import * as attendance from '../../../attendance/attendance.service.js';
import * as students from '../../../students/student.service.js';
import { ok, action } from '../protocol.js';
import { AppError } from '../../../../utils/AppError.js';
import {
  RISK, objectId, dateStr, MONTH, resolveEnrollmentId, resolveEnrollmentIdOrAsk, resolveStudentEnrollment, studentIdentitySchema,
  wrapAgentTool, summarise, resolveSection, classIdentitySchema,
} from './_shared.js';
import { attendanceAnswer, isFutureMonth, unreadableMonthMessage, formatPercent, formatDate } from '../../agent/present.js';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY'];

/**
 * The name to put on a named student's answer ("Rahul Sharma — Attendance
 * Summary"), or null when the caller named nobody and is asking about
 * themselves. Resolved at the caller's own scope, so it can only ever name a
 * student the lookup already allowed.
 */
async function namedStudent(ctx, args) {
  if (!args.studentId && !args.admissionNo && !args.studentName) return null;
  try {
    return (await resolveStudentEnrollment(ctx, args)).name ?? null;
  } catch {
    return null;
  }
}

/** Refuses a month argument that is the right shape but not a month ("2026-13"). */
function assertReadableMonth(month) {
  const unreadable = unreadableMonthMessage(month);
  if (unreadable) throw new AppError(unreadable, 400, [], 'AGENT_NEEDS_INPUT');
}

/** One student's summary as an envelope: a percentage only from real marks. */
function summaryEnvelope(summary, opts) {
  const { view, ...said } = attendanceAnswer(summary, opts);
  return ok(summary, { ...said, view });
}

/** Today as YYYY-MM-DD in the school's local calendar, not UTC's. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * The entries of a marking plan that would actually change the register.
 *
 * Compared against what is stored for that class, date and period -- the same
 * read the audit snapshot makes. An entry whose status is already the one asked
 * for is not a change, and proposing it again (a repeated request, a retried
 * message) asked a teacher to approve, and then audited, a write of nothing.
 */
async function entriesThatChange(plan) {
  const records = await attendance.findExisting(plan.sectionId, plan.date, plan.periodNo);
  const current = new Map(records.map((r) => [String(r.enrollmentId), r.status]));
  return plan.entries.filter((e) => current.get(String(e.enrollmentId)) !== String(e.status).toUpperCase());
}

/**
 * Refuses a plan that changes nothing, before anybody is asked to confirm it.
 * A 409 rather than a question: nothing is missing, and the orchestrator reads
 * a conflict out as the answer it is.
 */
async function assertChangesSomething(plan) {
  const changing = await entriesThatChange(plan);
  if (changing.length) return plan;
  const who = plan.names?.length ? plan.names.join(', ') : `${plan.entries.length} student(s)`;
  throw new AppError(
    `Attendance is already recorded that way${plan.className ? ` for ${plan.className}` : ''} on ${plan.date} — ${who}. Nothing to change.`,
    409, [], 'ATTENDANCE_UNCHANGED',
  );
}

