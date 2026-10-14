import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Assignment } from '../src/models/assignment.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { WhatsappConversation, WhatsappMessage } from '../src/models/whatsappConversation.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { toWhatsAppText } from '../src/modules/ai/agent/present.js';
import { weekdayDateIn, toIsoDate } from '../src/utils/naturalDates.js';
import { env } from '../src/config/env.js';
import { startApi } from './support/mcpHttp.js';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAskAiSchool, INTERNAL_LEAKS } from './support/askAiSchool.js';

/**
 * The two WhatsApp conversations from the bug report, end to end, through the
 * real doors: a signed Meta webhook for WhatsApp and POST /ai/agent for the
 * website. Everything asserted about a write is read back from the database --
 * what was created, how many times, for which class -- never taken from the
 * reply that claims it.
 *
 * 1. ASSIGNMENT
 *      "Create an assignment for class 6th b science chapter 4 questions due Friday"
 *      "Title: Assignment 5"      → asked "Which class did you mean?"
 *      "6 B science"              → asked again
 *      "Science - 6 B"            → asked again
 *
 * 2. ANNOUNCEMENT
 *      "Post an announcement for class 6b science practical on Monday"
 *                                 → proposed the announcement "Monday"
 *      "Yes"                      → a reply about Samsung and iPhone phones,
 *                                   then "The announcement has been posted."
 *
 * Both writes land on other people (a class's homework, a class's notice), and
 * such a change is no longer confirmed over WhatsApp: a bare "yes" from a phone
 * is not enough for it (registry.js confirmableOn). WhatsApp now sends the
 * teacher to the website, and the conversations themselves are replayed on the
 * website, turn by turn, with the same words -- `site()` below keeps the
 * transcript and answers "yes"/"no" with the confirm button, as ask-eduos.tsx
 * does.
 */

let api;
let school;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

beforeEach(async () => {
  resetAgentThrottle();
  sessions.clear();
  school = await seedAskAiSchool();
});
afterEach(() => { vi.restoreAllMocks(); });

const teacher = () => school.people.TEACHER;
const count = (Model, filter = {}) => inSchool(OAK, () => Model.countDocuments(filter));
const expectNoLeak = (reply) => {
  for (const leak of INTERNAL_LEAKS) expect(String(reply), `leaked: ${leak}`).not.toMatch(leak);
};

/** A WhatsApp turn through the signed webhook. */
async function wa(person, text) {
  resetAgentThrottle();
  return api.whatsapp(person, text);
}

