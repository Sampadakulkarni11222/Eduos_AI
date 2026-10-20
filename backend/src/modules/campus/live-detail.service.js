import mongoose from 'mongoose';
import { Facility } from '../../models/facility.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { Announcement } from '../../models/announcement.model.js';
import { Profile } from '../../models/profile.model.js';
import { Lab, PracticalSession } from '../../models/lab.model.js';
import { AppError } from '../../utils/AppError.js';
import { featuresFor } from '../../utils/features.js';
import { logger } from '../../utils/logger.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { assertObjectId, startOfDayUtc } from '../ops/common.js';
import { ownStudentIds, studentName } from '../safety/shared.js';
import { hasConfirmedCover } from '../staff/coverAccess.js';
import { coverFor } from '../staff/cover.service.js';
import { liveBySection, departments as departmentsLive } from './live.service.js';
import { campusLayers, layerAccess, loadOptional, adaptClubs } from './layers.service.js';
import { publicViews } from '../staff/credentials.service.js';
import { StaffCredential } from '../../models/staffCredential.model.js';
import { withEffectiveRooms, roomActivityAt } from '../examRooms/rooms.service.js';
import { sectionExamAt } from '../examRooms/campus.js';
import { shiftFor } from '../examRooms/occupancy.js';

/**
 * A teacher's professional profile as a page section: for families only the parts the
 * teacher agreed to show (nothing at all when none), for staff the whole record.
 */
function credentialSection(view, { family }) {
  if (!view) return null;
  const rows = [];
  if (view.qualifications?.length) rows.push({ label: 'Qualifications', value: view.qualifications.map((q) => [q.degree, q.institution, q.year].filter(Boolean).join(', ')).join('; ') });
  if (view.subjects?.length || view.specialisations?.length) rows.push({ label: 'Subjects', value: [...(view.subjects ?? []), ...(view.specialisations ?? [])].join(', ') });
  if (view.experienceYears !== undefined && view.experienceYears !== null) rows.push({ label: 'Experience', value: `${view.experienceYears} years` });
  if (view.certifications?.length) rows.push({ label: 'Certifications', value: view.certifications.map((c) => [c.name, c.year].filter(Boolean).join(' ')).join(', ') });
  if (view.bio) rows.push({ label: 'About', value: view.bio });
  if (!rows.length) return null;
  return { key: 'credentials', title: family ? 'About the teacher' : 'Professional profile', type: 'facts', rows, note: family ? 'Shown because the teacher chose to share it with families.' : null };
}

async function credentialFor(profileId, family) {
  if (!profileId) return null;
  if (family) return (await publicViews([profileId])).get(String(profileId)) ?? null;
  const doc = await StaffCredential.findOne({ profileId }).lean();
  return doc ? { ...doc, experienceYears: doc.experienceYears } : null;
}

/**
 * Live detail behind the campus map: what is happening in one room, class,
 * teacher, bus, lab, department, zone or the gate right now, and the
 * viewer's own campus view ("my child's class", "my next class").
 *
 * Everything is read from the module that owns the record (timetable,
 * attendance register, staff cover, labs, clubs, fleet, checkpoints) and is
 * limited on the server to what the viewer may see:
 *   - staff see a class's period, teacher and counts (as the map already does);
 *   - the named present/absent list goes only to staff holding attendance.read
 *     for that section: ALL (principal, admin) or OWN for the class teacher, a
 *     subject teacher of the section, or a substitute confirmed for this period;
 *   - parents and students see only their own child's/own class: the teacher's
 *     name and subject, period times, class strength and present count, and the
 *     child's own status. Never another child's name or attendance, never
 *     another class's details, never a teacher's personal data.
 * "Live" means the register and the timetable as they stand; nobody is located.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const IST_MS = 330 * 60_000;
const REFRESH_SECONDS = 15;
const KINDS = ['room', 'class', 'teacher', 'bus', 'lab', 'zone', 'department', 'gate'];

const istParts = (now) => {
  const t = new Date(now.getTime() + IST_MS);
  const d = t.getUTCDay();
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: d === 0 ? 7 : d, minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
};
const toMin = (s) => { const [h, m] = String(s ?? '0:0').split(':').map(Number); return h * 60 + (m || 0); };
/** "10:15" today at the school, as an instant. */
const atTime = (now, hhmm) => {
  const p = istParts(now);
  return new Date(Date.UTC(p.y, p.m, p.d) + toMin(hhmm) * 60_000 - IST_MS);
};
const istYmdOf = (now) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
const sectionLabel = (sec) => `${sec?.gradeId?.name ?? ''} ${sec?.name ?? ''}`.trim();
const initialOf = (name) => String(name ?? '?').trim().charAt(0).toUpperCase() || '?';
const SLOT_POPULATE = [
  { path: 'sectionId', select: 'name gradeId classTeacherId', populate: { path: 'gradeId', select: 'name' } },
  { path: 'subjectOfferingId', select: 'subjectId teacherId sectionId', populate: [{ path: 'subjectId', select: 'name' }, { path: 'teacherId', select: 'displayName' }] },
];

// ── Who is looking ──────────────────────────────────────────────────────

/** The viewer's own sections (family) or taught sections (teacher), read once per request. */
async function viewerOf(actor) {
  const family = FAMILY.has(actor.roleKey);
  const v = { actor, family, staff: !family, studentIds: [], ownSections: new Set(), teaches: new Set(), attendanceScope: actor.permissions?.['attendance.read'] ?? null };
  if (actor.roleKey === 'PARENT' || actor.roleKey === 'STUDENT') {
    v.studentIds = await ownStudentIds(actor);
    const en = v.studentIds.length ? await Enrollment.find({ studentId: { $in: v.studentIds }, status: 'ACTIVE' }).select('studentId sectionId').lean() : [];
    v.enrolments = en;
    for (const e of en) v.ownSections.add(String(e.sectionId));
  }
  if (actor.roleKey === 'TEACHER') for (const id of await getTeacherSectionIds(actor.profileId)) v.teaches.add(String(id));
  return v;
}

/** May this viewer see a class's period and counts? */
const canSeeClass = (v, sectionId) => (v.staff ? true : v.ownSections.has(String(sectionId)));

