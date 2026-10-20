import mongoose from 'mongoose';
import { ExamSitting, SITTING_KINDS, SITTING_STATUSES } from '../../models/examRoom.model.js';
import { Exam, ExamSubject } from '../../models/exam.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { ownStudentIds, studentName } from '../safety/shared.js';
import { assertObjectId, optionalText, profileNames, profilesWithRoles, pushHistory, requireProfile } from '../ops/common.js';
import { hhmm, localParts, toMin } from '../campus/day-plan.js';
import {
  TEACHING_KINDS, addDays, dayKey, facilityIndex, loadDay, parseTime, parseYmd, personConflicts, roomConflicts, sectionLabel, sittingWindow, todayYmd, ymdOf,
} from './occupancy.js';
import { notifyExamChange } from './notify.js';
import { resolveFacility, resolveSection, shortDate, freeRooms } from './rooms.service.js';

/**
 * Exam timetable and halls: each paper's date, times and rooms, the seating
 * plan, invigilators per room, and its status on the day.
 *
 * Who may do what:
 *   - board, term and other exams: exams.schedule or exams.manage at
 *     school-wide scope (principal, administrator, an exam coordinator);
 *   - a class test: a teacher (exams.schedule OWN) for a subject they teach,
 *     in a free room, invigilated by themselves; they edit only their own;
 *   - staff read the timetable and duty roster; a teacher sees the papers of
 *     the classes they teach and their own invigilation duties;
 *   - students and parents see only their own exam timetable: date, time,
 *     room and their own seat number. Never anyone else's seat.
 *
 * Every room and every invigilator is checked against everything else on that
 * day (occupancy.js): a room cannot hold two papers, or a paper and a
 * timetabled class, a booking or a closure; an invigilator cannot be teaching,
 * covering, invigilating elsewhere, on leave or absent. A change on the day
 * (room, time, delay, postponement) is announced to the candidates, their
 * families and the invigilators, once, and shown as a banner.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const hasAll = (actor, key) => actor?.permissions?.[key] === 'ALL';
export const canManageExams = (actor) => hasAll(actor, 'exams.schedule') || hasAll(actor, 'exams.manage');
const fail = (msg, status = 400, code = 'BAD_REQUEST', details = []) => new AppError(msg, status, details, code);
const MAX_MINUTES = 6 * 60;

// ── Reading a request ────────────────────────────────────────────────────

async function offeringsFor(body) {
  const ids = [...new Set([...(Array.isArray(body.subjectOfferingIds) ? body.subjectOfferingIds : []), body.subjectOfferingId].filter(Boolean).map(String))];
  if (ids.length) {
    const rows = await SubjectOffering.find({ _id: { $in: ids.map((id) => assertObjectId(id, 'subjectOfferingId')) } }).populate('subjectId', 'name').lean();
    if (rows.length !== ids.length) throw fail('Subject offering not found', 404, 'NOT_FOUND');
    return rows;
  }
  if ((body.className || body.sectionId) && body.subject) {
    const section = await resolveSection(body.sectionId ?? body.className);
    const all = await SubjectOffering.find({ sectionId: section._id }).populate('subjectId', 'name').lean();
    const want = String(body.subject).trim().toLowerCase();
    const hit = all.find((o) => o.subjectId?.name?.toLowerCase() === want) ?? all.find((o) => o.subjectId?.name?.toLowerCase().startsWith(want.slice(0, 4)));
    if (!hit) throw fail(`${sectionLabel(section)} has no subject called "${body.subject}".`, 404, 'NOT_FOUND');
    return [hit];
  }
  return [];
}

/** Turns a create/update body into a sitting's fields (validated, not saved). */
async function readSitting(actor, body, existing = null) {
  const out = {};
  let examSubject = null;
  if (body.examSubjectId) {
    examSubject = await ExamSubject.findById(assertObjectId(body.examSubjectId, 'examSubjectId')).lean();
    if (!examSubject) throw fail('Exam paper not found', 404, 'NOT_FOUND');
    const exam = await Exam.findById(examSubject.examId).lean();
    out.examSubjectId = examSubject._id;
    out.examId = examSubject.examId;
    body = { ...body, subjectOfferingIds: [String(examSubject.subjectOfferingId), ...(body.subjectOfferingIds ?? [])] };
    out._examName = exam?.name ?? 'Exam';
  }
  const offerings = await offeringsFor(body);
  if (offerings.length) {
    out.subjectOfferingIds = offerings.map((o) => o._id);
    out.sectionIds = [...new Set(offerings.map((o) => String(o.sectionId)))].map((id) => new mongoose.Types.ObjectId(id));
    out.subjectName = body.subjectName ?? offerings[0].subjectId?.name ?? null;
  } else if (Array.isArray(body.sectionIds) && body.sectionIds.length) {
    out.sectionIds = body.sectionIds.map((id) => new mongoose.Types.ObjectId(assertObjectId(id, 'sectionId')));
    out.subjectName = optionalText(body.subjectName, { max: 80 }) || null;
  } else if (!existing) {
    throw fail('Which class and subject? Give the paper, or the class and the subject.', 400, 'AGENT_NEEDS_INPUT');
  }
  if (body.kind !== undefined) {
    if (!SITTING_KINDS.includes(body.kind)) throw fail(`kind must be one of ${SITTING_KINDS.join(', ')}`);
    out.kind = body.kind;
  } else if (!existing) out.kind = examSubject ? 'TERM' : 'CLASS_TEST';
  if (body.title !== undefined || !existing) {
    const t = optionalText(body.title, { max: 160 }) || null;
    out.title = t ?? (out._examName ? `${out._examName} · ${out.subjectName ?? 'Paper'}` : `${out.kind === 'CLASS_TEST' ? 'Class test' : 'Exam'} · ${out.subjectName ?? 'Paper'}`);
  }
  if (body.date !== undefined || !existing) out.date = dayKey(parseYmd(body.date, 'date'));
  if (body.startTime !== undefined || !existing) out.startTime = parseTime(body.startTime, 'startTime');
  if (body.endTime !== undefined || !existing) out.endTime = parseTime(body.endTime, 'endTime');
  const start = toMin(out.startTime ?? existing?.startTime);
  const end = toMin(out.endTime ?? existing?.endTime);
  if (end <= start) throw fail('The paper must end after it starts.');
  if (end - start > MAX_MINUTES) throw fail('A paper cannot be longer than 6 hours.');
  if (body.notes !== undefined) out.notes = optionalText(body.notes, { max: 1000 }) || null;
  if (Array.isArray(body.venues)) out.venues = await readVenues(body.venues);
  delete out._examName;
  return out;
}

