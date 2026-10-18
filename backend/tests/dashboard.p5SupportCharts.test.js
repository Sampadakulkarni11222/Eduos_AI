import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { roleDashboard } from '../src/modules/insights/dashboards.service.js';
import { HealthVisit, HealthStock, CareNote } from '../src/models/health.model.js';
import { HostelRollCall, ReadingChallenge } from '../src/models/supportRoles.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { encrypt } from '../src/utils/crypto.js';

/**
 * Part 5 dashboard charts for the support roles: the nurse's health-room
 * dashboard (visits by week and reason, care notes waiting, stock by expiry),
 * the warden's roll-call exceptions trend and the librarian's reading-challenge
 * progress. Health stays with the nurse: the dashboard is built only for a
 * nurse holding health.manage at ALL, and it never carries a name or a complaint.
 */

let school;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const chartOf = (d, key) => d.charts.find((c) => c.key === key);
const kpiOf = (d, key) => d.kpis.find((k) => k.key === key);
const sum = (pts) => pts.reduce((n, p) => n + (p.value ?? 0), 0);
const nurse = () => ({ ...school.people.PRINCIPAL.actor, roleKey: 'NURSE', permissions: { 'health.manage': 'ALL', 'health.read': 'ALL' } });
const ymd = (d) => d.toISOString().slice(0, 10);

beforeEach(async () => { school = await seedSchool(); });

async function healthRecords() {
  return inOak(async () => {
    const now = Date.now();
    const visit = (n, studentId, complaint, extra = {}) => HealthVisit.create({ refNo: `HV-${n}`, studentId, arrivedAt: new Date(now - extra.ago * DAY), outcome: extra.outcome ?? 'RETURNED_TO_CLASS', injury: Boolean(extra.injury), complaintEnc: encrypt(complaint) });
    await visit(1, school.rahul.student._id, 'High fever and chills', { ago: 0, outcome: 'SENT_HOME' });
    await visit(2, school.priya.student._id, 'Fever since morning', { ago: 2 });
    await visit(3, school.aman.student._id, 'Stomach ache', { ago: 9, outcome: 'REST' });
    await visit(4, school.riya.student._id, 'Fell in the playground', { ago: 1, injury: true, outcome: 'FIRST_AID' });
    await visit(5, school.riya.student._id, 'Old visit outside the period', { ago: 120 });
    await HealthStock.create({ name: 'Paracetamol syrup', quantity: 2, reorderLevel: 5, expiresOn: new Date(now - 3 * DAY) });
    await HealthStock.create({ name: 'Bandages', quantity: 40, reorderLevel: 10, expiresOn: new Date(now + 10 * DAY) });
    await HealthStock.create({ name: 'ORS', quantity: 30, reorderLevel: 10, expiresOn: new Date(now + 60 * DAY) });
    await HealthStock.create({ name: 'Thermometer', kind: 'EQUIPMENT', quantity: 2, reorderLevel: 1, expiresOn: null });
    await CareNote.create({ studentId: school.rahul.student._id, textEnc: encrypt('Severe peanut allergy, EpiPen in the health room'), severity: 'SEVERE', shareConsent: { granted: false } });
    await CareNote.create({ studentId: school.priya.student._id, textEnc: encrypt('Asthma inhaler in bag'), severity: 'IMPORTANT', shareConsent: { granted: true, byName: 'Parent', at: new Date() } });
    await CareNote.create({ studentId: school.aman.student._id, textEnc: encrypt('Wears glasses'), severity: 'INFO', shareConsent: { granted: false, byName: 'Parent', at: new Date() } });
  });
}

