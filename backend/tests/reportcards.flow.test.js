import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { ReportCardVersion, TermReportCard } from '../src/models/reportCard.model.js';
import * as rc from '../src/modules/reportcards/reportcards.service.js';
import { renderTermCardPdf } from '../src/modules/reportcards/termCardPdf.js';

/**
 * Term report cards: generated from published marks only, manual components by
 * the subject teacher, co-scholastic grades and remarks by the class teacher,
 * moderation class teacher → principal, versioned publication with corrections,
 * a PDF, and families seeing only their own child's card.
 */
let s; let tpl;
const inOak = (fn) => inSchool(OAK, fn);
const T = () => s.people.TEACHER.actor; // class teacher of 6 A, English
const T2 = () => s.people.T2.actor; // Maths in 6 A
const PR = () => s.people.PRINCIPAL.actor;

beforeEach(async () => {
  s = await seedFamilySchool();
  await inOak(async () => {
    tpl = await rc.ensureDefaultTemplate();
    const pt = await Exam.create({ termId: s.term._id, name: 'Periodic Test 1', startsOn: new Date('2026-07-01'), endsOn: new Date('2026-07-05') });
    const hy = await Exam.create({ termId: s.term._id, name: 'Half Yearly', startsOn: new Date('2026-09-15'), endsOn: new Date('2026-09-25') });
    const paper = (exam, offering, maxMarks) => ExamSubject.create({ examId: exam._id, subjectOfferingId: offering._id, maxMarks });
    const ptEng = await paper(pt, s.offerings.engA, 20); const hyEng = await paper(hy, s.offerings.engA, 80);
    const ptMaths = await paper(pt, s.offerings.mathsA, 20); const hyMaths = await paper(hy, s.offerings.mathsA, 80);
    const e = s.rahul.enrollment._id;
    await Mark.create([
      { examSubjectId: ptEng._id, enrollmentId: e, marks: 18, status: 'PUBLISHED', publishedAt: new Date() },
      { examSubjectId: hyEng._id, enrollmentId: e, marks: 60, status: 'PUBLISHED', publishedAt: new Date() },
      { examSubjectId: ptMaths._id, enrollmentId: e, marks: 10, status: 'PUBLISHED', publishedAt: new Date() },
      // Still in draft: must not appear on the card.
      { examSubjectId: hyMaths._id, enrollmentId: e, marks: 72, status: 'DRAFT' },
    ]);
  });
});

const rahulCard = async () => inOak(async () => rc.get(T(), 'OWN', String((await TermReportCard.findOne({ enrollmentId: s.rahul.enrollment._id }).lean())._id)));