async function readVenues(list) {
  if (!list.length) throw fail('Choose at least one room.', 400, 'AGENT_NEEDS_INPUT');
  const idx = await facilityIndex();
  const out = [];
  for (const v of list.slice(0, 20)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of rooms
    const f = await resolveFacility(v.facilityId ?? v.room, idx);
    if (!TEACHING_KINDS.includes(f.kind)) throw fail(`${f.name} is not a room a paper can be sat in.`);
    if (out.some((x) => String(x.facilityId) === String(f._id))) throw fail(`${f.name} is listed twice.`);
    const capacity = v.capacity !== undefined && v.capacity !== null && v.capacity !== '' ? Number(v.capacity) : f.capacity ?? null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) throw fail(`Seats for ${f.name} must be a whole number.`);
    if (f.capacity && capacity > f.capacity) throw fail(`${f.name} seats ${f.capacity}; you asked for ${capacity}.`);
    const invigilatorProfileIds = [...new Set((v.invigilatorProfileIds ?? []).map((id) => assertObjectId(id, 'invigilatorProfileId')))];
    out.push({ facilityId: f._id, capacity, invigilatorProfileIds, seats: [] });
  }
  return out;
}

// ── Checks ───────────────────────────────────────────────────────────────

/** Room and invigilator clashes for a sitting as it would be saved. */
async function clashesOf(s, { ignoreSittingId = null } = {}) {
  const ymd = ymdOf(s.date);
  const day = await loadDay(ymd);
  const { start, end } = sittingWindow(s);
  const sectionIds = (s.sectionIds ?? []).map(String);
  const rooms = [];
  const people = [];
  const names = await profileNames((s.venues ?? []).flatMap((v) => v.invigilatorProfileIds ?? []));
  const seenPeople = new Map();
  for (const v of s.venues ?? []) {
    const f = day.index.byId.get(String(v.facilityId));
    for (const c of roomConflicts(day, v.facilityId, start, end, { ignoreSittingId, sectionIds })) rooms.push({ room: f?.name ?? 'Room', ...c });
    for (const pid of v.invigilatorProfileIds ?? []) {
      const key = String(pid);
      if (seenPeople.has(key) && seenPeople.get(key) !== String(v.facilityId)) people.push({ invigilator: names.get(key) ?? 'Invigilator', profileId: key, kind: 'TWO_ROOMS', detail: 'Listed for two rooms of this paper' });
      seenPeople.set(key, String(v.facilityId));
      for (const c of personConflicts(day, pid, start, end, { ignoreSittingId, sectionIds })) people.push({ invigilator: names.get(key) ?? 'Invigilator', profileId: key, ...c });
    }
  }
  return { rooms, people, day };
}

function throwClashes({ rooms, people }) {
  if (rooms.length) throw fail(`Room clash: ${rooms.slice(0, 3).map((c) => `${c.room}: ${c.detail}`).join('; ')}.`, 409, 'ROOM_CLASH', rooms);
  if (people.length) throw fail(`Invigilator clash: ${people.slice(0, 3).map((c) => `${c.invigilator}: ${c.detail}`).join('; ')}.`, 409, 'INVIGILATOR_CLASH', people);
}

async function assertMayTouch(actor, sitting, fields) {
  if (canManageExams(actor)) return;
  if (!actor.permissions?.['exams.schedule']) throw fail('Only the exam coordinator, principal or administrator can schedule exams.', 403, 'FORBIDDEN');
  const kind = fields.kind ?? sitting?.kind;
  if (kind !== 'CLASS_TEST') throw fail('Teachers schedule class tests; board and term papers are scheduled by the exam coordinator or principal.', 403, 'FORBIDDEN');
  if (sitting && String(sitting.createdByProfileId) !== String(actor.profileId)) throw fail('You can change only the class tests you scheduled.', 403, 'FORBIDDEN');
  const offeringIds = (fields.subjectOfferingIds ?? sitting?.subjectOfferingIds ?? []).map(String);
  if (!offeringIds.length) throw fail('A class test is for a subject you teach: give the class and subject.', 400, 'AGENT_NEEDS_INPUT');
  const taught = await SubjectOffering.countDocuments({ _id: { $in: offeringIds }, teacherId: actor.profileId });
  if (taught !== offeringIds.length) throw fail('You can schedule class tests only for subjects you teach.', 403, 'FORBIDDEN');
  for (const v of fields.venues ?? []) {
    const others = (v.invigilatorProfileIds ?? []).filter((id) => String(id) !== String(actor.profileId));
    if (others.length) throw fail('You invigilate your own class test; colleagues are assigned by the exam coordinator.', 403, 'FORBIDDEN');
    if (!v.invigilatorProfileIds?.length) v.invigilatorProfileIds = [actor.profileId];
  }
}

// ── Seating ──────────────────────────────────────────────────────────────