describe('nurse dashboard', () => {
  it('counts visits by week and by reason, stock by expiry and care notes waiting for the family', async () => {
    await healthRecords();
    const d = await inOak(() => roleDashboard(nurse(), { days: 30 }));
    expect(d.view).toBe('nurse');
    expect(kpiOf(d, 'visitsToday').value).toBe(1);
    expect(kpiOf(d, 'visits').value).toBe(4); // the 120-day-old visit is outside 30 days
    expect(sum(chartOf(d, 'visitsWeek').points)).toBe(4);
    const reasons = Object.fromEntries(chartOf(d, 'reasons').points.map((p) => [p.label, p.value]));
    expect(reasons).toEqual({ 'Fever / flu-like': 2, 'Stomach / vomiting / diarrhoea': 1, Injury: 1 });
    // One reason at a time.
    expect(chartOf(d, 'visitsWeek').variants.map((v) => v.label)).toEqual(['All visits', 'Injury', 'Fever / flu-like', 'Stomach / vomiting / diarrhoea']);
    const stock = Object.fromEntries(chartOf(d, 'stock').points.map((p) => [p.label, p.value]));
    expect(stock).toEqual({ Expired: 1, 'Within 30 days': 1, '31–90 days': 1 });
    expect(kpiOf(d, 'expiring')).toMatchObject({ value: 2, tone: 'bad' });
    expect(kpiOf(d, 'expiring').detail).toContain('1 item below reorder level');
    // Rahul's severe note has no answer yet; Aman's family declined (answered); Priya's is shared.
    expect(kpiOf(d, 'careDue')).toMatchObject({ value: 1, tone: 'bad' });
    expect(Object.fromEntries(chartOf(d, 'careNotes').points.map((p) => [p.label, p.value]))).toEqual({ Severe: 1, Important: 0, 'For information': 0 });
  });

  it('never carries a child\'s name or the complaint text', async () => {
    await healthRecords();
    const d = await inOak(() => roleDashboard(nurse(), { days: 30 }));
    const text = JSON.stringify(d);
    for (const word of ['Rahul', 'Priya', 'Aman', 'Riya', 'peanut', 'chills', 'playground', 'EpiPen']) expect(text).not.toContain(word);
  });

  it('is built only for a nurse who holds health.manage at ALL', async () => {
    await healthRecords();
    const partial = { ...nurse(), permissions: { 'health.read': 'ALL', 'health.manage': 'OWN' } };
    expect((await inOak(() => roleDashboard(partial, {}))).view).toBeNull();
    // Holding the permission under another role does not open it either.
    for (const r of ['PRINCIPAL', 'ADMIN', 'TEACHER']) {
      const a = { ...school.people[r].actor, permissions: { ...school.people[r].actor.permissions, 'health.manage': 'ALL' } };
      expect((await inOak(() => roleDashboard(a, {}))).view).not.toBe('nurse');
    }
  });

  it('says so when there is nothing to chart', async () => {
    const d = await inOak(() => roleDashboard(nurse(), {}));
    expect(chartOf(d, 'visitsWeek').status).toBe('EMPTY');
    expect(chartOf(d, 'stock').status).toBe('EMPTY');
    expect(kpiOf(d, 'careDue')).toMatchObject({ value: 0, tone: 'good' });
  });
});

describe('warden roll-call exceptions', () => {
  it('counts absent, late, sick bay and unmarked residents in submitted roll calls each week', async () => {
    await inOak(async () => {
      const today = new Date();
      const e = (s, status) => ({ studentId: s.student._id, name: s.student.firstName, status });
      await HostelRollCall.create({ date: ymd(today), session: 'NIGHT', submittedAt: new Date(), entries: [e(school.rahul, 'ABSENT'), e(school.priya, 'PRESENT'), e(school.aman, 'UNMARKED')] });
      await HostelRollCall.create({ date: ymd(new Date(Date.now() - 8 * DAY)), session: 'NIGHT', submittedAt: new Date(), entries: [e(school.rahul, 'LATE'), e(school.priya, 'SICK_BAY'), e(school.aman, 'ON_LEAVE')] });
      // A roll call still being taken is not counted.
      await HostelRollCall.create({ date: ymd(new Date(Date.now() - 2 * DAY)), session: 'MORNING', submittedAt: null, entries: [e(school.rahul, 'ABSENT')] });
    });
    const d = await inOak(() => roleDashboard(school.people.WARDEN.actor, { days: 30 }));
    const c = chartOf(d, 'rollcall');
    expect(c.status).toBe('OK');
    expect(sum(c.points)).toBe(4);
    expect(c.points.at(-1).value).toBe(2);
    expect(c.points[0].value).toBeNull(); // no roll call that week: blank, not 0
    const absent = c.variants.find((v) => v.label === 'Absent');
    expect(sum(absent.points)).toBe(1);
    expect(kpiOf(d, 'unaccounted')).toMatchObject({ value: 2, tone: 'bad' });
    expect(chartOf(d, 'occupancy')).toBeTruthy(); // existing charts stay
  });
});