export const attendanceTools = {
  get_student_attendance: {
    module: 'Attendance',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Use only when the user asks about the attendance of one specific named student: days present, working days and the percentage. Name a student to look up theirs; name nobody and it answers for the caller (or their child). Do not use for cohort queries, percentage-threshold queries, or "which students" questions (use get_at_risk_students instead). Read-only.',
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
      assertReadableMonth(args.month);
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
      // A percentage only from valid marks; none marked is "not available",
      // a month that has not started is said to be in the future.
      return summaryEnvelope(summary, {
        month: args.month ?? null,
        who: await namedStudent(ctx, args),
        child: !enrollmentId && ctx.actor?.roleKey === 'PARENT',
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
    // A class's register: nobody without a class of their own can be answered.
    requiresClass: true,
    resultShape: 'LIST',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Attendance for one whole class, for one date or one calendar month: on a date, every enrolled student with the status marked for them and who is absent; for a month, the class summary. This is the class-level answer — use it for "show the attendance of Class 5-A" and "who is absent in Class 5-A today". There is no class figure over a longer range. Name the class with className; sectionId is for when an id is already known. Read-only.',
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

      // The day is named in the answer: "attendance has not been marked yet"
      // with no date said was read as an answer about some other period.
      // The school's local calendar day, as every other attendance read and
      // write here uses (today()). The UTC day this used to take is still
      // yesterday until 05:30 in India, so an early-morning "who is absent in
      // Class 5 A?" was answered from the previous day's register.
      const day = args.date ?? today();
      const full = await attendance.getRoster(ctx.actor, ctx.scope, section.sectionId, day, args.periodNo ?? null);
      // getRoster() returns its rows under `roster`, beside section and period details.
      // The photo is for the marking screen's flashcards; an upload path is not
      // something the assistant passes on.
      const withoutPhoto = ({ photoUrl: _photoUrl, ...row }) => row;
      const rows = (Array.isArray(full) ? full : (full?.roster ?? [])).map(withoutPhoto);
      const roster = Array.isArray(full) ? rows : { ...full, roster: rows };
      const marked = rows.filter((r) => r.status).length;
      // The roster rows carry the name differently depending on how the service
      // populated them, so each shape is tried in turn. Parenthesised because
      // `??` and `||` may not be mixed without it.
      const nameOf = (r) =>
        r.studentName
        ?? r.name
        ?? ([r.studentId?.firstName, r.studentId?.lastName].filter(Boolean).join(' ').trim() || 'Unknown');
      const absent = rows.filter((r) => r.status === 'ABSENT').map(nameOf);
      const view = summarise(absent, (n) => n);
      return ok(
        { roster, count: rows.length, marked, absent, absentCount: absent.length, class: section.label, date: day },
        {
          speak: marked === 0
            ? `${section.label} has ${rows.length} student(s); attendance for ${day} has not been marked yet.`
            : `${section.label} on ${day}: ${rows.length} student(s), ${marked} marked. ` +
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
      // getTrend() resolves a single enrolment, and for a teacher naming
      // nobody that would be the first pupil on their list -- an answer about
      // somebody nobody asked about. Only a caller with a record of their own
      // (a student, or a parent's child) may leave the student out.
      if (!enrollmentId && !['STUDENT', 'PARENT'].includes(ctx.actor?.roleKey)) {
        throw new AppError('Which student? Give a name, admission number or id.', 400, [], 'AGENT_NEEDS_INPUT');
      }
      const trend = await attendance.getTrend(ctx.actor, ctx.scope, { enrollmentId, months: args.months ?? 6 });
      const points = Array.isArray(trend) ? trend : (trend?.points ?? []);
      // Months with nothing marked carry no percentage and are said to be
      // unmarked -- never read out as 0%.
      const marked = points.filter((p) => p.workingDays > 0 && p.pctPresent != null);
      return ok(trend, {
        speak: marked.length
          ? `Attendance by month: ${marked.map((p) => `${p.month} ${p.pctPresent}%`).join(', ')}.`
          : 'No attendance has been marked in that period, so there is no monthly percentage to show.',
        view: {
          type: 'attendance.trend',
          who: await namedStudent(ctx, args),
          points: points.map((p) => ({
            month: p.month,
            present: p.presentDays ?? 0,
            absent: p.absentDays ?? 0,
            marked: p.workingDays ?? 0,
            pct: p.workingDays > 0 ? (p.pctExact ?? p.pctPresent) : null,
          })),
        },
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
      const enrollmentId = await resolveEnrollmentIdOrAsk(ctx, args);
      const data = await attendance.getSubjectWiseSummary(ctx.actor, ctx.scope, { enrollmentId, month: args.month });
      const rows = data?.subjects ?? [];
      const view = summarise(rows, (s) => `${s.subject}: ${s.pctPresent ?? s.pct}%`);
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
      const enrollmentId = await resolveEnrollmentIdOrAsk(ctx, args);
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
      const enrollmentId = await resolveEnrollmentIdOrAsk(ctx, args);
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
      assertReadableMonth(args.month);
      if (args.month && isFutureMonth(args.month)) {
        return summaryEnvelope(null, { month: args.month });
      }
      const summary = await attendance.getSummary(ctx.actor, ctx.scope, { month: args.month });
      if (summary?.enrollmentId !== undefined) {
        // One student's own record: the same answer get_attendance gives.
        const { view, ...said } = attendanceAnswer(summary, {
          month: args.month ?? null, child: ctx.actor?.roleKey === 'PARENT',
        });
        return ok({ basis: 'OWN', ...summary }, { ...said, view });
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

  get_class_attendance_summary: {
    module: 'Attendance',
    // A staff view of classes: never a candidate for a caller who holds no
    // class (a student or parent), whose "how many days was I present this
    // month?" is about their own record.
    requiresClass: true,
    resultShape: 'SUMMARY',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Attendance compared ACROSS classes over a period, plus the figure for all of them together: each class with its attendance percentage, ranked. Use for "which class has the lowest/highest attendance", "class-wise attendance", "rank classes by attendance" and "overall attendance" of the school. The period is one date, one month, or a from/to range; with none it is the current month to date, and the answer always states the period. A school-wide reader sees every class; a teacher sees only the classes they teach. For ONE class use get_attendance_roster, for one student get_student_attendance. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        date: dateStr('One day'),
        month: { type: 'string', pattern: MONTH, description: 'YYYY-MM — one calendar month' },
        from: dateStr('Start of a range'),
        to: dateStr('End of a range'),
        order: { type: 'string', enum: ['LOWEST', 'HIGHEST'], description: 'Rank from the lowest or the highest attendance; lowest first by default' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Only when the user asks for a number of classes ("bottom 3")' },
      },
      additionalProperties: false,
    },
    permission: 'attendance.read',
    service: 'attendance.service.getClassWiseSummary()',
    async run(ctx, args) {
      assertReadableMonth(args.month);
      const data = await attendance.getClassWiseSummary(ctx.actor, ctx.scope, {
        date: args.date, month: args.month, from: args.from, to: args.to,
      });
      const highestFirst = args.order === 'HIGHEST';
      // Classes with nothing marked have no percentage, so they cannot be
      // ranked: they are listed after the ranking, and said to be unmarked --
      // never placed at the bottom as though they were 0%.
      const ranked = data.classes.filter((c) => c.pctExact != null)
        .sort((a, b) => (highestFirst ? b.pctExact - a.pctExact : a.pctExact - b.pctExact) || String(a.class).localeCompare(String(b.class)));
      const unmarked = data.classes.filter((c) => c.pctExact == null);
      const shown = args.limit ? ranked.slice(0, args.limit) : ranked;
      const whose = data.scope === 'SCHOOL' ? 'the school' : 'your classes';
      const period = `${formatDate(data.period.from ?? data.period.to)}${data.period.from && data.period.from !== data.period.to ? ` to ${formatDate(data.period.to)}` : ''}`;
      const periodNote = data.period.basis === 'MONTH_TO_DATE' ? `${period} (this month so far)` : period;

      if (!ranked.length) {
        return ok({ ...data, ranked: [] }, {
          speak: `No attendance has been marked for ${whose} in the period ${periodNote}, so there is no percentage to compare.`,
        });
      }

      const overallLine = `Overall for ${whose}: **${formatPercent(data.overall.pctExact)}** — ${data.overall.marked} day-level marks for ${data.overall.students} student(s).`;
      const first = shown[0];
      const lead = `${first.class} has the ${highestFirst ? 'highest' : 'lowest'} attendance at ${formatPercent(first.pctExact)}`;
      return ok({ ...data, ranked: shown, order: highestFirst ? 'HIGHEST' : 'LOWEST' }, {
        speak:
          `Attendance by class for ${periodNote}, ${highestFirst ? 'highest' : 'lowest'} first: `
          + `${shown.map((c) => `${c.class} ${formatPercent(c.pctExact)}`).join('; ')}. ${lead}. `
          + `Overall for ${whose}: ${formatPercent(data.overall.pctExact)}.`,
        view: {
          type: 'list.numbered',
          intro: `**Attendance by class — ${periodNote}** (${highestFirst ? 'highest' : 'lowest'} first)`,
          items: shown.map((c) => ({
            label: c.class,
            detail: `${formatPercent(c.pctExact)} · ${c.students} student(s) · ${c.ABSENT} absent of ${c.marked} marks`,
          })),
          outro: [
            `${lead}.`,
            overallLine,
            unmarked.length ? `_Not marked in this period: ${unmarked.map((c) => c.class).join(', ')}._` : null,
            data.period.basis === 'MONTH_TO_DATE' ? '_Say a date, a month ("last month") or a range for a different period._' : null,
          ].filter(Boolean).join('\n\n'),
        },
      });
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
        // The register screen's "Mark all present": every pupil on the class
        // register gets one status, and the teacher then changes the few who
        // differ. Those few are `students`, and they win.
        //
        // An object, not a bare status, on purpose: a status word is in almost
        // every attendance sentence, and a generic reader filling a bare enum
        // from "mark Diya present" would have marked the whole class. Nothing
        // fills an object from a sentence except the grammar that says
        // "everyone" / "all" / "the whole class".
        everyone: {
          type: 'object',
          description: 'Mark every pupil on the named class register with this status; pupils named in `students` are the exceptions',
          properties: { status: { type: 'string', enum: STATUSES } },
          required: ['status'],
          additionalProperties: false,
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

      // "Mark all present in Class 6-A, except Rahul Sharma": the whole register
      // from the same roster the Web screen loads (which also checks the caller
      // may see that class), with the named pupils as exceptions. The attendance
      // service still decides whether this caller may MARK it.
      if (args.everyone) {
        if (args.entries?.length) throw new AppError('Give either everyone or register entries, not both.', 400);
        const section = await resolveSection(ctx, args);
        const sectionId = section?.sectionId ?? args.sectionId ?? null;
        if (!sectionId) throw new AppError('Which class? Name it, for example "Class 6-A".', 400, [], 'AGENT_NEEDS_INPUT');
        const roster = await attendance.getRoster(ctx.actor, ctx.scope, sectionId, date, periodNo);
        const exceptions = new Map();
        const exceptionNames = [];
        for (const { status, ...ident } of args.students ?? []) {
          const found = await resolveStudentEnrollment(ctx, ident);
          if (String(found.sectionId) !== String(sectionId)) {
            throw new AppError(`${found.name} is not on the ${roster.section.name} register.`, 400);
          }
          exceptions.set(String(found.enrollmentId), status);
          exceptionNames.push(`${found.name} → ${status}`);
        }
        if (!roster.roster.length) throw new AppError(`There is nobody on the ${roster.section.name} register.`, 400);
        const entries = roster.roster.map((r) => ({
          enrollmentId: r.enrollmentId,
          status: exceptions.get(String(r.enrollmentId)) ?? args.everyone.status,
        }));
        const rest = entries.length - exceptions.size;
        return assertChangesSomething({
          sectionId,
          date,
          periodNo,
          entries,
          names: [...exceptionNames, `${exceptions.size ? 'everyone else' : 'everyone'} (${rest}) → ${args.everyone.status}`],
          className: section?.label ?? roster.section.name,
        });
      }

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
        // The same pupil named twice with two statuses is a contradiction, not
        // two instructions: asked about, never settled by whichever came last.
        const statusOf = new Map();
        for (const r of resolved) {
          const seen = statusOf.get(String(r.enrollmentId));
          if (seen && seen !== r.status) {
            throw new AppError(`${r.name} is named twice with different statuses (${seen} and ${r.status}). Which one?`, 400, [], 'AGENT_NEEDS_INPUT');
          }
          statusOf.set(String(r.enrollmentId), r.status);
        }
        const unique = resolved.filter((r, i) => resolved.findIndex((x) => String(x.enrollmentId) === String(r.enrollmentId)) === i);
        return assertChangesSomething({
          sectionId: unique[0].sectionId,
          date,
          periodNo,
          entries: unique.map((r) => ({ enrollmentId: r.enrollmentId, status: r.status })),
          names: unique.map((r) => `${r.name} → ${r.status}`),
          className: unique[0].class,
        });
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
      return assertChangesSomething({ sectionId, date, periodNo, entries: args.entries, names: null, className: section?.label ?? null });
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
      // Counted against the register as it stands NOW, not as it stood when the
      // proposal was made: between the two, the same marking may already have
      // been confirmed once (a second "yes", a redelivered message). The
      // service writes only what differs; this says truthfully how much did.
      const changing = await entriesThatChange(plan);
      const result = await attendance.markAttendance(ctx.actor, ctx.scope, {
        sectionId: plan.sectionId,
        date: plan.date,
        periodNo: plan.periodNo,
        entries: plan.entries,
      });
      const data = { ...result, sectionId: String(plan.sectionId), date: plan.date, marked: plan.entries.length, changed: changing.length };
      if (!changing.length) {
        return {
          ...action({
            type: 'attendance_unchanged',
            data,
            speak: `Attendance was already recorded that way on ${plan.date}${plan.names?.length ? ` — ${plan.names.join(', ')}` : ''}. Nothing was changed.`,
          }),
          // Read by the MCP server's audit entry: nothing was written.
          unchanged: true,
        };
      }
      return action({
        type: 'attendance_marked',
        data,
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
