import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

/**
 * More than one window: every record is still reachable.
 *
 * One answer carries at most RESULT_WINDOW (1000) rows -- a bound on a single
 * turn, because some collections grow without limit. That bound must never be
 * an end. Here a school with more than 2,500 students is listed in full by
 * following the answer's continuation, on the website ("Load more" →
 * POST /ai/agent/continue) and on WhatsApp ("MORE"), and every student is
 * checked to appear exactly once, in order, with numbering unbroken.
 *
 * The continuation is checked as a security boundary too: it is useless to
 * anyone but the person it was issued to, outside their school, for a write,
 * or once tampered with or expired.
 */

const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { env } = await import('../src/config/env.js');
const { Student, Enrollment } = await import('../src/models/student.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, OAK } = await import('./support/mcpSchool.js');

const EXTRA = 2600;
const FIXTURE_OAK_STUDENTS = 4; // Rahul, Priya, Aman, Riya
const TOTAL = EXTRA + FIXTURE_OAK_STUDENTS;
const pad = (n) => String(n).padStart(4, '0');

let api;
let school;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
  // Written straight to the collections for speed, stamped with the school
  // exactly as the tenancy plugin would stamp them.
  const now = new Date();
  const students = Array.from({ length: EXTRA }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    tenantId: OAK,
    admissionNo: `OAK-L${pad(i + 1)}`,
    firstName: 'Learner',
    lastName: pad(i + 1),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  await Student.collection.insertMany(students);
  await Enrollment.collection.insertMany(students.map((s, i) => ({
    tenantId: OAK,
    studentId: s._id,
    sectionId: school.sectionA._id,
    academicYearId: school.year._id,
    status: 'ACTIVE',
    rollNo: 1000 + i,
    createdAt: now,
    updatedAt: now,
  })));
}, 240_000);

/** Numbered lines of a reply, as [number, text]. */
const numberedLines = (text) => String(text)
  .split('\n')
  .map((l) => /^(\d+)\. (.*)$/.exec(l))
  .filter(Boolean)
  .map((m) => [Number(m[1]), m[2]]);

describe('website: "Show all students" in windows, then Load more until the end', () => {
  it('every student once, in order, numbering 1..N unbroken, with an honest range note', async () => {
    const first = await api.ask(school.people.ADMIN, 'Show all students');
    expect(first.status).toBe(200);
    expect(first.tool).toBe('search_students');
    expect(first.continuation).toMatchObject({ shown: { from: 1, to: 1000 }, next: { from: 1001, to: 2000 }, total: TOTAL });
    expect(first.reply).toMatch(new RegExp(`_Showing 1–1000 of ${TOTAL}\\._$`));

    const replies = [first.reply];
    let continuation = first.continuation;
    while (continuation) {
      const res = await api.post(school.people.ADMIN, '/ai/agent/continue', { continuationToken: continuation.token });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      replies.push(res.body.data.reply);
      continuation = res.body.data.continuation ?? null;
      expect(replies.length).toBeLessThan(10);
    }
    expect(replies).toHaveLength(Math.ceil(TOTAL / 1000));
    const lastFrom = Math.floor((TOTAL - 1) / 1000) * 1000 + 1;
    expect(replies.at(-1)).toMatch(new RegExp(`_Showing ${lastFrom}–${TOTAL} of ${TOTAL}\\._$`));

    const lines = replies.flatMap(numberedLines);
    // Numbering runs 1..TOTAL across the windows, with no gap and no repeat.
    expect(lines.map(([n]) => n)).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));
    // Every learner appears exactly once.
    const learners = lines.map(([, text]) => /Learner \d{4}/.exec(text)?.[0]).filter(Boolean);
    expect(learners).toHaveLength(EXTRA);
    expect(new Set(learners).size).toBe(EXTRA);
  }, 240_000);

  it('"Show top 10 students" is exactly 10, with nothing more offered', async () => {
    const res = await api.ask(school.people.ADMIN, 'Show me the top 10 students');
    expect(numberedLines(res.reply)).toHaveLength(10);
    expect(res.continuation ?? null).toBeNull();
  }, 60_000);

  it('"Show first 20 students" is exactly 20', async () => {
    const res = await api.ask(school.people.ADMIN, 'Show the first 20 students');
    expect(res.tool).toBe('search_students');
    expect(numberedLines(res.reply)).toHaveLength(20);
    expect(res.continuation ?? null).toBeNull();
  }, 60_000);
});