describe('preparing cards', () => {
  it('generates from published marks only and lets each teacher fill only their part', async () => {
    await expect(inOak(() => rc.generate(T2(), 'OWN', { sectionId: String(s.sectionA._id), termKey: 'TERM_1' }))).rejects.toMatchObject({ code: 'NOT_CLASS_TEACHER' });
    const gen = await inOak(() => rc.generate(T(), 'OWN', { sectionId: String(s.sectionA._id), termKey: 'TERM_1' }));
    expect(gen).toMatchObject({ created: 3, students: 3 });
    let card = await rahulCard();
    const eng = card.scholastic.find((r) => r.subject === 'English');
    const maths = card.scholastic.find((r) => r.subject === 'Mathematics');
    expect(eng.components.PT.value).toBe(9); // 18/20 of 10
    expect(eng.components.HY.value).toBe(60); // 60/80 of 80
    expect(maths.components.HY.status).toBe('PENDING'); // the draft mark is not used
    expect(maths.complete).toBe(false);
    expect(card.attendance.workingDays).toBe(1);
    // The Maths teacher enters Maths notebook marks, but not English.
    await inOak(() => rc.update(T2(), 'OWN', card.id, { manualMarks: { [String(s.offerings.mathsA._id)]: { NB: 4, SE: 5 } } }));
    await expect(inOak(() => rc.update(T2(), 'OWN', card.id, { manualMarks: { [String(s.offerings.engA._id)]: { NB: 4 } } }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    await expect(inOak(() => rc.update(T2(), 'OWN', card.id, { classTeacherRemarks: 'x' }))).rejects.toMatchObject({ code: 'NOT_CLASS_TEACHER' });
    await expect(inOak(() => rc.update(T2(), 'OWN', card.id, { manualMarks: { [String(s.offerings.mathsA._id)]: { NB: 9 } } }))).rejects.toThrow(/out of 5/);
    card = await inOak(() => rc.update(T(), 'OWN', card.id, { coScholastic: { WORK_EDUCATION: 'A', ART_EDUCATION: 'B', HEALTH_PE: 'A' }, discipline: 'A', classTeacherRemarks: 'A curious reader.' }));
    expect(card.coScholastic.ART_EDUCATION).toBe('B');
    await expect(inOak(() => rc.update(T(), 'OWN', card.id, { discipline: 'D' }))).rejects.toThrow(/one of/);
    // Not ready while marks are pending.
    await expect(inOak(() => rc.moderate(T(), 'OWN', card.id, { stage: 'CLASS_TEACHER' }))).rejects.toMatchObject({ code: 'CARD_INCOMPLETE' });
  });
});

describe('moderation, publication and families', () => {
  it('publishes after class teacher and principal approval, versions corrections, and shows families only their own child', async () => {
    await inOak(() => rc.generate(T(), 'OWN', { sectionId: String(s.sectionA._id), termKey: 'TERM_1' }));
    let card = await rahulCard();
    await inOak(() => rc.update(T(), 'OWN', card.id, { coScholastic: { WORK_EDUCATION: 'A', ART_EDUCATION: 'A', HEALTH_PE: 'B' }, discipline: 'A', classTeacherRemarks: 'Steady progress.' }));
    await expect(inOak(() => rc.publish(PR(), 'ALL', card.id))).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await expect(inOak(() => rc.moderate(T(), 'OWN', card.id, { stage: 'PRINCIPAL' }))).rejects.toMatchObject({ code: 'NOT_PRINCIPAL' });
    await inOak(() => rc.moderate(T(), 'OWN', card.id, { stage: 'CLASS_TEACHER', allowIncomplete: true }));
    await inOak(() => rc.moderate(PR(), 'ALL', card.id, { stage: 'PRINCIPAL' }));
    const v1 = await inOak(() => rc.publish(PR(), 'ALL', card.id));
    expect(v1).toMatchObject({ status: 'PUBLISHED', publishedVersion: 1 });

    // The parent sees Rahul's card; another parent sees nothing and cannot open it by id.
    const mine = await inOak(() => rc.published(s.people.PARENT.actor, 'OWN', {}));
    expect(mine).toHaveLength(1);
    expect(mine[0].card.studentName).toBe('Rahul Sharma');
    expect(await inOak(() => rc.published(s.people.PARENT2.actor, 'OWN', {}))).toHaveLength(0);
    await expect(inOak(() => rc.published(s.people.PARENT2.actor, 'OWN', { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => rc.getVersion(s.people.PARENT2.actor, s.people.PARENT2.actor.permissions, mine[0].versionId))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => rc.getVersion(s.people.STUDENT.actor, s.people.STUDENT.actor.permissions, mine[0].versionId))).rejects.toMatchObject({ statusCode: 404 });
    const opened = await inOak(() => rc.getVersion(s.people.PARENT.actor, s.people.PARENT.actor.permissions, mine[0].versionId));
    expect(opened.version).toBe(1);

    // A correction: the Maths half-yearly is published, the card is regenerated and goes back to draft.
    await inOak(() => Mark.updateMany({ status: 'DRAFT' }, { $set: { status: 'PUBLISHED', publishedAt: new Date() } }));
    await inOak(() => rc.generate(T(), 'OWN', { sectionId: String(s.sectionA._id), termKey: 'TERM_1' }));
    card = await rahulCard();
    expect(card.status).toBe('DRAFT');
    expect(card.scholastic.find((r) => r.subject === 'Mathematics').components.HY.value).toBe(72);
    await inOak(() => rc.moderate(T(), 'OWN', card.id, { stage: 'CLASS_TEACHER', allowIncomplete: true }));
    await inOak(() => rc.moderate(PR(), 'ALL', card.id, { stage: 'PRINCIPAL' }));
    await expect(inOak(() => rc.publish(PR(), 'ALL', card.id))).rejects.toMatchObject({ code: 'CORRECTION_NOTE_REQUIRED' });
    await inOak(() => rc.publish(PR(), 'ALL', card.id, { correctionNote: 'Mathematics half-yearly added' }));
    const versions = await inOak(() => ReportCardVersion.find({ cardId: card.id }).sort({ version: 1 }).lean());
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].supersededAt).not.toBeNull();
    const latest = await inOak(() => rc.published(s.people.PARENT.actor, 'OWN', {}));
    expect(latest[0].version).toBe(2);
    expect(latest[0].olderVersions).toHaveLength(1);

    // The PDF renders.
    const chunks = [];
    const sink = new PassThrough();
    sink.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => sink.on('end', r));
    renderTermCardPdf(sink, await inOak(() => rc.getVersion(s.people.PARENT.actor, s.people.PARENT.actor.permissions, latest[0].versionId)));
    await done;
    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