/**
 * May this viewer see the named register of a class? The same rule as the
 * attendance roster: ALL, or a teacher of the section, or a substitute
 * confirmed for the period now.
 */
async function canSeeRoster(v, sectionId, periodNo, now) {
  if (v.family) return false;
  if (v.attendanceScope === 'ALL') return true;
  if (v.actor.roleKey !== 'TEACHER' || !v.attendanceScope) return false;
  if (v.teaches.has(String(sectionId))) return true;
  return periodNo !== null && periodNo !== undefined && hasConfirmedCover(v.actor.profileId, sectionId, startOfDayUtc(now), periodNo).catch(() => false);
}

// ── A class right now ───────────────────────────────────────────────────

/** Today's timetable for one class, with the period now and the ones after it. */
async function classDay(sectionId, now) {
  const { dow, minutes } = istParts(now);
  const slots = await TimetableSlot.find({ sectionId, dayOfWeek: dow }).populate(SLOT_POPULATE).sort({ startTime: 1 }).lean();
  // Part 8: a room shift applied for today puts the period in its new room.
  await withEffectiveRooms(slots, istYmdOf(now)).catch((err) => logger.warn(`Live room shifts unavailable: ${err.message}`));
  const taught = slots.filter((s) => s.subjectOfferingId);
  const current = taught.find((s) => toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes) ?? null;
  const upcoming = taught.filter((s) => toMin(s.startTime) > minutes);
  return { slots: taught, current, upcoming, minutes };
}

/** The live block for one class: the period, the teacher (and cover), the register's counts. */
async function classNow(rawSectionId, now, { day = null } = {}) {
  // The register's aggregation does not cast ids, so always hand it an ObjectId.
  const sectionId = new mongoose.Types.ObjectId(String(rawSectionId));
  const [section, dayInfo, head, covers] = await Promise.all([
    Section.findById(sectionId).populate('gradeId', 'name').populate('classTeacherId', 'displayName').lean(),
    day ?? classDay(sectionId, now),
    liveBySection([sectionId], now).then((m) => m.get(String(sectionId))),
    coverFor(now).catch(() => []),
  ]);
  if (!section) return null;
  const { current, upcoming, slots } = dayInfo;
  const cover = current ? covers.find((c) => String(c.sectionId) === String(sectionId) && Number(c.periodNo) === Number(current.periodNo)) ?? null : null;
  // When the register was last written: the day's roll or a period's.
  const enrolIds = await Enrollment.find({ sectionId, status: 'ACTIVE' }).distinct('_id');
  const last = enrolIds.length
    ? await AttendanceRecord.findOne({ enrollmentId: { $in: enrolIds }, date: startOfDayUtc(now) }).sort({ updatedAt: -1 }).select('updatedAt').lean()
    : null;
  let periodRegister = null;
  if (current && enrolIds.length) {
    const rows = await AttendanceRecord.find({ enrollmentId: { $in: enrolIds }, date: startOfDayUtc(now), periodNo: current.periodNo }).select('status').lean();
    if (rows.length) periodRegister = { marked: rows.length, present: rows.filter((r) => ['PRESENT', 'LATE'].includes(r.status)).length };
  }
  const period = current ? {
    periodNo: current.periodNo, startTime: current.startTime, endTime: current.endTime,
    startsAt: atTime(now, current.startTime).toISOString(), endsAt: atTime(now, current.endTime).toISOString(),
    subject: current.subjectOfferingId?.subjectId?.name ?? 'Class',
    teacher: cover?.substituteName ?? current.subjectOfferingId?.teacherId?.displayName ?? null,
    teacherProfileId: cover?.substituteProfileId ? String(cover.substituteProfileId) : current.subjectOfferingId?.teacherId?._id ? String(current.subjectOfferingId.teacherId._id) : null,
    coveringFor: cover ? cover.absentName ?? 'an absent colleague' : null,
    room: current.room ?? null,
    subjectOfferingId: String(current.subjectOfferingId._id),
  } : null;
  return {
    sectionId: String(section._id), className: sectionLabel(section),
    classTeacher: section.classTeacherId?.displayName ?? null,
    period,
    next: upcoming.slice(0, 3).map((s) => ({ periodNo: s.periodNo, startTime: s.startTime, endTime: s.endTime, subject: s.subjectOfferingId?.subjectId?.name ?? 'Class', teacher: s.subjectOfferingId?.teacherId?.displayName ?? null, room: s.room ?? null })),
    timetable: slots.map((s) => ({ periodNo: s.periodNo, startTime: s.startTime, endTime: s.endTime, subject: s.subjectOfferingId?.subjectId?.name ?? 'Class', teacher: s.subjectOfferingId?.teacherId?.displayName ?? null, room: s.room ?? null, state: toMin(s.endTime) <= dayInfo.minutes ? 'done' : toMin(s.startTime) <= dayInfo.minutes ? 'now' : 'next' })),
    attendance: {
      marked: Boolean(head?.registerTaken), strength: head?.enrolled ?? 0,
      present: head?.registerTaken ? head.present : null, absent: head?.registerTaken ? head.absent : null, late: head?.registerTaken ? head.late : null,
      attendancePct: head?.attendancePct ?? null, periodRegister,
      lastUpdatedAt: last?.updatedAt ? new Date(last.updatedAt).toISOString() : null,
      source: "Today's attendance register; it changes as soon as a teacher marks or corrects it.",
    },
    exam: head?.exam ?? null,
    // Part 8: the paper the class is sitting right now, with its rooms (no seat numbers here).
    examNow: await sectionExamAt(sectionId, now).then((x) => (x ? { title: x.title, subject: x.subject, until: `${String(Math.floor(x.end / 60)).padStart(2, '0')}:${String(x.end % 60).padStart(2, '0')}`, venues: x.venues.map((v) => ({ facilityId: v.facilityId, seated: v.bySection[String(sectionId)] ?? 0 })) } : null)).catch(() => null),
  };
}