describe('the continuation is a security boundary', () => {
  const firstToken = async () => (await api.ask(school.people.ADMIN, 'Show all students')).continuation.token;

  it('is refused for anyone but the person it was issued to', async () => {
    const token = await firstToken();
    const res = await api.post(school.people.PRINCIPAL, '/ai/agent/continue', { continuationToken: token });
    expect(res.status).toBe(403);
  }, 60_000);

  it('is refused in another school', async () => {
    const token = await firstToken();
    const res = await api.post(school.people.RIVER_ADMIN, '/ai/agent/continue', { continuationToken: token });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Learner/);
  }, 60_000);

  it('is refused once tampered with, or for a write', async () => {
    const token = await firstToken();
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect((await api.post(school.people.ADMIN, '/ai/agent/continue', { continuationToken: tampered })).status).toBe(410);

    // A correctly signed token naming a write is still refused: continuing is read-only.
    const forged = jwt.sign(
      { t: 'mark_attendance', a: {}, w: { offset: 0 }, p: String(school.people.ADMIN.actor.profileId), s: OAK },
      env.JWT_SECRET, { audience: 'eduos-ai-continue', expiresIn: '5m' },
    );
    expect((await api.post(school.people.ADMIN, '/ai/agent/continue', { continuationToken: forged })).status).toBe(400);
  }, 60_000);

  it('a student is still not shown anyone else, however the list is asked for', async () => {
    const res = await api.ask(school.people.STUDENT, 'Show all students');
    expect(String(res.reply ?? res.body?.message)).not.toMatch(/Learner/);
    expect(res.continuation ?? null).toBeNull();
  }, 60_000);
});

