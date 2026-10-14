import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { LeaveBalance } from '../src/models/staffLeave.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import * as leave from '../src/modules/staff/staffLeave.service.js';

/**
 * Staff leave balances: deducted only on approval (never below zero, never by
 * the applicant), restored on cancellation, half days, Sundays and holidays
 * not counted, carry-forward capped, and LOP days in the shape payroll takes.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const T = () => s.people.TEACHER.actor;
const HR = () => s.people.HR.actor;
const bal = async (code, actor = T()) => (await inOak(() => leave.balanceFor(actor, 'OWN', { leaveYear: '2026-27' }))).balances.find((b) => b.code === code);

beforeEach(async () => {
  s = await seedFamilySchool();
  await inOak(() => leave.initBalances(HR(), 'ALL', { leaveYear: '2026-27' }));
});

describe('balances', () => {
  it('sets up the year for every member of staff, idempotently', async () => {
    const again = await inOak(() => leave.initBalances(HR(), 'ALL', { leaveYear: '2026-27' }));
    expect(again.created).toBe(0);
    expect(await bal('CL')).toMatchObject({ entitled: 12, used: 0, available: 12 });
    expect((await bal('LWP')).tracksBalance).toBe(false);
  });

  it('carries forward unused earned leave up to the cap, and lets casual leave lapse', async () => {
    await inOak(() => LeaveBalance.updateOne({ profileId: T().profileId, leaveYear: '2026-27', code: 'EL' }, { $set: { carriedForward: 25, used: 2 } }));
    await inOak(() => leave.initBalances(HR(), 'ALL', { leaveYear: '2027-28' }));
    const next = (await inOak(() => leave.balanceFor(T(), 'OWN', { leaveYear: '2027-28' }))).balances;
    expect(next.find((b) => b.code === 'EL').carriedForward).toBe(30); // 15 + 25 - 2 = 38, capped at 30
    expect(next.find((b) => b.code === 'CL').carriedForward).toBe(0);
  });
});

describe('applying and deciding', () => {
  it('deducts only on approval, refuses self-approval and overdrawing, and restores on cancellation', async () => {
    // Mon 2 Nov to Wed 4 Nov 2026, with Tue 3 Nov a school holiday: 2 working days.
    await inOak(() => CalendarEvent.create({ title: 'Holiday', type: 'HOLIDAY', startsAt: new Date('2026-11-03T03:00:00Z'), endsAt: new Date('2026-11-03T12:00:00Z') }));
    const app = await inOak(() => leave.apply(T(), 'OWN', { code: 'CL', fromDate: '2026-11-02', toDate: '2026-11-04', reason: 'Family function' }));
    expect(app.days).toBe(2);
    expect(await bal('CL')).toMatchObject({ used: 0, pending: 2, availableAfterPending: 10 });
    await expect(inOak(() => leave.apply(T(), 'OWN', { code: 'CL', fromDate: '2026-11-04', reason: 'x' }))).rejects.toMatchObject({ code: 'LEAVE_OVERLAP' });
    await expect(inOak(() => leave.decide(T(), 'OWN', app.id, { action: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 403 });
    const hrLeave = await inOak(() => leave.apply(HR(), 'OWN', { code: 'CL', fromDate: '2026-11-09', reason: 'x' }));
    await expect(inOak(() => leave.decide(HR(), 'ALL', hrLeave.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    const approved = await inOak(() => leave.decide(HR(), 'ALL', app.id, { action: 'APPROVE' }));
    expect(approved.status).toBe('APPROVED');
    expect(await bal('CL')).toMatchObject({ used: 2, available: 10 });
    await expect(inOak(() => leave.decide(HR(), 'ALL', app.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'LEAVE_DECIDED' });
    const cancelled = await inOak(() => leave.cancel(T(), 'OWN', app.id, { reason: 'Function postponed' }));
    expect(cancelled.status).toBe('CANCELLED');
    expect(await bal('CL')).toMatchObject({ used: 0, available: 12 });
  });

  it('allows half days only where the policy does, and refuses more than the balance', async () => {
    const half = await inOak(() => leave.apply(T(), 'OWN', { code: 'SL', fromDate: '2026-11-10', halfDay: 'FIRST_HALF', reason: 'Doctor' }));
    expect(half.days).toBe(0.5);
    await expect(inOak(() => leave.apply(T(), 'OWN', { code: 'EL', fromDate: '2026-11-11', halfDay: 'FIRST_HALF', reason: 'x' }))).rejects.toMatchObject({ code: 'NO_HALF_DAY' });
    await expect(inOak(() => leave.apply(T(), 'OWN', { code: 'CL', fromDate: '2026-11-16', toDate: '2026-11-30', reason: 'Long trip' }))).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    // Two pending applications that each fit but together overdraw: the second approval fails.
    await inOak(() => LeaveBalance.updateOne({ profileId: T().profileId, leaveYear: '2026-27', code: 'PL' }, { $set: { entitled: 3 } }));
    const a = await inOak(() => leave.apply(T(), 'OWN', { code: 'PL', fromDate: '2026-12-01', toDate: '2026-12-02', reason: 'a' }));
    await inOak(() => LeaveBalance.updateOne({ profileId: T().profileId, leaveYear: '2026-27', code: 'PL' }, { $set: { used: 2 } }));
    await expect(inOak(() => leave.decide(HR(), 'ALL', a.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect((await bal('PL')).used).toBe(2);
  });

  it('sums leave without pay as LOP days for payroll', async () => {
    const lwp = await inOak(() => leave.apply(T(), 'OWN', { code: 'LWP', fromDate: '2026-11-02', toDate: '2026-11-07', reason: 'Personal' }));
    await inOak(() => leave.decide(HR(), 'ALL', lwp.id, { action: 'APPROVE' }));
    const half = await inOak(() => leave.apply(s.people.T2.actor, 'OWN', { code: 'LWP', fromDate: '2026-11-05', halfDay: 'SECOND_HALF', reason: 'x' }));
    await inOak(() => leave.decide(HR(), 'ALL', half.id, { action: 'APPROVE' }));
    const lop = await inOak(() => leave.lopSummary(HR(), 'ALL', { from: '2026-11-01', to: '2026-11-30' }));
    const byId = Object.fromEntries(lop.payrollBody.inputs.map((i) => [i.profileId, i.lopDays]));
    expect(byId[T().profileId]).toBe(6); // Mon–Sat
    expect(byId[s.people.T2.actor.profileId]).toBe(0.5);
    await expect(inOak(() => leave.lopSummary(T(), 'OWN', { from: '2026-11-01', to: '2026-11-30' }))).rejects.toMatchObject({ statusCode: 403 });
  });
});
