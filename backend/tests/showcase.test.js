import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Enrollment, Student } from '../src/models/student.model.js';
import { MediaConsent } from '../src/models/community.model.js';
import { ShowcaseEntry } from '../src/models/showcase.model.js';
import * as showcase from '../src/modules/showcase/showcase.service.js';
import { competitionRanks, withinCutoff } from '../src/modules/showcase/ranking.js';

/**
 * The top-ranker and achievement showcase: ranks from published results
 * only, the tie rule, the school's cut-off, consent checked when publishing
 * (a child without it is left out) and again on every read, a second person
 * reviewing, and families reading the published showcase only.
 *
 * Class 6 A sits a Half Yearly with one English paper: Rahul 90, Priya 90,
 * Aman 80, and a fourth pupil, Neha, 70.
 */
let s;
let exam;
let paper;
const inOak = (fn) => inSchool(OAK, fn);
const A = () => s.people.ADMIN.actor;
const P = () => s.people.PRINCIPAL.actor;

async function setUpExam({ publish = true } = {}) {
  return inOak(async () => {
    const neha = await Student.create({ admissionNo: 'OAK-4', firstName: 'Neha', lastName: 'Iyer' });
    const nehaEnr = await Enrollment.create({ studentId: neha._id, sectionId: s.sectionA._id, academicYearId: s.year._id, status: 'ACTIVE', rollNo: 4 });
    exam = await Exam.create({ termId: s.term._id, name: 'Half Yearly', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-09-10') });
    paper = await ExamSubject.create({ examId: exam._id, subjectOfferingId: s.offerings.engA._id, maxMarks: 100 });
    const status = publish ? 'PUBLISHED' : 'REVIEW';
    for (const [enr, marks] of [[s.rahul.enrollment, 90], [s.priya.enrollment, 90], [s.aman.enrollment, 80], [nehaEnr, 70]]) {
      // eslint-disable-next-line no-await-in-loop
      await Mark.create({ examSubjectId: paper._id, enrollmentId: enr._id, marks, status, publishedAt: publish ? new Date() : null });
    }
    return { neha };
  });
}
const consent = (student, level = 'INTERNAL') => inOak(() => MediaConsent.create({ studentId: student._id, level, grantedByProfileId: s.people.PARENT.profile._id, grantedByRole: 'PARENT' }));

beforeEach(async () => { s = await seedFamilySchool(); });

describe('the tie rule', () => {
  it('equal percentages share a rank and the next rank skips; the cut-off keeps ties at the boundary', () => {
    const ranked = competitionRanks([{ id: 'c', percentage: 93 }, { id: 'a', percentage: 95 }, { id: 'b', percentage: 95.001 }, { id: 'd', percentage: 80 }]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([['a', 1], ['b', 1], ['c', 3], ['d', 4]]);
    expect(withinCutoff(ranked, 2).map((r) => r.id)).toEqual(['a', 'b']);
    expect(withinCutoff(ranked, 3).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('drawing ranks', () => {
  it('uses published results only and never returns more than the cut-off', async () => {
    await setUpExam({ publish: false });
    await expect(inOak(() => showcase.rankPreview(A(), { examId: String(exam._id), sectionId: String(s.sectionA._id) }))).rejects.toMatchObject({ code: 'RESULTS_NOT_PUBLISHED' });
    await inOak(() => Mark.updateMany({ examSubjectId: paper._id }, { $set: { status: 'PUBLISHED', publishedAt: new Date() } }));
    await inOak(() => showcase.updateSettings(A(), { rankCutoff: 2 }));
    const preview = await inOak(() => showcase.rankPreview(A(), { examId: String(exam._id), sectionId: String(s.sectionA._id) }));
    // 90, 90, 80, 70 → ranks 1, 1, 3, 4; cut-off 2 → only the two firsts.
    expect(preview.rows.map((r) => [r.name, r.rank]).sort()).toEqual([['Priya Verma', 1], ['Rahul Sharma', 1]]);
    expect(JSON.stringify(preview)).not.toMatch(/Aman|Neha|"percentage"/);
    await expect(inOak(() => showcase.updateSettings(A(), { rankCutoff: 25 }))).rejects.toMatchObject({ code: 'BAD_CUTOFF' });
  });
});

describe('publishing', () => {
  it('a parent cannot publish, a drafter cannot review their own entry, and a child without consent is left out at publish time', async () => {
    await setUpExam();
    // Families never publish: no permission, and refused even if a role were mis-granted.
    await expect(inOak(() => showcase.createEdition(s.people.PARENT.actor, { title: 'x' }))).rejects.toMatchObject({ statusCode: 403 });
    const forged = { ...s.people.PARENT.actor, permissions: { ...s.people.PARENT.actor.permissions, 'showcase.publish': 'ALL' } };
    await expect(inOak(() => showcase.createEdition(forged, { title: 'x' }))).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
    await expect(inOak(() => showcase.createEdition({ ...s.people.STUDENT.actor, permissions: { 'showcase.publish': 'ALL' } }, { title: 'x' }))).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
    expect(s.people.PARENT.actor.permissions['showcase.publish']).toBeUndefined();
    expect(s.people.STUDENT.actor.permissions['showcase.publish']).toBeUndefined();

    await consent(s.rahul.student);
    await consent(s.aman.student);
    await consent(s.priya.student);
    const ed = await inOak(() => showcase.createEdition(A(), { title: 'Term 1 toppers', periodLabel: 'Term 1, 2026-27' }));
    const drafted = await inOak(() => showcase.addRankEntries(A(), ed.id, { examId: String(exam._id), sectionId: String(s.sectionA._id) }));
    // Default cut-off 3: Rahul 1, Priya 1, Aman 3. Neha (4th) is never drafted.
    expect(drafted.created).toBe(3);
    expect(drafted.entries.map((e) => e.studentName).sort()).toEqual(['Aman Gupta', 'Priya Verma', 'Rahul Sharma']);
    expect(drafted.entries.find((e) => e.studentName === 'Aman Gupta').title).toBe('3rd in Class 6 A');
    await expect(inOak(() => showcase.addEntry(A(), ed.id, { kind: 'RANK', studentId: String(s.aman.student._id), category: 'ACADEMIC', title: '1st' }))).rejects.toMatchObject({ code: 'RANKS_FROM_RESULTS' });

    const [first] = drafted.entries;
    await expect(inOak(() => showcase.reviewEntry(A(), first.id))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    for (const e of drafted.entries) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => showcase.reviewEntry(P(), e.id, { decision: 'APPROVE' }));
    }
    // Priya's parent withdraws consent after review, before publishing.
    await inOak(() => MediaConsent.updateMany({ studentId: s.priya.student._id }, { $set: { withdrawnAt: new Date() } }));
    const out = await inOak(() => showcase.publishEdition(P(), ed.id));
    expect(out.published).toBe(2);
    expect(out.excluded).toEqual([expect.objectContaining({ studentId: String(s.priya.student._id), reason: expect.stringMatching(/consent/) })]);
    expect((await inOak(() => ShowcaseEntry.findOne({ studentId: s.priya.student._id }).lean())).status).toBe('EXCLUDED');

    // A family reads the published showcase: no Priya, no Neha, no percentages, no drafts.
    const seen = await inOak(() => showcase.published(s.people.PARENT2.actor, {}));
    expect(seen.editions).toHaveLength(1);
    expect(seen.editions[0].entries.map((e) => [e.studentName, e.rank]).sort()).toEqual([['Aman Gupta', 3], ['Rahul Sharma', 1]]);
    const text = JSON.stringify(seen);
    expect(text).not.toMatch(/Priya|Neha|percentage|"status"|DRAFT/);
    // The school lowers its cut-off to 1: rank 3 disappears from the showcase at once.
    await inOak(() => showcase.updateSettings(A(), { rankCutoff: 1 }));
    const after = await inOak(() => showcase.published(s.people.STUDENT.actor, {}));
    expect(after.editions[0].entries.map((e) => e.studentName)).toEqual(['Rahul Sharma']);
    // A consent withdrawn after publishing hides the child on the next read.
    await inOak(() => MediaConsent.updateMany({ studentId: s.rahul.student._id }, { $set: { withdrawnAt: new Date() } }));
    expect((await inOak(() => showcase.published(s.people.PARENT.actor, {}))).editions).toEqual([]);
  });

  it('withdraws an entry or a whole edition, and refuses ranks if results were reopened before publishing', async () => {
    await setUpExam();
    await consent(s.rahul.student);
    await consent(s.priya.student);
    const ed = await inOak(() => showcase.createEdition(A(), { title: 'Term 1 toppers' }));
    const drafted = await inOak(() => showcase.addRankEntries(A(), ed.id, { examId: String(exam._id), sectionId: String(s.sectionA._id) }));
    const achievement = await inOak(() => showcase.addEntry(A(), ed.id, { studentId: String(s.priya.student._id), category: 'OLYMPIAD', title: 'Gold, International Maths Olympiad (sample)', level: 'INTERNATIONAL' }));
    for (const e of [...drafted.entries, achievement]) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => showcase.reviewEntry(P(), e.id, { decision: 'APPROVE' }));
    }
    // The paper is reopened for correction between review and publishing.
    await inOak(() => Mark.updateOne({ examSubjectId: paper._id, enrollmentId: s.aman.enrollment._id }, { $set: { status: 'DRAFT' } }));
    const out = await inOak(() => showcase.publishEdition(P(), ed.id));
    expect(out.published).toBe(1); // the olympiad entry
    expect(out.excluded.every((x) => /reopened|consent/.test(x.reason))).toBe(true);
    const shown = await inOak(() => showcase.published(s.people.PARENT.actor, {}));
    expect(shown.highlights.map((h) => h.title)).toEqual(['Gold, International Maths Olympiad (sample)']);
    await inOak(() => showcase.withdrawEntry(P(), achievement.id, { reason: 'Certificate not yet verified' }));
    expect((await inOak(() => showcase.published(s.people.PARENT.actor, {}))).highlights).toEqual([]);
    const w = await inOak(() => showcase.withdrawEdition(P(), ed.id, { reason: 'Replaced by the corrected list' }));
    expect(w.status).toBe('WITHDRAWN');
    await expect(inOak(() => showcase.publishEdition(P(), ed.id))).rejects.toMatchObject({ statusCode: 409 });
  });
});