describe('in-app WhatsApp simulator: the same continuation as a real phone', () => {
  /** One simulator turn, as the admin's preview panel sends it. */
  const simulate = async (person, text, extra = {}) => {
    const res = await api.post(person, '/whatsapp/simulate', { text, ...extra });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    return res.body.data;
  };

  it('initial → window 1, MORE → 2, MORE → 3, and no MORE after the last; 1..N once each', async () => {
    const turns = [await simulate(school.people.ADMIN, 'Show all students')];
    expect(turns[0].reply).toMatch(new RegExp(`Reply \\*MORE\\* for 1001–2000 of ${TOTAL}\\.$`));
    while (/Reply \*MORE\*/.test(turns.at(-1).reply) && turns.length < 6) {
      turns.push(await simulate(school.people.ADMIN, 'MORE'));
    }
    expect(turns).toHaveLength(3);
    expect(turns[1].reply).toMatch(new RegExp(`Reply \\*MORE\\* for 2001–${TOTAL} of ${TOTAL}\\.$`));
    expect(turns[2].reply).not.toMatch(/Reply \*MORE\*/);

    // The previewed messages are exactly what a phone receives: parts within the limit.
    const parts = turns.flatMap((t) => t.messages);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4096);
    const lines = parts.flatMap(numberedLines);
    expect(lines.map(([n]) => n)).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));
    const learners = lines.map(([, t]) => /Learner \d{4}/.exec(t)?.[0]).filter(Boolean);
    expect(learners).toHaveLength(EXTRA);
    expect(new Set(learners).size).toBe(EXTRA);

    // And MORE with nothing left to continue is not a continuation.
    const after = await simulate(school.people.ADMIN, 'MORE');
    expect(after.reply).not.toMatch(/Learner|_Showing/);
  }, 300_000);

  it('is the real mechanism: the simulator and the phone answer alike and continue each other', async () => {
    const real = await api.whatsapp(school.people.ADMIN, 'Show all students');
    const sim = await simulate(school.people.ADMIN, 'Show all students');
    // Same answer, same parts.
    expect(sim.reply).toBe(real.body.data.replies[0].reply);
    expect(sim.messages).toEqual(real.body.data.replies[0].parts);

    // A list started in the simulator is continued by MORE from the phone --
    // one stored continuation, one redemption path.
    const fromPhone = await api.whatsapp(school.people.ADMIN, 'MORE');
    expect(numberedLines(fromPhone.body.data.replies[0].parts.join('\n'))[0][0]).toBe(1001);
    // …and the phone's continuation by MORE in the simulator.
    const fromSim = await simulate(school.people.ADMIN, 'MORE');
    expect(numberedLines(fromSim.messages.join('\n'))[0][0]).toBe(2001);
  }, 300_000);

  it('a token in the request is ignored: only the server\'s stored continuation is used', async () => {
    const forged = jwt.sign(
      { t: 'search_students', a: {}, w: { offset: 2000 }, p: String(school.people.ADMIN.actor.profileId), s: OAK },
      env.JWT_SECRET, { audience: 'eduos-ai-continue', expiresIn: '5m' },
    );
    // Nothing listed yet in this thread, so there is nothing to continue,
    // whatever the request carries.
    const res = await simulate(school.people.ADMIN, 'MORE', { continuationToken: forged, window: { offset: 2000 } });
    expect(res.reply).not.toMatch(/Learner|_Showing 2001/);
  }, 120_000);

  it('message text cannot move the position', async () => {
    await simulate(school.people.ADMIN, 'Show all students');
    const res = await simulate(school.people.ADMIN, 'MORE 2001');
    expect(res.reply).not.toMatch(/_Showing 2001|^\*?2001\. /m);
  }, 300_000);

  it('an expired or tampered stored continuation is refused, not honoured', async () => {
    const { WhatsappMessage } = await import('../src/models/whatsappConversation.model.js');
    await simulate(school.people.ADMIN, 'Show all students');
    const latest = () => WhatsappMessage.findOne({ direction: 'OUTBOUND', 'metadata.continuationToken': { $exists: true } }).sort({ createdAt: -1, _id: -1 });

    const expired = jwt.sign(
      { t: 'search_students', a: {}, w: { offset: 1000 }, p: String(school.people.ADMIN.actor.profileId), s: OAK },
      env.JWT_SECRET, { audience: 'eduos-ai-continue', expiresIn: -10 },
    );
    const row = await latest();
    await WhatsappMessage.updateOne({ _id: row._id }, { $set: { 'metadata.continuationToken': expired } });
    expect((await simulate(school.people.ADMIN, 'MORE')).reply).toMatch(/expired/i);

    await simulate(school.people.ADMIN, 'Show all students');
    const row2 = await latest();
    const tampered = `${row2.metadata.continuationToken.slice(0, -4)}AAAA`;
    await WhatsappMessage.updateOne({ _id: row2._id }, { $set: { 'metadata.continuationToken': tampered } });
    const res = await simulate(school.people.ADMIN, 'MORE');
    expect(res.reply).toMatch(/expired/i);
    expect(res.reply).not.toMatch(/Learner/);
  }, 300_000);

  it('authorization and school isolation are unchanged', async () => {
    // Someone else's MORE never reaches the admin's list: their thread holds none of it.
    await simulate(school.people.ADMIN, 'Show all students');
    for (const person of [school.people.PRINCIPAL, school.people.RIVER_ADMIN, school.people.STUDENT]) {
      const res = await simulate(person, 'MORE');
      expect(res.reply).not.toMatch(/Learner/);
    }
    // A student asking for everyone still sees nobody else.
    expect((await simulate(school.people.STUDENT, 'Show all students')).reply).not.toMatch(/Learner/);
    // Another school's administrator lists only their own school.
    const river = await simulate(school.people.RIVER_ADMIN, 'Show all students');
    expect(river.reply).not.toMatch(/Learner/);
    expect(river.reply).toMatch(/Rahul Riverside/);
  }, 300_000);
});

describe('WhatsApp: numbered parts per window, then MORE until the end', () => {
  it('every student once, numbering unbroken, parts within the limit, no line cut', async () => {
    const parts = [];
    const first = await api.whatsapp(school.people.ADMIN, 'Show all students');
    expect(first.status).toBe(200);
    parts.push(...first.body.data.replies[0].parts);
    expect(parts.at(-1)).toMatch(/Reply \*MORE\* for 1001–2000 of \d+\./);

    for (let guard = 0; guard < 6 && /Reply \*MORE\*/.test(parts.at(-1)); guard++) {
      const next = await api.whatsapp(school.people.ADMIN, 'MORE');
      expect(next.status).toBe(200);
      parts.push(...next.body.data.replies[0].parts);
    }
    expect(parts.at(-1)).not.toMatch(/Reply \*MORE\*/);

    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
      expect(part).not.toMatch(/\*\*|\|/);
    }
    const lines = parts.flatMap(numberedLines);
    expect(lines.map(([n]) => n)).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));
    // No line was cut: every learner line is whole ("Learner 0001* — Class 6 A").
    const learners = lines.map(([, t]) => /Learner \d{4}/.exec(t)?.[0]).filter(Boolean);
    expect(new Set(learners).size).toBe(EXTRA);
  }, 300_000);
});
