import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import mongoose from 'mongoose';
import { seedSchool } from './support/mcpSchool.js';
import { School } from '../src/models/school.model.js';
import * as drafts from '../src/modules/ai/drafts.service.js';

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');

/**
 * AI drafts: without a model key the draft is a labelled template; with one,
 * what reaches the model has had restricted and contact details removed, and
 * a report-card remark sends only marks bands and attendance. Nothing is ever
 * saved, sent or published.
 */
const teacher = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'TEACHER', displayName: 'Ms Iyer' };

afterEach(() => drafts.setDraftModelForTests({}));

describe('the template fallback', () => {
  it('is used and labelled when no AI key is configured, and saves nothing', async () => {
    drafts.setDraftModelForTests({ enabled: () => false, call: () => { throw new Error('must not be called'); } });
    const before = await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.countDocuments()));
    const minutes = await drafts.draft(teacher, { kind: 'MINUTES', meetingTitle: 'Science department', date: '2026-10-14', attendees: 'Ms Iyer, Mr Khan', notes: 'Reviewed lab safety rota.\nMr Khan will order goggles by Friday.' });
    expect(minutes).toMatchObject({ source: 'TEMPLATE', label: 'Template draft (no AI key configured)', saved: false });
    expect(minutes.text).toContain('Minutes: Science department');
    expect(minutes.text).toMatch(/Actions agreed\n• Mr Khan will order goggles by Friday\./);
    for (const body of [
      { kind: 'LETTER', recipient: 'Parents of Class 6', subject: 'Field trip', purpose: 'Inform about the planetarium visit.', points: ['Leave at 9 am'] },
      { kind: 'CIRCULAR', title: 'Winter uniform', audience: 'All families', details: 'Winter uniform from 1 November.' },
      { kind: 'LESSON_PLAN', subject: 'Science', grade: 'Class 6', topic: 'Photosynthesis', durationMinutes: 40, objectives: ['Name the inputs'] },
      { kind: 'REPORT_REMARK', studentFirstName: 'Priya', bands: [{ subject: 'Maths', band: 'A1' }, { subject: 'Hindi', band: 'D' }], attendancePct: 93 },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const d = await drafts.draft(teacher, body);
      expect(d.source).toBe('TEMPLATE');
      expect(d.text.length).toBeGreaterThan(20);
    }
    const remark = await drafts.draft(teacher, { kind: 'REPORT_REMARK', studentFirstName: 'Priya', bands: [{ subject: 'Maths', band: 'A1' }, { subject: 'Hindi', band: 'D' }], attendancePct: 93 });
    expect(remark.text).toBe('Priya has done very well in Maths. More regular practice in Hindi will help build confidence. Attendance has been excellent. Keep up the effort next term.');
    const after = await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.countDocuments()));
    expect(after).toEqual(before);
    await expect(drafts.draft(teacher, { kind: 'MINUTES', notes: '' })).rejects.toMatchObject({ code: 'NOTHING_TO_DRAFT' });
    await expect(drafts.draft(teacher, { kind: 'PUBLISH_NOW' })).rejects.toMatchObject({ code: 'BAD_KIND' });
  });

  it('falls back to a template when the model does not answer', async () => {
    drafts.setDraftModelForTests({ enabled: () => true, call: async () => ({ text: null, generated: false, reason: 'TIMEOUT' }) });
    const d = await drafts.draft(teacher, { kind: 'CIRCULAR', title: 'Sports day', details: 'Sports day on Saturday.' });
    expect(d).toMatchObject({ source: 'TEMPLATE', label: drafts.TEMPLATE_FALLBACK_LABEL });
  });
});

describe('what reaches the model', () => {
  it('has restricted details, contact details and the pupil\'s name removed; remarks get only bands and attendance', async () => {
    const sent = [];
    drafts.setDraftModelForTests({ enabled: () => true, call: async (args) => { sent.push(args); return { generated: true, text: 'The student has shown real progress this term.' }; } });
    const letter = await drafts.draft(teacher, {
      kind: 'LETTER', recipient: 'Mrs Sharma', subject: 'Follow-up',
      purpose: 'Thank you for meeting us. Rahul has an asthma diagnosis and uses an inhaler. The counsellor raised a safeguarding concern. Please call me on 98123 45678 or write to iyer@oakridge.example. Aadhaar 1234 5678 9012.',
      points: ['Homework club starts Monday'],
      healthNotes: 'Severe peanut allergy', safeguardingCase: 'SG-2026-0004',
    });
    expect(letter).toMatchObject({ source: 'AI', label: drafts.AI_LABEL, saved: false });
    expect(letter.redactions).toBeGreaterThanOrEqual(4);
    const msg = sent[0].message;
    expect(msg).toContain('Thank you for meeting us.');
    expect(msg).toContain('Homework club starts Monday');
    expect(msg).not.toMatch(/asthma|inhaler|safeguarding|counsellor|peanut|allergy|SG-2026|98123|iyer@|1234 5678 9012/i);
    expect(msg).toContain(drafts.REDACTED);

    const remark = await drafts.draft(teacher, {
      kind: 'REPORT_REMARK', studentFirstName: 'Priya', bands: [{ subject: 'Maths', band: 'A1' }, { subject: 'Science', band: 'made-up' }], attendancePct: 88,
      medicalNotes: 'Epilepsy', behaviourNotes: 'Detention twice', marks: { Maths: 97 }, studentId: '64b000000000000000000001',
    });
    const remarkMsg = sent[1].message;
    expect(remarkMsg).toContain('Maths: A1');
    expect(remarkMsg).toContain('Attendance: 88%');
    expect(remarkMsg).not.toMatch(/Priya|Epilepsy|Detention|97|64b0|made-up|Science/);
    // The name is put back only in the text handed to the teacher.
    expect(remark.text).toBe('Priya has shown real progress this term.');
  });
});

describe('the endpoint', () => {
  let server; let base; let s;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', apiRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
  beforeEach(async () => { s = await seedSchool(); await School.create({ slug: 'oakridge', name: 'Oakridge Academy' }); });
  const post = async (person, body) => {
    const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
    const res = await fetch(`${base}/ai/drafts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('is for staff holding ai.drafts.use; students and parents are refused', async () => {
    drafts.setDraftModelForTests({ enabled: () => false });
    const ok = await post(s.people.TEACHER, { kind: 'LESSON_PLAN', topic: 'Fractions', subject: 'Maths', grade: 'Class 6' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.label).toBe('Template draft (no AI key configured)');
    expect((await post(s.people.STUDENT, { kind: 'LESSON_PLAN', topic: 'Fractions' })).status).toBe(403);
    expect((await post(s.people.PARENT, { kind: 'LETTER', purpose: 'x' })).status).toBe(403);
  });
});
