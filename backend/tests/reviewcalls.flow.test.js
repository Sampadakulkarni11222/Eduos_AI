import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { DueItem } from '../src/models/dueItem.model.js';
import * as calls from '../src/modules/ptm/reviewcalls.service.js';
import * as tasks from '../src/modules/tasks/tasks.service.js';

/**
 * Parent review calls: private to the assigned person, the class teacher and
 * managers; fees reasons only for those who may see fees; attempts with a
 * channel suggestion after repeated failures; actions and follow-ups as tasks
 * that escalate when overdue; closure with an outcome.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

beforeEach(async () => { s = await seedFamilySchool(); });

describe('who sees a review call', () => {
  it('shows the case to the assigned teacher, the class teacher and the principal, not to other teachers', async () => {
    // The Maths teacher (a subject teacher) opens it for Rahul and assigns it to herself.
    const c = await inOak(() => calls.create(s.people.T2.actor, 'OWN', { studentId: String(s.rahul.student._id), reason: 'ACADEMICS', summary: 'Falling behind in fractions' }));
    await inOak(() => calls.addNote(s.people.T2.actor, 'OWN', c.id, { kind: 'CONTEXT', text: 'Missed three homework sets.' }));
    expect((await inOak(() => calls.get(s.people.TEACHER.actor, 'OWN', c.id))).notes).toHaveLength(1); // class teacher
    expect((await inOak(() => calls.get(s.people.PRINCIPAL.actor, 'ALL', c.id))).notes).toHaveLength(1);
    await expect(inOak(() => calls.get(s.people.T3.actor, 'OWN', c.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => calls.get(s.people.T4.actor, 'OWN', c.id))).rejects.toMatchObject({ statusCode: 404 });
    expect((await inOak(() => calls.list(s.people.T3.actor, 'OWN', {}))).total).toBe(0);
    // A teacher cannot open a case for a pupil they do not teach, nor a fees case.
    await expect(inOak(() => calls.create(s.people.T3.actor, 'OWN', { studentId: String(s.rahul.student._id), reason: 'ATTENDANCE' }))).rejects.toMatchObject({ code: 'NOT_YOUR_PUPIL' });
    await expect(inOak(() => calls.create(s.people.TEACHER.actor, 'OWN', { studentId: String(s.rahul.student._id), reason: 'FEES' }))).rejects.toMatchObject({ code: 'FEES_NOT_PERMITTED' });
    const fees = await inOak(() => calls.create(s.people.PRINCIPAL.actor, 'ALL', { studentId: String(s.rahul.student._id), reason: 'FEES', assignedProfileId: String(s.people.TEACHER.profile._id) }));
    expect(fees.assignedProfileId).toBe(String(s.people.TEACHER.profile._id));
    // Safeguarding concerns are not review-call notes.
    await expect(inOak(() => calls.addNote(s.people.T2.actor, 'OWN', c.id, { text: 'x', safeguarding: true }))).rejects.toMatchObject({ code: 'USE_SAFEGUARDING' });
  });
});

describe('working a case', () => {
  it('logs attempts, suggests another channel, turns actions into tasks that escalate, and closes', async () => {
    const T = s.people.TEACHER.actor;
    const c = await inOak(() => calls.create(T, 'OWN', { studentId: String(s.rahul.student._id), reason: 'ATTENDANCE', priority: 'HIGH' }));
    await inOak(() => calls.schedule(T, 'OWN', c.id, { scheduledAt: new Date(Date.now() + DAY).toISOString(), channel: 'PHONE' }));
    for (const ch of ['PHONE', 'PHONE', 'PHONE']) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => calls.logAttempt(T, 'OWN', c.id, { channel: ch, reached: false, note: 'No answer' }));
    }
    let m = await inOak(() => calls.metrics(s.people.PRINCIPAL.actor, 'ALL', {}));
    expect(m.openCases).toBe(1);
    expect(m.familiesNotReached).toHaveLength(1);
    expect(m.familiesNotReached[0].tryNext[0]).toBe('WHATSAPP');
    const reached = await inOak(() => calls.logAttempt(T, 'OWN', c.id, { channel: 'WHATSAPP', reached: true }));
    expect(reached.status).toBe('IN_PROGRESS');
    expect(reached.suggestion).toBeNull();
    // An action due yesterday: a task owned by the teacher, overdue, escalated by the tasks engine.
    const withAction = await inOak(() => calls.addAction(T, 'OWN', c.id, { title: 'Share the attendance plan', dueOn: new Date(Date.now() - 2 * DAY).toISOString() }));
    const action = withAction.actions[0];
    const task = await inOak(() => DueItem.findOne({ sourceKey: `reviewcall:${c.id}:action:${action.id}` }).lean());
    expect(String(task.ownerProfileId)).toBe(T.profileId);
    m = await inOak(() => calls.metrics(s.people.PRINCIPAL.actor, 'ALL', {}));
    expect(m.overdueActions).toBe(1);
    await inOak(() => tasks.runReminders({ now: new Date() }));
    expect((await inOak(() => DueItem.findById(task._id).lean())).escalationLevel).toBeGreaterThan(0);
    // Done from the case: the task closes too.
    const done = await inOak(() => calls.completeAction(T, 'OWN', c.id, action.id, { note: 'Plan sent' }));
    expect(done.actions[0].status).toBe('DONE');
    expect((await inOak(() => DueItem.findById(task._id).lean())).status).toBe('DONE');
    // The follow-up date is a task for the assigned teacher; closing the case resolves it.
    await inOak(() => calls.update(T, 'OWN', c.id, { nextFollowUpOn: new Date(Date.now() + 7 * DAY).toISOString() }));
    expect((await inOak(() => DueItem.findOne({ sourceKey: `reviewcall:${c.id}:followup` }).lean())).status).toBe('OPEN');
    await expect(inOak(() => calls.close(T, 'OWN', c.id, { outcome: 'IMPROVING' }))).rejects.toThrow(/note/);
    const closed = await inOak(() => calls.close(T, 'OWN', c.id, { outcome: 'IMPROVING', note: 'Attending daily since the call.' }));
    expect(closed.status).toBe('CLOSED');
    expect((await inOak(() => DueItem.findOne({ sourceKey: `reviewcall:${c.id}:followup` }).lean())).status).toBe('DONE');
    await expect(inOak(() => calls.logAttempt(T, 'OWN', c.id, { channel: 'PHONE', reached: true }))).rejects.toMatchObject({ code: 'CASE_CLOSED' });
  });
});
