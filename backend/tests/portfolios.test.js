import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { CoCurricularActivity } from '../src/models/coCurricular.model.js';
import { ReportCardTemplate, TermReportCard } from '../src/models/reportCard.model.js';
import * as svc from '../src/modules/portfolios/portfolios.service.js';
import { renderPortfolioPdf } from '../src/modules/portfolios/portfolio.pdf.js';

/**
 * Competency portfolios: evidence read from existing records (assignments,
 * report-card co-scholastic grades, co-curricular records), teacher evidence
 * and rubric ratings (never scores), student reflections, the PDF, and that
 * families and students see only their own portfolio.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  s = await seedFamilySchool();
  await inOak(async () => {
    const a = await Assignment.create({ subjectOfferingId: s.offerings.engA._id, title: 'Letter to the editor', type: 'HOMEWORK', dueAt: new Date(), maxMarks: 20 });
    await Submission.create({ assignmentId: a._id, enrollmentId: s.rahul.enrollment._id, status: 'GRADED', submittedAt: new Date(), marks: 17, feedback: 'Clear argument' });
    await CoCurricularActivity.create({ studentId: s.rahul.student._id, name: 'Inter-school debate', category: 'LITERARY', activityDate: new Date(), achievement: 'Second place', level: 'INTER_SCHOOL', status: 'APPROVED' });
    await CoCurricularActivity.create({ studentId: s.rahul.student._id, name: 'Pending thing', category: 'ARTS', activityDate: new Date(), status: 'PENDING' });
    const t = await ReportCardTemplate.create({ name: 'CBSE 6', terms: [{ key: 'TERM_1', name: 'Term 1', components: [] }], coScholasticAreas: [{ key: 'ART_EDUCATION', label: 'Art education' }] });
    await TermReportCard.create({ templateId: t._id, termKey: 'TERM_1', enrollmentId: s.rahul.enrollment._id, studentId: s.rahul.student._id, sectionId: s.sectionA._id, status: 'PUBLISHED', coScholastic: { ART_EDUCATION: 'A' }, publishedAt: new Date() });
  });
});

describe('evidence from existing records', () => {
  it('pulls assignments, co-scholastic grades and approved co-curricular records into the right competencies', async () => {
    const p = await inOak(() => svc.portfolio(s.people.TEACHER.actor, 'OWN', String(s.rahul.student._id)));
    const by = Object.fromEntries(p.competencies.map((c) => [c.key, c]));
    expect(by.LANGUAGE.evidence.map((e) => e.title)).toContain('Letter to the editor (English)');
    expect(by.LANGUAGE.evidence[0].detail).toMatch(/Marked 17\/20/);
    expect(by.CREATIVITY.evidence.some((e) => e.kind === 'REPORT_CARD' && e.detail === 'Grade A')).toBe(true);
    expect(by.COMMUNICATION.evidence.map((e) => e.title)).toContain('Inter-school debate');
    expect(JSON.stringify(p)).not.toContain('Pending thing');
    expect(p.counts.fromRecords).toBe(3);
  });
});

describe('teacher evidence, rubric and reflections', () => {
  it('rates on the rubric only, keeps one rating per term, and lets only the student reflect', async () => {
    const T = s.people.TEACHER.actor;
    const id = String(s.rahul.student._id);
    await inOak(() => svc.addEvidence(T, 'OWN', id, { competencyKey: 'COLLABORATION', title: 'Led the group model of the solar system', on: '2026-09-10' }));
    await inOak(() => svc.rate(T, 'OWN', id, { competencyKey: 'COLLABORATION', level: 'PROFICIENT', comment: 'Shares roles well', term: 'Term 1' }));
    await inOak(() => svc.rate(T, 'OWN', id, { competencyKey: 'COLLABORATION', level: 'ADVANCED', comment: 'Now leads', term: 'Term 1' }));
    await expect(inOak(() => svc.rate(T, 'OWN', id, { competencyKey: 'COLLABORATION', level: 'ADVANCED', score: 9 }))).rejects.toMatchObject({ code: 'RUBRIC_ONLY' });
    await expect(inOak(() => svc.rate(T, 'OWN', id, { competencyKey: 'COLLABORATION', level: 'EXCELLENT' }))).rejects.toMatchObject({ statusCode: 400 });
    // A teacher of another class cannot touch the portfolio.
    await expect(inOak(() => svc.rate(s.people.T4.actor, 'OWN', id, { competencyKey: 'COLLABORATION', level: 'ADVANCED' }))).rejects.toMatchObject({ statusCode: 404 });
    // Parents cannot add evidence or reflect.
    await expect(inOak(() => svc.addEvidence(s.people.PARENT.actor, 'OWN', id, { competencyKey: 'COLLABORATION', title: 'x' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => svc.reflect(s.people.PARENT.actor, id, { text: 'x' }))).rejects.toMatchObject({ code: 'STUDENT_ONLY' });

    const p = await inOak(() => svc.portfolio(s.people.PARENT.actor, 'OWN', id));
    const c = p.competencies.find((x) => x.key === 'COLLABORATION');
    expect(c.rating).toMatchObject({ level: 'ADVANCED', levelLabel: 'Advanced', term: 'Term 1' });
    expect(c.history).toHaveLength(1);
    expect(c.evidence[0].kind).toBe('TEACHER');
    expect(p.canManage).toBe(false);
  });

  it('lets a student reflect in their own portfolio only', async () => {
    const S = s.people.STUDENT.actor; // Priya
    const mine = String(s.priya.student._id);
    const r = await inOak(() => svc.reflect(S, mine, { competencyKey: 'CREATIVITY', text: 'I enjoyed designing the poster.' }));
    expect(r.competencyKey).toBe('CREATIVITY');
    await expect(inOak(() => svc.reflect(S, String(s.rahul.student._id), { text: 'x' }))).rejects.toMatchObject({ statusCode: 404 });
    const p = await inOak(() => svc.portfolio(S, 'OWN', mine));
    expect(p.canReflect).toBe(true);
    expect(p.competencies.find((c) => c.key === 'CREATIVITY').reflections[0].text).toMatch(/poster/);
  });
});

describe('who sees what', () => {
  it('shows families only their own child and renders the PDF', async () => {
    const id = String(s.rahul.student._id);
    await expect(inOak(() => svc.portfolio(s.people.PARENT2.actor, 'OWN', id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => svc.portfolio(s.people.STUDENT.actor, 'OWN', id))).rejects.toMatchObject({ statusCode: 404 });
    const kids = await inOak(() => svc.students(s.people.PARENT.actor, 'OWN', {}));
    expect(kids.map((k) => k.name).sort()).toEqual(['Rahul Sharma', 'Riya Kapoor']);
    const p = await inOak(() => svc.portfolio(s.people.PARENT.actor, 'OWN', id));
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => out.on('end', resolve));
    renderPortfolioPdf(out, p);
    await done;
    const buf = Buffer.concat(chunks);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });
});