/** The named register of a class today (only for viewers who pass canSeeRoster). */
async function classRoster(sectionId, now) {
  const enrolments = await Enrollment.find({ sectionId, status: 'ACTIVE' }).populate('studentId', 'firstName lastName admissionNo').sort({ rollNo: 1 }).lean();
  const recs = await AttendanceRecord.find({ enrollmentId: { $in: enrolments.map((e) => e._id) }, date: startOfDayUtc(now), periodNo: null }).select('enrollmentId status updatedAt').lean();
  const byEn = new Map(recs.map((r) => [String(r.enrollmentId), r]));
  return enrolments.map((e) => {
    const name = e.studentId ? `${e.studentId.firstName} ${e.studentId.lastName ?? ''}`.trim() : 'Unknown';
    const r = byEn.get(String(e._id));
    return { id: String(e._id), name, initial: initialOf(name), admissionNo: e.studentId?.admissionNo ?? null, rollNo: e.rollNo ?? null, status: r?.status ?? null, at: r?.updatedAt ?? null };
  });
}

/** Recent notices for a class (titles only), as its families would receive them. */
async function classNotices(section, roleKey = null) {
  const filter = {
    deletedAt: null, publishedAt: { $lte: new Date() },
    $or: [{ 'audience.all': true }, { 'audience.sectionIds': section._id }, ...(section.gradeId ? [{ 'audience.gradeIds': section.gradeId._id ?? section.gradeId }] : [])],
  };
  const rows = await Announcement.find(filter).sort({ publishedAt: -1 }).limit(8).select('title publishedAt audience.roleKeys').lean();
  return rows.filter((a) => !roleKey || !a.audience?.roleKeys?.length || a.audience.roleKeys.includes(roleKey)).slice(0, 5).map((a) => ({ title: a.title, at: a.publishedAt }));
}

