import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, mcp, proposeAndConfirm } from './support/mcpSchool.js';
import { Role } from '../src/models/role.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Student, Enrollment, StudentGuardian } from '../src/models/student.model.js';
import { Grade, Section, Subject, Term, SubjectOffering } from '../src/models/academics.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { DocumentType } from '../src/models/documentRequest.model.js';
import { AlumniProfile } from '../src/models/alumni.model.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { mcpToolsFor, getMcpTool, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import * as alumni from '../src/modules/alumni/alumni.service.js';
import * as docs from '../src/modules/documentRequests/documentRequest.service.js';
import * as opps from '../src/modules/p4StudentAlumnus/opportunities.service.js';
import * as planner from '../src/modules/p4StudentAlumnus/planner.service.js';
import { CURRENT_ONLY } from '../src/modules/p4StudentAlumnus/p4StudentAlumnus.routes.js';

/**
 * Part 4, student and alumnus:
 *   - the planner shows only the student's own homework, exams and marks, sizes the
 *     day by age, adds the board-details check in Classes 10 and 12, and a parent
 *     reaches only their own child;
 *   - a former student requests certificates from their own archived record, never
 *     a current-student certificate; former staff are sent to HR;
 *   - alumni offers wait for review, students see their audience only, without the
 *     link, and their interest goes to the coordinator, not the alumnus;
 *   - the assistant can do each of these (draft, then confirm), and decides nothing.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

async function actorFor(profileId) {
  const p = await Profile.findById(profileId).lean();
  const role = await Role.findById(p.roleId);
  return { accountId: String(p.accountId), profileId: String(p._id), displayName: p.displayName, roleKey: role.key, permissions: buildPermissionMap(role), tenantId: OAK };
}

beforeEach(async () => {
  s = await seedSchool();
  s.people.HR = await seedPerson({ roleKey: 'HR', roleId: s.roleIds.HR, displayName: 'Alumni coordinator' });
});

async function classWork() {
  return inOak(async () => {
    const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
    const maths = await Subject.create({ name: 'Mathematics' });
    const sci = await Subject.create({ name: 'Science' });
    const offM = await SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: maths._id, termId: term._id });
    const offS = await SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: sci._id, termId: term._id });
    const hw = await Assignment.create({ subjectOfferingId: offM._id, title: 'Fractions worksheet', dueAt: new Date(Date.now() + 2 * DAY) });
    const done = await Assignment.create({ subjectOfferingId: offS._id, title: 'Plant cell diagram', dueAt: new Date(Date.now() + 3 * DAY) });
    await Submission.create({ assignmentId: done._id, enrollmentId: s.priya.enrollment._id, status: 'SUBMITTED' });
    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date(), endsOn: new Date(Date.now() + 10 * DAY) });
    await ExamSubject.create({ examId: exam._id, subjectOfferingId: offS._id, examDate: new Date(Date.now() + 5 * DAY), maxMarks: 50 });
    const past = await Exam.create({ termId: term._id, name: 'Unit Test 1', startsOn: new Date(Date.now() - 40 * DAY), endsOn: new Date(Date.now() - 35 * DAY) });
    const pm = await ExamSubject.create({ examId: past._id, subjectOfferingId: offM._id, examDate: new Date(Date.now() - 38 * DAY), maxMarks: 50 });
    const ps = await ExamSubject.create({ examId: past._id, subjectOfferingId: offS._id, examDate: new Date(Date.now() - 37 * DAY), maxMarks: 50 });
    await Mark.create({ examSubjectId: pm._id, enrollmentId: s.priya.enrollment._id, marks: 22, status: 'PUBLISHED' });
    await Mark.create({ examSubjectId: ps._id, enrollmentId: s.priya.enrollment._id, marks: 45, status: 'PUBLISHED' });
    // A classmate's mark that must never appear in Priya's planner.
    await Mark.create({ examSubjectId: pm._id, enrollmentId: s.rahul.enrollment._id, marks: 50, status: 'PUBLISHED' });
    return { hw, term, maths };
  });
}

describe('student planner', () => {
  it('lists own open homework and exams, plans from own marks, and sizes the day by age', async () => {
    const { hw } = await classWork();
    const p = await inOak(() => planner.getPlanner(s.people.STUDENT.actor));
    expect(p.student.gradeNo).toBe(6);
    expect(p.student.stage).toBe('MIDDLE');
    expect(p.due.map((d) => d.title)).toEqual(['Fractions worksheet']); // the submitted one is gone
    expect(p.due[0].id).toBe(String(hw._id));
    expect(p.exams).toHaveLength(1);
    expect(p.exams[0]).toMatchObject({ exam: 'Unit Test 2', subject: 'Science', daysLeft: 5 });
    expect(p.strengths).toEqual([{ subject: 'Mathematics', percentage: 44, papers: 1 }, { subject: 'Science', percentage: 90, papers: 1 }]);
    expect(p.plan.dailyMinutes).toBe(60);
    const blocks = p.plan.days.flatMap((d) => d.blocks);
    expect(blocks.some((b) => b.kind === 'HOMEWORK' && /Fractions worksheet/.test(b.reason))).toBe(true);
    expect(blocks.some((b) => b.kind === 'REVISION' && b.subject === 'Science')).toBe(true);
    for (const d of p.plan.days) expect(d.totalMinutes).toBeLessThanOrEqual(60);
    expect(p.board).toBeNull();
    expect(planner.dailyMinutesFor(1)).toBe(20);
    expect(planner.dailyMinutesFor(12)).toBe(120);
    // Practice is never prescribed for games, art or music; "Sanskrit" and "Mathematics" are academic.
    for (const sub of ['Physical Education', 'Art', 'Music', 'Games']) expect(planner.NON_ACADEMIC.test(sub), sub).toBe(true);
    for (const sub of ['Mathematics', 'Sanskrit', 'Social Science']) expect(planner.NON_ACADEMIC.test(sub), sub).toBe(false);
    // A day off keeps no practice block.
    for (const d of p.plan.days.filter((x) => x.dayOff)) expect(d.blocks.every((b) => b.kind !== 'PRACTICE')).toBe(true);
  });

  it('adds the board-details check in Class 10, flagging what is missing', async () => {
    const { student } = await inOak(async () => {
      const g = await Grade.create({ name: 'Class 10', level: 10 });
      const sec = await Section.create({ gradeId: g._id, name: 'A' });
      const st = await Student.create({ admissionNo: 'OAK-10', firstName: 'Kiran', lastName: 'Das', dob: new Date('2011-03-04'), profileId: s.people.STUDENT.profile._id });
      await Enrollment.updateMany({ studentId: s.priya.student._id }, { $set: { status: 'WITHDRAWN' } });
      await Student.updateOne({ _id: s.priya.student._id }, { $set: { profileId: null } });
      await Enrollment.create({ studentId: st._id, sectionId: sec._id, academicYearId: s.year._id, status: 'ACTIVE', rollNo: 1 });
      await StudentGuardian.create({ studentId: st._id, guardianProfileId: s.people.PARENT.profile._id, relation: 'MOTHER' });
      return { student: st };
    });
    const p = await inOak(() => planner.getPlanner(s.people.STUDENT.actor));
    expect(p.student.stage).toBe('SECONDARY');
    expect(p.board.exam).toBe('Class 10 board examination');
    const byKey = Object.fromEntries(p.board.checks.map((c) => [c.key, c]));
    expect(byKey.name.value).toBe('Kiran Das');
    expect(byKey.dob.value).toBe('2011-03-04');
    expect(byKey.mother.value).toBe(s.people.PARENT.profile.displayName);
    expect(byKey.father.missing).toBe(true);
    expect(student).toBeTruthy();
  });

  it("lets a parent read only their own child's planner", async () => {
    await classWork();
    const own = await inOak(() => planner.getPlanner(s.people.PARENT.actor));
    expect(own.student.name).toBe('Rahul Sharma');
    // Part 5: the plan speaks about the child to the parent, not "your marks".
    expect(own.plan.note).toContain('Rahul’s homework');
    expect(JSON.stringify(own.plan)).not.toMatch(/Your published marks|your own published/);
    const mine = await inOak(() => planner.getPlanner(s.people.STUDENT.actor));
    expect(mine.plan.note).toContain('your own published marks');
    await expect(inOak(() => planner.getPlanner(s.people.PARENT.actor, { studentId: String(s.priya.student._id) }))).rejects.toMatchObject({ code: 'STUDENT_NOT_LINKED' });
    await expect(inOak(() => planner.getPlanner(s.people.TEACHER.actor))).rejects.toMatchObject({ code: 'ROLE_NOT_PERMITTED' });
  });
});

async function graduatePriya() {
  const out = await inOak(() => alumni.transition(s.people.HR.actor, { studentId: String(s.priya.student._id), reason: 'GRADUATED' }));
  return actorFor(out.profileId);
}

describe('alumni certificates', () => {
  it("files a former student's request against their own archived record", async () => {
    const alum = await graduatePriya();
    const { character, bonafide } = await inOak(async () => ({
      character: await DocumentType.create({ name: 'Character Certificate', nameKey: 'character certificate' }),
      bonafide: await DocumentType.create({ name: 'Bonafide Certificate', nameKey: 'bonafide certificate' }),
    }));
    expect(CURRENT_ONLY.test(bonafide.name)).toBe(true);
    expect(CURRENT_ONLY.test('Enrollment Certificate')).toBe(true);
    expect(CURRENT_ONLY.test(character.name)).toBe(false);

    const r = await inOak(() => docs.createRequest(alum, { documentTypeId: String(character._id), purpose: 'University admission', studentId: String(s.rahul.student._id) }));
    expect(r.status).toBe('PENDING');
    const office = await inOak(() => docs.listForSchool({}));
    const row = (office.items ?? office).find((x) => x.id === r.id);
    // The record is Priya's own, whatever studentId was sent.
    expect(row.student.name).toBe('Priya Verma');
    expect(row.student.className).toBe('Class 6 A');
    const mine = await inOak(() => docs.listMine(alum));
    expect(mine.map((x) => x.id)).toEqual([r.id]);
    await inOak(() => docs.cancelMine(alum, r.id));
  });

  it('refuses former staff and suspended alumni', async () => {
    const staff = await inOak(() => alumni.transition(s.people.HR.actor, { staffProfileId: String(s.people.LIBRARIAN.profile._id), reason: 'RETIRED', servedFrom: 2010, servedTo: 2025 }));
    const staffActor = await actorFor(staff.profileId);
    await expect(inOak(() => docs.listMine(staffActor))).rejects.toMatchObject({ code: 'ROLE_NOT_PERMITTED' });
    const alum = await graduatePriya();
    await inOak(() => AlumniProfile.updateOne({ profileId: alum.profileId }, { $set: { status: 'SUSPENDED' } }));
    await expect(inOak(() => docs.listMine(alum))).rejects.toMatchObject({ code: 'ALUMNUS_SUSPENDED' });
  });
});

describe('give-back board', () => {
  it('holds an offer for review, then shows students their audience without the link or the poster', async () => {
    const alum = await graduatePriya();
    const talk = await inOak(() => opps.create(alum, { kind: 'CAREER_TALK', title: 'Life as an engineer', description: 'A talk for every class about engineering.', audience: 'ALL_STUDENTS', link: 'https://example.org/talk' }));
    const intern = await inOak(() => opps.create(alum, { kind: 'INTERNSHIP', title: 'Summer internship', description: 'Two weeks for Classes 11 and 12.', audience: 'SENIOR_STUDENTS' }));
    expect(talk.status).toBe('PENDING_REVIEW');
    await expect(inOak(() => opps.create(alum, { kind: 'JOB', title: 'x', description: 'y', link: 'http://insecure.example' }))).rejects.toMatchObject({ code: 'BAD_LINK' });

    const rahulStudent = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, displayName: 'Rahul' });
    await inOak(() => Student.updateOne({ _id: s.rahul.student._id }, { $set: { profileId: rahulStudent.profile._id } }));
    expect(await inOak(() => opps.list(rahulStudent.actor))).toEqual([]);

    const hr = s.people.HR.actor;
    await expect(inOak(() => opps.review(hr, talk.id, { decision: 'REJECT' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await inOak(() => opps.review(hr, talk.id, { decision: 'PUBLISH' }));
    await inOak(() => opps.review(hr, intern.id, { decision: 'PUBLISH' }));
    await expect(inOak(() => opps.review(alum, talk.id, { decision: 'PUBLISH' }))).rejects.toThrow(/alumni.manage/);

    // Class 6: the all-students talk, not the senior internship; no link.
    const seen = await inOak(() => opps.list(rahulStudent.actor));
    expect(seen.map((o) => o.title)).toEqual(['Life as an engineer']);
    expect(seen[0].link).toBeNull();
    expect(seen[0].interestCount).toBeUndefined();
    expect(seen[0].interests).toBeUndefined();
    await expect(inOak(() => opps.interest(rahulStudent.actor, intern.id, {}))).rejects.toMatchObject({ statusCode: 404 });

    await inOak(() => opps.interest(rahulStudent.actor, talk.id, { note: 'I like maths' }));
    await expect(inOak(() => opps.interest(rahulStudent.actor, talk.id, {}))).rejects.toMatchObject({ code: 'ALREADY_INTERESTED' });
    // The alumnus sees a count, never names; the coordinator sees who.
    const posterView = (await inOak(() => opps.mine(alum))).find((o) => o.id === talk.id);
    expect(posterView.interestCount).toBe(1);
    expect(posterView.interests).toBeUndefined();
    const coordView = (await inOak(() => opps.list(hr, {}))).find((o) => o.id === talk.id);
    expect(coordView.interests[0]).toMatchObject({ roleKey: 'STUDENT', className: 'Class 6 A', note: 'I like maths' });
    // Alumni see the link.
    expect((await inOak(() => opps.list(alum))).find((o) => o.id === talk.id).link).toBe('https://example.org/talk');
    // Parents cannot show interest.
    await expect(inOak(() => opps.interest(s.people.PARENT.actor, talk.id, {}))).rejects.toMatchObject({ code: 'ROLE_NOT_PERMITTED' });
  });

  it('keeps a coordinator from reviewing their own offer, and lets the poster withdraw', async () => {
    const alum = await graduatePriya();
    const hr = s.people.HR.actor;
    const own = await inOak(() => opps.create(hr, { kind: 'SCHOLARSHIP', title: 'Merit scholarship', description: 'Two awards.', audience: 'SENIOR_STUDENTS' }));
    expect(own.status).toBe('PUBLISHED');
    const offer = await inOak(() => opps.create(alum, { kind: 'MENTORING', title: 'Mentoring', description: 'Monthly sessions.' }));
    const w = await inOak(() => opps.withdraw(alum, offer.id));
    expect(w.status).toBe('WITHDRAWN');
    await expect(inOak(() => opps.withdraw(alum, offer.id))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('assistant coverage', () => {
  it('registers the tools without a deciding one, and shows each role only its own', async () => {
    expect(validateMcpRegistry()).toEqual([]);
    const names = ['get_my_alumni_profile', 'update_my_alumni_profile', 'get_my_school_record', 'list_alumni_batches', 'list_alumni_posts', 'create_alumni_post',
      'list_alumni_certificate_types', 'get_my_alumni_certificate_requests', 'request_alumni_certificate', 'cancel_alumni_certificate_request',
      'list_alumni_opportunities', 'get_my_opportunity_offers', 'offer_opportunity', 'withdraw_opportunity_offer', 'express_interest_in_opportunity',
      'get_my_planner', 'get_board_registration_details'];
    for (const n of names) expect(getMcpTool(n), n).toBeTruthy();
    const alum = await graduatePriya();
    const forAlum = mcpToolsFor(alum).map((t) => t.name);
    for (const n of names.filter((x) => !['get_my_planner', 'get_board_registration_details'].includes(x))) expect(forAlum, n).toContain(n);
    const forStudent = mcpToolsFor(s.people.STUDENT.actor).map((t) => t.name);
    expect(forStudent).toEqual(expect.arrayContaining(['get_my_planner', 'get_board_registration_details', 'list_alumni_opportunities', 'express_interest_in_opportunity']));
    expect(forStudent).not.toContain('request_alumni_certificate');
    expect(forStudent).not.toContain('offer_opportunity');
    expect(mcpToolsFor(s.people.TEACHER.actor).map((t) => t.name)).not.toContain('get_my_planner');
  });

  it('drafts and confirms an alumnus offer and a certificate request; refuses a student', async () => {
    const alum = await graduatePriya();
    await inOak(() => DocumentType.create({ name: 'Character Certificate', nameKey: 'character certificate' }));
    const { proposal, done } = await proposeAndConfirm(OAK, alum, 'offer_opportunity', { kind: 'CAREER_TALK', title: 'Careers in design', description: 'A talk on design careers for seniors.' });
    expect(proposal.action.status).toBe('confirmation_required');
    expect(done.success).toBe(true);
    expect((await inOak(() => opps.mine(alum)))[0].status).toBe('PENDING_REVIEW');

    const cert = await proposeAndConfirm(OAK, alum, 'request_alumni_certificate', { certificate: 'character', purpose: 'Job verification' });
    expect(cert.proposal.action.status).toBe('confirmation_required');
    expect(cert.done.success).toBe(true);
    expect(await inOak(() => docs.listMine(alum))).toHaveLength(1);

    const refused = await mcp(OAK, s.people.STUDENT.actor, 'request_alumni_certificate', { certificate: 'character', purpose: 'x' });
    expect(refused.success).toBe(false);

    // Priya has graduated here; the parent asks for Rahul's.
    const plan = await mcp(OAK, s.people.PARENT.actor, 'get_my_planner', {});
    expect(plan.success).toBe(true);
  });
});
