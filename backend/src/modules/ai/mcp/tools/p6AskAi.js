import { Section } from '../../../../models/academics.model.js';
import { Enrollment, Student } from '../../../../models/student.model.js';
import { AttendanceRecord } from '../../../../models/attendanceRecord.model.js';
import { HostelAllocation } from '../../../../models/hostel.model.js';
import { attendanceFigures, ATTENDANCE_STATUSES } from '../../../attendance/attendance.service.js';
import { getTeacherSectionIds, getOwnStudentId, getGuardianStudentIds } from '../../../../utils/scope.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok } from '../protocol.js';
import { RISK, resolveSection, noArgs } from './_shared.js';
import { formatPercent } from '../../agent/present.js';

/**
 * Ask AI (p6 fixes): reads the conversation harness found missing.
 *
 * get_low_attendance_students -- "students with low attendance in my
 * classes", from a teacher. The only list of low-attendance students was
 * get_at_risk_students, which fronts the school-wide risk scan and is
 * ai.insights ALL only; a teacher asking the same question was asked "Which
 * class?" by the one-class register instead. This answers across every
 * section the caller may read attendance for -- a teacher's own classes (the
 * sections they are class teacher of or teach a subject in, as every OWN
 * attendance read draws the line), or the whole school for a school-wide
 * reader -- counted exactly as the attendance module counts: day-level marks
 * only, late and excused attended, a half day as half, and a student with
 * nothing marked in the period left out (no percentage, never 0%).
 *
 * Read-only, and it computes nothing the attendance screens do not: it writes
 * no risk scores (the risk scan does), so asking cannot change any record.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (d) => d.toISOString().slice(0, 10);

export const p6AskAiTools = {
  /**
   * "What is my hostel room?" -- a student's own bed (a parent's children's).
   * Every hostel read was the warden's (hostel.read ALL), so the question was
   * answered with the student's OUT-PASSES ("No out-passes yet"), true and
   * beside the point. Reads only the caller's own student record(s).
   */
  get_my_hostel_room: {
    module: 'Hostel', operation: 'GET', risk: RISK.LOW,
    description: "A student's own hostel room and bed allocation (a parent: each of their children's), or that they have none. Use for \"what is my hostel room\", \"which room am I in\", \"is my child in the hostel\". Read-only.",
    inputSchema: noArgs,
    permission: 'students.read', forRoles: ['STUDENT', 'PARENT'],
    service: 'HostelAllocation for the caller\'s own student record(s)',
    async run(ctx) {
      const ids = ctx.actor.roleKey === 'STUDENT'
        ? [await getOwnStudentId(ctx.actor.profileId)].filter(Boolean)
        : await getGuardianStudentIds(ctx.actor.profileId);
      if (!ids.length) return ok({ allocations: [] }, { speak: 'There is no student record linked to your account, so there is no hostel room to show.' });
      const [rows, people] = await Promise.all([
        HostelAllocation.find({ studentId: { $in: ids }, status: 'ACTIVE' }).populate('roomId', 'roomNo block floor type').lean(),
        Student.find({ _id: { $in: ids } }).select('firstName lastName').lean(),
      ]);
      const nameOf = new Map(people.map((p) => [String(p._id), `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()]));
      const allocations = rows.map((r) => ({
        student: nameOf.get(String(r.studentId)) ?? '',
        room: r.roomId?.roomNo ?? null,
        block: r.roomId?.block ?? null,
        since: r.allottedAt ? new Date(r.allottedAt).toISOString().slice(0, 10) : null,
      }));
      const own = ctx.actor.roleKey === 'STUDENT';
      if (!allocations.length) {
        return ok({ allocations }, { speak: own ? 'You are not allocated a hostel room.' : 'None of your children is allocated a hostel room.' });
      }
      return ok({ allocations }, {
        speak: allocations.map((a) => `${own ? 'You are' : `${a.student} is`} in room ${a.room}${a.block ? `, block ${a.block}` : ''}${a.since ? ` (since ${a.since})` : ''}.`).join(' '),
      });
    },
  },

  get_low_attendance_students: {
    // Filed with the at-risk list (Analytics), not with the registers: it is
    // reached by its own words ("low attendance"), and must never be taken by
    // the generic resolver as the answer to "attendance for Class 6 A this week".
    module: 'Analytics', operation: 'GET', risk: RISK.LOW,
    requiresClass: true,
    resultShape: 'LIST',
    description: 'Students whose attendance is below a percentage (default 75%) over the last 30 days (or a from/to range), across every class the caller may read attendance for: a teacher\'s own classes (class teacher or subject teacher), or the whole school for a school-wide reader. Each with class, percentage, days present and days marked, lowest first. Use for "students with low attendance in my classes", "who in my classes is below 75%", "which of my students have poor attendance". Narrow to one class with className. Students with nothing marked in the period are not assessed. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        attendanceBelowPct: { type: 'integer', minimum: 1, maximum: 100, description: 'Only students below this percentage (default 75)' },
        className: { type: 'string', maxLength: 40, description: 'One class, e.g. "Class 6 A"' },
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start of the period (default 30 days ago)' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End of the period (default today)' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'AttendanceRecord day-level counts over the caller\'s sections (attendance.service.attendanceFigures)',
    async run(ctx, args) {
      const threshold = args.attendanceBelowPct ?? 75;
      let sectionIds = null;
      if (ctx.scope !== 'ALL') {
        if (ctx.actor?.roleKey !== 'TEACHER') {
          throw new AppError('Class attendance is a staff view — you can see only your own attendance.', 403, [], 'AGENT_FORBIDDEN_SCOPE');
        }
        sectionIds = await getTeacherSectionIds(ctx.actor.profileId);
      }
      const one = args.className ? await resolveSection(ctx, { className: args.className }) : null;
      if (one) sectionIds = [one.sectionId];

      const sections = await Section.find(sectionIds ? { _id: { $in: sectionIds } } : {})
        .select('_id name gradeId').populate('gradeId', 'name').lean();
      const label = new Map(sections.map((s) => [String(s._id), `${s.gradeId?.name ?? ''} ${s.name ?? ''}`.trim()]));
      const enrollments = await Enrollment.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' })
        .select('_id sectionId studentId').populate('studentId', 'firstName lastName').lean();

      const today = new Date();
      const to = args.to ? new Date(`${args.to}T00:00:00.000Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const from = args.from ? new Date(`${args.from}T00:00:00.000Z`) : new Date(to.getTime() - 29 * DAY);
      if (to < from) throw new AppError('The end date cannot be before the start date.', 400, [], 'AGENT_NEEDS_INPUT');

      const rows = await AttendanceRecord.aggregate([
        { $match: {
          enrollmentId: { $in: enrollments.map((e) => e._id) },
          status: { $in: ATTENDANCE_STATUSES },
          periodNo: null,
          date: { $gte: from, $lte: new Date(to.getTime() + DAY - 1) },
        } },
        { $group: { _id: { enrollmentId: '$enrollmentId', status: '$status' }, count: { $sum: 1 } } },
      ]);
      const tally = new Map();
      for (const r of rows) {
        const key = String(r._id.enrollmentId);
        const t = tally.get(key) ?? {};
        t[r._id.status] = (t[r._id.status] ?? 0) + r.count;
        tally.set(key, t);
      }

      let assessed = 0;
      const below = [];
      for (const e of enrollments) {
        const t = tally.get(String(e._id));
        if (!t) continue;
        const f = attendanceFigures(t);
        if (f.pctExact == null) continue;
        assessed += 1;
        if (f.pctExact < threshold) {
          below.push({
            studentName: `${e.studentId?.firstName ?? ''} ${e.studentId?.lastName ?? ''}`.trim() || 'Unknown',
            class: label.get(String(e.sectionId)) ?? '',
            attendancePct: f.pctExact,
            daysPresent: f.PRESENT + f.LATE + f.EXCUSED + f.HALF_DAY * 0.5,
            daysMarked: f.workingDays,
          });
        }
      }
      below.sort((a, b) => a.attendancePct - b.attendancePct || a.studentName.localeCompare(b.studentName));

      const whose = one ? one.label : ctx.scope === 'ALL' ? 'the school' : 'your classes';
      const period = `${iso(from)} to ${iso(to)}`;
      const data = {
        scope: one ? 'CLASS' : ctx.scope === 'ALL' ? 'SCHOOL' : 'MY_CLASSES',
        classes: sections.map((s) => label.get(String(s._id))),
        period: { from: iso(from), to: iso(to) },
        threshold,
        studentsAssessed: assessed,
        notAssessed: enrollments.length - assessed,
        students: below,
      };
      if (!enrollments.length) return ok(data, { speak: `There are no enrolled students in ${whose}.` });
      if (!below.length) {
        return ok(data, {
          speak: `Nobody in ${whose} is below ${threshold}% attendance from ${period} (${assessed} student(s) with attendance marked).`,
        });
      }
      const notAssessed = data.notAssessed ? `_${data.notAssessed} student(s) had no attendance marked in this period and are not assessed._` : null;
      return ok(data, {
        speak: `${below.length} student(s) in ${whose} below ${threshold}% attendance from ${period}: `
          + `${below.map((s) => `${s.studentName} (${s.class}) ${formatPercent(s.attendancePct)}`).join('; ')}.`,
        view: {
          type: 'list.numbered',
          intro: `**${below.length} student(s) in ${whose} below ${threshold}% attendance** (${period})`,
          items: below.map((s) => ({ label: s.studentName, detail: `${s.class} — ${formatPercent(s.attendancePct)} (${s.daysPresent} of ${s.daysMarked} day(s))` })),
          outro: notAssessed ?? undefined,
        },
      });
    },
  },
};