/** A practical in session in a lab room, and a club session in any room, right now. */
async function roomActivities(actor, facility, now, features) {
  const out = { practical: null, club: null };
  if (features.labs) {
    const lab = await Lab.findOne({ facilityId: facility._id }).select('_id name').lean();
    if (lab) {
      const s = await PracticalSession.findOne({ labId: lab._id, status: { $in: ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS'] }, startsAt: { $lte: now, $gt: new Date(now.getTime() - 6 * 3_600_000) } }).sort({ startsAt: -1 }).lean();
      const running = s && ((s.endsAt ? new Date(s.endsAt) > now : now - new Date(s.startsAt) < 90 * 60_000) || s.status === 'IN_PROGRESS');
      if (running) out.practical = { labId: String(lab._id), title: s.title, subject: s.subject ?? null, className: s.className ?? null, sectionId: s.sectionId ? String(s.sectionId) : null, teacher: s.teacherName ?? null, until: s.endsAt ?? null, status: s.status };
    }
  }
  if (features.clubs && actor.permissions?.['clubs.read']) {
    const fn = await loadOptional('clubs', ['../clubs/sessions.service.js'], 'clubsActivityFor');
    if (fn) {
      const items = adaptClubs(await fn(now).catch(() => []), now).items ?? [];
      const hit = items.find((i) => i.facilityId === String(facility._id) && i.label === 'Now');
      if (hit) out.club = { title: hit.title, activity: hit.activity ?? null, startTime: hit.startTime ?? null, endTime: hit.endTime ?? null };
    }
  }
  return out;
}

/** The room a class is in for a slot: the timetabled room by code or name, else its home room. */
async function roomForSlot(sectionId, roomText) {
  if (roomText) {
    const f = await Facility.findOne({ $or: [{ code: roomText }, { name: roomText }], restricted: { $ne: true } }).select('_id name').lean();
    if (f) return f;
  }
  return Facility.findOne({ sectionId, restricted: { $ne: true } }).select('_id name').lean();
}

// ── Sections of the dynamic page ────────────────────────────────────────

const link = (page, label, query = '') => ({ page, label, query });

function periodSection(now, cls) {
  if (!cls.period) {
    return { key: 'period', title: 'Right now', type: 'facts', rows: [{ label: 'Lesson', value: 'No lesson is timetabled for this class right now' }, ...(cls.next[0] ? [{ label: 'Next', value: `${cls.next[0].startTime} · ${cls.next[0].subject}${cls.next[0].teacher ? ` · ${cls.next[0].teacher}` : ''}` }] : [])], link: link('timetable', 'Timetable') };
  }
  return { key: 'period', title: 'Right now', type: 'period', period: cls.period, attendance: cls.attendance, className: cls.className, link: link('timetable', 'Timetable') };
}

function attendanceFacts(cls, family = false) {
  const a = cls.attendance;
  return {
    key: 'attendance', title: family ? 'Your class today' : 'Attendance today', type: 'metrics',
    items: [
      { label: 'on roll', value: a.strength, tone: 'neutral' },
      { label: 'present', value: a.marked ? a.present : 'not taken', tone: a.marked ? 'good' : 'neutral' },
      // Families get the class's strength and present count only.
      ...(a.marked && !family ? [{ label: 'absent', value: a.absent, tone: a.absent ? 'warn' : 'good' }, { label: 'came late', value: a.late, tone: a.late ? 'warn' : 'neutral' }] : []),
    ],
    note: a.marked ? "From today's attendance register." : 'The register has not been taken yet today.',
    updatedAt: a.lastUpdatedAt,
    link: link('attendance', 'Attendance'),
  };
}

async function classSections(v, sectionId, now, { includeRoster = true } = {}) {
  const cls = await classNow(sectionId, now);
  if (!cls) throw new AppError('Class not found', 404);
  // Families get their own class's strength and present count only: no absent, late or period counts.
  if (v.family) {
    const a = cls.attendance;
    cls.attendance = { marked: a.marked, strength: a.strength, present: a.present, lastUpdatedAt: a.lastUpdatedAt, source: a.source };
  }
  const sections = [periodSection(now, cls), attendanceFacts(cls, v.family)];
  const about = credentialSection(await credentialFor(cls.period?.teacherProfileId, v.family).catch(() => null), { family: v.family });
  if (about) sections.splice(1, 0, { ...about, title: v.family ? `About ${cls.period.teacher ?? 'the teacher'}` : about.title });
  if (cls.examNow) {
    const names = new Map((await Facility.find({ _id: { $in: cls.examNow.venues.map((x) => x.facilityId) } }).select('name').lean()).map((f) => [String(f._id), f.name]));
    sections.splice(1, 0, { key: 'examNow', title: 'Exam in progress', type: 'facts', rows: [{ label: 'Paper', value: cls.examNow.title }, { label: 'Room', value: cls.examNow.venues.map((x) => `${names.get(x.facilityId) ?? 'Room'} (${x.seated})`).join(', ') }, { label: 'Until', value: cls.examNow.until }], link: link(v.family ? 'my-exams' : 'exam-schedule', v.family ? 'My exams' : 'Exam timetable') });
  }
  if (cls.exam?.paperToday) sections.push({ key: 'exam', title: 'Exam today', type: 'facts', rows: [{ label: cls.exam.name, value: cls.exam.subject ?? 'Paper today' }], link: link('exams', 'Exams') });
  if (includeRoster) {
    if (await canSeeRoster(v, sectionId, cls.period?.periodNo, now)) {
      const roster = await classRoster(sectionId, now);
      sections.push({ key: 'roster', title: 'Present, absent and late', type: 'roster', items: roster, counts: cls.attendance, link: link('attendance', 'Open the register', `?section=${sectionId}`) });
    } else if (v.staff) {
      sections.push({ key: 'roster', title: 'Present, absent and late', type: 'note', text: 'The named register is shown to the class teacher, the class\'s subject teachers, a confirmed substitute, and school leadership.' });
    }
  }
  sections.push({ key: 'next', title: 'Next periods', type: 'list', items: cls.next.map((n) => ({ title: `${n.startTime}–${n.endTime} · ${n.subject}`, sub: [n.teacher, n.room].filter(Boolean).join(' · ') || null })), empty: 'No more lessons today.', link: link('timetable', 'Timetable') });
  const section = await Section.findById(sectionId).populate('gradeId', 'name').lean();
  sections.push({ key: 'notices', title: 'Recent notices', type: 'list', items: (await classNotices(section, v.family ? v.actor.roleKey : null)).map((n) => ({ title: n.title, at: n.at })), empty: 'No notices for this class.', link: link('announcements', 'Notices') });
  return { cls, sections };
}

// ── The dynamic page ────────────────────────────────────────────────────

const notFound = (what = 'Not found') => new AppError(what, 404);
const forbidden = (what) => new AppError(what, 403, [], 'CAMPUS_LIVE_FORBIDDEN');

async function roomDetail(v, id, now) {
  const f = await Facility.findById(assertObjectId(id)).lean();
  if (!f || (f.restricted && v.family)) throw notFound('Room not found');
  const head = { kind: 'room', id: String(f._id), title: f.name, subtitle: [f.kind.replace(/_/g, ' ').toLowerCase(), f.code].filter(Boolean).join(' · '), facilityId: String(f._id) };
  if (f.restricted && !v.actor.permissions?.['facilities.manage']) return { ...head, title: 'Restricted area', sections: [{ key: 'about', title: 'About', type: 'note', text: 'Details of this space are kept for the staff who manage it.' }] };
  const { dow, minutes } = istParts(now);
  const names = [f.code, f.name].filter(Boolean);
  const or = [{ room: { $in: names } }];
  if (f.sectionId) or.push({ sectionId: f.sectionId, $or: [{ room: null }, { room: '' }] });
  // Part 8: a period moved out by a room shift is not here; one moved in is; a paper in progress is.
  const act = await roomActivityAt(f._id, now).catch(() => null);
  const slots = (await TimetableSlot.find({ dayOfWeek: dow, $or: or }).populate(SLOT_POPULATE).sort({ startTime: 1 }).lean())
    .filter((s) => s.subjectOfferingId)
    .filter((s) => { const sh = act ? shiftFor(act.day.shifts, s.sectionId?._id ?? s.sectionId, s.periodNo) : null; return !sh || String(sh.toFacilityId) === String(f._id); });
  const movedIn = act?.movedIn?.[0] ?? null;
  const examHere = act?.exams?.[0] ?? null;
  const current = slots.find((s) => toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes) ?? null;
  const examSection = examHere ? ((examHere.sectionIds ?? []).find((id) => !v.family || v.ownSections.has(String(id))) ?? examHere.sectionIds?.[0]) : null;
  const sectionId = examSection ?? current?.sectionId?._id ?? (movedIn ? movedIn.sectionId : null) ?? f.sectionId ?? null;
  const features = await featuresFor();
  const about = { key: 'about', title: 'The room', type: 'facts', rows: [
    { label: 'Kind', value: f.kind.replace(/_/g, ' ').toLowerCase() },
    ...(f.capacity ? [{ label: 'Seats', value: f.capacity }] : []),
    { label: 'Status', value: f.status === 'ACTIVE' ? 'In use as normal' : f.status.replace(/_/g, ' ').toLowerCase() },
  ], link: v.actor.permissions?.['facilities.read'] ? link('facilities', 'Facilities', '?tab=spaces') : null };

  // Families: their own child's class only.
  const ownExam = examHere && v.family && (examHere.sectionIds ?? []).some((id) => v.ownSections.has(String(id)));
  if (v.family && !ownExam && (!sectionId || !v.ownSections.has(String(sectionId)))) {
    return { ...head, live: null, sections: [about, { key: 'live', title: 'Live now', type: 'note', text: 'Live details are shown for your own class only.' }] };
  }
  const acts = v.family ? { practical: null, club: null } : await roomActivities(v.actor, f, now, features);
  let live = null;
  let sections = [about];
  if (sectionId) {
    const out = await classSections(v, sectionId, now);
    const cls = out.cls;
    // In the class's home room while it is elsewhere this period: say where it is.
    const away = !current && cls.period && cls.period.room && !names.includes(cls.period.room);
    live = toLive(cls, { practical: acts.practical, club: acts.club, homeRoom: !current, away: away ? cls.period.room : null }, v);
    sections = [about, ...out.sections];
    if (away) sections.splice(1, 0, { key: 'away', title: 'Where the class is', type: 'note', text: `${cls.className} is in ${cls.period.room} this period.` });
  } else if (acts.practical || acts.club) {
    live = { practical: acts.practical, club: acts.club, updatedAt: now.toISOString() };
  }
  if (movedIn && !examHere) sections.splice(1, 0, { key: 'movedIn', title: 'Moved here', type: 'note', text: `${sectionLabel(act.day.sectionById.get(movedIn.sectionId))} is in this room for period ${movedIn.periodNo}: ${movedIn.shift.reason} (${movedIn.shift.refNo}).` });
  if (examHere) {
    const w = { start: toMin(examHere.startTime) + (examHere.delayMinutes ?? 0), end: toMin(examHere.endTime) + (examHere.delayMinutes ?? 0) };
    const venue = (examHere.venues ?? []).find((x) => String(x.facilityId) === String(f._id));
    const seatedOwn = (venue?.seats ?? []).filter((x) => v.ownSections.has(String(x.sectionId))).length;
    const classes = (examHere.sectionIds ?? []).map((id) => sectionLabel(act.day.sectionById.get(String(id)))).join(', ');
    const invNames = v.family ? [] : [...(await Profile.find({ _id: { $in: venue?.invigilatorProfileIds ?? [] } }).select('displayName').lean())].map((p) => p.displayName);
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    sections = sections.filter((x) => x.key !== 'examNow');
    sections.splice(1, 0, {
      key: 'exam', title: `Exam in progress: ${v.family ? examHere.subjectName ?? examHere.title : `${classes} ${examHere.subjectName ?? examHere.title}`}`, type: 'facts',
      rows: v.family
        ? [{ label: 'Paper', value: examHere.title }, { label: 'Your class here', value: `${seatedOwn} students` }, { label: 'Until', value: hh(w.end) }]
        : [{ label: 'Paper', value: examHere.title }, { label: 'Classes', value: classes }, { label: 'Students seated', value: `${venue?.seats?.length ?? 0}${venue?.capacity ? ` of ${venue.capacity}` : ''}` }, { label: 'Invigilators', value: invNames.length ? invNames.join(', ') : 'None assigned' }, { label: 'Time', value: `${hh(w.start)}–${hh(w.end)}` }],
      link: link(v.family ? 'my-exams' : 'exam-schedule', v.family ? 'My exams' : 'Exam timetable'),
    });
  }
  if (acts.practical) sections.splice(1, 0, { key: 'practical', title: 'Practical in session', type: 'facts', rows: [{ label: 'Practical', value: acts.practical.title }, ...(acts.practical.className ? [{ label: 'Class', value: acts.practical.className }] : []), ...(acts.practical.teacher ? [{ label: 'Teacher', value: acts.practical.teacher }] : []), ...(acts.practical.until ? [{ label: 'Until', value: new Date(acts.practical.until).toISOString(), format: 'time' }] : [])], link: link('labs', 'Labs') });
  if (acts.club) sections.splice(1, 0, { key: 'club', title: 'Club session now', type: 'facts', rows: [{ label: 'Club', value: acts.club.title }, ...(acts.club.activity ? [{ label: 'Activity', value: acts.club.activity }] : []), ...(acts.club.startTime ? [{ label: 'Time', value: `${acts.club.startTime}–${acts.club.endTime ?? ''}` }] : [])], link: link('clubs', 'Clubs & Teams') });
  return { ...head, sectionId: sectionId ? String(sectionId) : null, live, sections };
}

/** The compact "Live now" object the 3D room panel shows. */
function toLive(cls, extra = {}, v = null) {
  return {
    className: cls.className, sectionId: cls.sectionId,
    period: cls.period, next: cls.next[0] ?? null,
    attendance: cls.attendance,
    classTeacher: v?.family ? null : cls.classTeacher,
    practical: extra.practical ?? null, club: extra.club ?? null,
    homeRoom: Boolean(extra.homeRoom), awayIn: extra.away ?? null,
    updatedAt: cls.attendance.lastUpdatedAt,
  };
}

async function classDetail(v, id, now) {
  const section = await Section.findById(assertObjectId(id)).populate('gradeId', 'name').lean();
  if (!section) throw notFound('Class not found');
  if (!canSeeClass(v, section._id)) throw forbidden('Live details are shown for your own class only.');
  const out = await classSections(v, section._id, now);
  const room = await roomForSlot(section._id, out.cls.period?.room ?? null);
  return { kind: 'class', id: String(section._id), title: sectionLabel(section), subtitle: v.family ? 'Your class today' : out.cls.classTeacher ? `Class teacher: ${out.cls.classTeacher}` : 'Class today', facilityId: room ? String(room._id) : null, sectionId: String(section._id), live: toLive(out.cls, {}, v), sections: out.sections };
}

async function teacherDetail(v, id, now) {
  const profile = await Profile.findById(assertObjectId(id)).select('displayName tenantId deletedAt').lean();
  // Profiles are not tenant-scoped: never answer for another school's person.
  if (!profile || profile.deletedAt || (v.actor.tenantId && profile.tenantId !== v.actor.tenantId)) throw notFound('Teacher not found');
  const offerings = await SubjectOffering.find({ teacherId: profile._id }).select('_id sectionId').lean();
  // Only someone who teaches here is a "teacher" on this page; any other profile id is not found.
  if (!offerings.length && !(await coverFor(now).catch(() => [])).some((c) => String(c.substituteProfileId) === String(profile._id))) throw notFound('Teacher not found');
  // A family sees a teacher only when they teach the family's own class, and only the lessons in it.
  const visible = v.family ? offerings.filter((o) => v.ownSections.has(String(o.sectionId))) : offerings;
  if (v.family && !visible.length) throw forbidden('Teacher details are shown for your own class\'s teachers only.');
  const { dow, minutes } = istParts(now);
  const slots = await TimetableSlot.find({ dayOfWeek: dow, subjectOfferingId: { $in: visible.map((o) => o._id) } }).populate(SLOT_POPULATE).sort({ startTime: 1 }).lean();
  const covers = v.family ? [] : (await coverFor(now).catch(() => [])).filter((c) => String(c.substituteProfileId) === String(profile._id));
  const rows = [
    ...slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime, title: `${s.startTime}–${s.endTime} · ${s.subjectOfferingId?.subjectId?.name ?? 'Class'} · ${sectionLabel(s.sectionId)}`, sub: s.room ?? null, sectionId: String(s.sectionId?._id ?? '') })),
    ...covers.map((c) => ({ startTime: c.startTime, endTime: c.endTime, title: `${c.startTime}–${c.endTime} · Cover · ${c.className}`, sub: `Covering for ${c.absentName ?? 'a colleague'}`, sectionId: String(c.sectionId) })),
  ].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const now1 = rows.find((r) => toMin(r.startTime) <= minutes && toMin(r.endTime) > minutes) ?? null;
  const next = rows.find((r) => toMin(r.startTime) > minutes) ?? null;
  const sections = [
    { key: 'now', title: 'Teaching now', type: 'facts', rows: [{ label: 'Now', value: now1 ? now1.title : 'Not teaching this period' }, ...(next ? [{ label: 'Next', value: next.title }] : [])] },
    { key: 'today', title: v.family ? 'Lessons with your class today' : 'Today\'s lessons', type: 'list', items: rows.map((r) => ({ title: r.title, sub: r.sub, state: toMin(r.endTime) <= minutes ? 'done' : toMin(r.startTime) <= minutes ? 'now' : 'next' })), empty: 'No lessons timetabled today.', link: link('timetable', 'Timetable') },
  ];
  if (!v.family && now1?.sectionId) {
    const cls = await classNow(now1.sectionId, now);
    if (cls) sections.push(attendanceFacts(cls));
  }
  const about = credentialSection(await credentialFor(profile._id, v.family).catch(() => null), { family: v.family });
  if (about) sections.unshift(about);
  return { kind: 'teacher', id: String(profile._id), title: profile.displayName, subtitle: 'Teacher', sections };
}

