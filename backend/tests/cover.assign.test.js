import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { CoverAssignment } from '../src/models/staffLeave.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as leave from '../src/modules/staff/staffLeave.service.js';
import * as cover from '../src/modules/staff/cover.service.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';
import { pinClock } from './support/clock.js';

// Built around "today": runs on a school day (next Wednesday morning IST), not on whatever day CI runs.
pinClock();

/**
 * Substitute cover: an absence produces the affected periods; candidates are
 * free, present and within limits; a period is covered once and a substitute
 * covers one class at a time (also under concurrency); everyone is told once;
 * the substitute may mark exactly the covered period's register.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
// Read per test, after the clock is pinned: a value taken when the file loads
// is the real date, not the pinned school day the services see.
let today;
const P = () => s.people.PRINCIPAL.actor;

beforeEach(async () => { today = ymdIn(0); s = await seedFamilySchool(); });

const absent = (who) => inOak(() => cover.markAbsent(P(), 'ALL', { profileId: s.people[who].actor.profileId, date: today, reason: 'Unwell' }));
const assign = (body) => inOak(() => cover.assign(P(), 'ALL', { date: today, ...body }));

describe('cover needs and proposals', () => {
  it('lists an absent teacher\'s periods and ranks free substitutes, excluding busy ones', async () => {
    await absent('TEACHER');
    const needs = await inOak(() => cover.needs(P(), 'ALL', { date: today }));
    expect(needs.absent).toHaveLength(1);
    expect(needs.absent[0].periods.map((p) => [p.className, p.periodNo, p.subject])).toEqual([['Class 6 A', 1, 'English']]);
    const { candidates } = await inOak(() => cover.candidates(P(), 'ALL', { date: today, sectionId: String(s.sectionA._id), periodNo: 1 }));
    const by = Object.fromEntries(candidates.map((c) => [c.name, c]));
    expect(by['Maths teacher'].eligible).toBe(true); // free in P1, teaches the class
    expect(by['Maths teacher'].sameClass).toBe(true);
    expect(by['Free teacher'].eligible).toBe(true);
    expect(by['Science teacher (6 B)'].eligible).toBe(false); // teaching 6 B in P1
    expect(candidates[0].name).toBe('Maths teacher');
  });

  it('counts an approved leave as an absence', async () => {
    if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) return; // a Sunday is never a leave day
    await inOak(() => leave.initBalances(s.people.HR.actor, 'ALL', { leaveYear: leave.leaveYearOf(new Date()) }));
    const app = await inOak(() => leave.apply(s.people.TEACHER.actor, 'OWN', { code: 'CL', fromDate: today, reason: 'Unwell' }));
    await inOak(() => leave.decide(s.people.HR.actor, 'ALL', app.id, { action: 'APPROVE' }));
    const needs = await inOak(() => cover.needs(P(), 'ALL', { date: today }));
    expect(needs.absent[0]).toMatchObject({ source: 'LEAVE', uncovered: 1 });
  });
});

describe('confirming cover', () => {
  it('covers a period once, never double-books a substitute, and notifies once', async () => {
    await absent('TEACHER');
    await absent('T3');
    const c = await assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: s.people.T4.actor.profileId });
    expect(c.status).toBe('CONFIRMED');
    await expect(assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: s.people.T2.actor.profileId })).rejects.toMatchObject({ code: 'ALREADY_COVERED' });
    // T4 is now busy in P1: cannot also take 6 B in P1.
    await expect(assign({ sectionId: String(s.sectionB._id), periodNo: 1, substituteProfileId: s.people.T4.actor.profileId })).rejects.toMatchObject({ code: 'SUBSTITUTE_BUSY' });
    // The absent teacher, the substitute and the class teacher (the same person here) get one message; a repeat sends nothing.
    const staffMsgs = await inOak(() => MessageOutbox.find({ idempotencyKey: `cover:${c.id}:staff` }).lean());
    expect(new Set(staffMsgs.map((m) => String(m.recipientProfileId)))).toEqual(new Set([s.people.TEACHER.actor.profileId, s.people.T4.actor.profileId]));
    const studentMsgs = await inOak(() => MessageOutbox.countDocuments({ idempotencyKey: `cover:${c.id}:class` }));
    expect(studentMsgs).toBe(0); // in-app only for the class: no outbox rows, a notification instead
    const map = await inOak(() => cover.coverFor(today));
    expect(map).toEqual([expect.objectContaining({ key: `${s.sectionA._id}:1`, substituteName: 'Free teacher', absentName: 'TEACHER user' })]);
  });

  it('lets only one of two coordinators confirm the same period at once', async () => {
    await absent('TEACHER');
    const results = await Promise.allSettled([
      assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: s.people.T4.actor.profileId }),
      assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: s.people.T2.actor.profileId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await inOak(() => CoverAssignment.countDocuments({ status: 'CONFIRMED' }))).toBe(1);
  });

  it('enforces the daily cover limit unless an override reason is given', async () => {
    await inOak(() => cover.setRules(P(), 'ALL', { maxPerDay: 1 }));
    await absent('TEACHER'); await absent('T2');
    await assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: s.people.T4.actor.profileId });
    await expect(assign({ sectionId: String(s.sectionA._id), periodNo: 2, substituteProfileId: s.people.T4.actor.profileId })).rejects.toMatchObject({ code: 'OVER_LIMIT' });
    const ok = await assign({ sectionId: String(s.sectionA._id), periodNo: 2, substituteProfileId: s.people.T4.actor.profileId, overrideReason: 'Nobody else free' });
    expect(ok.overrideReason).toBe('Nobody else free');
  });
});

describe('the substitute marks attendance', () => {
  const T4 = () => s.people.T4.actor;
  const mark = (periodNo, date = today) => inOak(() => attendance.markAttendance(T4(), 'OWN', {
    sectionId: String(s.sectionA._id), date, periodNo, entries: [{ enrollmentId: String(s.rahul.enrollment._id), status: 'PRESENT' }],
  }));

  it('may mark exactly the covered period, and nothing else', async () => {
    await expect(mark(1)).rejects.toMatchObject({ statusCode: 403 }); // no cover yet
    await absent('TEACHER');
    await assign({ sectionId: String(s.sectionA._id), periodNo: 1, substituteProfileId: T4().profileId });
    await mark(1);
    const roster = await inOak(() => attendance.getRoster(T4(), 'OWN', String(s.sectionA._id), today, 1));
    expect(roster.canMark).toBe(true);
    await expect(mark(2)).rejects.toMatchObject({ statusCode: 403 });
    await expect(mark(null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => attendance.getRoster(T4(), 'OWN', String(s.sectionA._id), today, 2))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => attendance.getRoster(T4(), 'OWN', String(s.sectionB._id), today, 1))).rejects.toMatchObject({ statusCode: 403 });
    // Cancelled cover takes the access away again.
    const c = await inOak(() => CoverAssignment.findOne({}).lean());
    await inOak(() => cover.cancelCover(P(), 'ALL', String(c._id), { reason: 'Teacher came in' }));
    await expect(mark(1)).rejects.toMatchObject({ statusCode: 403 });
  });
});
