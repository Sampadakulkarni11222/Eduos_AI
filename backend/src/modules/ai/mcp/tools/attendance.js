import * as attendance from '../../../attendance/attendance.service.js';
import * as students from '../../../students/student.service.js';
import { ok, action } from '../protocol.js';
import { AppError } from '../../../../utils/AppError.js';
import {
  RISK, objectId, dateStr, MONTH, resolveEnrollmentId, resolveStudentEnrollment, studentIdentitySchema,
  wrapAgentTool, summarise, resolveSection, classIdentitySchema,
} from './_shared.js';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY'];

/** Today as YYYY-MM-DD in the school's local calendar, not UTC's. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const attendanceTools = {
  get_student_attendance: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's attendance record: days present, working days and the percentage. Name a student to look up theirs; name nobody and it answers for the caller (or their child). Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        month: { type: 'string', pattern: MONTH, description: 'YYYY-MM' },
        from: dateStr(),
        to: dateStr(),
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getSummary()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const whichStudent = () => new AppError('Which student? Give a name, admission number or id.', 400, [], 'AGENT_NEEDS_INPUT');
      // A school-wide reader who names nobody has no "own" record to report.
      if (!enrollmentId && ctx.scope !== 'OWN') throw whichStudent();
      const summary = await attendance.getSummary(ctx.actor, ctx.scope, {
        enrollmentId, month: args.month, from: args.from, to: args.to,
      });
      // Named nobody, and the caller's own scope covers several students (a
      // teacher's classes): the service answers with a per-enrolment map, and
      // reading that out as "no attendance recorded" would be wrong. Ask.
      if (!enrollmentId && summary && summary.enrollmentId === undefined) throw whichStudent();
      if (summary?.pctPresent == null) return ok(summary, { speakKey: 'attendance.none' });
      return ok(summary, {
        speakKey: 'attendance.summary',
        params: { pct: summary.pctPresent, present: summary.PRESENT ?? 0, days: summary.workingDays ?? 0 },
      });
    },
  },

  get_absent_students: {
    module: 'Attendance',
    resultShape: 'SUMMARY',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "Today's absence snapshot for the whole school: how many students are absent, present, late and excused, and whether the register has been marked at all. Use for \"who is absent today\" and \"how many are absent\". Read-only.",
    inputSchema: {
      type: 'object',
      properties: { date: dateStr('Defaults to today') },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    minScope: 'ALL',
    service: 'attendance.service.getDailyAbsenceSummary()',
    async run(_ctx, args) {
      const data = await attendance.getDailyAbsenceSummary({ date: args.date });
      if (data.marked === 0) return ok(data, { speakKey: 'absent.notMarked' });
      return ok(data, {
        speakKey: 'absent.today',
        params: { absent: data.ABSENT, present: data.PRESENT, late: data.LATE, excused: data.EXCUSED, marked: data.marked },
      });
    },
  },

  get_attendance_roster: {
    module: 'Attendance',
    resultShape: 'LIST',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Attendance for one whole class on one date: every enrolled student with the status marked for them, if any, and who is absent. This is the class-level answer — use it for "show the attendance of Class 5-A" and "who is absent in Class 5-A today". Name the class with className; sectionId is for when an id is already known. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...classIdentitySchema,
        sectionId: objectId('The class section, when the id is already known'),
        date: dateStr('Defaults to today'),
        month: { type: 'string', pattern: MONTH, description: 'YYYY-MM — the class summary for a whole month' },
        periodNo: { type: 'integer', minimum: 1, maximum: 12, description: 'Omit for day-level attendance' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getRoster()',
    async run(ctx, args) {
      // A class named in words is resolved at the caller's own scope, so a
      // teacher reaches their own classes and is refused another's by name
      // rather than by a confusing empty answer. `required: ['sectionId']` was
      // dropped because no conversation carries a section id -- the model was
      // being asked for something it cannot know.
      const section = await resolveSection(ctx, { sectionId: args.sectionId, className: args.className });
      if (!section) {
        throw new AppError('Which class? Name it, for example "Class 5 A".', 400, [], 'AGENT_NEEDS_INPUT');
      }
      // A month names a class summary rather than one day's register.
      // getSummary() is the authorized read for a range, and it is given the
      // section's own enrolments — so "July attendance for Class 5-A" answers
      // about that class instead of silently widening to the whole school,
      // which is what dropping the class used to do.
      if (args.month && !args.date) {
        const enrolments = await students.listEnrollments({ sectionId: section.sectionId, status: 'ACTIVE' });
        const tally = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
        for (const enrolment of enrolments) {
          // eslint-disable-next-line no-await-in-loop -- one class, and each
          // call re-checks that this caller may read that enrolment.
          const row = await attendance.getSummary(ctx.actor, ctx.scope, { enrollmentId: enrolment.id, month: args.month });
          for (const key of Object.keys(tally)) tally[key] += Number(row?.[key] ?? 0);
        }
        const marked = Object.values(tally).reduce((sum, n) => sum + n, 0);
        const pct = marked ? Math.round(((tally.PRESENT + tally.LATE + tally.HALF_DAY * 0.5) / marked) * 100) : null;
        return ok(
          { class: section.label, month: args.month, students: enrolments.length, marked, pctPresent: pct, ...tally },
          {
            speak: marked
              ? `${section.label} in ${args.month}: ${pct}% present across ${marked} marked entr${marked === 1 ? 'y' : 'ies'} ` +
                `for ${enrolments.length} student(s) — ${tally.PRESENT} present, ${tally.ABSENT} absent, ${tally.LATE} late.`
              : `No attendance has been marked for ${section.label} in ${args.month}.`,
          },
        );
      }

      const roster = await attendance.getRoster(
        ctx.actor, ctx.scope, section.sectionId,
        args.date ?? new Date().toISOString().slice(0, 10),
        args.periodNo ?? null,
      );
      // getRoster() returns its rows under `roster`, beside section and period details.
      const rows = Array.isArray(roster) ? roster : (roster?.roster ?? []);
      const marked = rows.filter((r) => r.status).length;
      // The roster rows carry the name differently depending on how the service
      // populated them, so each shape is tried in turn. Parenthesised because
      // `??` and `||` may not be mixed without it.
      const nameOf = (r) =>
        r.studentName
        ?? r.name
        ?? ([r.studentId?.firstName, r.studentId?.lastName].filter(Boolean).join(' ').trim() || 'Unknown');
      const absent = rows.filter((r) => r.status === 'ABSENT').map(nameOf);
      const view = summarise(absent, (n) => n, { limit: 10 });
      return ok(
        { roster, count: rows.length, marked, absent, absentCount: absent.length, class: section.label },
        {
          speak: marked === 0
            ? `${section.label} has ${rows.length} student(s); attendance has not been marked yet.`
            : `${section.label}: ${rows.length} student(s), ${marked} marked. ` +
              (absent.length ? `${absent.length} absent — ${view.list}${view.more ? ', …' : ''}.` : 'Nobody is marked absent.'),
        },
      );
    },
  },

  get_attendance_trend: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "Month-by-month attendance percentages for a student, for spotting a decline over time. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        months: { type: 'integer', minimum: 1, maximum: 24, description: 'How many months back, default 6' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getTrend()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const trend = await attendance.getTrend(ctx.actor, ctx.scope, { enrollmentId, months: args.months ?? 6 });
      const points = Array.isArray(trend) ? trend : (trend?.points ?? []);
      return ok(trend, {
        speak: points.length
          ? `Attendance by month: ${points.map((p) => `${p.month ?? p.label} ${p.pctPresent ?? p.pct}%`).join(', ')}.`
          : 'There is not enough attendance history to show a trend.',
      });
    },
  },

  get_subject_attendance: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's attendance broken down per subject. Note the `basis` field: DAY means the day's status was attributed to each subject scheduled that weekday, PERIOD means true per-period marks. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        month: { type: 'string', pattern: MONTH },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getSubjectWiseSummary()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const data = await attendance.getSubjectWiseSummary(ctx.actor, ctx.scope, { enrollmentId, month: args.month });
      const rows = data?.subjects ?? [];
      const view = summarise(rows, (s) => `${s.subject}: ${s.pctPresent ?? s.pct}%`, { limit: 8 });
      return ok(data, { speak: rows.length ? `Attendance by subject — ${view.list}.` : 'No per-subject attendance is recorded yet.' });
    },
  },

  get_attendance_calendar: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A day-by-day attendance calendar for one student for one month, showing the status recorded on each date. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        month: { type: 'string', pattern: MONTH, description: 'YYYY-MM; defaults to the current month' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getCalendar()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const data = await attendance.getCalendar(ctx.actor, ctx.scope, { enrollmentId, month: args.month });
      const days = data?.days ?? [];
      const absent = days.filter((d) => d.status === 'ABSENT').length;
      return ok(data, { speak: `${days.length} recorded day(s) this month, ${absent} marked absent.` });
    },
  },

  get_lecture_attendance: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Lecture-by-lecture attendance for one student over a month or a date range: each period with its subject, time and the status recorded. Only periods actually marked per lecture are counted — a whole-day mark says nothing about an individual lecture. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        month: { type: 'string', pattern: MONTH, description: 'YYYY-MM' },
        from: dateStr(),
        to: dateStr(),
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getLectureAttendance()',
    async run(ctx, args) {
      // The service re-checks the enrolment through
      // resolveSummaryEnrollmentIds(), which refuses an id the caller is not
      // entitled to (404) rather than treating the id as proof of entitlement.
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const data = await attendance.getLectureAttendance(ctx.actor, ctx.scope, {
        enrollmentId,
        ...(args.month && { month: args.month }),
        ...(args.from && { from: args.from }),
        ...(args.to && { to: args.to }),
      });
      const total = data?.totalLectures ?? 0;
      return ok(data, {
        speak: total
          ? `${total} lecture(s) recorded, ${data.pctPresent}% present, ${data.counts?.ABSENT ?? 0} absent.`
          : 'No lecture-level attendance has been recorded for that period.',
      });
    },
  },

  get_attendance_statistics: {
    module: 'Attendance',
    resultShape: 'SUMMARY',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "Attendance statistics. For staff, the school's register for a date with the present percentage; for a student or parent, their own summary. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { date: dateStr(), month: { type: 'string', pattern: MONTH } },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getDailyAbsenceSummary() / getSummary()',
    async run(ctx, args) {
      if (ctx.scope !== 'OWN') {
        const data = await attendance.getDailyAbsenceSummary({ date: args.date });
        if (data.marked === 0) return ok({ basis: 'SCHOOL_DAY', ...data }, { speakKey: 'absent.notMarked' });
        return ok({ basis: 'SCHOOL_DAY', ...data }, {
          speak:
            `On ${data.date}, ${data.pctPresent}% of the ${data.marked} students marked were present — ` +
            `${data.PRESENT} present, ${data.ABSENT} absent, ${data.LATE} late, ${data.EXCUSED} excused.`,
        });
      }
      const summary = await attendance.getSummary(ctx.actor, ctx.scope, { month: args.month });
      if (summary?.pctPresent != null) {
        return ok({ basis: 'OWN', ...summary }, {
          speakKey: 'attendance.summary',
          params: { pct: summary.pctPresent, present: summary.PRESENT ?? 0, days: summary.workingDays ?? 0 },
        });
      }

      // A teacher's OWN scope covers every pupil they teach, so getSummary()
      // answers with one entry per enrolment rather than a percentage. That
      // shape used to fall through to "no attendance recorded" — and, on the
      // per-student tool, to "Which student?" — which is how "show attendance
      // for July" became a dead end. The same authorized figures are totalled
      // here instead: it is a presentation of what the service already
      // returned, not a wider read.
      const perEnrolment = Object.values(summary ?? {}).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
      if (perEnrolment.length) {
        const tally = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
        for (const row of perEnrolment) {
          for (const key of Object.keys(tally)) tally[key] += Number(row[key] ?? 0);
        }
        const marked = Object.values(tally).reduce((sum, n) => sum + n, 0);
        if (marked > 0) {
          const pct = Math.round(((tally.PRESENT + tally.LATE + tally.HALF_DAY * 0.5) / marked) * 100);
          return ok(
            { basis: 'MY_CLASSES', students: perEnrolment.length, marked, pctPresent: pct, ...tally },
            {
              speak:
                `Across your classes${args.month ? ` in ${args.month}` : ''}: ${pct}% present over ${marked} marked ` +
                `entr${marked === 1 ? 'y' : 'ies'} for ${perEnrolment.length} student(s) — ` +
                `${tally.PRESENT} present, ${tally.ABSENT} absent, ${tally.LATE} late, ${tally.EXCUSED} excused.`,
            },
          );
        }
      }
      return ok({ basis: 'OWN', ...summary }, { speakKey: 'attendance.none' });
    },
  },

  /* ── Wrapped from agent/tools.js ─────────────────────── */
  // Kept alongside get_absent_students, which answers the same question, because
  // this is the name the rule parser and the WhatsApp opening briefing already
  // use. Renaming it would silently break both for no gain.
  who_is_absent_today: wrapAgentTool('who_is_absent_today', {
    module: 'Attendance',
    description:
      "Today's school-wide absence snapshot for leadership. Equivalent to get_absent_students. Read-only.",
    inputSchema: { type: 'object', properties: { date: dateStr() }, additionalProperties: false },
    service: 'attendance.service.getDailyAbsenceSummary()',
  }),

  get_attendance: wrapAgentTool('get_attendance', {
    module: 'Attendance',
    description:
      "The caller's own attendance summary — or, for staff, today's school register. Use get_student_attendance instead when the user names a particular student. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', pattern: MONTH }, date: dateStr() },
      additionalProperties: false,
    },
    service: 'attendance.service.getSummary() / getDailyAbsenceSummary()',
  }),

  /* ── Actions ─────────────────────────────────────────── */
  mark_attendance: {
    module: 'Attendance',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Record attendance on a date. Say who in one of two ways: `students` — name them (by name, admission number or id) each with a status, which is how "mark Rahul absent" works; or `sectionId` plus `entries` of enrolment ids, as returned by get_attendance_roster. Everyone in one call must be in the same class. This writes to the attendance register — the record a family may dispute later — so it always needs confirmation and is fully audited. Re-marking the same student and date updates the existing entry rather than adding a second one.',
    inputSchema: {
      type: 'object',
      properties: {
        students: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'Students named directly, each with the status to record',
          items: {
            type: 'object',
            properties: {
              ...studentIdentitySchema,
              status: { type: 'string', enum: STATUSES },
            },
            required: ['status'],
            additionalProperties: false,
          },
        },
        ...classIdentitySchema,
        sectionId: objectId('The class section, when giving entries'),
        entries: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'One entry per enrolment, when marking a register from get_attendance_roster',
          items: {
            type: 'object',
            properties: {
              enrollmentId: objectId(),
              status: { type: 'string', enum: STATUSES },
              note: { type: 'string', maxLength: 200 },
            },
            required: ['enrollmentId', 'status'],
            additionalProperties: false,
          },
        },
        date: dateStr('Defaults to today'),
        periodNo: { type: 'integer', minimum: 1, maximum: 12, description: 'Omit for day-level attendance' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.mark',
    affectsOthers: true,
    service: 'attendance.service.markAttendance()',
    summarise: (args, _actor, prepared) => {
      const plan = prepared ?? {};
      const who = plan.names?.length
        ? plan.names.join(', ')
        : `${(plan.entries ?? args.entries ?? []).length} student(s)`;
      return (
        `Mark attendance: ${who}` +
        `${plan.className ? ` in ${plan.className}` : ''} on ${plan.date ?? args.date ?? today()}` +
        `${plan.periodNo ? `, period ${plan.periodNo}` : ''}`
      );
    },
    /**
     * Turns however the user named the students into the register entries the
     * service takes, before the confirmation is shown — so the person approves
     * "Rahul Sharma → ABSENT in Class 6 A", not a list of ids, and an unknown or
     * ambiguous name is a question rather than a failed write.
     *
     * Names are resolved at the caller's own students.read scope, and the
     * service then enforces that a teacher only marks a class they teach. This
     * is input resolution only; which classes a person may mark is the
     * attendance service's rule, not this tool's.
     */
    async prepare(ctx, args) {
      const date = args.date ?? today();
      const periodNo = args.periodNo ?? null;

      if (args.students?.length) {
        if (args.entries?.length) {
          throw new AppError('Give either named students or register entries, not both.', 400);
        }
        const resolved = [];
        for (const { status, ...ident } of args.students) {
          const found = await resolveStudentEnrollment(ctx, ident);
          resolved.push({ ...found, status });
        }
        if (new Set(resolved.map((r) => r.sectionId)).size > 1) {
          throw new AppError('Those students are in different classes — mark each class separately.', 400);
        }
        return {
          sectionId: resolved[0].sectionId,
          date,
          periodNo,
          entries: resolved.map((r) => ({ enrollmentId: r.enrollmentId, status: r.status })),
          names: resolved.map((r) => `${r.name} → ${r.status}`),
          className: resolved[0].class,
        };
      }

      // A class named in words is resolved at the caller's own scope, the same
      // way every other class-level tool resolves one. Without it "mark
      // attendance for Class 5-A" could not reach this capability at all: the
      // class it named was inexpressible, so the request scored as being about
      // something else entirely.
      const section = await resolveSection(ctx, args);
      const sectionId = section?.sectionId ?? args.sectionId ?? null;

      if (!sectionId || !args.entries?.length) {
        throw new AppError('Which students should I mark, and as what?', 400, [], 'AGENT_NEEDS_INPUT');
      }
      return { sectionId, date, periodNo, entries: args.entries, names: null, className: section?.label ?? null };
    },
    /**
     * Attendance is the tool most likely to be disputed later ("my child was
     * present that day"), so the audit records the register as it stood before
     * and after — a tally by status plus the values for the rows this call
     * touches.
     */
    async snapshot(_ctx, _args, prepared) {
      if (!prepared?.sectionId) return null;
      const records = await attendance.findExisting(prepared.sectionId, prepared.date, prepared.periodNo);
      const touched = new Set(prepared.entries.map((e) => String(e.enrollmentId)));
      const tally = {};
      for (const r of records) tally[r.status] = (tally[r.status] ?? 0) + 1;
      return {
        sectionId: String(prepared.sectionId),
        date: prepared.date,
        tally,
        rows: records
          .filter((r) => touched.has(String(r.enrollmentId)))
          .map((r) => ({ enrollmentId: String(r.enrollmentId), status: r.status })),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await attendance.markAttendance(ctx.actor, ctx.scope, {
        sectionId: plan.sectionId,
        date: plan.date,
        periodNo: plan.periodNo,
        entries: plan.entries,
      });
      return action({
        type: 'attendance_marked',
        data: { ...result, sectionId: String(plan.sectionId), date: plan.date, marked: plan.entries.length },
        ...(plan.names?.length
          ? { speak: `Attendance recorded: ${plan.names.join(', ')}.` }
          : { speakKey: 'attendance.marked', params: { count: plan.entries.length } }),
      });
    },
  },

  bulk_mark_attendance: {
    module: 'Attendance',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Mark a whole section at once from a list of rows, typically "everyone present except these". Bulk register changes always need confirmation. Use mark_attendance for a handful of named students.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: objectId(),
        date: dateStr('Defaults to today'),
        periodNo: { type: 'integer', minimum: 1, maximum: 12 },
        rows: {
          type: 'array',
          minItems: 1,
          maxItems: 500,
          description: 'One row per student, named by roll number or admission number within the section. (To mark by enrolment id, use mark_attendance with entries.)',
          items: {
            type: 'object',
            properties: {
              rollNo: { type: 'integer', minimum: 1 },
              admissionNo: { type: 'string', maxLength: 40 },
              status: { type: 'string', enum: STATUSES },
            },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
      required: ['sectionId', 'rows'],
      additionalProperties: false,
    },
    permission: 'attendance.mark',
    affectsOthers: true,
    service: 'attendance.service.markAttendanceBulk()',
    summarise: (args) => `Mark attendance for ${args.rows.length} student(s) in section ${args.sectionId} on ${args.date ?? 'today'} in one go`,
    async run(ctx, args) {
      // markAttendanceBulk() takes rows as its CSV importer parses them —
      // lower-case keys, string values. It used to be handed the tool's own
      // shape ({ rollNo: 3 }), matched nothing, and refused every call with
      // "No valid attendance rows found". Rows are translated to its contract.
      const rows = args.rows.map((r) => ({
        ...(r.rollNo != null && { rollno: String(r.rollNo) }),
        ...(r.admissionNo && { admissionno: String(r.admissionNo) }),
        status: r.status,
      }));
      const result = await attendance.markAttendanceBulk(ctx.actor, ctx.scope, {
        sectionId: args.sectionId,
        date: args.date ?? today(),
        periodNo: args.periodNo ?? null,
        rows,
      });
      return action({
        type: 'attendance_marked_bulk',
        data: result,
        speak: `Attendance recorded for ${result?.marked ?? args.rows.length} student(s).`,
      });
    },
  },
};