async function busDetail(v, id, now) {
  const features = await featuresFor();
  if (!features.fleet) throw notFound('Transport is not switched on for this school');
  if (v.family) {
    const { myTrips } = await import('../fleet/trips.service.js');
    const mine = await myTrips(v.actor, now);
    const items = mine.children.flatMap((c) => c.trips.map((t) => ({ title: `${c.name} · ${t.kindLabel ?? t.title}`, sub: [t.vehicle?.registrationNo, t.stop?.name ? `Stop: ${t.stop.name}` : null, t.eta?.at ? `${t.eta.isEstimate ? 'Estimated ' : ''}${new Date(new Date(t.eta.at).getTime() + IST_MS).toISOString().slice(11, 16)}` : null].filter(Boolean).join(' · ') || null, badge: (t.myStatus ?? t.status ?? '').replace(/_/g, ' ').toLowerCase() })));
    return { kind: 'bus', id: String(id ?? 'mine'), title: 'Your bus today', subtitle: mine.note, sections: [{ key: 'trips', title: 'Today\'s trips', type: 'list', items, empty: 'No bus trip today.', link: link('bus-today', 'Bus today') }] };
  }
  const layers = await campusLayers(v.actor, { now });
  if (!layers.transport) throw forbidden('Transport details are kept for the transport team.');
  const veh = layers.transport.vehicles.find((x) => x.id === String(id)) ?? null;
  if (!veh && id) throw notFound('Vehicle not found');
  const list = veh ? [veh] : layers.transport.vehicles;
  return {
    kind: 'bus', id: String(id ?? 'all'), title: veh ? veh.registrationNo : 'Buses', subtitle: veh ? veh.type?.toLowerCase() : `${layers.transport.live} live · ${layers.transport.offline} offline`, facilityId: layers.transport.facilityId,
    sections: [
      { key: 'vehicles', title: veh ? 'Status' : 'Vehicles', type: 'list', items: list.map((x) => ({ title: `${x.registrationNo} · ${x.positionStatus.replace(/_/g, ' ').toLowerCase()}`, sub: x.trips.map((t) => `${t.routeName ?? t.kind.replace(/_/g, ' ').toLowerCase()} · ${t.status.replace(/_/g, ' ').toLowerCase()} · ${t.seatsUsed}/${t.capacity} seats`).join(' | ') || 'No trip today', badge: x.blocked ? 'papers expired' : x.documentsDue.length || x.checksDue.length ? 'due soon' : null })), empty: 'No vehicles recorded.', link: link('fleet', 'Fleet') },
    ],
  };
}