/**
 * Seats every candidate by roll number (class by class, or alternating
 * classes so neighbours sit different papers' classmates apart), filling the
 * rooms in order up to their seats. Refuses when the rooms are too small.
 */
async function buildSeating(sitting, { mode = 'ROLL' } = {}) {
  const enrolments = await Enrollment.find({ sectionId: { $in: sitting.sectionIds ?? [] }, status: 'ACTIVE' }).select('studentId sectionId rollNo').lean();
  const sections = new Map((await Section.find({ _id: { $in: sitting.sectionIds ?? [] } }).populate('gradeId', 'name level').lean()).map((s) => [String(s._id), s]));
  const bySection = [...sitting.sectionIds].map(String).sort((a, b) => sectionLabel(sections.get(a)).localeCompare(sectionLabel(sections.get(b))))
    .map((sid) => enrolments.filter((e) => String(e.sectionId) === sid).sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999)));
  let order = [];
  if (mode === 'ALTERNATE') {
    const max = Math.max(0, ...bySection.map((l) => l.length));
    for (let i = 0; i < max; i++) for (const list of bySection) if (list[i]) order.push(list[i]);
  } else order = bySection.flat();
  const idx = await facilityIndex();
  const venues = sitting.venues ?? [];
  const missing = venues.filter((v) => !v.capacity);
  if (missing.length) throw fail(`Set the number of seats for ${missing.map((v) => idx.byId.get(String(v.facilityId))?.name ?? 'a room').join(', ')}.`);
  const total = venues.reduce((n, v) => n + v.capacity, 0);
  if (order.length > total) throw fail(`Not enough seats: ${order.length} candidates, ${total} seats in the rooms chosen. Add a room.`, 400, 'NOT_ENOUGH_SEATS', [{ candidates: order.length, seats: total }]);
  let i = 0;
  for (const v of venues) {
    const code = idx.byId.get(String(v.facilityId))?.code ?? 'R';
    const take = order.slice(i, i + v.capacity);
    i += take.length;
    v.seats = take.map((e, n) => ({ enrollmentId: e._id, studentId: e.studentId, sectionId: e.sectionId, rollNo: e.rollNo ?? null, seatNo: `${code}-${String(n + 1).padStart(2, '0')}` }));
  }
  return { candidates: order.length, seats: total };
}

// ── Presenting ───────────────────────────────────────────────────────────

/** The status a paper is in now: a scheduled paper is in progress during its window and finished after it. */
export function statusOf(s, now = new Date()) {
  if (['POSTPONED', 'CANCELLED', 'FINISHED'].includes(s.status)) return s.status;
  const { ymd, minutes } = localParts(now);
  const date = ymdOf(s.date);
  const w = sittingWindow(s);
  if (date < ymd || (date === ymd && minutes >= w.end)) return 'FINISHED';
  if (date === ymd && minutes >= w.start) return 'IN_PROGRESS';
  return s.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED';
}

async function present(rows, actor, { seats = false, now = new Date() } = {}) {
  const idx = await facilityIndex();
  const sectionIds = [...new Set(rows.flatMap((r) => (r.sectionIds ?? []).map(String)))];
  const sections = new Map((await Section.find({ _id: { $in: sectionIds } }).populate('gradeId', 'name level').lean()).map((s) => [String(s._id), s]));
  const counts = new Map((await Enrollment.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: sectionIds.map((id) => new mongoose.Types.ObjectId(id)) } } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }])).map((c) => [String(c._id), c.n]));
  const names = await profileNames(rows.flatMap((r) => (r.venues ?? []).flatMap((v) => v.invigilatorProfileIds ?? [])));
  let studentNames = new Map();
  if (seats) {
    const ids = rows.flatMap((r) => (r.venues ?? []).flatMap((v) => v.seats.map((x) => x.studentId)));
    studentNames = new Map((await Student.find({ _id: { $in: ids } }).select('firstName lastName admissionNo').lean()).map((s) => [String(s._id), s]));
  }
  const manage = canManageExams(actor);
  return rows.map((r) => {
    const w = sittingWindow(r);
    const candidates = (r.sectionIds ?? []).reduce((n, id) => n + (counts.get(String(id)) ?? 0), 0);
    const seated = (r.venues ?? []).reduce((n, v) => n + (v.seats?.length ?? 0), 0);
    const date = ymdOf(r.date);
    return {
      id: String(r._id), kind: r.kind, title: r.title, subject: r.subjectName ?? null,
      examSubjectId: r.examSubjectId ? String(r.examSubjectId) : null,
      classes: (r.sectionIds ?? []).map((id) => ({ sectionId: String(id), className: sectionLabel(sections.get(String(id))) })),
      date, dateLabel: shortDate(date), startTime: r.startTime, endTime: r.endTime, delayMinutes: r.delayMinutes ?? 0,
      startsAt: hhmm(w.start), endsAt: hhmm(w.end),
      status: statusOf(r, now), storedStatus: r.status, banner: r.banner ?? null, bannerAt: r.bannerAt ?? null, notes: r.notes ?? null,
      candidates, seated, unseated: Math.max(0, candidates - seated),
      venues: (r.venues ?? []).map((v) => {
        const f = idx.byId.get(String(v.facilityId));
        return {
          id: String(v._id), facilityId: String(v.facilityId), room: f?.name ?? 'Room', code: f?.code ?? null, capacity: v.capacity ?? f?.capacity ?? null, seated: v.seats?.length ?? 0,
          invigilators: (v.invigilatorProfileIds ?? []).map((id) => ({ id: String(id), name: names.get(String(id)) ?? 'Invigilator' })),
          ...(seats ? { seats: v.seats.map((x) => { const st = studentNames.get(String(x.studentId)); return { seatNo: x.seatNo, enrollmentId: String(x.enrollmentId), studentId: String(x.studentId), name: studentName(st) ?? 'Student', admissionNo: st?.admissionNo ?? null, rollNo: x.rollNo, className: sectionLabel(sections.get(String(x.sectionId))) }; }) } : {}),
        };
      }),
      canEdit: manage || (r.kind === 'CLASS_TEST' && String(r.createdByProfileId) === String(actor.profileId)),
      ...(manage || String(r.createdByProfileId) === String(actor.profileId) ? { history: r.history ?? [] } : {}),
    };
  });
}

