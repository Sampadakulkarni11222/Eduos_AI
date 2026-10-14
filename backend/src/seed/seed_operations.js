import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runWithTenant } from '../tenancy/tenantContext.js';
import { buildPermissionMap } from '../utils/buildPermissionMap.js';
import { Role } from '../models/role.model.js';
import { Profile } from '../models/profile.model.js';
import { Section, SubjectOffering, Term } from '../models/academics.model.js';
import { Enrollment } from '../models/student.model.js';
import { AttendanceRecord } from '../models/attendanceRecord.model.js';
import { TimetableSlot } from '../models/timetableSlot.model.js';
import { Exam, ExamSubject } from '../models/exam.model.js';
import { Facility, FacilityBooking, WorkOrder } from '../models/facility.model.js';
import { InstitutionProfile, OrgUnit, Position, Appointment } from '../models/institution.model.js';
import { Correspondence, Contract, InstitutionEvent } from '../models/administration.model.js';
import { Licence, Policy, TrainingSession, RegulatoryNotice, RegulatoryReturn, SafeguardingCase } from '../models/compliance.model.js';
import { AccreditationCycle } from '../models/accreditation.model.js';
import { ApprovalRequest } from '../models/approval.model.js';
import { VerificationCase } from '../models/verification.model.js';
import { BoardMeeting } from '../models/governance.model.js';
import { Lead } from '../models/lead.model.js';
import { Campaign } from '../models/marketing.model.js';
import { CommunityPost } from '../models/community.model.js';
import { OnlineClass } from '../models/onlineClass.model.js';
import { CourseModule } from '../models/courseModule.model.js';
import { Notification } from '../models/notification.model.js';
import { MessageOutbox } from '../models/messaging.model.js';
import * as financeModels from '../models/finance.model.js';
import * as complianceModels from '../models/compliance.model.js';
import * as marketingModels from '../models/marketing.model.js';
import * as communityModels from '../models/community.model.js';
import * as institutionModels from '../models/institution.model.js';
import { startOfDayUtc } from '../modules/ops/common.js';
import * as institution from '../modules/institution/institution.service.js';
import * as org from '../modules/institution/org.service.js';
import * as correspondence from '../modules/administration/correspondence.service.js';
import * as verification from '../modules/administration/verification.service.js';
import * as events from '../modules/administration/events.service.js';
import * as facilities from '../modules/administration/facility.service.js';
import * as governance from '../modules/governance/governance.service.js';
import * as compliance from '../modules/compliance/compliance.service.js';
import * as accreditation from '../modules/compliance/accreditation.service.js';
import * as safeguarding from '../modules/compliance/safeguarding.service.js';
import * as payroll from '../modules/finance-ops/payroll.service.js';
import * as procurement from '../modules/finance-ops/procurement.service.js';
import * as marketing from '../modules/marketing/marketing.service.js';
import * as community from '../modules/community/community.service.js';
import * as lectures from '../modules/lectures/lecture.service.js';
import * as syllabus from '../modules/syllabus/syllabus.service.js';
// Student and parent sample data (sections appended at the end of the run).
import { Student, StudentGuardian } from '../models/student.model.js';
import { Book, BookIssue } from '../models/library.model.js';
import { Announcement } from '../models/announcement.model.js';
import { DocumentType } from '../models/documentRequest.model.js';
import { Assignment } from '../models/assignment.model.js';
import * as documentTypes from '../modules/documentRequests/documentType.service.js';

/**
 * Sample data for every operations screen, so each one has something to look
 * at and act on the first time it is opened:
 *
 *   npm run seed:school && npm run seed && npm run seed:operations
 *
 * Everything here is FICTIONAL: invented people, reference numbers, vendors
 * and authorities' letters. Nothing is filed, paid or sent; messages land in
 * the outbox as simulated. Records are written through the same services the
 * screens use, so they obey the same rules (and a section that fails is
 * reported and skipped, not half-written by hand). Each section runs only
 * while its collection is empty, so the script is safe to run twice.
 *
 * `seed:school` recreates every person, which leaves earlier sample records
 * pointing at people who no longer exist. After re-running it, pass --reset
 * here (npm run seed:operations -- --reset) to clear the sample records first.
 */
const SEED_SCHOOL_SLUG = (process.env.SEED_SCHOOL_SLUG || 'oakridge').toLowerCase();
const DAY = 86_400_000;
const now = new Date();
const inDays = (n, hour = null) => {
  const d = new Date(now.getTime() + n * DAY);
  if (hour !== null) d.setUTCHours(hour - 6, 30, 0, 0); // `hour` o'clock in India
  return d;
};
const ymd = (n) => inDays(n).toISOString().slice(0, 10);
const rupees = (n) => Math.round(n * 100);

