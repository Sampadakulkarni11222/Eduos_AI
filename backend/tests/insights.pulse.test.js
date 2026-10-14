import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { WorkOrder } from '../src/models/facility.model.js';
import { Lead } from '../src/models/lead.model.js';
import * as lectures from '../src/modules/lectures/lecture.service.js';
import { pulse } from '../src/modules/insights/pulse.service.js';

/**
 * The dashboard's charts, feed and tiles: each role gets only what it may read,
 * empty data says so, and the briefing is built from the same figures.
 */

let school;
const inOak = (fn) => inSchool(OAK, fn);
const keys = (p) => p.charts.map((c) => c.key).sort();

beforeEach(async () => { school = await seedSchool(); });

describe('who sees which charts', () => {
  it('gives the principal the school-wide picture', async () => {
    const p = await inOak(() => pulse(school.people.PRINCIPAL.actor, { decisions: 2 }));
    expect(keys(p)).toEqual(expect.arrayContaining(['approvals', 'attendance', 'fees', 'repairs', 'compliance']));
    expect(p.briefing[1]).toBe('2 decisions are waiting on you.');
  });

  it('gives a teacher their own classes only, and no money', async () => {
    const p = await inOak(() => pulse(school.people.TEACHER.actor));
    expect(keys(p)).toContain('attendance');
    expect(keys(p)).not.toEqual(expect.arrayContaining(['fees']));
    expect(keys(p)).not.toContain('approvals');
    expect(p.charts.find((c) => c.key === 'attendance').title).toBe('Attendance in my classes');
    expect(p.departments.map((d) => d.key)).toEqual(['learning']);
  });

  it('gives a parent no school-wide figures at all', async () => {
    const p = await inOak(() => pulse(school.people.PARENT.actor));
    expect(keys(p)).toEqual(['classes']);
    expect(p.departments.map((d) => d.key)).toEqual(['learning']);
  });
});

describe('what the charts say', () => {
  it('draws today\'s attendance from the register, and counts no day without one', async () => {
    const p = await inOak(() => pulse(school.people.PRINCIPAL.actor));
    const att = p.charts.find((c) => c.key === 'attendance');
    // The fixture marks two students today: one present, one absent.
    expect(att.points).toHaveLength(1);
    expect(att.points[0]).toMatchObject({ value: 50, detail: '1 of 2 present' });
    expect(att.status).toBe('OK');
  });

  it('says a chart is empty rather than drawing zeros as data', async () => {
    const p = await inOak(() => pulse(school.people.PRINCIPAL.actor));
    expect(p.charts.find((c) => c.key === 'repairs')).toMatchObject({ status: 'EMPTY', emptyText: 'No open repairs.' });
  });

  it('ages open repairs and narrows the funnel stage by stage', async () => {
    const old = new Date(Date.now() - 10 * 86_400_000);
    await inOak(() => WorkOrder.collection.insertOne({ tenantId: OAK, refNo: 'WO-1', title: 'Leaking tap', status: 'OPEN', priority: 'URGENT', kind: 'CORRECTIVE', category: 'PLUMBING', reportedByProfileId: school.people.TEACHER.profile._id, createdAt: old, updatedAt: old }));
    await inOak(() => Lead.create([{ childName: 'A', guardianName: 'G', phone: '+919000000001', stage: 'NEW' }, { childName: 'B', guardianName: 'H', phone: '+919000000002', stage: 'ENROLLED' }]));
    const p = await inOak(() => pulse(school.people.PRINCIPAL.actor));
    const repairs = p.charts.find((c) => c.key === 'repairs');
    expect(repairs.points.find((x) => x.label === '1–4 weeks')).toMatchObject({ value: 1, detail: '1 urgent', tone: 'bad' });
    const funnel = p.charts.find((c) => c.key === 'funnel').points.map((x) => x.value);
    expect(funnel[0]).toBe(2);
    expect(funnel.at(-1)).toBe(1);
    expect([...funnel].sort((a, b) => b - a)).toEqual(funnel);
    expect(p.activity.some((a) => a.text === 'Reported: Leaking tap' && a.kind === 'urgent')).toBe(true);
  });

  it('counts the caller\'s online classes for today and mentions them in the briefing', async () => {
    await inOak(() => lectures.create(school.people.TEACHER.actor, { title: 'Algebra', sectionIds: [String(school.sectionA._id)], startsAt: new Date(Date.now() + 5 * 60_000).toISOString() }));
    const p = await inOak(() => pulse(school.people.STUDENT.actor));
    expect(p.charts.find((c) => c.key === 'classes').points[0]).toMatchObject({ label: 'Today', value: 1, detail: 'Algebra' });
    expect(p.briefing.join(' ')).toMatch(/1 online class today/);
  });
});