// ── Reads ────────────────────────────────────────────────────────────────

async function visibilityFilter(actor) {
  if (canManageExams(actor) || hasAll(actor, 'timetable.read')) return {};
  if (FAMILY.has(actor.roleKey)) throw fail('Open My exams for your own timetable.', 403, 'FORBIDDEN');
  const sections = await getTeacherSectionIds(actor.profileId);
  return { $or: [{ sectionIds: { $in: sections } }, { 'venues.invigilatorProfileIds': actor.profileId }, { createdByProfileId: actor.profileId }] };
}

/** The exam timetable for staff, filtered by dates, class, room or status. */
export async function listSittings(actor, query = {}) {
  requireProfile(actor);
  const from = query.from ? parseYmd(query.from, 'from') : addDays(todayYmd(), -7);
  const to = query.to ? parseYmd(query.to, 'to') : addDays(from, 60);
  const filter = { ...(await visibilityFilter(actor)), date: { $gte: dayKey(from), $lte: dayKey(to) } };
  if (query.sectionId) filter.sectionIds = assertObjectId(query.sectionId, 'sectionId');
  if (query.facilityId) filter['venues.facilityId'] = assertObjectId(query.facilityId, 'facilityId');
  if (query.kind) filter.kind = String(query.kind).toUpperCase();
  const rows = await ExamSitting.find(filter).sort({ date: 1, startTime: 1 }).limit(500).lean();
  let out = await present(rows, actor);
  if (query.status) out = out.filter((r) => r.status === String(query.status).toUpperCase());
  return { from, to, items: out, canSchedule: canManageExams(actor) ? 'ALL' : actor.permissions?.['exams.schedule'] ? 'CLASS_TEST' : null };
}

export async function getSitting(actor, id) {
  requireProfile(actor);
  const row = await ExamSitting.findOne({ _id: assertObjectId(id), ...(await visibilityFilter(actor)) }).lean();
  if (!row) throw fail('Exam paper not found', 404, 'NOT_FOUND');
  return (await present([row], actor, { seats: true }))[0];
}