async function labDetail(v, id, now) {
  if (v.family) throw forbidden('Lab details are kept for staff.');
  const layers = await campusLayers(v.actor, { now });
  if (!layers.labs) throw forbidden('You do not have access to the labs.');
  const lab = layers.labs.find((l) => l.labId === String(id) || l.facilityId === String(id));
  if (!lab) throw notFound('Lab not found');
  return {
    kind: 'lab', id: lab.labId, title: lab.name, subtitle: 'Lab', facilityId: lab.facilityId,
    sections: [
      { key: 'practical', title: 'Practical now', type: 'facts', rows: lab.practicalNow ? [{ label: 'Practical', value: lab.practicalNow.title }, ...(lab.practicalNow.className ? [{ label: 'Class', value: lab.practicalNow.className }] : []), { label: 'Status', value: lab.practicalNow.status.replace(/_/g, ' ').toLowerCase() }] : [{ label: 'Practical', value: 'None in session' }], link: link('labs', 'Labs') },
      ...(lab.openIncidents !== null ? [{ key: 'counts', title: 'Lab health', type: 'metrics', items: [{ label: 'open incidents', value: lab.openIncidents, tone: lab.openIncidents ? 'bad' : 'good' }, { label: 'low stock', value: lab.lowStock, tone: lab.lowStock ? 'warn' : 'good' }, { label: 'expiring or expired', value: lab.expiringSoon, tone: lab.expiringSoon ? 'warn' : 'good' }, { label: 'calibration overdue', value: lab.calibrationOverdue, tone: lab.calibrationOverdue ? 'warn' : 'good' }], link: link('labs', 'Labs') }] : []),
    ],
  };
}

