import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { logger } from '../../utils/logger.js';
import { sendOperational } from '../messaging/messaging.service.js';

/**
 * Absence and late alerts to guardians.
 *
 * When the day's register marks a student ABSENT or LATE, each guardian linked
 * to that student (StudentGuardian) is sent one ATTENDANCE_ALERT through the
 * operational outbox. sendOperational always leaves an in-app notification and
 * applies the WhatsApp rules itself: no opt-in means SKIPPED_NO_CONSENT, quiet
 * hours means DEFERRED until the morning, and an unconfigured channel is
 * recorded as SIMULATED. Nothing here bypasses those rules.
 *
 * Idempotency: one key per student, date and status
 * (`attendance-alert:<studentId>:<YYYY-MM-DD>:<STATUS>`), so re-saving the
 * register sends nothing twice, while a genuine change (LATE -> ABSENT) is a
 * new fact and is sent. A correction back to PRESENT sends nothing; the
 * earlier message stays as it was.
 *
 * Only day-level marks belong here (periodNo null): a missed period is not an
 * absence from school. The caller (attendance.service markAttendance) decides
 * that, and calls this after the write has succeeded.
 *
 * Never throws: the register has already been saved, and a messaging problem
 * must not turn a successful save into an error for the teacher.
 */

export const ALERT_STATUSES = new Set(['ABSENT', 'LATE']);
const STATUS_LABEL = { ABSENT: 'absent', LATE: 'late' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A register day is stored as the calendar date at UTC midnight. */
function toDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const isoDay = (d) => d.toISOString().slice(0, 10);
/** "14 Oct 2026" — the portal's date format. */
const displayDay = (d) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/**
 * Queue alerts for the given marks.
 *
 * Accepts either one status for several enrollments
 *   notifyGuardiansOfAbsence({ enrollmentIds, date, status })
 * or a mixed list, as markAttendance has it
 *   notifyGuardiansOfAbsence({ entries: [{ enrollmentId, status }], date })
 *
 * Statuses other than ABSENT and LATE are ignored. Marks for a day more than
 * `maxAgeDays` before today are ignored too: a register filled in a week late
 * should not tell a parent "today" about last Tuesday.
 *
 * @returns {Promise<{ queued: number, students: number, skipped: string|null }>}
 */
export async function notifyGuardiansOfAbsence({
  enrollmentIds = [], status, entries, date, requestedBy = null, now = new Date(), maxAgeDays = 1,
} = {}) {
  try {
    const day = toDay(date);
    if (!day) return { queued: 0, students: 0, skipped: 'invalid date' };
    const today = toDay(now);
    if (today.getTime() - day.getTime() > maxAgeDays * 86_400_000) {
      return { queued: 0, students: 0, skipped: 'mark is for an earlier day' };
    }

    const marks = (entries ?? enrollmentIds.map((enrollmentId) => ({ enrollmentId, status })))
      .map((e) => ({ enrollmentId: String(e.enrollmentId), status: String(e.status ?? '').toUpperCase() }))
      .filter((e) => ALERT_STATUSES.has(e.status));
    if (!marks.length) return { queued: 0, students: 0, skipped: null };

    const enrollments = await Enrollment.find({ _id: { $in: marks.map((m) => m.enrollmentId) } })
      .select('_id studentId').lean();
    const studentByEnrollment = new Map(enrollments.map((e) => [String(e._id), String(e.studentId)]));
    const studentIds = [...new Set(enrollments.map((e) => String(e.studentId)))];

    const [students, links] = await Promise.all([
      Student.find({ _id: { $in: studentIds }, deletedAt: null }).select('_id firstName lastName').lean(),
      StudentGuardian.find({ studentId: { $in: studentIds } }).select('studentId guardianProfileId').lean(),
    ]);
    // Only guardians whose profile is active in this school.
    const guardianIds = [...new Set(links.map((l) => String(l.guardianProfileId)))];
    const tenantId = currentTenantId();
    const activeGuardians = new Set((await Profile.find({
      _id: { $in: guardianIds }, deletedAt: null, status: 'ACTIVE', ...(tenantId ? { tenantId } : {}),
    }).select('_id').lean()).map((p) => String(p._id)));

    const nameOf = new Map(students.map((s) => [String(s._id), `${s.firstName} ${s.lastName ?? ''}`.trim()]));
    const guardiansOf = new Map();
    for (const l of links) {
      const g = String(l.guardianProfileId);
      if (!activeGuardians.has(g)) continue;
      const sid = String(l.studentId);
      if (!guardiansOf.has(sid)) guardiansOf.set(sid, []);
      guardiansOf.get(sid).push(g);
    }

    let queued = 0;
    let studentsAlerted = 0;
    const seen = new Set();
    for (const mark of marks) {
      const studentId = studentByEnrollment.get(mark.enrollmentId);
      if (!studentId || !nameOf.has(studentId)) continue;
      const key = `attendance-alert:${studentId}:${isoDay(day)}:${mark.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const recipients = guardiansOf.get(studentId) ?? [];
      if (!recipients.length) continue;
      // eslint-disable-next-line no-await-in-loop -- one outbox call per student keeps each key separate
      const results = await sendOperational({
        templateKey: 'ATTENDANCE_ALERT',
        recipientProfileIds: recipients,
        variables: { studentName: nameOf.get(studentId), statusLabel: STATUS_LABEL[mark.status], date: displayDay(day) },
        link: '/parent/attendance',
        idempotencyKey: key,
        relatedEntityType: 'Student',
        relatedEntityId: studentId,
        requestedBy,
        channels: ['WHATSAPP'],
        now,
      });
      queued += results.filter((r) => !r.duplicate).length;
      studentsAlerted += 1;
    }
    return { queued, students: studentsAlerted, skipped: null };
  } catch (err) {
    logger.error(`Attendance alert failed: ${err.message}`);
    return { queued: 0, students: 0, skipped: `error: ${err.message}` };
  }
}
