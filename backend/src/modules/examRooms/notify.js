import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Who hears about a change to a paper or a class's room, and the one message
 * each of them gets. Staff (invigilators, class and subject teachers) by
 * email; students and parents through the operational outbox (WhatsApp where
 * they opted in, simulated without a provider), and everyone in the app. Each
 * change carries its own idempotency key, so a retried request tells nobody
 * twice. A delivery problem never undoes the change that caused it.
 */

/** Student and guardian profile ids for the active pupils of some sections. */
export async function familyProfileIds(sectionIds) {
  if (!sectionIds?.length) return { students: [], guardians: [] };
  const enrolled = await Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).select('studentId').lean();
  const studentIds = enrolled.map((e) => e.studentId);
  const [students, links] = await Promise.all([
    Student.find({ _id: { $in: studentIds }, profileId: { $ne: null } }).select('profileId').lean(),
    StudentGuardian.find({ studentId: { $in: studentIds } }).select('guardianProfileId').lean(),
  ]);
  return { students: students.map((s) => String(s.profileId)), guardians: [...new Set(links.map((l) => String(l.guardianProfileId)))] };
}

/** Class teacher and subject teachers of a section (optionally only some offerings). */
export async function teacherProfileIds(sectionId, offeringIds = null) {
  const [sec, offerings] = await Promise.all([
    Section.findById(sectionId).select('classTeacherId').lean(),
    SubjectOffering.find({ sectionId, teacherId: { $ne: null }, ...(offeringIds ? { _id: { $in: offeringIds } } : {}) }).select('teacherId').lean(),
  ]);
  return [...new Set([sec?.classTeacherId, ...offerings.map((o) => o.teacherId)].filter(Boolean).map(String))];
}

async function safely(label, fn) {
  try { return await fn(); } catch (err) { logger.warn(`${label}: ${err.message}`); return []; }
}

/** One change to a paper, to its candidates, their families and its invigilators. */
export async function notifyExamChange(sitting, { change, key, invigilatorIds = [], date }) {
  const fam = await familyProfileIds(sitting.sectionIds ?? []);
  const vars = { title: sitting.title, date, change };
  const base = { templateKey: 'EXAM_CHANGED', variables: vars, relatedEntityType: 'ExamSitting', relatedEntityId: sitting._id, urgency: 'URGENT' };
  const out = {};
  out.families = await safely('exam change (families)', () => sendOperational({ ...base, recipientProfileIds: [...fam.students, ...fam.guardians], link: '/my-exams', idempotencyKey: `exam:${sitting._id}:${key}:family` }));
  out.staff = await safely('exam change (staff)', () => sendOperational({ ...base, recipientProfileIds: invigilatorIds.map(String), channels: ['EMAIL'], link: '/exam-schedule?tab=duties', idempotencyKey: `exam:${sitting._id}:${key}:staff` }));
  return { students: fam.students.length, guardians: fam.guardians.length, invigilators: new Set(invigilatorIds.map(String)).size };
}

/** An applied room shift, to the class's teachers, its pupils and their families. */
export async function notifyRoomShift(shift, { className, room, when, reason = shift.reason, offeringIds = null, key = 'applied' }) {
  const [fam, teachers] = await Promise.all([familyProfileIds([shift.sectionId]), teacherProfileIds(shift.sectionId, offeringIds)]);
  const vars = { className, room, when, reason };
  const base = { templateKey: 'ROOM_SHIFTED', variables: vars, relatedEntityType: 'RoomShift', relatedEntityId: shift._id };
  await safely('room shift (staff)', () => sendOperational({ ...base, recipientProfileIds: teachers, channels: ['EMAIL'], link: '/rooms-classes?tab=shifts', idempotencyKey: `roomshift:${shift._id}:${key}:staff` }));
  await safely('room shift (families)', () => sendOperational({ ...base, recipientProfileIds: [...fam.students, ...fam.guardians], link: '/timetable', idempotencyKey: `roomshift:${shift._id}:${key}:family` }));
  return { teachers: teachers.length, students: fam.students.length, guardians: fam.guardians.length };
}