async function departmentDetail(v, code, now) {
  const all = await departmentsLive(v.actor, { now });
  const d = all.find((x) => x.code === String(code ?? '').toUpperCase());
  if (!d) throw notFound('Department not found');
  const rooms = d.facilityIds.length ? await Facility.find({ _id: { $in: d.facilityIds.slice(0, 30) } }).select('name kind').lean() : [];
  return {
    kind: 'department', id: d.code, title: d.name, subtitle: d.description ?? 'Department',
    sections: [
      ...(d.head || d.staffCount !== null ? [{ key: 'people', title: 'People', type: 'facts', rows: [...(d.head ? [{ label: d.head.title, value: d.head.name ?? 'Not appointed' }] : []), ...(d.staffCount !== null ? [{ label: 'Staff', value: d.staffCount }] : [])] }] : []),
      ...(d.metrics.length ? [{ key: 'figures', title: 'Live figures', type: 'metrics', items: d.metrics.map((m) => ({ label: m.label, value: m.value, tone: m.tone })) }] : [{ key: 'figures', title: 'Live figures', type: 'note', text: 'Its figures are kept for the staff who run it.' }]),
      { key: 'rooms', title: 'Where it works', type: 'list', items: rooms.map((r) => ({ title: r.name, sub: r.kind.replace(/_/g, ' ').toLowerCase(), go: { kind: 'room', id: String(r._id) } })), empty: 'No rooms recorded.' },
    ],
    pages: d.pages,
  };
}

async function zoneDetail(v, id, now) {
  if (v.family) throw forbidden('Zone details are kept for staff.');
  const layers = await campusLayers(v.actor, { now });
  const z = layers.greenery?.items?.find((x) => String(x.id) === String(id) || String(x.facilityId) === String(id));
  if (!z) throw notFound('Zone not found');
  return { kind: 'zone', id: String(z.id), title: z.title ?? 'Green zone', subtitle: z.kind ?? 'Zone', facilityId: z.facilityId ?? null, sections: [{ key: 'zone', title: 'Now', type: 'facts', rows: [...(z.value !== null && z.value !== undefined ? [{ label: 'Plants', value: `${z.value} ${z.unit ?? ''}`.trim() }] : []), { label: 'Sanitation tasks open', value: z.count ?? 0 }, { label: 'Overdue', value: z.target ?? 0 }], link: link('sustainability', 'Sustainability') }] };
}

async function gateDetail(v, now) {
  const layers = v.family ? null : await campusLayers(v.actor, { now });
  if (!layers?.gate) throw forbidden('Gate figures are kept for the gate and hostel teams.');
  const g = layers.gate;
  return { kind: 'gate', id: g.facilityId ?? 'gate', title: 'Gate', subtitle: 'Counts only', facilityId: g.facilityId, sections: [{ key: 'gate', title: 'On site now', type: 'metrics', items: [...(g.visitorsOnSite !== null ? [{ label: 'visitors on site', value: g.visitorsOnSite, tone: 'neutral' }] : []), ...(g.studentsOutOnPass !== null ? [{ label: 'students out on a pass', value: g.studentsOutOnPass, tone: 'neutral' }] : [])], link: link('gate', 'Gate') }] };
}

/**
 * GET /campus/live?kind=&id= — the dynamic detail page and the 3D panel's
 * "Live now" block. The answer is a title and a list of typed sections the
 * page renders as they come, each with the page that holds the full record.
 */
export async function liveDetail(actor, { kind, id = null, now = new Date() } = {}) {
  const k = String(kind ?? '').toLowerCase();
  if (!KINDS.includes(k)) throw new AppError(`kind must be one of ${KINDS.join(', ')}`, 400);
  const v = await viewerOf(actor);
  let out;
  if (k === 'room') out = await roomDetail(v, id, now);
  else if (k === 'class') out = await classDetail(v, id, now);
  else if (k === 'teacher') out = await teacherDetail(v, id, now);
  else if (k === 'bus') out = await busDetail(v, id, now);
  else if (k === 'lab') out = await labDetail(v, id, now);
  else if (k === 'department') out = await departmentDetail(v, id, now);
  else if (k === 'zone') out = await zoneDetail(v, id, now);
  else out = await gateDetail(v, now);
  return { asOf: now.toISOString(), refreshSeconds: REFRESH_SECONDS, ...out };
}

// ── My campus view ──────────────────────────────────────────────────────

const STAFF_DEPT = { PRINCIPAL: ['LEADERSHIP', 'ACADEMICS'], ADMIN: ['ADMINISTRATION'], FINANCE: ['FINANCE'], MARKETING: ['ADMISSIONS'], HR: ['HR'], COMPLIANCE: ['COMPLIANCE'], LIBRARIAN: ['LIBRARY'], WARDEN: ['HOSTEL'], TRUSTEE: ['LEADERSHIP'] };