/** The same webhook delivery sent again, byte for byte -- what Meta does when it gets no 200. */
async function deliver(person, text, id) {
  resetAgentThrottle();
  const payload = {
    entry: [{ changes: [{ value: { messages: [{ id, from: person.phone.replace('+', ''), type: 'text', text: { body: text } }] } }] }],
  };
  const raw = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex')}`;
  const res = await fetch(`${api.base}/whatsapp/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw,
  });
  const body = await res.json();
  return { status: res.status, reply: body.data?.replies?.[0]?.reply ?? null, skipped: body.data?.replies?.[0]?.skipped ?? null, body };
}

/** A website conversation with the transcript ask-eduos.tsx sends. */
async function web(person, turns) {
  const history = [];
  const replies = [];
  for (const message of turns) {
    resetAgentThrottle();
    const res = await api.post(person, '/ai/agent', { message, source: 'WEB', history: [...history] });
    const data = { status: res.status, ...(res.body.data ?? {}), reply: res.body.data?.reply ?? res.body.message };
    replies.push(data);
    history.push({ role: 'user', text: message }, { role: 'assistant', text: String(data.reply ?? '') });
  }
  return replies;
}

/**
 * A website conversation, a turn at a time: the transcript is kept as the
 * page keeps it, and "yes" / "no" press the confirm button on the newest
 * proposal -- the website's equivalent of the WhatsApp turns these tests were
 * first written as.
 */
const sessions = new Map();
const YES_NO = /^\s*(yes|y|no|n)\s*[.!]?\s*$/i;
async function site(person, text) {
  resetAgentThrottle();
  const key = String(person.actor.profileId);
  const state = sessions.get(key) ?? { history: [], token: null };
  sessions.set(key, state);
  let out;
  if (YES_NO.test(text)) {
    if (!state.token) {
      out = { status: 200, reply: "There's nothing waiting for your confirmation right now." };
    } else {
      const res = await api.confirm(person, state.token, /^\s*y/i.test(text));
      state.token = null;
      out = { ...res, reply: res.reply ?? res.body?.message ?? '' };
    }
  } else {
    const res = await api.post(person, '/ai/agent', { message: text, source: 'WEB', history: [...state.history] });
    const data = res.body.data ?? {};
    state.token = data.action?.confirmToken ?? null;
    out = { status: res.status, ...data, reply: data.reply ?? res.body.message ?? '' };
  }
  state.history.push({ role: 'user', text }, { role: 'assistant', text: String(out.reply ?? '') });
  return out;
}
const ASKS_TO_CONFIRM = /Shall I go ahead\?|Reply YES/i;

const nextFriday = () => weekdayDateIn('Friday', new Date(), { prefer: 'future' }).iso;
const science6B = () => String(school.offerings.s6b._id);
const assignmentsFor6B = () => inSchool(OAK, () => Assignment.find({ subjectOfferingId: school.offerings.s6b._id }).lean());
const outboundAfter = async (person, since) => {
  const convo = await WhatsappConversation.findOne({ phone: person.phone.replace(/\D/g, '') });
  return WhatsappMessage.find({ conversationId: convo._id, direction: 'OUTBOUND', createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
};

/* ════════════════════════════════════════════════════════════
   1. ASSIGNMENT CREATION
   ════════════════════════════════════════════════════════════ */

describe('Website — creating an assignment (the reported conversation)', () => {
  const REQUEST = 'Create an assignment for class 6th b science chapter 4 questions due Friday';

  it('asks only for the title, then proposes the assignment the teacher described', async () => {
    const first = await site(teacher(), REQUEST);
    // The class, the subject and the due date were all in the request: the
    // one thing missing is the title, and that is the one thing asked for.
    expect(first.reply).toMatch(/Tell me a title/);
    expect(first.reply).not.toMatch(/which class|due date/i);

    const second = await site(teacher(), 'Title: Assignment 5');
    // Never the class question again -- the loop the screenshot shows.
    expect(second.reply).not.toMatch(/Which class did you mean/i);
    expect(second.reply).toContain(`Set "Assignment 5" (Science) for Class 6 B, due ${nextFriday()}`);
    expect(second.reply).toMatch(/Science chapter 4 questions/);
    expect(second.reply).toMatch(ASKS_TO_CONFIRM);
    // A proposal, not a write.
    expect(await assignmentsFor6B()).toHaveLength(0);
  }, 90_000);

  it('creates exactly that assignment on YES, and says what was created', async () => {
    await site(teacher(), REQUEST);
    await site(teacher(), 'Title: Assignment 5');
    const done = await site(teacher(), 'Yes');

    const created = await assignmentsFor6B();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'Assignment 5', description: 'Science chapter 4 questions' });
    expect(String(created[0].subjectOfferingId)).toBe(science6B());
    expect(new Date(created[0].dueAt).toISOString().slice(0, 10)).toBe(nextFriday());
    // Marks were never mentioned ("chapter 4", "Assignment 5" are not marks).
    expect(created[0].maxMarks ?? null).not.toBe(4);
    expect(created[0].maxMarks ?? null).not.toBe(5);

    expect(done.reply).toBe('"Assignment 5" has been set for Class 6 B Science.');
    const audited = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.create_assignment', 'after.status': 'EXECUTED' }).lean());
    expect(audited?.after?.confirmed).toBe(true);
    expect(audited?.channel).toBe('WEB');
  }, 120_000);

  it.each([
    ['6 B science'],
    ['Science - 6 B'],
    ['Science, Class 6 B'],
    ['6th B Science'],
    ['class 6b science'],
  ])('"%s" answers the class question the first time it is given', async (answer) => {
    await site(teacher(), 'Create an assignment due Friday');
    const asked = await site(teacher(), 'Assignment 5');
    // No class or subject yet: this is where the question belongs, once.
    expect(asked.reply).toMatch(/Which class and subject did you mean\? You teach: /);
    expect(asked.reply).toMatch(/Science — Class 6 B/);

    const answered = await site(teacher(), answer);
    expect(answered.reply, answer).not.toMatch(/Which class/i);
    expect(answered.reply, answer).toContain(`Set "Assignment 5" (Science) for Class 6 B, due ${nextFriday()}`);
    await site(teacher(), 'yes');
    expect(await assignmentsFor6B()).toHaveLength(1);
  }, 120_000);

  it('asks only for the subject when the class is settled and the teacher has two there', async () => {
    // Class 5 A: this teacher has both Mathematics and Science.
    const replies = await web(teacher(), ['Create an assignment for Class 5 A titled Revision due tomorrow', 'Science']);
    expect(replies[0].reply).toBe('Which subject for Class 5 A? You teach: Mathematics — Class 5 A; Science — Class 5 A.');
    expect(replies[1].action?.summary).toBe(`Set "Revision" (Science) for Class 5 A, due ${toIsoDate('tomorrow')}`);
  }, 120_000);

  it('reads the class and subject in any order', async () => {
    for (const request of [
      'Create assignment for Class 6 B Science titled Unit 4 due Friday',
      'Create a Science assignment for 6th B titled Unit 4 due Friday',
      'Make an assignment for Science - Class 6 B titled Unit 4 due Friday',
      'Set Science homework for class 6b titled Unit 4 due Friday',
    ]) {
      const [reply] = await web(teacher(), [request]);
      expect(reply.action?.summary, request).toContain(`Set "Unit 4" (Science) for Class 6 B, due ${nextFriday()}`);
    }
  }, 120_000);

  it('resolves relative due dates to days still to come', async () => {
    const day = (text) => toIsoDate(text) ?? weekdayDateIn(text, new Date(), { prefer: 'future' }).iso;
    for (const [phrase, expected] of [
      ['tomorrow', day('tomorrow')],
      ['next Monday', weekdayDateIn('next Monday').iso],
      ['Friday', nextFriday()],
    ]) {
      const [reply] = await web(teacher(), [`Create a Science assignment for Class 6 B titled Unit 4 due ${phrase}`]);
      expect(reply.action?.summary, phrase).toContain(`due ${expected}`);
      expect(expected >= toIsoDate('today'), `${phrase} → ${expected} is not in the past`).toBe(true);
    }
  }, 120_000);

  it('refuses a class-subject pair the teacher does not teach, clearly, and proposes nothing', async () => {
    // Mathematics is not this teacher's subject in 6 B (Science is).
    const invalid = await site(teacher(), 'Create a Maths assignment for Class 6 B titled Test due tomorrow');
    expect(invalid.reply).toMatch(/You do not teach Maths for Class 6 B\. You teach: /);
    // Class 9 B is somebody else's class altogether -- same refusal, nothing about it disclosed.
    const unauthorized = await site(teacher(), 'Create a Science assignment for Class 9 B titled Test due tomorrow');
    expect(unauthorized.reply).toMatch(/You do not teach Science for Class 9 B/);
    expect(unauthorized.reply).not.toMatch(/Ishaan|UNRELATED/);

    expect(await count(AgentAction, { status: 'PENDING' })).toBe(0);
    const yes = await site(teacher(), 'yes');
    expect(yes.reply).not.toMatch(/has been set/);
    expect(await count(Assignment, { title: 'Test' })).toBe(0);
  }, 120_000);

  it('a role that may not set work is refused, on both channels', async () => {
    const student = school.people.STUDENT;
    const onWa = await site(student, 'Create a Science assignment for Class 6 B titled Test due tomorrow');
    const [onWeb] = await web(student, ['Create a Science assignment for Class 6 B titled Test due tomorrow']);
    expect(onWa.reply).not.toMatch(ASKS_TO_CONFIRM);
    expect(onWeb.action ?? null).toBeNull();
    expect(await count(AgentAction, {})).toBe(0);
    expect(await count(Assignment, { title: 'Test' })).toBe(0);
  }, 90_000);

  it('NO cancels: nothing is created, and a later YES has nothing to run', async () => {
    await site(teacher(), REQUEST);
    await site(teacher(), 'Title: Assignment 5');
    const cancelled = await site(teacher(), 'No');
    expect(cancelled.reply).toMatch(/not made any changes/i);
    const late = await site(teacher(), 'Yes');
    expect(late.reply).not.toMatch(/has been set/);
    expect(await assignmentsFor6B()).toHaveLength(0);
    expect(await count(AgentAction, { status: 'REJECTED' })).toBe(1);
  }, 120_000);

  it('an expired confirmation is rejected and creates nothing', async () => {
    await site(teacher(), REQUEST);
    await site(teacher(), 'Title: Assignment 5');
    await inSchool(OAK, () => AgentAction.updateMany({ status: 'PENDING' }, { $set: { expiresAt: new Date(Date.now() - 60_000) } }));
    const late = await site(teacher(), 'Yes');
    expect(late.reply).not.toMatch(/has been set/);
    expect(await assignmentsFor6B()).toHaveLength(0);
  }, 120_000);

  it('two confirmations of one proposal create the assignment once', async () => {
    await site(teacher(), REQUEST);
    const proposal = await site(teacher(), 'Title: Assignment 5');
    const [a, b] = await Promise.all([
      api.confirm(teacher(), proposal.action.confirmToken),
      api.confirm(teacher(), proposal.action.confirmToken),
    ]);
    expect([a.status, b.status].filter((st) => st === 200)).toHaveLength(1);
    expect(await assignmentsFor6B()).toHaveLength(1);
  }, 120_000);

  it('on WhatsApp the assignment is sent to the website: a redelivered request proposes nothing, and YES writes nothing', async () => {
    const id = `wamid.req.${Date.now()}`;
    const request = 'Create a Science assignment for Class 6 B titled Unit 4 due Friday';
    const first = await deliver(teacher(), request, id);
    const replay = await deliver(teacher(), request, id);
    expect(first.reply).toMatch(/EduOS website/);
    expect(first.reply).not.toMatch(/Reply YES/i);
    expect(replay.skipped).toBe('DUPLICATE');
    expect((await wa(teacher(), 'yes')).reply).not.toMatch(/has been set/);
    expect(await count(AgentAction, {})).toBe(0);
    expect(await count(Assignment, { title: 'Unit 4' })).toBe(0);
  }, 90_000);

  it('does not claim success when the write fails', async () => {
    await site(teacher(), REQUEST);
    await site(teacher(), 'Title: Assignment 5');
    vi.spyOn(Assignment, 'create').mockRejectedValueOnce(
      new Error('E11000 duplicate key error collection: eduos.assignments at C:\\app\\src\\modules\\assignments\\assignment.service.js:88:19'),
    );
    const failed = await site(teacher(), 'Yes');
    expect(failed.reply).not.toMatch(/has been set/);
    expect(failed.reply).toMatch(/went wrong|could not|not be completed/i);
    expectNoLeak(failed.reply);
    expect(failed.reply).not.toMatch(/E11000|collection|assignment\.service/);
    expect(await assignmentsFor6B()).toHaveLength(0);
    expect(await count(AgentAction, { status: 'FAILED' })).toBe(1);
    // The failed proposal is closed: a second YES cannot run it after all.
    const retry = await site(teacher(), 'Yes');
    expect(retry.reply).not.toMatch(/has been set/);
    expect(await assignmentsFor6B()).toHaveLength(0);
  }, 120_000);

  it('the website conversation reads the same whichever way it is driven, and a newer proposal retires the older', async () => {
    const replies = await web(teacher(), [REQUEST, 'Title: Assignment 5']);
    expect(replies[0].reply).toMatch(/Tell me a title/);
    expect(replies[1].action?.tool).toBe('create_assignment');
    expect(replies[1].action.summary).toContain(`Set "Assignment 5" (Science) for Class 6 B, due ${nextFriday()}`);

    await site(teacher(), REQUEST);
    const again = await site(teacher(), 'Title: Assignment 5');
    expect(again.reply).toContain(replies[1].action.summary);

    // The second proposal superseded the first: its token is dead, and only
    // the newest proposal can be confirmed.
    const stale = await api.confirm(teacher(), replies[1].action.confirmToken);
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(await assignmentsFor6B()).toHaveLength(0);
    await site(teacher(), 'yes');
    expect(await assignmentsFor6B()).toHaveLength(1);
  }, 150_000);
});

/* ════════════════════════════════════════════════════════════
   2. ANNOUNCEMENT POSTING
   ════════════════════════════════════════════════════════════ */

describe('Website — posting an announcement (the reported conversation)', () => {
  const REQUEST = 'Post an announcement for class 6b science practical on Monday';
  const announcements = () => inSchool(OAK, () => Announcement.find({ createdByProfileId: teacher().profile._id }).lean());

  it('proposes the whole announcement to the class named -- not the word "Monday"', async () => {
    const proposed = await site(teacher(), REQUEST);
    expect(proposed.reply).toContain('Post the announcement "Science practical on Monday" to Class 6 B');
    expect(proposed.reply).not.toContain('"Monday"');
    expect(proposed.reply).toMatch(ASKS_TO_CONFIRM);
    expect(await announcements()).toHaveLength(0);
    const pending = await inSchool(OAK, () => AgentAction.findOne({ status: 'PENDING' }).lean());
    expect(pending.args).toMatchObject({ title: 'Science practical on Monday', content: 'Science practical on Monday' });
    expect(String(pending.actorProfileId)).toBe(String(teacher().profile._id));
    expect(pending.prepared.audience.sectionIds.map(String)).toEqual([String(school.sectionB._id)]);
  }, 90_000);

  it('YES posts that announcement to that class, and answers with what was posted', async () => {
    await site(teacher(), REQUEST);
    const done = await site(teacher(), 'Yes');

    // The record, read back: the right words, the right class, written once.
    const posted = await announcements();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ title: 'Science practical on Monday', content: 'Science practical on Monday' });
    expect(posted[0].audience.all).toBe(false);
    expect(posted[0].audience.sectionIds.map(String)).toEqual([String(school.sectionB._id)]);

    // The reply states the announcement and the class that the record holds.
    expect(done.reply).toBe('The announcement "Science practical on Monday" has been posted to Class 6 B.');
    expect(done.reply).not.toMatch(/Samsung|Galaxy|iPhone|I cannot help with class announcements/i);
  }, 120_000);

  it('on WhatsApp the announcement is sent to the website, exactly ONE message is sent, and nothing is posted', async () => {
    const since = new Date();
    const asked = await wa(teacher(), REQUEST);
    expect(asked.reply).toMatch(/EduOS website/);
    const sent = await outboundAfter(teacher(), since);
    expect(sent).toHaveLength(1);
    expect(asked.body.data.replies).toHaveLength(1);
    await wa(teacher(), 'Yes');
    expect(await announcements()).toHaveLength(0);
    expect(await count(AgentAction, {})).toBe(0);
  }, 120_000);

  it('the success sentence is built from the record, and a failed post is reported as a failure', async () => {
    await site(teacher(), REQUEST);
    vi.spyOn(Announcement, 'create').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.1.2.3:27017 at node_modules/mongodb/lib/cmap/connect.js:379:20'));
    const failed = await site(teacher(), 'Yes');
    // Accepting the confirmation is not success: nothing was written, so
    // nothing is said to have been posted.
    expect(failed.reply).not.toMatch(/has been posted/);
    expect(failed.reply).toMatch(/went wrong|could not|not be completed/i);
    expectNoLeak(failed.reply);
    expect(failed.reply).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|connect\.js/);
    expect(await announcements()).toHaveLength(0);
    expect(await count(AgentAction, { status: 'FAILED' })).toBe(1);
    const trail = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.create_announcement', 'after.status': 'FAILED' }).lean());
    expect(trail).not.toBeNull();
  }, 120_000);

  it('NO cancels; an expired proposal is refused; neither posts anything', async () => {
    await site(teacher(), REQUEST);
    expect((await site(teacher(), 'no')).reply).toMatch(/not made any changes/i);
    expect((await site(teacher(), 'yes')).reply).not.toMatch(/has been posted/);

    await site(teacher(), REQUEST);
    await inSchool(OAK, () => AgentAction.updateMany({ status: 'PENDING' }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await site(teacher(), 'yes')).reply).not.toMatch(/has been posted/);
    expect(await announcements()).toHaveLength(0);
  }, 150_000);

  it('a duplicate confirmation posts it once', async () => {
    const proposal = await site(teacher(), REQUEST);
    const first = await api.confirm(teacher(), proposal.action.confirmToken);
    const again = await api.confirm(teacher(), proposal.action.confirmToken);
    expect(first.reply).toMatch(/has been posted to Class 6 B/);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(await announcements()).toHaveLength(1);
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ action: 'agent.create_announcement', 'after.status': 'EXECUTED' }))).toBe(1);
  }, 120_000);

  it('two simultaneous confirmations post it once', async () => {
    const [proposal] = await web(teacher(), [REQUEST]);
    const [a, b] = await Promise.all([
      api.confirm(teacher(), proposal.action.confirmToken),
      api.confirm(teacher(), proposal.action.confirmToken),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(await announcements()).toHaveLength(1);
  }, 90_000);

  it('a confirmation belongs to the person, the school and the proposal it was made for', async () => {
    const [proposal] = await web(teacher(), [REQUEST]);
    const token = proposal.action.confirmToken;

    // Somebody else's YES -- on WhatsApp, or with the token on the website --
    // does not run the teacher's proposal.
    const otherYes = await wa(school.people.PRINCIPAL, 'yes');
    expect(otherYes.reply).not.toMatch(/has been posted/);
    expect((await api.confirm(school.people.PRINCIPAL, token)).status).toBe(403);
    // Another school's administrator, holding the token, finds nothing.
    expect((await api.confirm(school.people.RIVER_ADMIN, token)).status).toBeGreaterThanOrEqual(400);
    expect(await count(Announcement, { title: 'Science practical on Monday' })).toBe(0);

    // The token cannot be pointed at different words: what runs is what was
    // stored with the proposal, whatever arrives beside the token.
    const res = await api.post(teacher(), '/ai/agent/confirm', {
      confirmToken: token, accept: true, title: 'SCHOOL CLOSED', className: 'Class 10 A', args: { title: 'SCHOOL CLOSED' },
    });
    expect(res.status).toBe(200);
    const posted = await announcements();
    expect(posted.map((p) => p.title)).toEqual(['Science practical on Monday']);
    expect(posted[0].audience.sectionIds.map(String)).toEqual([String(school.sectionB._id)]);
  }, 120_000);

  it('a newer proposal replaces the older one: YES runs only what was last shown', async () => {
    await site(teacher(), REQUEST);
    const newer = await site(teacher(), 'Post an announcement to Class 5 A: Bring your atlas tomorrow');
    expect(newer.reply).toMatch(/"Bring your atlas tomorrow" to Class 5 A/);
    await site(teacher(), 'yes');
    const posted = await announcements();
    expect(posted.map((p) => p.title)).toEqual(['Bring your atlas tomorrow']);
    expect(posted[0].audience.sectionIds.map(String)).toEqual([String(school.c5a._id)]);
  }, 120_000);

  it('refuses a class the teacher does not teach, before anything is offered', async () => {
    const refused = await site(teacher(), 'Post an announcement for class 9 B test tomorrow');
    expect(refused.reply).toMatch(/Class 9 B is not one of your classes/);
    expect(refused.reply).not.toMatch(ASKS_TO_CONFIRM);
    expect(await count(AgentAction, {})).toBe(0);
    expect((await site(teacher(), 'yes')).reply).not.toMatch(/has been posted/);
    expect(await announcements()).toHaveLength(0);
  }, 90_000);

  it('a user who may not publish is refused, on both channels', async () => {
    for (const role of ['STUDENT', 'PARENT', 'LIBRARIAN']) {
      const person = school.people[role];
      const onWa = await site(person, REQUEST);
      expect(onWa.reply, role).not.toMatch(ASKS_TO_CONFIRM);
      const [onWeb] = await web(person, [REQUEST]);
      expect(onWeb.action ?? null, role).toBeNull();
    }
    expect(await count(AgentAction, {})).toBe(0);
    expect(await count(Announcement, { title: /practical/i })).toBe(0);
  }, 120_000);

  it('asks what to say when the request has no words for the notice, instead of inventing them', async () => {
    for (const request of ['Post an announcement', 'Post an announcement for Class 6 B', 'Send an announcement to my class']) {
      const reply = await site(teacher(), request);
      expect(reply.reply, request).toMatch(/Tell me a title|what (?:should|would)/i);
      expect(reply.reply, request).not.toMatch(ASKS_TO_CONFIRM);
    }
    expect(await count(AgentAction, {})).toBe(0);
    // ...and the answer to that question becomes the announcement, to the class named first.
    await site(teacher(), 'Post an announcement for Class 6 B');
    const proposed = await site(teacher(), 'Lab coats are required on Thursday');
    expect(proposed.reply).toContain('"Lab coats are required on Thursday" to Class 6 B');
  }, 150_000);

  it('keeps the content whole however the request is written', async () => {
    for (const [request, title] of [
      ['Post an announcement for class 6b science practical on Monday', 'Science practical on Monday'],
      ['Post an announcement to Class 6 B: Science practical on Monday at 10 AM in Lab 2', 'Science practical on Monday at 10 AM in Lab 2'],
      ['Announce to Class 6 B that the science practical is on Monday', 'The science practical is on Monday'],
      ['Post an announcement for Class 6 B saying bring your lab manual on Monday', 'Bring your lab manual on Monday'],
    ]) {
      const [reply] = await web(teacher(), [request]);
      expect(reply.action?.tool, request).toBe('create_announcement');
      const pending = await inSchool(OAK, () => AgentAction.findOne({ status: 'PENDING' }).lean());
      // Nothing of what was written is lost between the request and the record.
      expect(pending.args.content, request).toBe(title);
      expect(reply.action.summary, request).toMatch(/to Class 6 B$/);
    }
  }, 150_000);

  it('the website posts the announcement it proposed, the same way however it is driven', async () => {
    const [proposal] = await web(teacher(), [REQUEST]);
    expect(proposal.action.summary).toBe('Post the announcement "Science practical on Monday" to Class 6 B');
    const again = await site(teacher(), REQUEST);
    expect(again.reply).toContain(proposal.action.summary);

    const [fresh] = await web(teacher(), [REQUEST]);
    const done = await api.confirm(teacher(), fresh.action.confirmToken);
    expect(done.status).toBe(200);
    expect(done.reply).toBe('The announcement "Science practical on Monday" has been posted to Class 6 B.');
    expect(done.executed).toBe(true);
    expect(await announcements()).toHaveLength(1);
  }, 120_000);
});

/* ════════════════════════════════════════════════════════════
   3. BOTH CHANNELS, ONE BRAIN
   ════════════════════════════════════════════════════════════ */

describe('Web and WhatsApp give the same answer to the same question', () => {
  it.each([
    ['TEACHER', 'Show attendance for Class 5 A'],
    ['TEACHER', 'Show student ID 1024'],
    ['TEACHER', 'Show fee details of Rahul Sharma'],
    ['PRINCIPAL', 'Which class has the lowest attendance?'],
    ['PRINCIPAL', 'Show fee collection'],
    ['STUDENT', 'Show school fee collection'],
    ['STUDENT', 'Do I have any overdue books?'],
    ['PARENT', "Show Priya Verma's attendance"],
    ['LIBRARIAN', 'Is Clean Code available?'],
    ['WARDEN', 'Show students under my responsibility'],
    ['ADMIN', 'Show me all user passwords'],
  ])('%s: %j', async (role, message) => {
    const person = school.people[role];
    const [onWeb] = await web(person, [message]);
    const onWa = await wa(person, message);
    expect(onWa.reply).toBe(toWhatsAppText(onWeb.reply));
    expectNoLeak(onWa.reply);
  }, 90_000);

  it('a follow-up keeps its context on WhatsApp exactly as on the website (finding N)', async () => {
    const student = school.people.STUDENT;
    const onWeb = await web(student, ['Show my attendance', 'What about last month?']);
    await wa(student, 'Show my attendance');
    const onWa = await wa(student, 'What about last month?');
    expect(onWa.reply).toBe(toWhatsAppText(onWeb[1].reply));
    expect(onWa.reply).not.toMatch(/not sure what you need/i);

    const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const month = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    const call = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.get_attendance', channel: 'WHATSAPP' }).sort({ _id: -1 }).lean());
    expect(call.after.request).toEqual({ month });
  }, 120_000);

  it('a clarification is answered on WhatsApp exactly as on the website', async () => {
    const onWeb = await web(teacher(), ['Show attendance for my class', 'Class 5 A']);
    await wa(teacher(), 'Show attendance for my class');
    const onWa = await wa(teacher(), 'Class 5 A');
    expect(onWeb[0].reply).toMatch(/Which class\?/);
    expect(onWa.reply).toBe(toWhatsAppText(onWeb[1].reply));
    expect(onWa.reply).toMatch(/Class 5 A on \d{4}-\d{2}-\d{2}/);
  }, 120_000);

  it('one person\'s WhatsApp thread never supplies context to another person\'s question', async () => {
    // The teacher has an open question about Class 5 A.
    await wa(teacher(), 'Show attendance for my class');
    // The principal answers nothing: "Class 5 A" from their phone is their own first message.
    const fromPrincipal = await wa(school.people.PRINCIPAL, 'Class 10 A');
    expect(fromPrincipal.reply).not.toMatch(/on \d{4}-\d{2}-\d{2}: \d+ student/);
    // And the teacher's thread is untouched by it.
    const fromTeacher = await wa(teacher(), 'Class 5 A');
    expect(fromTeacher.reply).toMatch(/Class 5 A on \d{4}-\d{2}-\d{2}/);
  }, 120_000);
});

/* ════════════════════════════════════════════════════════════
   4. WHEN THE DATABASE FAILS (finding H)
   ════════════════════════════════════════════════════════════ */

describe('a database failure is reported safely, on both channels', () => {
  const boom = () => Object.assign(
    new Error('connect ECONNREFUSED 10.1.2.3:27017\n    at TCPConnectWrap.afterConnect (C:\\app\\node_modules\\mongodb\\lib\\cmap\\connect.js:379:20)\n    at attendance.service.js:612:11'),
    { name: 'MongoNetworkError' },
  );

  it('says the records could not be reached -- no stack trace, no path, no host, and no invented figure', async () => {
    const student = school.people.STUDENT;
    vi.spyOn(AttendanceRecord, 'aggregate').mockRejectedValue(boom());
    const [onWeb] = await web(student, ['Show my attendance']);
    const onWa = await wa(student, 'Show my attendance');
    for (const reply of [onWeb.reply, onWa.reply]) {
      expectNoLeak(reply);
      expect(reply).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|27017|connect\.js|TCPConnectWrap|\bat\s+\w+.*:\d+:\d+/);
      // Nothing is made up to fill the gap.
      expect(reply).not.toMatch(/\d+\s?%|Present:|Absent:/);
      expect(reply.length).toBeGreaterThan(10);
    }
    expect(onWeb.status).toBeLessThan(600);
    expect(JSON.stringify(onWeb)).not.toMatch(/ECONNREFUSED|connect\.js|stack/);
  }, 90_000);

  it('does not fall back to somebody else\'s records, or to a list, when a lookup fails', async () => {
    vi.spyOn(AttendanceRecord, 'aggregate').mockRejectedValue(boom());
    const [reply] = await web(teacher(), ['Show attendance of Aarav Mishra']);
    for (const name of ['Rahul Sharma', 'Priya Verma', 'Ananya Mishra', 'Aman Gupta']) expect(reply.reply).not.toContain(name);
    expect(reply.reply).not.toMatch(/\d+\s?%/);
  }, 60_000);

  it('the failure is on the audit trail, with its real cause kept out of the reply', async () => {
    vi.spyOn(AttendanceRecord, 'aggregate').mockRejectedValue(boom());
    await web(school.people.STUDENT, ['Show my attendance']);
    const failed = await inSchool(OAK, () => AuditLog.findOne({ 'after.status': 'FAILED' }).lean());
    expect(failed?.after?.code).toBe('DATABASE_ERROR');
  }, 60_000);
});
