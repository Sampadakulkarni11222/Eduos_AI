import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { ConversationThread, ConversationMessage } from '../src/models/conversation.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as conv from '../src/modules/conversations/conversations.service.js';

/**
 * Parent–teacher conversations: who may start one, read receipts, numbers
 * removed, principal oversight that is audited and leaves receipts alone,
 * the 48-hour unanswered queue, closing, and rate limiting.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const scope = (a) => a.permissions['conversations.use'];

beforeEach(async () => { s = await seedFamilySchool(); });

describe('who may start a conversation', () => {
  it('refuses an unrelated parent, a teacher of another class, and a parent writing to a teacher who does not teach the child', async () => {
    const rahul = String(s.rahul.student._id);
    await expect(inOak(() => conv.start(s.people.PARENT3.actor, scope(s.people.PARENT3.actor), { studentId: rahul, staffProfileId: String(s.people.TEACHER.profile._id), body: 'Hello' }))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
    await expect(inOak(() => conv.start(s.people.PARENT.actor, scope(s.people.PARENT.actor), { studentId: rahul, staffProfileId: String(s.people.T3.profile._id), body: 'Hello' }))).rejects.toMatchObject({ code: 'NOT_CHILDS_TEACHER' });
    await expect(inOak(() => conv.start(s.people.T3.actor, scope(s.people.T3.actor), { studentId: rahul, parentProfileId: String(s.people.PARENT.profile._id), body: 'Hello' }))).rejects.toMatchObject({ code: 'NOT_YOUR_PUPIL' });
    // A teacher of the child cannot write to someone who is not the child's guardian.
    await expect(inOak(() => conv.start(s.people.TEACHER.actor, scope(s.people.TEACHER.actor), { studentId: rahul, parentProfileId: String(s.people.PARENT2.profile._id), body: 'Hello' }))).rejects.toMatchObject({ code: 'NOT_GUARDIAN' });
    // The subject teacher and the principal are reachable.
    const ok = await inOak(() => conv.start(s.people.PARENT.actor, scope(s.people.PARENT.actor), { studentId: rahul, staffProfileId: String(s.people.T2.profile._id), body: 'About maths homework' }));
    expect(ok.staffRole).toBe('SUBJECT_TEACHER');
    const contacts = await inOak(() => conv.contacts(s.people.PARENT.actor, scope(s.people.PARENT.actor)));
    expect(contacts.children).toHaveLength(2);
    expect(JSON.stringify(contacts)).not.toMatch(/\+91/);
  });
});

describe('a conversation', () => {
  it('carries read receipts, removes phone numbers, appears on the 48-hour queue, and closes', async () => {
    const P = s.people.PARENT.actor; const T = s.people.TEACHER.actor;
    const t = await inOak(() => conv.start(P, scope(P), { studentId: String(s.rahul.student._id), staffProfileId: T.profileId, subject: 'Absence on Monday', body: 'He was unwell. Call me on +91 98765 43210.' }));
    expect(t.messages[0].body).toContain('[number removed]');
    expect(t.messages[0].body).not.toMatch(/98765/);
    expect(t.messages[0].readByOther).toBe(false);
    // Starting again adds to the same open thread.
    const again = await inOak(() => conv.start(P, scope(P), { studentId: String(s.rahul.student._id), staffProfileId: T.profileId, body: 'Also the bus.' }));
    expect(again.id).toBe(t.id);
    // The principal reads it for oversight: audited, and it does not count as the teacher reading it.
    const view = await inOak(() => conv.getThread(s.people.PRINCIPAL.actor, 'ALL', t.id));
    expect(view.oversight).toBe(true);
    expect(view.canReply).toBe(false);
    expect(await inOak(() => AuditLog.countDocuments({ action: 'conversation.read.oversight' }))).toBe(1);
    expect((await inOak(() => conv.getThread(P, scope(P), t.id))).messages[0].readByOther).toBe(false);
    // Unanswered for 49 hours: on the teacher's queue and the principal's.
    await inOak(() => ConversationThread.updateOne({ _id: t.id }, { $set: { awaitingStaffSince: new Date(Date.now() - 49 * 3_600_000) } }));
    expect((await inOak(() => conv.unansweredQueue(T, scope(T), {}))).total).toBe(1);
    expect((await inOak(() => conv.unansweredQueue(s.people.PRINCIPAL.actor, 'ALL', {}))).total).toBe(1);
    expect((await inOak(() => conv.unansweredQueue(s.people.T2.actor, scope(s.people.T2.actor), {}))).total).toBe(0);
    // The teacher opens it (receipts) and replies (off the queue).
    await inOak(() => conv.getThread(T, scope(T), t.id));
    await inOak(() => conv.reply(T, scope(T), t.id, { body: 'Thank you, noted.' }));
    const parentView = await inOak(() => conv.getThread(P, scope(P), t.id));
    expect(parentView.messages[0].readByOther).toBe(true);
    expect((await inOak(() => conv.unansweredQueue(T, scope(T), {}))).total).toBe(0);
    // Others cannot read or write.
    await expect(inOak(() => conv.getThread(s.people.T3.actor, scope(s.people.T3.actor), t.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => conv.getThread(s.people.PARENT2.actor, scope(s.people.PARENT2.actor), t.id))).rejects.toMatchObject({ statusCode: 404 });
    // Only staff close; then nobody writes.
    await expect(inOak(() => conv.close(P, scope(P), t.id))).rejects.toMatchObject({ code: 'NOT_STAFF' });
    await inOak(() => conv.close(T, scope(T), t.id, { note: 'Resolved' }));
    await expect(inOak(() => conv.reply(P, scope(P), t.id, { body: 'One more thing' }))).rejects.toMatchObject({ code: 'THREAD_CLOSED' });
  });

  it('rate-limits a parent who sends too many messages', async () => {
    const P = s.people.PARENT.actor;
    const t = await inOak(() => conv.start(P, scope(P), { studentId: String(s.rahul.student._id), staffProfileId: s.people.TEACHER.actor.profileId, body: 'm1' }));
    await inOak(() => ConversationMessage.insertMany(Array.from({ length: 9 }, (_, i) => ({ threadId: t.id, senderProfileId: P.profileId, side: 'PARENT', body: `x${i}`, tenantId: OAK }))));
    await expect(inOak(() => conv.reply(P, scope(P), t.id, { body: 'again' }))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