async function familyView(v, actor, { studentId = null, now }) {
  const students = v.studentIds.length ? await Student.find({ _id: { $in: v.studentIds }, deletedAt: null }).select('_id firstName lastName').lean() : [];
  const enrolOf = new Map((v.enrolments ?? []).map((e) => [String(e.studentId), e]));
  const sectionIds = [...new Set((v.enrolments ?? []).map((e) => String(e.sectionId)))];
  const sections = sectionIds.length ? await Section.find({ _id: { $in: sectionIds } }).populate('gradeId', 'name').lean() : [];
  const labelOf = new Map(sections.map((s) => [String(s._id), sectionLabel(s)]));
  const children = students.map((s) => ({ studentId: String(s._id), name: studentName(s), className: labelOf.get(String(enrolOf.get(String(s._id))?.sectionId)) ?? null }));
  if (studentId && !children.some((c) => c.studentId === String(studentId))) throw forbidden('You can only view your own child.');
  const chosen = children.find((c) => c.studentId === String(studentId)) ?? children.find((c) => enrolOf.has(c.studentId)) ?? children[0] ?? null;
  const base = { role: actor.roleKey, asOf: now.toISOString(), refreshSeconds: REFRESH_SECONDS, children: actor.roleKey === 'PARENT' ? children : undefined, selectedStudentId: chosen?.studentId ?? null };
  if (!chosen || !enrolOf.has(chosen.studentId)) return { ...base, focus: null, note: chosen ? 'Your class is not set up yet for this year.' : 'No child is linked to your profile yet. Ask the school office to link them.' };
  const enrolment = enrolOf.get(chosen.studentId);
  const cls = await classNow(enrolment.sectionId, now);
  const room = await roomForSlot(enrolment.sectionId, cls.period?.room ?? null);
  const home = await Facility.findOne({ sectionId: enrolment.sectionId, restricted: { $ne: true } }).select('_id name').lean();
  // The child's own day: today's register mark and (when the school uses them) gate and bus checkpoints.
  const mark = await AttendanceRecord.findOne({ enrollmentId: enrolment._id, date: startOfDayUtc(now), periodNo: null }).select('status updatedAt').lean();
  const features = await featuresFor();
  let checkpoints = null;
  if (features.idCheckpoints) {
    try {
      const { myChildren } = await import('../safety/checkpoints.service.js');
      const cp = await myChildren(actor, {});
      checkpoints = (cp.children.find((c) => c.studentId === chosen.studentId)?.events ?? []).map((e) => ({ point: e.point, label: e.pointLabel, at: e.at }));
    } catch (err) { logger.warn(`Campus my-view checkpoints unavailable: ${err.message}`); }
  }
  let bus = null;
  if (features.fleet) {
    try {
      const { myTrips } = await import('../fleet/trips.service.js');
      const t = await myTrips(actor, now);
      bus = (t.children.find((c) => c.studentId === chosen.studentId)?.trips ?? []).map((x) => ({ title: x.kindLabel ?? x.title, status: x.status, myStatus: x.myStatus, vehicle: x.vehicle?.registrationNo ?? null, stop: x.stop?.name ?? null, stopPlannedAt: x.stop?.plannedAt ?? null, eta: x.eta ?? null }));
    } catch (err) { logger.warn(`Campus my-view bus unavailable: ${err.message}`); }
  }
  return {
    ...base,
    focus: { sectionId: cls.sectionId, className: cls.className, facilityId: room ? String(room._id) : home ? String(home._id) : null, roomName: room?.name ?? home?.name ?? null, homeFacilityId: home ? String(home._id) : null },
    now: cls.period ? { ...cls.period, teacherProfileId: undefined } : null,
    teacher: cls.period?.teacher ? { name: cls.period.teacher, subject: cls.period.subject, coveringFor: cls.period.coveringFor, profileId: cls.period.teacherProfileId, about: cls.period.teacherProfileId ? (await publicViews([cls.period.teacherProfileId]).catch(() => new Map())).get(String(cls.period.teacherProfileId)) ?? null : null } : null,
    next: cls.next[0] ?? null,
    timetable: cls.timetable,
    classCounts: { strength: cls.attendance.strength, present: cls.attendance.present, marked: cls.attendance.marked, lastUpdatedAt: cls.attendance.lastUpdatedAt },
    child: { studentId: chosen.studentId, name: chosen.name, today: mark?.status ?? null, markedAt: mark?.updatedAt ?? null, checkpoints, bus },
  };
}

async function teacherView(actor, now) {
  const { dow, minutes } = istParts(now);
  const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id').lean();
  const slots = await TimetableSlot.find({ dayOfWeek: dow, subjectOfferingId: { $in: offerings.map((o) => o._id) } }).populate(SLOT_POPULATE).sort({ startTime: 1 }).lean();
  const covers = (await coverFor(now).catch(() => [])).filter((c) => String(c.substituteProfileId) === String(actor.profileId));
  const rows = [
    ...slots.map((s) => ({ sectionId: String(s.sectionId?._id ?? ''), className: sectionLabel(s.sectionId), subject: s.subjectOfferingId?.subjectId?.name ?? 'Class', startTime: s.startTime, endTime: s.endTime, periodNo: s.periodNo, room: s.room ?? null, cover: null })),
    ...covers.map((c) => ({ sectionId: String(c.sectionId), className: c.className, subject: 'Cover', startTime: c.startTime, endTime: c.endTime, periodNo: c.periodNo, room: c.room ?? null, cover: c.absentName ?? 'a colleague' })),
  ].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const counts = await liveBySection([...new Set(rows.map((r) => r.sectionId))].filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id)), now);
  const decorate = async (r) => {
    if (!r) return null;
    const room = await roomForSlot(r.sectionId, r.room);
    const h = counts.get(r.sectionId);
    return { ...r, facilityId: room ? String(room._id) : null, roomName: room?.name ?? r.room, startsAt: atTime(now, r.startTime).toISOString(), endsAt: atTime(now, r.endTime).toISOString(), strength: h?.enrolled ?? 0, present: h?.registerTaken ? h.present : null, marked: Boolean(h?.registerTaken) };
  };
  const current = await decorate(rows.find((r) => toMin(r.startTime) <= minutes && toMin(r.endTime) > minutes) ?? null);
  const next = await decorate(rows.find((r) => toMin(r.startTime) > minutes) ?? null);
  const focusOf = current ?? next;
  return {
    role: 'TEACHER', asOf: now.toISOString(), refreshSeconds: REFRESH_SECONDS,
    current, next,
    today: rows.map((r) => ({ ...r, state: toMin(r.endTime) <= minutes ? 'done' : toMin(r.startTime) <= minutes ? 'now' : 'next' })),
    focus: focusOf ? { sectionId: focusOf.sectionId, className: focusOf.className, facilityId: focusOf.facilityId } : null,
  };
}

/** GET /campus/my-view — the viewer's own corner of the campus. */
export async function myView(actor, { studentId = null, now = new Date() } = {}) {
  if (actor.roleKey === 'PARENT' || actor.roleKey === 'STUDENT') {
    const v = await viewerOf(actor);
    return familyView(v, actor, { studentId, now });
  }
  if (actor.roleKey === 'TEACHER') return teacherView(actor, now);
  if (actor.roleKey === 'ALUMNUS') return { role: 'ALUMNUS', asOf: now.toISOString(), refreshSeconds: REFRESH_SECONDS, focus: null };
  const access = layerAccess(actor);
  return { role: 'STAFF', asOf: now.toISOString(), refreshSeconds: REFRESH_SECONDS, focus: null, departments: STAFF_DEPT[actor.roleKey] ?? [], layers: Object.keys(access).filter((k) => access[k]) };
}