const results = [];
/** Runs one section; a failure is reported, and the rest still run. */
async function section(name, Model, fn) {
  try {
    if (Model && (await Model.countDocuments({})) > 0) { results.push([name, 'kept (already has data)']); return; }
    const note = await fn();
    results.push([name, note ?? 'done']);
  } catch (err) {
    results.push([name, `FAILED: ${err.message}`]);
    logger.warn(`  ✘  ${name}: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}
/** One step inside a section that may be refused without stopping the section. */
async function attempt(label, fn) {
  try { return await fn(); } catch (err) { logger.warn(`     · ${label}: ${err.message}`); return null; }
}

// What each subject's four modules cover (generic, textbook-neutral wording).
const MODULES = {
  Mathematics: [['Number systems', ['Integers and rationals', 'Number line', 'Operations', 'Word problems']], ['Algebra', ['Expressions', 'Linear equations', 'Solving for x', 'Applications', 'Revision test']], ['Geometry', ['Lines and angles', 'Triangles', 'Congruence', 'Constructions', 'Practice sheet']], ['Data handling', ['Collecting data', 'Bar graphs', 'Mean, median, mode', 'Probability']]],
  Science: [['Matter and materials', ['States of matter', 'Mixtures', 'Separation methods', 'Lab: filtration']], ['Living world', ['Cells', 'Tissues', 'Plant systems', 'Human systems', 'Lab: microscope']], ['Force and motion', ['Speed and velocity', 'Laws of motion', 'Friction', 'Lab: trolley experiment', 'Numericals']], ['Energy', ['Work and power', 'Heat', 'Light', 'Electric circuits']]],
  English: [['Prose', ['Reading: chapter 1', 'Reading: chapter 2', 'Comprehension', 'Vocabulary']], ['Poetry', ['Poem 1', 'Poem 2', 'Figures of speech', 'Recitation', 'Appreciation writing']], ['Grammar', ['Tenses', 'Active and passive', 'Reported speech', 'Clauses', 'Editing practice']], ['Writing skills', ['Letter writing', 'Essay', 'Notice and report', 'Story writing']]],
  default: [['Unit 1 · Foundations', ['Introduction', 'Key terms', 'Worked examples', 'Exercise']], ['Unit 2 · Core ideas', ['Concept 1', 'Concept 2', 'Class activity', 'Practice', 'Unit test']], ['Unit 3 · Applications', ['Case study', 'Project work', 'Discussion', 'Worksheet', 'Revision']], ['Unit 4 · Review', ['Recap', 'Sample paper', 'Doubt clearing', 'Assessment']]],
};
const modulesFor = (subject) => MODULES[Object.keys(MODULES).find((k) => subject?.toLowerCase().includes(k.toLowerCase())) ?? 'default'];

async function seedOperations() {
  if (!env.isDev && !process.env.SEED_DEMO_PASSWORD) { logger.error('REFUSING to seed sample data outside development.'); process.exit(1); }
  if (!/localhost|127\.0\.0\.1/.test(env.MONGO_URI) && !process.argv.includes('--allow-remote')) { logger.error('REFUSING to seed a non-local database. Re-run with --allow-remote if you are certain.'); process.exit(1); }
  await mongoose.connect(env.MONGO_URI);

  if (process.argv.includes('--reset')) {
    const models = [
      ...[financeModels, complianceModels, marketingModels, communityModels, institutionModels].flatMap((m) => Object.values(m)),
      CourseModule, OnlineClass, Correspondence, Contract, InstitutionEvent, AccreditationCycle, VerificationCase, BoardMeeting, Lead, ApprovalRequest, FacilityBooking, WorkOrder,
      // Notifications and outbox messages addressed to the people the old sample records named.
      Notification, MessageOutbox,
    ].filter((m) => typeof m?.deleteMany === 'function');
    for (const m of models) {
      // eslint-disable-next-line no-await-in-loop
      await m.deleteMany({});
    }
    logger.warn(`Cleared ${models.length} collections of sample operations data (--reset).`);
  }

  const roles = await Role.find({}).lean();
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const actorOf = (profile, roleKey) => ({
    accountId: String(profile.accountId), profileId: String(profile._id), displayName: profile.displayName, roleKey,
    permissions: buildPermissionMap(roleByKey.get(roleKey)), tenantId: SEED_SCHOOL_SLUG, tenantName: profile.tenantName,
  });
  const who = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE', 'ALUMNUS', 'LIBRARIAN', 'WARDEN', 'STUDENT', 'PARENT']) {
    const role = roleByKey.get(key);
    // eslint-disable-next-line no-await-in-loop
    const profile = role ? await Profile.findOne({ roleId: role._id, tenantId: SEED_SCHOOL_SLUG, deletedAt: null }).sort({ createdAt: 1 }).lean() : null;
    if (profile) who[key] = { profile, actor: actorOf(profile, key), id: String(profile._id) };
  }
  const missing = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE'].filter((k) => !who[k]);
  if (missing.length) { logger.error(`Run "npm run seed:school" and "npm run seed" first; no demo person for: ${missing.join(', ')}`); process.exit(1); }
  const { ADMIN, PRINCIPAL, TEACHER, FINANCE, HR, MARKETING, COMPLIANCE } = who;
  const teacherRole = roleByKey.get('TEACHER');
  const teachers = await Profile.find({ roleId: teacherRole._id, tenantId: SEED_SCHOOL_SLUG, deletedAt: null }).lean();
  const teacherActor = new Map(teachers.map((t) => [String(t._id), actorOf(t, 'TEACHER')]));
  const room = async (code) => Facility.findOne({ code }).lean();

  // ── The school itself ───────────────────────────────────────────────────
  await section('School profile', null, async () => {
    const p = await InstitutionProfile.findOne({}).lean();
    if (p?.campuses?.length) return 'kept (already filled in)';
    await institution.updateProfile(ADMIN.actor, {
      displayName: 'Oakridge Academy', legalName: 'Oakridge Education Trust (sample)', shortName: 'Oakridge', motto: 'Learn. Lead. Serve.',
      about: 'A fictional K-12 day and boarding school used to demonstrate this system. Every figure, person and reference number here is sample data.',
      website: 'https://oakridge.example', institutionType: 'SCHOOL', management: 'PRIVATE_UNAIDED', establishedYear: 1998,
      legalEntity: { type: 'TRUST', name: 'Oakridge Education Trust (sample)', registrationNo: 'SAMPLE/TRUST/0001', registeredOn: '1997-08-14' },
      contact: { email: 'office@oakridge.example', phone: '+910000000100' }, boards: ['CBSE'],
      campuses: [{ code: 'MAIN', name: 'Main Campus', type: 'SCHOOL', addressLine: '1 Sample Road', city: 'Sampleville', district: 'Sample District', state: 'Maharashtra', pincode: '400000', udiseCode: '00000000000' }],
    });
    return 'filled in';
  });

  await section('Organisation structure', OrgUnit, async () => {
    // The starter structure also appoints every member of staff to the position for their role.
    await org.bootstrap('SCHOOL');
    return `${await OrgUnit.countDocuments({})} units, ${await Position.countDocuments({})} positions, ${await Appointment.countDocuments({})} appointments`;
  });

  // ── Timetable: an afternoon, so the map has lessons for more of the day ──
  await section('Afternoon timetable', null, async () => {
    if (await TimetableSlot.exists({ periodNo: 6 })) return 'kept';
    const sections = await Section.find({}).sort({ _id: 1 }).lean();
    const extra = [{ no: 6, start: '13:15', end: '14:00' }, { no: 7, start: '14:15', end: '15:00' }, { no: 8, start: '15:00', end: '15:45' }];
    const docs = [];
    for (const [i, sec] of sections.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const offs = await SubjectOffering.find({ sectionId: sec._id }).sort({ _id: 1 }).select('_id').lean();
      if (!offs.length) continue;
      for (const day of [1, 2, 3, 4, 5, 6]) {
        for (const p of extra) docs.push({ sectionId: sec._id, dayOfWeek: day, periodNo: p.no, startTime: p.start, endTime: p.end, subjectOfferingId: offs[(day + p.no - 1 + i) % offs.length]._id });
        // Saturday mornings too, so a weekend test still shows a school at work.
        if (day === 6) for (const [k, t] of [['08:30', '09:15'], ['09:15', '10:00'], ['10:15', '11:00'], ['11:00', '11:45'], ['12:30', '13:15']].entries()) docs.push({ sectionId: sec._id, dayOfWeek: 6, periodNo: k + 1, startTime: t[0], endTime: t[1], subjectOfferingId: offs[(day + k + i) % offs.length]._id });
      }
    }
    await TimetableSlot.insertMany(docs, { ordered: false }).catch((e) => { if (!e.insertedDocs) throw e; });
    return `${docs.length} periods added (afternoons and Saturday)`;
  });

  // A lab period a day for the first classes, so the labs are in use too.
  await section('Lab periods', null, async () => {
    if (await TimetableSlot.exists({ room: { $nin: [null, ''] } })) return 'kept';
    const labs = await Facility.find({ kind: 'LAB' }).sort({ code: 1 }).select('code name').lean();
    const sections = await Section.find({}).sort({ _id: 1 }).limit(8).lean();
    if (!labs.length) return 'no labs on the campus';
    let n = 0;
    for (const [i, sec] of sections.entries()) {
      // Each class has its own period, so no two are in the same lab together.
      // eslint-disable-next-line no-await-in-loop
      const res = await TimetableSlot.updateMany({ sectionId: sec._id, periodNo: i + 1 }, { $set: { room: labs[i % labs.length].code } });
      n += res.modifiedCount;
    }
    return `${n} periods moved into ${labs.length} labs`;
  });

  // ── Today's register, so each classroom shows who is in it ───────────────
  await section("Today's attendance", null, async () => {
    const today = startOfDayUtc(now);
    const homeRooms = await Facility.find({ sectionId: { $ne: null } }).sort({ code: 1 }).select('sectionId code').lean();
    // The last two classes are left unmarked on purpose: mark them and watch the map change.
    const marked = homeRooms.slice(0, Math.max(0, homeRooms.length - 2));
    let n = 0;
    for (const [i, r] of marked.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const enrolments = await Enrollment.find({ sectionId: r.sectionId, status: 'ACTIVE' }).select('_id').lean();
      // eslint-disable-next-line no-await-in-loop
      if (await AttendanceRecord.exists({ enrollmentId: { $in: enrolments.map((e) => e._id) }, date: today, periodNo: null })) continue;
      const docs = enrolments.map((e, k) => {
        const roll = (k * 7 + i * 3) % 23;
        const status = roll === 0 || roll === 11 ? 'ABSENT' : roll === 5 ? 'LATE' : 'PRESENT';
        return { enrollmentId: e._id, date: today, periodNo: null, status, note: status === 'LATE' ? 'Late bus' : '', source: 'WEB', markedByProfileId: TEACHER.profile._id };
      });
      // eslint-disable-next-line no-await-in-loop
      if (docs.length) { await AttendanceRecord.insertMany(docs); n += docs.length; }
    }
    return `${n} students marked in ${marked.length} classes; ${homeRooms.length - marked.length} classes left unmarked`;
  });

  // ── An exam in progress, so the map shows exam halls ─────────────────────
  await section('Exam in progress', null, async () => {
    if (await Exam.exists({ name: 'Unit Test 2 (sample)' })) return 'kept';
    const term = await Term.findOne({ startsOn: { $lte: now }, endsOn: { $gte: now } }).lean() ?? await Term.findOne({}).lean();
    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 2 (sample)', startsOn: inDays(-1), endsOn: inDays(3) });
    const homeRooms = await Facility.find({ sectionId: { $ne: null } }).sort({ code: 1 }).select('sectionId').lean();
    const sitting = homeRooms.slice(2, 4).map((r) => r.sectionId);
    const offs = await SubjectOffering.find({ sectionId: { $in: sitting } }).sort({ _id: 1 }).lean();
    const perSection = new Map();
    for (const o of offs) {
      const k = String(o.sectionId);
      const n = perSection.get(k) ?? 0;
      perSection.set(k, n + 1);
      if (n > 3) continue;
      // The first paper is today; the rest follow one a day.
      // eslint-disable-next-line no-await-in-loop
      await ExamSubject.create({ examId: exam._id, subjectOfferingId: o._id, examDate: new Date(startOfDayUtc(now).getTime() + n * DAY), maxMarks: 50 });
    }
    return `${sitting.length} classes sitting a paper today`;
  });

  // ── Module plans and what has been taught ────────────────────────────────
  await section('Syllabus modules', CourseModule, async () => {
    const offs = await SubjectOffering.find({ teacherId: { $ne: null } }).populate('subjectId', 'name').sort({ _id: 1 }).lean();
    // Windows relative to today: two finished, one under way, one still to come.
    const windows = [[-120, -82], [-80, -40], [-24, 11], [13, 45]];
    let made = 0; let skipped = 0;
    for (const [i, o] of offs.entries()) {
      const actor = teacherActor.get(String(o.teacherId));
      // Every eleventh subject has no plan yet, so the tracker has that case to show.
      if (!actor || i % 11 === 10) { skipped += 1; continue; }
      const plan = modulesFor(o.subjectId?.name);
      const shape = i % 8; // 0 behind · 2 ahead · 4 overdue on the previous module · 5 gone quiet · the rest on track
      for (const [k, [title, topics]] of plan.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const m = await attempt(`plan ${title}`, () => syllabus.createModule(actor, { subjectOfferingId: String(o._id), title, plannedStart: ymd(windows[k][0]), plannedEnd: ymd(windows[k][1]), plannedPeriods: topics.length * 3, topics }));
        if (!m) continue;
        made += 1;
        const ids = m.topics.map((t) => t.id);
        const teach = (topicIds, day, note, homework) => attempt('record lesson', () => syllabus.recordProgress(actor, m.id, { topicIds, taughtOn: ymd(day), note, homework }));
        if (k === 0) {
          // eslint-disable-next-line no-await-in-loop
          await teach(ids.slice(0, 2), windows[0][0] + 6, 'Introduced with examples from the textbook.', 'Exercise 1, questions 1-5');
          // eslint-disable-next-line no-await-in-loop
          await teach(ids.slice(2), windows[0][1] - 3, 'Completed and revised.', 'Worksheet 1');
        } else if (k === 1) {
          // eslint-disable-next-line no-await-in-loop
          await teach(ids.slice(0, 3), windows[1][0] + 10, 'Group activity went well.', 'Read the next section');
          // eslint-disable-next-line no-await-in-loop
          if (shape !== 4) await teach(ids.slice(3), windows[1][1] - 2, 'Unit closed with a short test.', null);
        } else if (k === 2 && shape !== 4) {
          const done = shape === 0 ? 1 : shape === 2 ? ids.length - 1 : 3;
          // eslint-disable-next-line no-await-in-loop
          await teach(ids.slice(0, 1), shape === 5 ? -20 : -18, 'Started the unit.', 'Revise class notes');
          // eslint-disable-next-line no-await-in-loop
          if (done > 1) await teach(ids.slice(1, done), shape === 5 ? -16 : -2, 'Covered with worked examples on the board.', 'Practice set 2');
        }
      }
    }
    return `${made} modules planned across ${offs.length - skipped} subjects; ${skipped} left without a plan`;
  });

  // ── Online classes ───────────────────────────────────────────────────────
  await section('Digital lectures', OnlineClass, async () => {
    const mine = await SubjectOffering.find({ teacherId: TEACHER.profile._id }).populate('subjectId', 'name').limit(3).lean();
    let n = 0;
    for (const [i, o] of mine.entries()) {
      const startsAt = i === 0 ? new Date(now.getTime() + 40 * 60_000) : inDays(i, 17);
      // eslint-disable-next-line no-await-in-loop
      if (await attempt('online class', () => lectures.create(TEACHER.actor, { title: `${o.subjectId?.name ?? 'Subject'} · ${['doubt-clearing session', 'revision class', 'guest lecture'][i]}`, sectionIds: [String(o.sectionId)], subjectOfferingId: String(o._id), startsAt: startsAt.toISOString(), durationMinutes: 45, includeGuardians: i === 1, kind: i === 2 ? 'WEBINAR' : 'LECTURE', provider: 'JITSI' }))) n += 1;
    }
    return `${n} classes scheduled (the first starts in 40 minutes)`;
  });

  // ── Administration ───────────────────────────────────────────────────────
  await section('Correspondence', Correspondence, async () => {
    const a = await correspondence.register(ADMIN.actor, { direction: 'INWARD', counterpartyType: 'DISTRICT_OFFICE', counterpartyName: 'District Education Office (sample)', subject: 'Annual inspection: documents to keep ready', summary: 'Sample letter asking the school to keep fire-safety, building-safety and staff records ready for inspection.', theirReference: 'DEO/SAMPLE/2026/114', ownerProfileId: COMPLIANCE.id, receivedOn: ymd(-3), dueOn: ymd(6) });
    await correspondence.register(ADMIN.actor, { direction: 'INWARD', counterpartyType: 'BOARD', counterpartyName: 'Examining Board (sample)', subject: 'List of candidates: last date reminder', summary: 'Sample reminder that the list of candidates must reach the board before the closing date.', theirReference: 'BOARD/SAMPLE/LOC/77', ownerProfileId: PRINCIPAL.id, receivedOn: ymd(-9), dueOn: ymd(-1) });
    await correspondence.register(ADMIN.actor, { direction: 'INWARD', counterpartyType: 'PARENT', counterpartyName: 'A parent (sample)', subject: 'Request for an extra bus stop', summary: 'Sample request to add a stop on Route 1.', ownerProfileId: ADMIN.id, receivedOn: ymd(-1), dueOn: ymd(10) });
    const out = await correspondence.register(ADMIN.actor, { direction: 'OUTWARD', counterpartyType: 'LOCAL_AUTHORITY', counterpartyName: 'Municipal Fire Office (sample)', subject: 'Request to renew the fire safety certificate', summary: 'Sample outward letter that needs the principal\'s signature.', ownerProfileId: ADMIN.id, dueOn: ymd(4) });
    await attempt('draft reply', () => correspondence.saveDraft(ADMIN.actor, 'ALL', out.id, { body: 'Sir/Madam,\n\nWe request renewal of the fire safety certificate for our school building. The last inspection report and the fee receipt are enclosed.\n\nYours faithfully,\nPrincipal' }));
    await attempt('send for signature', () => correspondence.submitForApproval(ADMIN.actor, 'ALL', out.id, {}));
    await attempt('assign', () => correspondence.assign(ADMIN.actor, 'ALL', a.id, { ownerProfileId: COMPLIANCE.id }));
    return '3 inward letters (one overdue), 1 outward letter awaiting signature';
  });

  await section('Background verification', VerificationCase, async () => {
    const consent = { obtained: true, evidenceUrl: 'https://files.example/sample/consent-form.pdf' };
    const ready = await verification.initiate(HR.actor, { subjectType: 'TEACHER', subjectName: 'Anita Sample (new teacher)', positionTitle: 'Science Teacher', consent });
    for (const c of ready.checks) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(`check ${c.type}`, () => verification.recordCheck(HR.actor, ready.id, String(c.id ?? c._id), { status: 'CLEAR', provider: 'Sample Verification Agency', reference: `SAMPLE-${c.type}-001`, note: 'Sample result for testing.' }));
    }
    await attempt('HR review', () => verification.hrReview(HR.actor, ready.id, { recommendation: 'CLEAR', note: 'All checks are clear. Recommended for clearance (sample).' }));
    const driver = await verification.initiate(HR.actor, { subjectType: 'DRIVER', subjectName: 'Ramesh Sample (bus driver)', positionTitle: 'Driver · Route 1', linkedEntity: 'Route 1', consent, driver: { licenceNo: 'SAMPLE-DL-0001', licenceClass: 'HMV', licenceExpiresOn: ymd(200), badgeNo: 'SAMPLE-BADGE-01' } });
    for (const c of driver.checks.slice(0, 3)) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(`check ${c.type}`, () => verification.recordCheck(HR.actor, driver.id, String(c.id ?? c._id), { status: 'CLEAR', provider: 'Sample Verification Agency', reference: `SAMPLE-${c.type}-002` }));
    }
    await verification.initiate(HR.actor, { subjectType: 'ATTENDANT', subjectName: 'Sunita Sample (bus attendant)', positionTitle: 'Attendant · Route 1' });
    await verification.initiate(HR.actor, { subjectType: 'SECURITY', subjectName: 'Vijay Sample (gate security)', positionTitle: 'Security guard', consent });
    return '4 cases: one ready for the principal, a driver half-way, one awaiting consent, one just opened';
  });

  await section('Facility bookings', FacilityBooking, async () => {
    const [aud, lab, court] = await Promise.all([room('AUD-HALL'), room('203'), room('CRT-1')]);
    let n = 0;
    if (aud) {
      const live = await attempt('book now', () => facilities.requestBooking(TEACHER.actor, { facilityId: String(aud._id), title: 'Annual Day rehearsal', startsAt: new Date(now.getTime() - 30 * 60_000).toISOString(), endsAt: new Date(now.getTime() + 90 * 60_000).toISOString(), attendees: 120 }));
      if (live) { n += 1; await attempt('approve', () => facilities.decideBooking(ADMIN.actor, live.id, { decision: 'CONFIRMED', note: 'Confirmed (sample).' })); }
      if (await attempt('book', () => facilities.requestBooking(PRINCIPAL.actor, { facilityId: String(aud._id), title: 'Parent orientation', startsAt: inDays(3, 10).toISOString(), endsAt: inDays(3, 12).toISOString(), attendees: 250 }))) n += 1;
    }
    if (lab && await attempt('book', () => facilities.requestBooking(TEACHER.actor, { facilityId: String(lab._id), title: 'Coding club', startsAt: inDays(1, 15).toISOString(), endsAt: inDays(1, 16).toISOString(), attendees: 25 }))) n += 1;
    if (court && await attempt('book', () => facilities.requestBooking(TEACHER.actor, { facilityId: String(court._id), title: 'Inter-house basketball practice', startsAt: inDays(2, 16).toISOString(), endsAt: inDays(2, 17).toISOString(), attendees: 30 }))) n += 1;
    return `${n} bookings (one in the auditorium right now)`;
  });

  await section('Repairs', WorkOrder, async () => {
    const jobs = [['G03', 'Ceiling fan not working', 'ELECTRICAL', 'URGENT'], ['203', 'Six computers will not start', 'IT', 'HIGH'], ['HST-1', 'Leaking tap in the washroom', 'PLUMBING', 'NORMAL'], ['LIB-RR', 'Two reading chairs broken', 'FURNITURE', 'LOW'], ['CAN-1', 'Exhaust fan noisy', 'ELECTRICAL', 'NORMAL']];
    let n = 0;
    for (const [code, title, category, priority] of jobs) {
      // eslint-disable-next-line no-await-in-loop
      const f = await room(code);
      // eslint-disable-next-line no-await-in-loop
      if (f && await attempt(`repair ${code}`, () => facilities.reportIssue(TEACHER.actor, { facilityId: String(f._id), title, category, priority, description: 'Sample repair request for testing.' }))) n += 1;
    }
    return `${n} open repair requests`;
  });

  let fest = null;
  await section('Events and fests', InstitutionEvent, async () => {
    const [aud, ground] = await Promise.all([room('AUD-HALL'), room('GRD-1')]);
    fest = await events.proposeEvent(TEACHER.actor, { title: 'Oakridge Utsav 2026 (annual fest)', kind: 'FEST', description: 'Two days of cultural performances, a science fair and food stalls. Sample event.', startsAt: inDays(12, 9).toISOString(), endsAt: inDays(13, 18).toISOString(), facilityId: aud ? String(aud._id) : undefined, audience: 'INSTITUTION', expectedAttendance: 380, budgetLines: [{ head: 'Stage and sound', amountPaise: rupees(85000) }, { head: 'Decoration', amountPaise: rupees(30000) }, { head: 'Prizes', amountPaise: rupees(25000) }, { head: 'Refreshments', amountPaise: rupees(40000) }] });
    await attempt('submit fest', () => events.submitEvent(TEACHER.actor, fest.id));
    await events.proposeEvent(TEACHER.actor, { title: 'Inter-school football tournament', kind: 'SPORTS', description: 'Sample event, still a draft.', startsAt: inDays(20, 8).toISOString(), endsAt: inDays(20, 16).toISOString(), facilityId: ground ? String(ground._id) : undefined, audience: 'STUDENTS', expectedAttendance: 200, budgetLines: [{ head: 'Referees', amountPaise: rupees(8000) }, { head: 'Trophies', amountPaise: rupees(12000) }] }).catch((e) => logger.warn(`     · sports event: ${e.message}`));
    return 'a fest awaiting approval and a sports event in draft';
  });

  await section('Agreements', Contract, async () => {
    await events.createContract(ADMIN.actor, { title: 'School bus operations', kind: 'TRANSPORT', counterparty: 'Sample Travels Pvt Ltd', valuePaise: rupees(1800000), startsOn: ymd(-300), endsOn: ymd(40), noticePeriodDays: 60, autoRenews: false, draft: 'Sample agreement text: the operator provides four buses with verified drivers and attendants.' });
    await events.createContract(ADMIN.actor, { title: 'Canteen services', kind: 'SERVICE', counterparty: 'Sample Caterers', valuePaise: rupees(600000), startsOn: ymd(-120), endsOn: ymd(245), noticePeriodDays: 30, autoRenews: true, draft: 'Sample agreement text: daily meals as per the approved menu and hygiene standards.' });
    await events.createContract(ADMIN.actor, { title: 'MoU: coding and robotics club', kind: 'MOU', counterparty: 'Sample Learning Foundation', valuePaise: 0, startsOn: ymd(10), endsOn: ymd(375), noticePeriodDays: 30, autoRenews: false, draft: 'Sample MoU text: weekly robotics sessions for classes 6-10.' });
    return '3 agreements (the bus contract ends in 40 days; an MoU has just been requested)';
  });

  await section('Board meetings', BoardMeeting, async () => {
    const members = [who.TRUSTEE, PRINCIPAL, ADMIN, FINANCE].filter(Boolean);
    const roles = { [PRINCIPAL.id]: 'SECRETARY', ...(who.TRUSTEE ? { [who.TRUSTEE.id]: 'CHAIR' } : {}) };
    const m = await governance.create(PRINCIPAL.actor, { body: 'TRUST_BOARD', title: 'Quarterly board meeting', quorum: 2, mode: 'HYBRID', location: 'Board Room, Administration Block', durationMinutes: 120, memberProfileIds: members.map((x) => x.id), memberRoles: roles, externalMembers: [{ name: 'Dr. Sample Trustee', role: 'MEMBER' }], proposedSlots: [inDays(8, 11).toISOString(), inDays(9, 16).toISOString(), inDays(10, 11).toISOString()] });
    await attempt('agenda', () => governance.setAgenda(PRINCIPAL.actor, 'ALL', m.id, { items: [{ title: 'Half-yearly results and attendance', decisionNeeded: false }, { title: 'Budget for the new computer lab', decisionNeeded: true }, { title: 'Fee structure for 2027-28', decisionNeeded: true }, { title: 'Safety audit findings', decisionNeeded: false }] }));
    if (who.TRUSTEE) await attempt('availability', () => governance.markAvailability(who.TRUSTEE.actor, 'OWN', m.id, { slotIndexes: [0, 2] }));
    return '1 meeting with three proposed slots and an agenda';
  });

  // ── Compliance ───────────────────────────────────────────────────────────
  await section('Licences and certificates', Licence, async () => {
    await attempt('catalogue', () => compliance.seedCatalogue(COMPLIANCE.actor, 'SCHOOL'));
    const list = [
      ['AFFILIATION', 'Board affiliation (sample)', 'Examining Board (sample)', 'SAMPLE/AFF/1130000', 540, 180, true],
      ['RECOGNITION', 'State recognition certificate (sample)', 'State Education Department (sample)', 'SAMPLE/REC/2019/55', 900, 180, true],
      ['CERTIFICATE', 'Fire safety certificate (sample)', 'Municipal Fire Office (sample)', 'SAMPLE/FIRE/2025/09', 22, 60, true],
      ['CERTIFICATE', 'Building safety certificate (sample)', 'Public Works Department (sample)', 'SAMPLE/BLD/2024/31', -12, 60, true],
      ['INSURANCE', 'Student group accident insurance (sample)', 'Sample Insurance Co.', 'SAMPLE/INS/778', 150, 45, false],
      ['VEHICLE', 'Bus fitness certificate: MH-00-XX-0001 (sample)', 'Regional Transport Office (sample)', 'SAMPLE/RTO/FIT/01', 75, 30, false],
      ['CERTIFICATE', 'Drinking water test report (sample)', 'Sample Public Health Lab', 'SAMPLE/WATER/Q3', 48, 30, true],
    ];
    for (const [kind, title, issuingAuthority, number, expiresIn, renewalLeadDays, publicDisclosure] of list) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(title, () => compliance.createLicence(COMPLIANCE.actor, { kind, title, issuingAuthority, number, licenceNo: number, issuedOn: ymd(expiresIn - 365), expiresOn: ymd(expiresIn), renewalLeadDays, publicDisclosure }));
    }
    return `${await Licence.countDocuments({})} licences (one expired, one due within a month)`;
  });

  await section('Policies', Policy, async () => {
    const p1 = await compliance.createPolicy(COMPLIANCE.actor, { code: 'CHILD-PROTECTION', title: 'Child Protection Policy', category: 'SAFEGUARDING', audienceRoles: ['TEACHER', 'ADMIN', 'PRINCIPAL', 'HR', 'WARDEN', 'LIBRARIAN', 'FINANCE', 'MARKETING', 'COMPLIANCE'], requiresAcknowledgement: true, body: 'Sample policy text. Every adult working with children must report a concern to the designated officer the same day; nobody investigates on their own; records are confidential.' });
    await attempt('submit policy', () => compliance.submitPolicy(COMPLIANCE.actor, p1.id, {}));
    await attempt('policy 2', () => compliance.createPolicy(COMPLIANCE.actor, { code: 'TRANSPORT-SAFETY', title: 'Transport Safety Policy', category: 'SAFETY', audienceRoles: ['ADMIN', 'TEACHER'], requiresAcknowledgement: true, body: 'Sample policy text. Every bus carries a verified driver and attendant; a headcount is taken on boarding and on arrival.' }));
    await attempt('policy 3', () => compliance.createPolicy(COMPLIANCE.actor, { code: 'ANTI-BULLYING', title: 'Anti-Bullying Policy', category: 'SAFEGUARDING', audienceRoles: ['TEACHER', 'STUDENT', 'PARENT'], requiresAcknowledgement: false, body: 'Sample policy text. Bullying in any form is not tolerated; students can report in confidence.' }));
    return `${await Policy.countDocuments({})} policies (one sent for approval)`;
  });

  await section('Mandatory trainings', TrainingSession, async () => {
    await compliance.scheduleTraining(COMPLIANCE.actor, { topic: 'POCSO_CHILD_PROTECTION', title: 'POCSO awareness session for all staff', audience: 'ALL_STAFF', mandatory: true, basis: 'Annual child-protection training (sample)', scheduledAt: inDays(5, 14).toISOString(), durationMinutes: 90, facilitator: 'Sample Child Rights Trainer', location: 'Main Auditorium', recurrenceMonths: 12 });
    await compliance.scheduleTraining(COMPLIANCE.actor, { topic: 'FIRE_SAFETY', title: 'Fire drill and extinguisher training', audience: 'ALL_STAFF', mandatory: true, basis: 'Half-yearly drill (sample)', scheduledAt: inDays(15, 11).toISOString(), durationMinutes: 60, facilitator: 'Sample Fire Officer', location: 'Playground', recurrenceMonths: 6 });
    const past = await compliance.scheduleTraining(COMPLIANCE.actor, { topic: 'FIRST_AID', title: 'First aid basics for teachers', audience: 'TEACHING_STAFF', mandatory: false, scheduledAt: inDays(-20, 15).toISOString(), durationMinutes: 60, facilitator: 'Sample School Nurse', location: 'Staff Room' });
    await attempt('attendance', () => compliance.recordTrainingAttendance(COMPLIANCE.actor, past.id, { attendance: (past.participants ?? []).slice(0, 12).map((p, i) => ({ profileId: String(p.profileId), status: i % 6 === 5 ? 'ABSENT' : 'ATTENDED' })) }));
    return '3 sessions: POCSO in 5 days, a fire drill, and a past session with attendance';
  });

  await section('Authority notices', RegulatoryNotice, async () => {
    await compliance.createNotice(COMPLIANCE.actor, { source: 'DISTRICT_COLLECTOR', jurisdiction: 'Sample District', title: 'Heavy-rain advisory: schools to stay prepared for closure (sample)', theirReference: 'COLL/SAMPLE/2026/88', publishedOn: ymd(-1), summary: 'Sample notice. Schools must keep parents informed and be ready to close at short notice.' });
    await compliance.createNotice(COMPLIANCE.actor, { source: 'CBSE', jurisdiction: 'National', title: 'Circular on internal assessment records (sample)', theirReference: 'SAMPLE/ACAD/42', publishedOn: ymd(-6), effectiveOn: ymd(20), summary: 'Sample circular. Schools must keep internal assessment records for inspection.' });
    await compliance.createNotice(COMPLIANCE.actor, { source: 'STATE_EDUCATION_DEPT', jurisdiction: 'Maharashtra', title: 'Bus safety audit to be completed this quarter (sample)', theirReference: 'EDU/SAMPLE/TR/19', publishedOn: ymd(-12), summary: 'Sample notice. Every school bus needs a fitness certificate and a verified driver and attendant.' });
    await attempt('notice source', () => compliance.addNoticeSource({ name: 'District Collector office (sample page)', url: 'https://collector.example/notices', source: 'DISTRICT_COLLECTOR' }));
    return '3 notices waiting for a decision';
  });

  await section('Returns to authorities', RegulatoryReturn, async () => {
    const month = new Date(now.getTime() - 20 * DAY).toISOString().slice(0, 7);
    await attempt('UDISE+', () => compliance.createReturn(COMPLIANCE.actor, { template: 'UDISE_PLUS_PROFILE', period: '2026-27', dueOn: ymd(25) }));
    await attempt('attendance return', () => compliance.createReturn(COMPLIANCE.actor, { template: 'MONTHLY_ATTENDANCE', period: month, dueOn: ymd(4) }));
    await attempt('staff statement', () => compliance.createReturn(COMPLIANCE.actor, { template: 'STAFF_STRENGTH', period: '2026-27', dueOn: ymd(40) }));
    await attempt('disclosure', () => compliance.createReturn(COMPLIANCE.actor, { template: 'MANDATORY_DISCLOSURE', period: '2026-27', dueOn: ymd(60) }));
    return `${await RegulatoryReturn.countDocuments({})} returns drafted from the school's own records, ready to print and sign`;
  });

  await section('Accreditation', AccreditationCycle, async () => {
    const cycle = await accreditation.createCycle(COMPLIANCE.actor, { framework: 'BOARD_INSPECTION', title: 'Board affiliation inspection 2027 (sample)', targetDate: ymd(150) });
    const first = cycle.criteria?.[0];
    if (first) await attempt('evidence item', () => accreditation.addItem(COMPLIANCE.actor, cycle.id, first.id, { metric: 'Fire and building safety certificates on file', ownerProfileId: ADMIN.id, dueOn: ymd(30) }));
    return '1 inspection cycle with its checklist';
  });

  await section('Safeguarding', SafeguardingCase, async () => {
    await safeguarding.report(TEACHER.actor, { category: 'CHILD_PROTECTION', urgency: 'URGENT', description: 'SAMPLE CONCERN FOR TESTING ONLY. No real child or adult is involved. Use it to try the confidential workflow.' });
    return '1 sample concern (visible only to the designated officers)';
  });

  // ── Finance ──────────────────────────────────────────────────────────────
  await section('Payroll', null, async () => {
    const runs = await payroll.listRuns(FINANCE.actor).catch(() => []);
    if ((runs.items ?? runs).length) return 'kept (already has data)';
    await attempt('rules', () => payroll.seedRules());
    const staff = [PRINCIPAL, ADMIN, FINANCE, HR, MARKETING, COMPLIANCE, who.LIBRARIAN, who.WARDEN].filter(Boolean).map((x) => x.profile).concat(teachers.slice(0, 12));
    let n = 0;
    for (const [i, p] of staff.entries()) {
      const basic = rupees(i === 0 ? 90000 : 28000 + (i % 5) * 4000);
      // eslint-disable-next-line no-await-in-loop
      if (await attempt(`pay ${p.displayName}`, () => payroll.upsertCompensation(FINANCE.actor, {
        profileId: String(p._id), employeeCode: `EMP${String(i + 1).padStart(3, '0')}`, joiningDate: '2022-06-01',
        components: [
          { code: 'BASIC', name: 'Basic pay', kind: 'EARNING', calc: 'FIXED', value: basic, statutoryWage: true, prorate: true },
          { code: 'HRA', name: 'House rent allowance', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 4000, statutoryWage: false, prorate: true },
          { code: 'CONV', name: 'Conveyance', kind: 'EARNING', calc: 'FIXED', value: rupees(1600), statutoryWage: false, prorate: true },
        ],
        bank: { accountNo: `0000000${String(1000 + i)}`, ifsc: 'SMPL0000001' },
      }))) n += 1;
    }
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const run = await payroll.createRun(FINANCE.actor, { period: prev });
    await attempt('inputs', () => payroll.setInputs(FINANCE.actor, run.id, { inputs: [{ profileId: String(teachers[0]._id), lopDays: 1, arrearsPaise: 0, adjustments: [] }] }));
    await attempt('calculate', () => payroll.calculate(FINANCE.actor, run.id));
    await attempt('send for approval', () => payroll.submitRun(FINANCE.actor, run.id, { acknowledgeUnverifiedRules: true }));
    return `${n} salary structures and the ${prev} run, calculated and sent for approval`;
  });

  await section('Procurement, budgets and financing', null, async () => {
    const existing = await procurement.listVendors(FINANCE.actor).catch(() => []);
    if ((existing.items ?? existing).length) return 'kept (already has data)';
    const v1 = await procurement.createVendor(FINANCE.actor, { name: 'Sample Computers & Systems', category: 'IT', contactName: 'Sample Contact', phone: '+910000000201', email: 'sales@samplecomputers.example', gstin: null });
    const v2 = await procurement.createVendor(FINANCE.actor, { name: 'Sample Office Mart', category: 'STATIONERY', phone: '+910000000202' });
    const v3 = await procurement.createVendor(FINANCE.actor, { name: 'Sample Furniture Works', category: 'FURNITURE', phone: '+910000000203' });
    const fy = now.getUTCMonth() >= 3 ? `${now.getUTCFullYear()}-${String(now.getUTCFullYear() + 1).slice(2)}` : `${now.getUTCFullYear() - 1}-${String(now.getUTCFullYear()).slice(2)}`;
    const budget = await procurement.createBudget(FINANCE.actor, { fiscalYear: fy, name: `Annual budget ${fy}`, lines: [
      { code: 'IT', head: 'Computers and IT', kind: 'CAPEX', plannedPaise: rupees(1200000) },
      { code: 'FURN', head: 'Furniture', kind: 'CAPEX', plannedPaise: rupees(400000) },
      { code: 'LAB', head: 'Laboratory supplies', kind: 'OPEX', plannedPaise: rupees(250000) },
      { code: 'EVT', head: 'Events and fests', kind: 'OPEX', plannedPaise: rupees(300000) },
      { code: 'MKT', head: 'Marketing and admissions', kind: 'OPEX', plannedPaise: rupees(350000) },
      { code: 'MNT', head: 'Repairs and maintenance', kind: 'OPEX', plannedPaise: rupees(500000) },
    ] });
    await attempt('submit budget', () => procurement.submitBudget(FINANCE.actor, budget.id));
    const pr = await procurement.createRequestDraft(TEACHER.actor, { title: '20 desktop computers for the computer lab', justification: 'Six machines have failed; the lab cannot seat a full class.', budgetId: budget.id, budgetLineCode: 'IT', items: [{ description: 'Desktop computer (i5, 16 GB)', qty: 20, estUnitPaise: rupees(42000), isAsset: true }, { description: 'UPS 1 kVA', qty: 5, estUnitPaise: rupees(6500), isAsset: true }] });
    await attempt('quotes', () => procurement.setQuotes(FINANCE.actor, 'ALL', pr.id, { quotes: [{ vendorId: v1.id, amountPaise: rupees(865000), selected: true }, { vendorId: v2.id, amountPaise: rupees(902000) }, { vendorId: v3.id, amountPaise: rupees(915000) }] }));
    await attempt('submit request', () => procurement.submit(TEACHER.actor, 'ALL', pr.id));
    await attempt('second request', () => procurement.createRequestDraft(who.LIBRARIAN?.actor ?? TEACHER.actor, { title: 'Reading-room chairs', justification: 'Two chairs are broken and ten are worn.', budgetId: budget.id, budgetLineCode: 'FURN', items: [{ description: 'Reading chair', qty: 12, estUnitPaise: rupees(3200), isAsset: true }] }));
    const loan = await attempt('funding', () => procurement.createFunding(FINANCE.actor, { kind: 'LOAN', title: 'Term loan for the new science wing', purpose: 'Sample proposal comparing two offers.', amountRequestedPaise: rupees(5000000), offers: [{ provider: 'Sample Bank A', annualRateBp: 1050, tenureMonths: 60, processingFeePaise: rupees(25000) }, { provider: 'Sample Bank B', annualRateBp: 1125, tenureMonths: 84, processingFeePaise: rupees(10000) }] }));
    await attempt('grant', () => procurement.createFunding(FINANCE.actor, { kind: 'CSR', title: 'CSR grant for a robotics lab', purpose: 'Sample proposal to a company foundation.', amountRequestedPaise: rupees(1500000), restricted: true }));
    return `3 vendors, a budget, a purchase request with three quotes, ${loan ? 'a loan comparison' : 'no loan'} and a grant proposal`;
  });

  // ── Marketing and admissions ─────────────────────────────────────────────
  await section('Marketing', Campaign, async () => {
    const camp = await marketing.createCampaign(MARKETING.actor, { name: 'Admissions open 2027-28', code: 'ADM-2027', objective: 'ENQUIRIES', channels: [], audience: 'Parents of children aged 3-15 within 10 km', gradesOrProgrammes: ['Class 1', 'Class 6', 'Class 9'], academicYear: '2027-28', startsOn: ymd(-20), endsOn: ymd(70), budgetPaise: rupees(180000) });
    await attempt('campaign 2', () => marketing.createCampaign(MARKETING.actor, { name: 'Open house weekend', code: 'OPEN-HOUSE', objective: 'OPEN_HOUSE', channels: [], audience: 'Families who enquired this year', startsOn: ymd(9), endsOn: ymd(11), budgetPaise: rupees(40000) }));
    await attempt('poster', () => marketing.createAsset(MARKETING.actor, { kind: 'POSTER', title: 'Admissions open: main poster', size: 'A3_POSTER', campaignId: camp.id, claims: ['Admissions open for 2027-28', 'Campus tours every Saturday'], altText: 'Poster announcing that admissions are open, with the school building in the background.', url: 'https://files.example/sample/admissions-poster.png' }));
    await attempt('social post', () => marketing.createAsset(MARKETING.actor, { kind: 'SOCIAL_POST', title: 'Open house: social post', size: 'INSTAGRAM_POST', campaignId: camp.id, claims: ['Open house on Saturday'], altText: 'Square graphic inviting families to the open house.', url: 'https://files.example/sample/open-house.png' }));
    for (const [g, cap] of [['Class 1', 80], ['Class 6', 40], ['Class 9', 30]]) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(`capacity ${g}`, () => marketing.setCapacity(MARKETING.actor, { academicYear: '2027-28', gradeOrProgramme: g, capacity: cap }));
    }
    return '2 campaigns, 2 creatives awaiting review, seat capacity for three classes';
  });

  await section('Admission enquiries', Lead, async () => {
    const stages = ['NEW', 'NEW', 'CONTACTED', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];
    const sources = ['WEB', 'WALK_IN', 'REFERRAL', 'WHATSAPP'];
    const children = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sara', 'Vivaan', 'Zoya', 'Ishaan', 'Tara', 'Neil', 'Anaya', 'Dev', 'Riya', 'Arjun', 'Kiara', 'Yash', 'Nisha'];
    const docs = children.map((c, i) => ({ childName: `${c} Sample`, guardianName: `Parent of ${c} (sample)`, phone: `+9100000005${String(i).padStart(2, '0')}`, email: `parent${i + 1}@family.example`, gradeApplying: ['Class 1', 'Class 6', 'Class 9'][i % 3], source: sources[i % 4], stage: stages[i % stages.length], createdAt: inDays(-(i * 2) % 28), updatedAt: inDays(-(i % 5)) }));
    const made = await Lead.insertMany(docs);
    const tour = made.find((l) => l.stage === 'TOUR_SCHEDULED');
    if (tour) await attempt('campus tour', () => marketing.bookAppointment(MARKETING.actor, { leadId: String(tour._id), kind: 'CAMPUS_TOUR', at: inDays(2, 11).toISOString() }));
    const second = made.find((l) => l.stage === 'CONTACTED');
    if (second) await attempt('counselling', () => marketing.bookAppointment(MARKETING.actor, { leadId: String(second._id), kind: 'COUNSELLING', at: inDays(1, 16).toISOString() }));
    return `${made.length} enquiries across every stage, with two visits booked`;
  });

  // ── Newsroom and community ───────────────────────────────────────────────
  await section('Newsroom and circles', CommunityPost, async () => {
    const posts = [
      [PRINCIPAL.actor, { title: 'Our under-14 team wins the district football final', body: 'A 2-1 win in the final minute. Congratulations to the team and their coach. (Sample story.)', kind: 'ACHIEVEMENT', audience: 'INSTITUTION', tags: ['sports'], submit: true }],
      [TEACHER.actor, { title: 'Science exhibition: 42 working models on display', body: 'Classes 6 to 10 presented projects on water, energy and waste. (Sample story.)', kind: 'EVENT_HIGHLIGHT', audience: 'INSTITUTION', tags: ['science'], submit: true }],
      [MARKETING.actor, { title: 'Admissions open for 2027-28', body: 'Campus tours every Saturday. Book a visit from the admissions page. (Sample story.)', kind: 'STORY', audience: 'PUBLIC', tags: ['admissions'], submit: true }],
      [TEACHER.actor, { title: 'Reading week begins Monday', body: 'Twenty minutes of reading in every class, every day. (Sample story awaiting moderation.)', kind: 'STORY', audience: 'INSTITUTION', submit: true }],
    ];
    let n = 0;
    for (const [actor, body] of posts) {
      // eslint-disable-next-line no-await-in-loop
      const post = await attempt('post', () => community.createPost(actor, body));
      if (!post) continue;
      n += 1;
      // The last one stays in the moderation queue.
      // eslint-disable-next-line no-await-in-loop
      if (n < posts.length && post.status !== 'PUBLISHED') await attempt('publish', () => community.moderatePost(PRINCIPAL.actor, post.id, { decision: 'PUBLISH' }));
    }
    const club = await attempt('club', () => community.createCircle(TEACHER.actor, { name: 'Robotics Club', kind: 'CLUB', joinPolicy: 'OPEN', description: 'Build, code and compete. (Sample circle.)' }));
    await attempt('alumni circle', () => community.createCircle(ADMIN.actor, { name: 'Oakridge Alumni', kind: 'ALUMNI', joinPolicy: 'APPROVAL', description: 'Former students staying in touch. (Sample circle.)' }));
    await attempt('seniors circle', () => community.createCircle(TEACHER.actor, { name: 'Ask a Senior', kind: 'CLUB', joinPolicy: 'OPEN', description: 'Seniors answer juniors\' questions on subjects and exams. (Sample circle.)' }));
    if (club && who.STUDENT) await attempt('join club', () => community.joinCircle(who.STUDENT.actor, club.id));
    if (who.ALUMNUS) {
      await attempt('mentor', () => community.upsertMentorProfile(who.ALUMNUS.actor, { headline: 'Class of 2018 · software engineer (sample)', topics: ['Engineering entrance', 'Careers in software'], bio: 'Happy to talk to students about engineering. (Sample profile.)' }));
    }
    return `${n} stories (one waiting for moderation) and three circles`;
  });

  // ── Students and parents ─────────────────────────────────────────────────
  // The demo student and the demo parent's children, so their screens have
  // something real to show.
  const demoStudentIds = new Set();
  if (who.STUDENT) {
    const own = await Student.findOne({ profileId: who.STUDENT.profile._id }).select('_id').lean();
    if (own) demoStudentIds.add(String(own._id));
  }
  if (who.PARENT) {
    const links = await StudentGuardian.find({ guardianProfileId: who.PARENT.profile._id }).select('studentId').lean();
    for (const l of links) demoStudentIds.add(String(l.studentId));
  }

  await section('Certificate types', DocumentType, async () => {
    // The school's suggested set: Bonafide, Study, Character, Fee, Leaving,
    // Transfer and Enrollment certificates, through the same service the
    // admin's "add suggested types" button uses.
    const out = await documentTypes.addSuggested(ADMIN.actor);
    const created = Array.isArray(out?.created) ? out.created.length : (Array.isArray(out) ? out.length : null);
    return created == null ? 'suggested types added' : `${created} certificate types`;
  });

  await section('Library loans', null, async () => {
    const students = await Student.find({ _id: { $in: [...demoStudentIds] } }).select('_id firstName lastName').lean();
    if (!students.length) return 'skipped (no demo student)';
    if (await BookIssue.exists({ borrowerProfileId: { $in: students.map((s) => s._id) } })) return 'kept (demo students already have loans)';
    const books = await Book.find({ deletedAt: null, resourceKind: { $in: ['BOOK', null] }, availableCopies: { $gt: 0 } }).sort({ title: 1 }).limit(4).lean();
    if (books.length < 2) return 'skipped (fewer than two books with copies on the shelf)';
    // borrowerProfileId holds the Student id, as the lending screen writes it.
    const plan = [];
    students.forEach((s, i) => {
      const name = `${s.firstName} ${s.lastName ?? ''}`.trim();
      plan.push({ book: books[(i * 2) % books.length], s, name, issued: -25, due: -11, status: 'OVERDUE', fine: 22 });
      plan.push({ book: books[(i * 2 + 1) % books.length], s, name, issued: -3, due: 11, status: 'ACTIVE', fine: 0 });
    });
    for (const p of plan) {
      // eslint-disable-next-line no-await-in-loop
      await BookIssue.create({
        bookId: p.book._id, borrowerProfileId: p.s._id, borrowerName: p.name,
        issuedAt: inDays(p.issued), dueDate: inDays(p.due), status: p.status, fineAmount: p.fine,
      });
      // eslint-disable-next-line no-await-in-loop
      await Book.updateOne({ _id: p.book._id, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } });
    }
    return `${plan.length} loans for ${students.length} students, ${plan.filter((p) => p.status === 'OVERDUE').length} overdue with a ₹22 fine`;
  });

  await section('Announcements', Announcement, async () => {
    const notices = [
      { title: 'Unit Test 1 timetable published', content: 'Unit Test 1 runs from next week. The subject-wise timetable is on the Calendar. Please check the syllabus with your class teacher. (Sample notice.)', at: -1 },
      { title: 'Parent-teacher meeting on Saturday', content: 'Class teachers will meet parents from 9:30 AM to 12:30 PM in the classrooms. Please bring the report card. (Sample notice.)', at: -3 },
      { title: 'Winter uniform from 1 November', content: 'Students should wear the winter uniform (navy sweater and blazer) from 1 November. (Sample notice.)', at: -6 },
    ];
    for (const n of notices) {
      // eslint-disable-next-line no-await-in-loop
      await Announcement.create({
        title: n.title, content: n.content, audience: { all: true },
        publishedAt: inDays(n.at), createdByProfileId: ADMIN.profile._id,
      });
    }
    return `${notices.length} notices for everyone`;
  });

  await section('Upcoming homework', null, async () => {
    const enrolments = await Enrollment.find({ studentId: { $in: [...demoStudentIds] }, status: 'ACTIVE' }).select('sectionId').lean();
    const sectionIds = [...new Set(enrolments.map((e) => String(e.sectionId)))];
    let n = 0;
    for (const sectionId of sectionIds) {
      // eslint-disable-next-line no-await-in-loop
      const offerings = await SubjectOffering.find({ sectionId }).populate('subjectId', 'name').limit(2).lean();
      // eslint-disable-next-line no-await-in-loop
      if (!offerings.length || await Assignment.exists({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, dueAt: { $gte: startOfDayUtc(now) }, deletedAt: null })) continue;
      for (const [i, o] of offerings.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await Assignment.create({
          subjectOfferingId: o._id,
          title: `${o.subjectId?.name ?? 'Subject'}: practice worksheet ${i + 1} (sample)`,
          description: 'Complete the worksheet in your notebook and submit a photo. (Sample homework.)',
          type: 'WORKSHEET', dueAt: startOfDayUtc(inDays(3 + i * 4)), maxMarks: 20,
          createdByProfileId: o.teacherId ?? TEACHER.profile._id,
        });
        n += 1;
      }
    }
    return `${n} assignments due in the next week`;
  });

  // ── What came out ────────────────────────────────────────────────────────
  const pending = await ApprovalRequest.countDocuments({ status: 'PENDING' }).catch(() => 0);
  // Printed directly, so the summary shows whatever the log level is.
  console.log('');
  console.log('Sample data for every section:');
  for (const [name, note] of results) console.log(`  ${note.startsWith('FAILED') ? '✘' : '✔'}  ${name.padEnd(36)} ${note}`);
  console.log(`  ➜  ${pending} decisions are waiting in the approvals inbox.`);
  console.log('Everything above is fictional. Nothing was filed, paid or sent.');
  const failed = results.filter(([, n]) => n.startsWith('FAILED')).length;
  await mongoose.disconnect();
  process.exit(failed && process.argv.includes('--strict') ? 1 : 0);
}

runWithTenant(SEED_SCHOOL_SLUG, seedOperations).catch((err) => {
  logger.error('Sample-data seeding failed:', err);
  process.exit(1);
});