/** Finds a paper by what people say: "class 10 maths", "class 9 science", optionally a date or exam name. */
export async function findSittings(actor, { className = null, subject = null, exam = null, date = null } = {}) {
  requireProfile(actor);
  const filter = {};
  if (!FAMILY.has(actor.roleKey)) Object.assign(filter, await visibilityFilter(actor));
  if (className) {
    const m = /(?:class|grade)?\s*(\d{1,2})\s*[- ]?\s*([a-z])?\b/i.exec(String(className));
    let sections = [];
    if (m && !m[2]) {
      const all = await Section.find({}).populate('gradeId', 'name level').lean();
      sections = all.filter((s) => new RegExp(`(^|\\s)${m[1]}$`).test(String(s.gradeId?.name ?? '')) || String(s.gradeId?.level) === m[1]);
    } else sections = [await resolveSection(className)];
    if (!sections.length) throw fail(`I could not find the class "${className}".`, 404, 'NOT_FOUND');
    filter.sectionIds = { $in: sections.map((s) => s._id) };
  }
  if (subject) {
    // "maths" finds Mathematics, "sci" Science: the start of the word, at least four letters when given.
    const stem = String(subject).trim().slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${stem}`, 'i');
    filter.$and = [...(filter.$and ?? []), { $or: [{ subjectName: re }, { title: re }] }];
  }
  if (exam) filter.title = new RegExp(String(exam).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  filter.date = date ? dayKey(parseYmd(date)) : { $gte: dayKey(addDays(todayYmd(), -1)) };
  const rows = await ExamSitting.find(filter).sort({ date: 1, startTime: 1 }).limit(20).lean();
  return present(rows, actor);
}

/** A student's or parent's own exam timetable: date, time, room and their own seat. */
export async function myExams(actor, { studentId = null, from = null } = {}) {
  requireProfile(actor);
  if (!FAMILY.has(actor.roleKey)) throw fail('My exams is for students and parents; staff use the exam timetable.', 403, 'FORBIDDEN');
  const kids = await ownStudentIds(actor);
  if (studentId && !kids.includes(String(studentId))) throw fail('You can see your own child\'s exams only.', 403, 'FORBIDDEN');
  const chosen = studentId ? [String(studentId)] : kids;
  const [students, enrolments] = await Promise.all([
    Student.find({ _id: { $in: chosen } }).select('firstName lastName').lean(),
    Enrollment.find({ studentId: { $in: chosen }, status: 'ACTIVE' }).select('studentId sectionId').lean(),
  ]);
  const start = from ? parseYmd(from, 'from') : addDays(todayYmd(), -1);
  const sectionIds = enrolments.map((e) => e.sectionId);
  const rows = await ExamSitting.find({ sectionIds: { $in: sectionIds }, date: { $gte: dayKey(start), $lte: dayKey(addDays(start, 90)) } }).sort({ date: 1, startTime: 1 }).lean();
  const idx = await facilityIndex();
  const sections = new Map((await Section.find({ _id: { $in: sectionIds } }).populate('gradeId', 'name').lean()).map((s) => [String(s._id), s]));
  const today = todayYmd();
  const children = students.map((st) => {
    const en = enrolments.find((e) => String(e.studentId) === String(st._id));
    const exams = en ? rows.filter((r) => (r.sectionIds ?? []).map(String).includes(String(en.sectionId))).map((r) => {
      const venue = (r.venues ?? []).find((v) => v.seats.some((x) => String(x.enrollmentId) === String(en._id)));
      const seat = venue?.seats.find((x) => String(x.enrollmentId) === String(en._id)) ?? null;
      const w = sittingWindow(r);
      const room = venue ? idx.byId.get(String(venue.facilityId)) : null;
      const date = ymdOf(r.date);
      return {
        id: String(r._id), title: r.title, subject: r.subjectName ?? null, kind: r.kind, date, dateLabel: shortDate(date), startTime: hhmm(w.start), endTime: hhmm(w.end), delayMinutes: r.delayMinutes ?? 0,
        status: statusOf(r), room: room?.name ?? null, seatNo: seat?.seatNo ?? null,
        rooms: venue ? undefined : (r.venues ?? []).map((v) => idx.byId.get(String(v.facilityId))?.name).filter(Boolean),
        banner: r.banner && date >= today ? r.banner : null,
      };
    }) : [];
    return { studentId: String(st._id), name: studentName(st), className: en ? sectionLabel(sections.get(String(en.sectionId))) : null, exams };
  });
  return { children, note: 'Your own exam timetable: the room and your own seat. Other pupils\' seats are not shown.' };
}

/** Invigilation duties: one teacher's (their own, or anyone's for the exam office), or the whole roster. */
export async function duties(actor, { profileId = null, from = null, to = null, all = false } = {}) {
  requireProfile(actor);
  if (FAMILY.has(actor.roleKey)) throw fail('Invigilation duties are for staff.', 403, 'FORBIDDEN');
  const manage = canManageExams(actor);
  const who = profileId ? assertObjectId(profileId, 'profileId') : actor.profileId;
  if ((profileId && String(profileId) !== String(actor.profileId)) || all) { if (!manage) throw fail('You can see your own duties only.', 403, 'FORBIDDEN'); }
  const start = from ? parseYmd(from, 'from') : todayYmd();
  const end = to ? parseYmd(to, 'to') : addDays(start, 60);
  const filter = { date: { $gte: dayKey(start), $lte: dayKey(end) }, status: { $nin: ['CANCELLED'] } };
  if (!all) filter['venues.invigilatorProfileIds'] = who;
  const rows = await ExamSitting.find(filter).sort({ date: 1, startTime: 1 }).lean();
  const shown = await present(rows, { ...actor, permissions: { ...actor.permissions } });
  const items = [];
  for (const s of shown) {
    for (const v of s.venues) {
      for (const inv of v.invigilators) {
        if (!all && inv.id !== String(who)) continue;
        items.push({ sittingId: s.id, profileId: inv.id, invigilator: inv.name, date: s.date, dateLabel: s.dateLabel, startTime: s.startsAt, endTime: s.endsAt, title: s.title, classes: s.classes.map((c) => c.className), room: v.room, seated: v.seated, with: v.invigilators.filter((x) => x.id !== inv.id).map((x) => x.name), status: s.status, banner: s.banner });
      }
    }
  }
  if (!all) return { profileId: String(who), from: start, to: end, items };
  const byTeacher = new Map();
  for (const d of items) {
    const row = byTeacher.get(d.profileId) ?? { profileId: d.profileId, name: d.invigilator, duties: 0, minutes: 0, items: [] };
    row.duties += 1; row.minutes += toMin(d.endTime) - toMin(d.startTime); row.items.push(d);
    byTeacher.set(d.profileId, row);
  }
  return { from: start, to: end, roster: [...byTeacher.values()].sort((a, b) => b.duties - a.duties || a.name.localeCompare(b.name)), items };
}

/** Teachers free (or why not) for a window, to pick invigilators. */
export async function invigilatorOptions(actor, { date, startTime, endTime, sittingId = null, sectionIds = [] } = {}) {
  requireProfile(actor);
  if (!canManageExams(actor)) throw fail('Invigilators are assigned by the exam coordinator.', 403, 'FORBIDDEN');
  const day = await loadDay(parseYmd(date));
  const start = toMin(parseTime(startTime, 'startTime'));
  const end = toMin(parseTime(endTime, 'endTime'));
  const staff = await profilesWithRoles(['TEACHER', 'PRINCIPAL', 'ADMIN']);
  return staff.map((p) => {
    const c = personConflicts(day, p._id, start, end, { ignoreSittingId: sittingId, sectionIds: (Array.isArray(sectionIds) ? sectionIds : [sectionIds]).filter(Boolean) });
    return { id: String(p._id), name: p.displayName, role: p.roleId?.key ?? null, free: !c.length, clashes: c.map((x) => x.detail) };
  }).sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
}

/** Rooms free for a paper's window, big enough for its candidates. */
export async function freeExamRooms(actor, { date, startTime, endTime, minCapacity = null } = {}) {
  return freeRooms(actor, { date, startTime: parseTime(startTime, 'startTime'), endTime: parseTime(endTime, 'endTime'), minCapacity });
}

// ── Writes ───────────────────────────────────────────────────────────────

async function syncExamDate(s) {
  if (s.examSubjectId) await ExamSubject.updateOne({ _id: s.examSubjectId }, { $set: { examDate: s.date } }).catch(() => {});
}

/** Schedules a paper: times, rooms, invigilators, and (by default) the seating by roll number. */
export async function createSitting(actor, body = {}, { dryRun = false } = {}) {
  requireProfile(actor);
  const fields = await readSitting(actor, body);
  if (!fields.venues?.length) {
    // A class test with no room named goes to the class's home room when it is free.
    if (fields.kind === 'CLASS_TEST' && fields.sectionIds?.length === 1) {
      const idx = await facilityIndex();
      const home = idx.homeOf.get(String(fields.sectionIds[0]));
      if (home) fields.venues = await readVenues([{ facilityId: String(home._id) }]);
    }
    if (!fields.venues?.length) throw fail('Choose at least one room.', 400, 'AGENT_NEEDS_INPUT');
  }
  await assertMayTouch(actor, null, fields);
  if (fields.date < dayKey(todayYmd())) throw fail('That date has already passed.');
  const doc = new ExamSitting({ ...fields, createdByProfileId: actor.profileId, status: 'SCHEDULED' });
  throwClashes(await clashesOf(doc));
  if (body.autoSeat !== false) await buildSeating(doc, { mode: body.seatingMode === 'ALTERNATE' ? 'ALTERNATE' : 'ROLL' });
  // A preview (the assistant's draft): everything checked, nothing saved.
  if (dryRun) return (await present([doc.toObject()], actor))[0];
  pushHistory(doc, actor, 'scheduled', { note: `${shortDate(ymdOf(doc.date))} ${doc.startTime}–${doc.endTime}` });
  try { await doc.save(); } catch (err) {
    if (err?.code === 11000) throw fail('This paper already has a sitting; change it instead.', 409, 'DUPLICATE');
    throw err;
  }
  await syncExamDate(doc);
  return (await present([doc.toObject()], actor, { seats: true }))[0];
}

async function loadForEdit(actor, id) {
  requireProfile(actor);
  const doc = await ExamSitting.findById(assertObjectId(id));
  if (!doc) throw fail('Exam paper not found', 404, 'NOT_FOUND');
  await assertMayTouch(actor, doc, {});
  return doc;
}

/** Announce a change to the people it affects, once, and keep the banner for the day. */
async function announce(doc, actor, change, { previousInvigilators = [] } = {}) {
  const date = ymdOf(doc.date);
  const told = date >= todayYmd() && statusOf(doc) !== 'FINISHED'
    ? await notifyExamChange(doc, { change, key: `h${doc.history.length}`, date: shortDate(date), invigilatorIds: [...new Set([...previousInvigilators, ...doc.venues.flatMap((v) => v.invigilatorProfileIds ?? [])].map(String))] })
    : null;
  if (told) {
    doc.banner = `${change.charAt(0).toUpperCase()}${change.slice(1)}`.slice(0, 300);
    doc.bannerAt = new Date();
    await doc.save();
  }
  return told;
}

const venueNames = async (venues) => {
  const idx = await facilityIndex();
  return venues.map((v) => idx.byId.get(String(v.facilityId))?.name ?? 'a room').join(' and ');
};

/**
 * Changes a paper: date or times, rooms (re-seated), invigilators, notes, title.
 * A change of room, time or date is announced and shown as a banner.
 */
export async function updateSitting(actor, id, body = {}) {
  const doc = await loadForEdit(actor, id);
  if (['CANCELLED'].includes(doc.status)) throw fail('This paper was cancelled.', 409, 'INVALID_TRANSITION');
  const before = { date: ymdOf(doc.date), startTime: doc.startTime, endTime: doc.endTime, venues: doc.venues.map((v) => String(v.facilityId)).join(','), invigilators: doc.venues.flatMap((v) => v.invigilatorProfileIds.map(String)) };
  const fields = await readSitting(actor, { ...body, kind: undefined }, doc);
  delete fields.kind;
  await assertMayTouch(actor, doc, fields);
  const prevVenues = doc.venues.map((v) => v.toObject());
  Object.assign(doc, fields);
  throwClashes(await clashesOf(doc, { ignoreSittingId: doc._id }));
  const roomsChanged = fields.venues && fields.venues.map((v) => String(v.facilityId)).join(',') !== before.venues;
  const capChanged = fields.venues && fields.venues.some((v, i) => v.capacity !== prevVenues[i]?.capacity);
  if (fields.venues) {
    // Keep seats when only invigilators changed; re-seat when the rooms or their sizes did.
    if (roomsChanged || capChanged) await buildSeating(doc, { mode: body.seatingMode === 'ALTERNATE' ? 'ALTERNATE' : 'ROLL' });
    else doc.venues.forEach((v, i) => { v.seats = prevVenues[i]?.seats ?? []; });
  }
  const changes = [];
  if (fields.date && ymdOf(fields.date) !== before.date) changes.push(`moved to ${shortDate(ymdOf(fields.date))}`);
  if ((fields.startTime && fields.startTime !== before.startTime) || (fields.endTime && fields.endTime !== before.endTime)) changes.push(`now ${doc.startTime}–${doc.endTime}`);
  if (roomsChanged) changes.push(`now in ${await venueNames(doc.venues)}`);
  if (fields.date && doc.status === 'POSTPONED') doc.status = 'SCHEDULED';
  pushHistory(doc, actor, 'updated', { note: changes.join('; ') || 'details changed' });
  await doc.save();
  await syncExamDate(doc);
  const told = changes.length ? await announce(doc, actor, changes.join(', '), { previousInvigilators: before.invigilators }) : null;
  return { ...(await present([doc.toObject()], actor, { seats: true }))[0], notified: told };
}

/**
 * Moves a paper to another room (or replaces one of its rooms), re-seats the
 * candidates and tells everyone: "change the exam hall for class 9 science to the auditorium".
 */
export async function changeVenue(actor, id, { toFacilityId = null, toRoom = null, fromFacilityId = null, capacity = null, reason = null } = {}, { dryRun = false } = {}) {
  const doc = await loadForEdit(actor, id);
  const idx = await facilityIndex();
  const to = await resolveFacility(toFacilityId ?? toRoom, idx);
  const current = doc.venues.map((v) => v.toObject());
  let replaceAt = 0;
  if (fromFacilityId) {
    const from = await resolveFacility(fromFacilityId, idx);
    replaceAt = current.findIndex((v) => String(v.facilityId) === String(from._id));
    if (replaceAt < 0) throw fail(`This paper is not in ${from.name}.`);
  } else if (current.length > 1) {
    // No room named: the whole paper moves to the new room.
    replaceAt = -1;
  }
  const keepInv = replaceAt >= 0 ? current[replaceAt]?.invigilatorProfileIds ?? [] : current.flatMap((v) => v.invigilatorProfileIds ?? []);
  const next = replaceAt >= 0
    ? current.map((v, i) => (i === replaceAt ? { facilityId: String(to._id), capacity: capacity ?? undefined, invigilatorProfileIds: keepInv.map(String) } : { facilityId: String(v.facilityId), capacity: v.capacity, invigilatorProfileIds: (v.invigilatorProfileIds ?? []).map(String) }))
    : [{ facilityId: String(to._id), capacity: capacity ?? undefined, invigilatorProfileIds: [...new Set(keepInv.map(String))] }];
  const venues = await readVenues(next);
  const oldNames = await venueNames(current);
  const prevInv = current.flatMap((v) => (v.invigilatorProfileIds ?? []).map(String));
  doc.venues = venues;
  throwClashes(await clashesOf(doc, { ignoreSittingId: doc._id }));
  await buildSeating(doc);
  if (dryRun) return { ...(await present([doc.toObject()], actor))[0], from: oldNames, to: await venueNames(doc.venues) };
  const why = optionalText(reason, { max: 200 }) || null;
  pushHistory(doc, actor, 'room_changed', { from: oldNames, to: await venueNames(doc.venues), note: why });
  await doc.save();
  const told = await announce(doc, actor, `moved from ${oldNames} to ${await venueNames(doc.venues)}${why ? ` (${why})` : ''}`, { previousInvigilators: prevInv });
  return { ...(await present([doc.toObject()], actor))[0], notified: told };
}

/** A delay on the day ("starts 30 minutes late"), checked again for clashes, and announced. */
export async function delaySitting(actor, id, { minutes, reason = null } = {}) {
  const doc = await loadForEdit(actor, id);
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 0 || m > 600) throw fail('minutes must be a whole number from 0 to 600');
  doc.delayMinutes = m;
  throwClashes(await clashesOf(doc, { ignoreSittingId: doc._id }));
  const why = optionalText(reason, { max: 200 }) || null;
  pushHistory(doc, actor, 'delayed', { to: `${m} min`, note: why });
  await doc.save();
  const w = sittingWindow(doc);
  const told = await announce(doc, actor, m ? `starts ${m} minutes late, at ${hhmm(w.start)} (ends ${hhmm(w.end)})${why ? `: ${why}` : ''}` : `back on time, ${doc.startTime}–${doc.endTime}`);
  return { ...(await present([doc.toObject()], actor))[0], notified: told };
}

const STATUS_MACHINE = {
  SCHEDULED: ['IN_PROGRESS', 'POSTPONED', 'CANCELLED', 'FINISHED'],
  IN_PROGRESS: ['FINISHED', 'POSTPONED'],
  POSTPONED: ['SCHEDULED', 'CANCELLED'],
  FINISHED: ['IN_PROGRESS'],
  CANCELLED: [],
};

/** Starts, finishes, postpones (optionally to a new date) or cancels a paper. */
export async function setStatus(actor, id, { status, reason = null, newDate = null, startTime = null, endTime = null } = {}) {
  const doc = await loadForEdit(actor, id);
  const to = String(status ?? '').toUpperCase();
  if (!SITTING_STATUSES.includes(to)) throw fail(`status must be one of ${SITTING_STATUSES.join(', ')}`);
  const from = statusOf(doc);
  if (from === to && !newDate) return (await present([doc.toObject()], actor))[0];
  if (!(STATUS_MACHINE[from] ?? []).includes(to) && !(to === 'SCHEDULED' && newDate)) throw fail(`A paper that is ${from.toLowerCase().replace('_', ' ')} cannot become ${to.toLowerCase().replace('_', ' ')}.`, 409, 'INVALID_TRANSITION');
  const why = optionalText(reason, { max: 200 }) || null;
  if (['POSTPONED', 'CANCELLED'].includes(to) && !why) throw fail('Give a reason; it is sent to the candidates and their families.', 400, 'AGENT_NEEDS_INPUT');
  let change = null;
  if (newDate) {
    doc.date = dayKey(parseYmd(newDate, 'newDate'));
    if (startTime) doc.startTime = parseTime(startTime, 'startTime');
    if (endTime) doc.endTime = parseTime(endTime, 'endTime');
    doc.delayMinutes = 0;
    doc.status = 'SCHEDULED';
    throwClashes(await clashesOf(doc, { ignoreSittingId: doc._id }));
    change = `${to === 'POSTPONED' ? 'postponed' : 'moved'} to ${shortDate(ymdOf(doc.date))}, ${doc.startTime}–${doc.endTime}${why ? ` (${why})` : ''}`;
    await syncExamDate(doc);
  } else {
    doc.status = to;
    if (to === 'POSTPONED') change = `postponed${why ? `: ${why}` : ''}; a new date will follow`;
    if (to === 'CANCELLED') change = `cancelled${why ? `: ${why}` : ''}`;
    if (to === 'SCHEDULED' && from === 'POSTPONED') change = `back on as scheduled, ${doc.startTime}–${doc.endTime}`;
  }
  pushHistory(doc, actor, 'status', { from, to: doc.status, note: why });
  await doc.save();
  const told = change ? await announce(doc, actor, change) : null;
  return { ...(await present([doc.toObject()], actor))[0], notified: told };
}

/** Builds the seating again (by roll number, or alternating classes). */
export async function reseat(actor, id, { mode = 'ROLL' } = {}) {
  const doc = await loadForEdit(actor, id);
  const out = await buildSeating(doc, { mode: mode === 'ALTERNATE' ? 'ALTERNATE' : 'ROLL' });
  pushHistory(doc, actor, 'seating', { note: `${out.candidates} candidates, ${mode === 'ALTERNATE' ? 'alternating classes' : 'by roll number'}` });
  await doc.save();
  return (await present([doc.toObject()], actor, { seats: true }))[0];
}

/** Moves one candidate to another room or seat (swapping with whoever has that seat), within the room's seats. */
export async function moveSeat(actor, id, { enrollmentId, toFacilityId = null, seatNo = null } = {}) {
  const doc = await loadForEdit(actor, id);
  const eid = assertObjectId(enrollmentId, 'enrollmentId');
  const seats = doc.venues.map((v) => v.seats.map((x) => (x.toObject ? x.toObject() : { ...x })));
  const fi = seats.findIndex((list) => list.some((x) => String(x.enrollmentId) === eid));
  if (fi < 0) throw fail('That candidate has no seat in this paper.', 404, 'NOT_FOUND');
  const ti = toFacilityId ? doc.venues.findIndex((v) => String(v.facilityId) === String(toFacilityId)) : fi;
  if (ti < 0) throw fail('That room is not one of the rooms of this paper.');
  const idx = await facilityIndex();
  const roomName = idx.byId.get(String(doc.venues[ti].facilityId))?.name ?? 'That room';
  const code = idx.byId.get(String(doc.venues[ti].facilityId))?.code ?? 'R';
  const mine = seats[fi].find((x) => String(x.enrollmentId) === eid);
  const wanted = seatNo ? String(seatNo).trim().toUpperCase().slice(0, 20) : null;
  const taken = wanted ? seats[ti].find((x) => x.seatNo.toUpperCase() === wanted && String(x.enrollmentId) !== eid) : null;
  seats[fi] = seats[fi].filter((x) => x !== mine);
  if (taken) {
    seats[ti] = seats[ti].filter((x) => x !== taken);
    seats[fi].push({ ...taken, seatNo: mine.seatNo });
    seats[ti].push({ ...mine, seatNo: wanted });
  } else {
    if (fi !== ti && seats[ti].length >= (doc.venues[ti].capacity ?? 0)) throw fail(`${roomName} is full (${doc.venues[ti].capacity} seats).`, 409, 'ROOM_FULL');
    const used = new Set(seats[ti].map((x) => x.seatNo.toUpperCase()));
    let next = wanted;
    if (!next) { let n = 1; while (used.has(`${code}-${String(n).padStart(2, '0')}`)) n += 1; next = `${code}-${String(n).padStart(2, '0')}`; }
    seats[ti].push({ ...mine, seatNo: next });
  }
  doc.venues.forEach((v, i) => { v.seats = seats[i].sort((a, b) => a.seatNo.localeCompare(b.seatNo, undefined, { numeric: true })); });
  doc.markModified('venues');
  pushHistory(doc, actor, 'seat_moved', { note: `Candidate moved to ${roomName}${wanted ? ` seat ${wanted}` : ''}` });
  await doc.save();
  return (await present([doc.toObject()], actor, { seats: true }))[0];
}

export async function deleteSitting(actor, id) {
  const doc = await loadForEdit(actor, id);
  if (doc.kind !== 'CLASS_TEST' && statusOf(doc) !== 'SCHEDULED') throw fail('Cancel the paper instead; it is no longer only scheduled.', 409, 'INVALID_TRANSITION');
  await doc.deleteOne();
  return { id: String(doc._id), deleted: true };
}

// ── Exports for printing ─────────────────────────────────────────────────

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };

/** The seating chart as CSV: room, seat, roll, class, name, admission number. */
export async function seatingCsv(actor, id) {
  const s = await getSitting(actor, id);
  const lines = [['Paper', 'Date', 'Time', 'Room', 'Seat', 'Class', 'Roll', 'Name', 'Admission no'].join(',')];
  for (const v of s.venues) for (const x of v.seats) lines.push([s.title, s.date, `${s.startsAt}-${s.endsAt}`, v.room, x.seatNo, x.className, x.rollNo ?? '', x.name, x.admissionNo ?? ''].map(csvCell).join(','));
  return { filename: `seating-${s.date}-${s.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, csv: `${lines.join('\n')}\n` };
}

/** The list for each room's door: which classes and roll numbers sit there, and who invigilates. */
export async function doorList(actor, id) {
  const s = await getSitting(actor, id);
  return {
    sittingId: s.id, title: s.title, date: s.date, dateLabel: s.dateLabel, time: `${s.startsAt}–${s.endsAt}`,
    rooms: s.venues.map((v) => {
      const groups = new Map();
      for (const x of v.seats) {
        const g = groups.get(x.className) ?? { className: x.className, fromRoll: null, toRoll: null, count: 0, fromSeat: x.seatNo, toSeat: x.seatNo };
        g.count += 1;
        if (x.rollNo !== null && x.rollNo !== undefined) { g.fromRoll = g.fromRoll === null ? x.rollNo : Math.min(g.fromRoll, x.rollNo); g.toRoll = g.toRoll === null ? x.rollNo : Math.max(g.toRoll, x.rollNo); }
        g.toSeat = x.seatNo;
        groups.set(x.className, g);
      }
      return { room: v.room, code: v.code, capacity: v.capacity, seated: v.seated, invigilators: v.invigilators.map((i) => i.name), groups: [...groups.values()] };
    }),
  };
}

export const __test = { buildSeating, statusOf, clashesOf };