describe('librarian reading challenges', () => {
  it('shows each active challenge as the share of readers who finished', async () => {
    await inOak(async () => {
      const start = new Date(Date.now() - 20 * DAY);
      await ReadingChallenge.create({ title: '2 books in October', sectionIds: [school.sectionA._id], startsOn: start, endsOn: new Date(Date.now() + 10 * DAY), targetBooks: 2 });
      await ReadingChallenge.create({ title: 'Closed one', startsOn: start, endsOn: new Date(Date.now() + 10 * DAY), targetBooks: 1, status: 'CLOSED' });
      const books = await Book.create([{ title: 'A', author: 'X' }, { title: 'B', author: 'Y' }]);
      const loan = (s, b, ago) => BookIssue.create({ bookId: b._id, borrowerProfileId: s.student._id, issuedAt: new Date(Date.now() - ago * DAY), dueDate: new Date(), returnedAt: new Date(), status: 'RETURNED' });
      await loan(school.rahul, books[0], 10); await loan(school.rahul, books[1], 5); // Rahul finished
      await loan(school.priya, books[0], 4); // Priya started
    });
    const d = await inOak(() => roleDashboard(school.people.LIBRARIAN.actor, {}));
    const c = chartOf(d, 'reading');
    expect(c.points).toHaveLength(1);
    expect(c.points[0]).toMatchObject({ label: '2 books in October', value: 33.3 });
    expect(c.points[0].detail).toContain('1 of 3 readers finished, 2 started');
    expect(JSON.stringify(c)).not.toContain('Rahul');
    expect(chartOf(d, 'issues')).toBeTruthy();
  });
});

describe('briefing for the library and the hostel', () => {
  it('tells the librarian about overdue loans instead of "nothing needs your attention"', async () => {
    const { pulse } = await import('../src/modules/insights/pulse.service.js');
    await inOak(async () => {
      const book = await Book.create({ title: 'Late book', author: 'Z' });
      await BookIssue.create({ bookId: book._id, borrowerProfileId: school.rahul.student._id, issuedAt: new Date(Date.now() - 30 * DAY), dueDate: new Date(Date.now() - 10 * DAY), status: 'ACTIVE' });
    });
    const p = await inOak(() => pulse(school.people.LIBRARIAN.actor));
    expect(p.briefing).toContain('Library: 1 loan overdue.');
    expect(p.briefing.join(' ')).not.toContain('Nothing needs your attention');
    expect(p.briefingSources.some((s) => s.link === '/library-desk')).toBe(true);
    // Not for another role.
    const t = await inOak(() => pulse(school.people.TEACHER.actor));
    expect(t.briefing.join(' ')).not.toContain('Library:');
  });
});

describe('campus my-view follows a staff preview time (part 5)', () => {
  it('passes the previewed moment to the teacher view, and ignores it for families', async () => {
    const express = (await import('express')).default;
    const { campusRouter } = await import('../src/modules/campus/campus.routes.js');
    const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
    const { signAccessToken } = await import('../src/utils/jwt.js');
    const app = express(); app.use(express.json()); app.use('/api/v1/campus', campusRouter); app.use(notFoundHandler); app.use(errorHandler);
    const server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/campus`;
    const get = async (person, path) => {
      const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
      const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': OAK } });
      return { status: res.status, body: await res.json() };
    };
    try {
      const ymdIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const t = await get(school.people.TEACHER, `/my-view?date=${ymdIst}&at=10:30`);
      expect(t.status).toBe(200);
      expect(new Date(t.body.data.asOf).toISOString()).toBe(new Date(`${ymdIst}T10:30:00+05:30`).toISOString());
      const p = await get(school.people.PARENT, `/my-view?date=${ymdIst}&at=10:30`);
      expect(p.status).toBe(200);
      expect(Math.abs(new Date(p.body.data.asOf).getTime() - Date.now())).toBeLessThan(60_000);
    } finally { await new Promise((r) => server.close(r)); }
  });
});
