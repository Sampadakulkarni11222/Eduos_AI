import * as academics from '../../../academics/academics.service.js';
import * as exams from '../../../exams/exam.service.js';
import * as assignments from '../../../assignments/assignment.service.js';
import * as timetable from '../../../timetable/timetable.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, objectId, dateStr, noArgs, summarise, shortDate, wrapAgentTool, resolveEnrollmentId,
  studentIdentitySchema, resolveSection, classIdentitySchema,
} from './_shared.js';
import { classKey } from '../../../../utils/classNames.js';

/** How many exam papers a single class-marks answer summarises. */
const MAX_MARKS_PAPERS = 6;

/**
 * Academic structure, exams, marks, assignments and the timetable.
 *
 * The reads mostly front services that already resolve "whose" from the actor —
 * `timetable.getTimetable()` gives a teacher their own periods and a student
 * their own section — so these tools choose *what* to ask for and leave *whose*
 * to the service, which is where that rule already lives.
 */

export const academicTools = {
  /* ── Structure (reads) ───────────────────────────────── */
  list_classes: {
    module: 'Academics',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'The school\'s grades and class sections, with each section\'s id and class teacher. Use this to turn a class name like "Class 6 A" into the sectionId other tools need. Read-only.',
    inputSchema: { type: 'object', properties: { gradeId: objectId() }, additionalProperties: false },
    permission: 'academics.read',
    minScope: 'ALL',
    service: 'academics.service.listGrades() + listSections()',
    async run(_ctx, args) {
      const [grades, sections] = await Promise.all([
        academics.listGrades(),
        academics.listSections(args.gradeId),
      ]);
      const rows = sections.map((s) => ({
        sectionId: String(s._id),
        name: s.name,
        grade: s.gradeId?.name ?? null,
        gradeId: s.gradeId?._id ? String(s.gradeId._id) : null,
        classTeacherId: s.classTeacherId ? String(s.classTeacherId) : null,
      }));
      const view = summarise(rows, (s) => `${s.grade ?? ''} ${s.name}`.trim(), { limit: 12 });
      return ok(
        { grades: grades.map((g) => ({ gradeId: String(g._id), name: g.name, level: g.level })), sections: rows },
        { speak: `${grades.length} grade(s) and ${rows.length} section(s): ${view.list}.` },
      );
    },
  },

  list_subjects: {
    module: 'Academics',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Every subject configured for the school, and the subject offerings that link a subject to a section and a teacher. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { sectionId: objectId(), termId: objectId() },
      additionalProperties: false,
    },
    permission: 'academics.read',
    minScope: 'ALL',
    service: 'academics.service.listSubjects() + listOfferings()',
    async run(_ctx, args) {
      const filter = { ...(args.sectionId && { sectionId: args.sectionId }), ...(args.termId && { termId: args.termId }) };
      const [subjects, offerings] = await Promise.all([academics.listSubjects(), academics.listOfferings(filter)]);
      const rows = offerings.map((o) => ({
        offeringId: String(o._id),
        subject: o.subjectId?.name ?? null,
        section: o.sectionId?.name ?? null,
        teacher: o.teacherId?.displayName ?? null,
      }));
      return ok(
        { subjects: subjects.map((s) => ({ subjectId: String(s._id), name: s.name })), offerings: rows },
        { speak: `${subjects.length} subject(s), ${rows.length} offering(s).` },
      );
    },
  },

  list_academic_years: {
    module: 'Academics',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Academic years and terms, with which year is current. Use this to get the academicYearId other tools require. Read-only.',
    inputSchema: { type: 'object', properties: { academicYearId: objectId() }, additionalProperties: false },
    permission: 'academics.read',
    minScope: 'ALL',
    service: 'academics.service.listYears() + listTerms()',
    async run(_ctx, args) {
      const years = await academics.listYears();
      const terms = await academics.listTerms(args.academicYearId);
      return ok(
        {
          years: years.map((y) => ({ academicYearId: String(y._id), name: y.name, isCurrent: Boolean(y.isCurrent), startsOn: y.startsOn })),
          terms: terms.map((t) => ({ termId: String(t._id), name: t.name })),
        },
        { speak: `${years.length} academic year(s), ${terms.length} term(s).` },
      );
    },
  },

  get_my_classes: {
    module: 'Academics',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own sections and subject offerings — for a teacher, the classes they teach. Can be narrowed to one of those classes. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...classIdentitySchema,
        sectionId: objectId('One of the caller\'s own sections'),
      },
      additionalProperties: false,
    },
    permission: 'timetable.read',
    service: 'academics.service.getMySections() + getMyOfferings()',
    async run(ctx, args = {}) {
      const [sections, offerings] = await Promise.all([
        academics.getMySections(ctx.actor),
        academics.getMyOfferings(ctx.actor),
      ]);
      let secRows = (sections ?? []).map((s) => ({
        sectionId: String(s._id ?? s.id),
        name: s.name,
        grade: s.gradeId?.name ?? s.grade ?? null,
      }));
      // The section each offering belongs to is kept alongside the row rather
      // than inside it, so narrowing can use it without changing the shape of
      // what this tool has always returned.
      const offAll = (offerings ?? []).map((o) => ({
        sectionId: String(o.sectionId?._id ?? o.sectionId ?? ''),
        row: {
          offeringId: String(o._id ?? o.id),
          subject: o.subjectId?.name ?? null,
          section: o.sectionId?.name ?? null,
        },
      }));

      // Optional narrowing to one class. resolveSection() re-resolves the name
      // or id at the caller's own scope and refuses a class that is not theirs
      // (CLASS_OUT_OF_SCOPE), so this can only ever narrow what
      // getMySections() already returned -- never widen it. Omit both and the
      // answer is exactly what it was before.
      const wanted = (args.className || args.sectionId)
        ? await resolveSection(ctx, { sectionId: args.sectionId, className: args.className })
        : null;
      if (wanted) secRows = secRows.filter((s) => s.sectionId === wanted.sectionId);
      const offRows = (wanted ? offAll.filter((o) => o.sectionId === wanted.sectionId) : offAll).map((o) => o.row);

      const list = () => secRows.map((s) => `${s.grade ?? ''} ${s.name}`.trim()).join(', ');
      return ok(
        { sections: secRows, offerings: offRows },
        {
          speak: secRows.length
            ? (wanted
              ? `${list()}: ${offRows.length} subject(s) you teach there.`
              : `You have ${secRows.length} section(s): ${list()}.`)
            : (wanted
              ? `You are not assigned to ${wanted.label}.`
              : 'No classes are assigned to you.'),
        },
      );
    },
  },

  /* ── Structure (writes) ──────────────────────────────── */
  create_section: {
    module: 'Academics',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create a class section within a grade, optionally assigning a class teacher. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        gradeId: objectId(),
        name: { type: 'string', maxLength: 40, description: 'e.g. "A"' },
        classTeacherId: objectId('Teacher profile id'),
      },
      required: ['gradeId', 'name'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createSection()',
    summarise: (args) => `Create section "${args.name}" in grade ${args.gradeId}`,
    async run(_ctx, args) {
      const section = await academics.createSection(args);
      return action({ type: 'section_created', id: section._id, data: section, speak: `Section ${section.name} created.` });
    },
  },

  update_section: {
    module: 'Academics',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Rename a section or change its class teacher. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: objectId(),
        name: { type: 'string', maxLength: 40 },
        classTeacherId: objectId(),
      },
      required: ['sectionId'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.updateSection()',
    summarise: (args) => `Update section ${args.sectionId}`,
    async run(_ctx, args) {
      const { sectionId, ...updates } = args;
      const section = await academics.updateSection(sectionId, updates);
      return action({ type: 'section_updated', id: sectionId, data: section, speak: 'The section has been updated.' });
    },
  },

  assign_teacher_to_subject: {
    module: 'Academics',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Create a subject offering — the link between a subject, a section, a term and the teacher who teaches it. This is how a teacher is assigned to a class. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: objectId(),
        sectionId: objectId(),
        termId: objectId(),
        teacherId: objectId('Teacher profile id'),
      },
      required: ['subjectId', 'sectionId', 'termId'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'academics.service.createOffering()',
    summarise: (args) => `Assign subject ${args.subjectId} to section ${args.sectionId}${args.teacherId ? ` with teacher ${args.teacherId}` : ''}`,
    async run(_ctx, args) {
      const offering = await academics.createOffering(args);
      return action({ type: 'offering_created', id: offering._id, data: offering, speak: 'The subject offering has been created.' });
    },
  },

  update_subject_offering: {
    module: 'Academics',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Change a subject offering — most often to reassign the teacher. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        offeringId: objectId(),
        teacherId: objectId(),
        isElective: { type: 'boolean' },
        capacity: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['offeringId'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'academics.service.updateOffering()',
    summarise: (args) => `Update subject offering ${args.offeringId}`,
    async run(_ctx, args) {
      const { offeringId, ...updates } = args;
      const offering = await academics.updateOffering(offeringId, updates);
      return action({ type: 'offering_updated', id: offeringId, data: offering, speak: 'The subject offering has been updated.' });
    },
  },

  /* ── Timetable ───────────────────────────────────────── */
  get_timetable: wrapAgentTool('get_timetable', {
    module: 'Timetable',
    description:
      "The timetable for a day. A teacher sees the periods they teach, a student or parent their own section, and a school-wide reader the school. Accepts a weekday name or today/tomorrow/yesterday. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { day: { type: 'string', maxLength: 24, description: 'Weekday name, or today/tomorrow/yesterday' } },
      additionalProperties: false,
    },
    service: 'timetable.service.getTimetable()',
  }),

  upsert_timetable_slot: {
    module: 'Timetable',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Create or replace one timetable period for a section — its day, period number, times and subject offering. Changes what a whole class sees as its schedule, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: objectId(),
        dayOfWeek: { type: 'integer', minimum: 1, maximum: 7, description: '1 = Monday … 7 = Sunday' },
        periodNo: { type: 'integer', minimum: 1, maximum: 12 },
        startTime: { type: 'string', maxLength: 8, description: 'HH:MM' },
        endTime: { type: 'string', maxLength: 8, description: 'HH:MM' },
        subjectOfferingId: objectId('Omit for a break'),
      },
      required: ['sectionId', 'dayOfWeek', 'periodNo', 'startTime', 'endTime'],
      additionalProperties: false,
    },
    permission: 'timetable.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'timetable.service.upsertSlot()',
    summarise: (args) =>
      `Set period ${args.periodNo} (${args.startTime}–${args.endTime}) on day ${args.dayOfWeek} for section ${args.sectionId}`,
    async run(_ctx, args) {
      const slot = await timetable.upsertSlot(args);
      return action({ type: 'timetable_slot_set', id: slot?._id, data: slot, speak: 'The timetable period has been set.' });
    },
  },

  /* ── Exams and marks ─────────────────────────────────── */
  get_results: wrapAgentTool('get_results', {
    module: 'Exams',
    description:
      "Published exam results and the report-card summary for the caller (or their child). Use get_report_card when the user names another student. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { exam: { type: 'string', maxLength: 60, description: 'Exam name, e.g. "Unit Test 1"' } },
      additionalProperties: false,
    },
    service: 'exam.service.getReportCard()',
  }),

  get_report_card: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's report card: subject marks, percentage, grade and GPA for a published exam. Only published results are visible. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        exam: { type: 'string', maxLength: 60 },
      },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.getReportCard()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const card = await exams.getReportCard(ctx.actor, ctx.scope, { enrollmentId, exam: args.exam });
      const s = card.summary;
      return ok(card, {
        speak: s?.percentage != null
          ? `${card.student?.name ?? 'The student'} scored ${s.percentage}%, grade ${s.grade?.label ?? '—'}${s.gpa ? `, GPA ${s.gpa}` : ''}.`
          : 'No results have been published for that student yet.',
      });
    },
  },

  get_class_marks: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "How a whole class performed: every student's marks for the class's exam papers, with the class average, highest and lowest, and how many papers are still unmarked. Name the class, and optionally one subject or exam. This is the class-level answer — for one student's report card use get_report_card. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...classIdentitySchema,
        sectionId: objectId('The class section, when the id is already known'),
        subject: { type: 'string', maxLength: 80, description: 'Narrow to one subject, e.g. "Mathematics"' },
        exam: { type: 'string', maxLength: 60, description: 'Narrow to one exam, e.g. "Unit Test 2"' },
      },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.listExamSubjects() + getMarksGrid()',
    /**
     * Composed from two existing authorized reads rather than a new query.
     *
     * "Show marks for Class 5-A" used to reach get_results, which answers for
     * the CALLER or their child — so a teacher was shown one arbitrary pupil's
     * report card in answer to a question about a class. There was no
     * class-level marks read to route to.
     *
     * listExamSubjects() already narrows a teacher to the papers they
     * personally teach, and getMarksGrid() re-checks ownership per paper
     * (loadOwnedExamSubject) and returns every enrolled student's marks. So
     * the class answer is those two, aggregated — nothing here touches a
     * model, and a paper the caller may not see never enters the total.
     */
    async run(ctx, args) {
      const section = await resolveSection(ctx, { sectionId: args.sectionId, className: args.className });
      if (!section) throw new AppError('Which class? Name it, for example "Class 5 A".', 400, [], 'AGENT_NEEDS_INPUT');

      const papers = await exams.listExamSubjects(ctx.actor, ctx.scope, null);
      const wanted = (papers ?? []).filter((p) => {
        if (classKey(p.class) !== classKey(section.label)) return false;
        if (args.subject && !String(p.subject ?? '').toLowerCase().includes(args.subject.toLowerCase())) return false;
        if (args.exam && !String(p.examName ?? '').toLowerCase().includes(args.exam.toLowerCase())) return false;
        return true;
      });

      if (!wanted.length) {
        const narrowed = [args.subject, args.exam].filter(Boolean).join(', ');
        return ok(
          { class: section.label, subjects: [], papers: 0 },
          {
            speak: narrowed
              ? `No exam papers for ${section.label} match ${narrowed}.`
              : `No exam papers have been set up for ${section.label} yet.`,
          },
        );
      }

      // Bounded: a class answer summarises its papers, it does not dump a term.
      const grids = [];
      for (const paper of wanted.slice(0, MAX_MARKS_PAPERS)) {
        // eslint-disable-next-line no-await-in-loop -- per-paper ownership check
        const grid = await exams.getMarksGrid(ctx.actor, ctx.scope, paper.id);
        const rows = (grid?.rows ?? []).map((r) => ({
          rollNo: r.rollNo ?? null,
          studentName: r.studentName,
          marks: r.marks ?? null,
          gradeLabel: r.gradeLabel ?? null,
          status: r.status ?? 'PENDING',
        }));
        const scored = rows.filter((r) => typeof r.marks === 'number');
        const maxMarks = grid?.examSubject?.maxMarks ?? paper.maxMarks ?? 100;
        const total = scored.reduce((sum, r) => sum + r.marks, 0);
        grids.push({
          subject: paper.subject,
          exam: paper.examName,
          maxMarks,
          students: rows.length,
          marked: scored.length,
          unmarked: rows.length - scored.length,
          averagePct: scored.length ? Math.round((total / (scored.length * maxMarks)) * 100) : null,
          highest: scored.length ? Math.max(...scored.map((r) => r.marks)) : null,
          lowest: scored.length ? Math.min(...scored.map((r) => r.marks)) : null,
          rows,
        });
      }

      const spoken = grids
        .map((g) => {
          if (!g.marked) return `${g.subject} (${g.exam}): no marks entered yet for ${g.students} student(s)`;
          return `${g.subject} (${g.exam}): average ${g.averagePct}%, highest ${g.highest}/${g.maxMarks}, lowest ${g.lowest}/${g.maxMarks}` +
            `${g.unmarked ? `, ${g.unmarked} still unmarked` : ''}`;
        })
        .join('; ');

      return ok(
        { class: section.label, papers: grids.length, ofPapers: wanted.length, subjects: grids },
        { speak: `${section.label} — ${spoken}.` },
      );
    },
  },

  get_marks_grid: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'The mark-entry grid for one exam subject: every enrolled student with the marks recorded so far and the maximum. Use before enter_marks. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { examSubjectId: objectId() },
      required: ['examSubjectId'],
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.getMarksGrid()',
    async run(ctx, args) {
      const grid = await exams.getMarksGrid(ctx.actor, ctx.scope, args.examSubjectId);
      const rows = grid?.rows ?? grid?.students ?? [];
      const entered = rows.filter((r) => r.marks != null).length;
      return ok(grid, { speak: `${rows.length} student(s) in this exam subject; marks entered for ${entered}.` });
    },
  },

  list_exams: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Exams configured for a term, and their exam subjects with maximum marks. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { termId: objectId(), examId: objectId('List the subjects of one exam') },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.listExams() + listExamSubjects()',
    async run(ctx, args) {
      const list = await exams.listExams(args.termId);
      const subjects = args.examId ? await exams.listExamSubjects(ctx.actor, ctx.scope, args.examId) : [];
      return ok(
        {
          exams: list.map((e) => ({ examId: String(e._id), name: e.name, startsOn: e.startsOn })),
          examSubjects: subjects.map((s) => ({
            examSubjectId: String(s._id ?? s.id),
            subject: s.subjectId?.name ?? s.subject ?? null,
            maxMarks: s.maxMarks,
          })),
        },
        { speak: `${list.length} exam(s)${args.examId ? `, ${subjects.length} subject(s) in the one asked about` : ''}.` },
      );
    },
  },

  get_performance_history: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A student's published results across exams over time, for spotting a trend. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { ...studentIdentitySchema },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.getPerformanceHistory()',
    async run(ctx, args) {
      const history = await exams.getPerformanceHistory(ctx.actor, ctx.scope, { studentId: args.studentId });
      const points = history?.exams ?? history?.items ?? [];
      return ok(history, {
        speak: points.length ? `${points.length} published exam result(s) on record.` : 'No published results on record yet.',
      });
    },
  },

  get_performance: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's published marks as they stand — each graded paper with its subject and score. Distinct from get_performance_history, which reports results across years and terms to show a trend. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { ...studentIdentitySchema, enrollmentId: objectId() },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.getPerformance()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      // The service is the authority on who may read this: at OWN scope it
      // checks a teacher against their own sections, and narrows a subject
      // teacher who is not the section's class teacher to the subjects they
      // actually teach there rather than the whole student record.
      const data = await exams.getPerformance(ctx.actor, ctx.scope, { enrollmentId });
      const rows = data?.results ?? data?.subjects ?? data?.marks ?? [];
      const count = Array.isArray(rows) ? rows.length : 0;
      return ok(data, {
        speak: count ? `${count} published result(s) on record.` : 'No published marks are on record yet.',
      });
    },
  },

  create_exam: {
    module: 'Exams',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create an exam within a term. Add exam subjects afterwards with create_exam_subject. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 80 },
        termId: objectId(),
        startsOn: dateStr(),
        endsOn: dateStr(),
      },
      required: ['name', 'termId', 'startsOn', 'endsOn'],
      additionalProperties: false,
    },
    permission: 'exams.manage',
    minScope: 'ALL',
    service: 'exam.service.createExam()',
    summarise: (args) => `Create the exam "${args.name}"`,
    async run(_ctx, args) {
      const exam = await exams.createExam(args);
      return action({ type: 'exam_created', id: exam._id, data: exam, speak: `Exam "${exam.name}" created.` });
    },
  },

  create_exam_subject: {
    module: 'Exams',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add a subject to an exam, with its maximum marks and exam date. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        examId: objectId(),
        subjectOfferingId: objectId(),
        maxMarks: { type: 'integer', minimum: 1, maximum: 1000 },
        examDate: dateStr(),
      },
      required: ['examId', 'subjectOfferingId', 'maxMarks'],
      additionalProperties: false,
    },
    permission: 'exams.manage',
    minScope: 'ALL',
    service: 'exam.service.createExamSubject()',
    summarise: (args) => `Add a subject to exam ${args.examId} worth ${args.maxMarks} marks`,
    async run(_ctx, args) {
      const subject = await exams.createExamSubject(args);
      return action({ type: 'exam_subject_created', id: subject._id, data: subject, speak: 'The exam subject has been added.' });
    },
  },

  enter_marks: {
    module: 'Exams',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      "Record marks for students in one exam subject. Marks stay unpublished until publish_marks, so students do not see them yet. Writes to other people's academic records, so it needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        examSubjectId: objectId(),
        entries: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              enrollmentId: objectId(),
              marks: { type: 'number', minimum: 0 },
            },
            required: ['enrollmentId', 'marks'],
            additionalProperties: false,
          },
        },
      },
      required: ['examSubjectId', 'entries'],
      additionalProperties: false,
    },
    permission: 'marks.enter',
    affectsOthers: true,
    service: 'exam.service.enterMarks()',
    summarise: (args) => `Enter marks for ${args.entries.length} student(s) in exam subject ${args.examSubjectId}`,
    async run(ctx, args) {
      const result = await exams.enterMarks(ctx.actor, ctx.scope, { examSubjectId: args.examSubjectId, entries: args.entries });
      return action({
        type: 'marks_entered',
        data: result,
        speak: `Marks recorded for ${args.entries.length} student(s). They are not published yet.`,
      });
    },
  },

  publish_marks: {
    module: 'Exams',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Publish the marks for one exam subject, making them visible to students and parents. This is what families see, and it is hard to walk back, so it always needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { examSubjectId: objectId() },
      required: ['examSubjectId'],
      additionalProperties: false,
    },
    permission: 'marks.publish',
    affectsOthers: true,
    service: 'exam.service.publishMarks()',
    summarise: (args) => `Publish the marks for exam subject ${args.examSubjectId} to students and parents`,
    async run(ctx, args) {
      const result = await exams.publishMarks(ctx.actor, ctx.scope, args.examSubjectId);
      return action({ type: 'marks_published', id: args.examSubjectId, data: result, speak: 'The marks are now published and visible to families.' });
    },
  },

  /* ── Assignments ─────────────────────────────────────── */
  get_assignments: {
    module: 'Assignments',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Homework and assignments. For a student or parent with no filters, the work still to be submitted, soonest deadline first. For a teacher, the work they have set — narrow it with a subject, a class, or both. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...classIdentitySchema,
        subject: { type: 'string', maxLength: 80, description: 'Narrow to one subject, e.g. "Mathematics"' },
      },
      additionalProperties: false,
    },
    permission: 'assignments.read',
    service: 'assignment.service.list()',
    /**
     * One tool, two honest answers.
     *
     * The old version wrapped an agent tool that filtered on `mySubmission`,
     * which is a STUDENT's question — "what do I still owe". A teacher asking
     * "show Mathematics homework" got that filter applied to their own
     * submissions, so the answer was other subjects' work and nothing they had
     * set. It also declared no arguments at all, so the subject and the class
     * in the question had nowhere to go.
     *
     * assignment.service.list() already scopes a teacher to the offerings they
     * personally teach and returns the subject and section on every row, so
     * filtering is done on that authorized result — never by widening the
     * query. Passing no arguments as a student or parent behaves exactly as
     * before.
     */
    async run(ctx, args) {
      const isFamily = ctx.actor?.roleKey === 'STUDENT' || ctx.actor?.roleKey === 'PARENT';
      const section = args.className || args.sectionId
        ? await resolveSection(ctx, { sectionId: args.sectionId, className: args.className })
        : null;

      const all = await assignments.list(ctx.actor, ctx.scope, {});
      const wantedSubject = args.subject ? String(args.subject).toLowerCase() : null;

      let rows = all;
      if (wantedSubject) rows = rows.filter((a) => String(a.subject ?? '').toLowerCase().includes(wantedSubject));
      if (section) rows = rows.filter((a) => classKey(a.class) === classKey(section.label));

      // A family's unfiltered question is about what is still due; a filtered
      // one, or a teacher's, is about the work itself.
      const pendingOnly = isFamily && !wantedSubject && !section;
      if (pendingOnly) {
        rows = rows.filter((a) => !['SUBMITTED', 'LATE', 'GRADED'].includes(a.mySubmission?.status));
      }

      const ordered = [...rows].sort((a, b) => new Date(a.dueAt ?? 0) - new Date(b.dueAt ?? 0));
      const shown = ordered.slice(0, 10).map((a) => ({
        id: String(a.id),
        title: a.title,
        subject: a.subject,
        class: a.class,
        dueAt: a.dueAt,
        maxMarks: a.maxMarks ?? null,
        submissionCount: a.submissionCount ?? 0,
        ...(isFamily && { status: a.mySubmission?.status ?? 'PENDING' }),
      }));

      const scopeLabel = [args.subject, section?.label].filter(Boolean).join(' for ');
      const view = summarise(shown, (a) => `${a.title} (${a.subject}${a.dueAt ? `, due ${shortDate(a.dueAt)}` : ''})`);

      if (!ordered.length) {
        return ok(
          { assignments: [], count: 0, ...(section && { class: section.label }), ...(args.subject && { subject: args.subject }) },
          { speak: scopeLabel ? `No homework found for ${scopeLabel}.` : (pendingOnly ? 'You have nothing due.' : 'No homework has been set.') },
        );
      }
      return ok(
        {
          assignments: shown,
          count: ordered.length,
          ...(section && { class: section.label }),
          ...(args.subject && { subject: args.subject }),
        },
        {
          speak: `${ordered.length} ${pendingOnly ? 'still to submit' : 'homework item(s)'}${scopeLabel ? ` for ${scopeLabel}` : ''}: ${view.list}${view.more ? ', …' : ''}.`,
        },
      );
    },
  },

  get_submissions: {
    module: 'Assignments',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The submissions for one assignment, with each student\'s status and marks where graded. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { assignmentId: objectId() },
      required: ['assignmentId'],
      additionalProperties: false,
    },
    permission: 'submissions.grade',
    service: 'assignment.service.listSubmissions()',
    async run(ctx, args) {
      const rows = await assignments.listSubmissions(ctx.actor, ctx.scope, args.assignmentId);
      const graded = rows.filter((r) => r.marks != null).length;
      return ok(
        { submissions: rows, count: rows.length, graded, pending: rows.length - graded },
        { speak: `${rows.length} submission(s), ${graded} graded, ${rows.length - graded} still to grade.` },
      );
    },
  },

  create_assignment: {
    module: 'Assignments',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Set an assignment or homework for a class you teach. Every student in that section sees it, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectOfferingId: objectId('The class and subject it is for'),
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        dueAt: dateStr(),
        maxMarks: { type: 'integer', minimum: 1, maximum: 1000 },
        type: { type: 'string', enum: ['HOMEWORK', 'PROJECT', 'WORKSHEET', 'LAB'] },
        chapter: { type: 'string', maxLength: 120 },
      },
      required: ['subjectOfferingId', 'title', 'dueAt'],
      additionalProperties: false,
    },
    permission: 'assignments.manage',
    affectsOthers: true,
    service: 'assignment.service.create()',
    summarise: (args) => `Set "${args.title}" for the class, due ${args.dueAt}`,
    async run(ctx, args) {
      const created = await assignments.create(ctx.actor, ctx.scope, args);
      return action({ type: 'assignment_created', id: created._id, data: created, speak: `"${created.title}" has been set for the class.` });
    },
  },

  generate_homework: wrapAgentTool('generate_homework', {
    module: 'Assignments',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Draft homework with AI for a class you teach and set it. The draft is written before you are asked to confirm, so you approve homework that already exists in full rather than a promise to generate it. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', maxLength: 80 },
        className: { type: 'string', maxLength: 40 },
        topic: { type: 'string', maxLength: 200, description: 'What the homework is about' },
        dueAt: dateStr(),
        maxMarks: { type: 'integer', minimum: 1, maximum: 1000 },
      },
      required: ['topic', 'dueAt'],
      additionalProperties: false,
    },
    service: 'homework.service.draftHomework() + commitHomework()',
  }),

  grade_submission: {
    module: 'Assignments',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Record a mark and feedback against one student's assignment submission. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: objectId(),
        enrollmentId: objectId(),
        marks: { type: 'number', minimum: 0 },
        feedback: { type: 'string', maxLength: 2000 },
      },
      required: ['assignmentId', 'enrollmentId', 'marks'],
      additionalProperties: false,
    },
    permission: 'submissions.grade',
    affectsOthers: true,
    service: 'assignment.service.gradeSubmission()',
    summarise: (args) => `Grade submission for enrolment ${args.enrollmentId} with ${args.marks} mark(s)`,
    async run(ctx, args) {
      const result = await assignments.gradeSubmission(ctx.actor, ctx.scope, args);
      return action({ type: 'submission_graded', data: result, speak: `Graded: ${args.marks} mark(s) recorded.` });
    },
  },

  submit_assignment: {
    module: 'Assignments',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Submit an assignment on the caller's own behalf. Needs confirmation, because a submission is a deadline-bearing act the student should mean to make.",
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: objectId(),
        enrollmentId: objectId('Omit to use the caller\'s own enrolment'),
        attachments: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            // `fileUrl` is the name assignment.service.submit() reads; a
            // web link or an uploaded file path, stored on the submission.
            properties: {
              fileUrl: { type: 'string', maxLength: 500, pattern: '^(https?://|/)' },
              name: { type: 'string', maxLength: 200 },
            },
            required: ['fileUrl'],
            additionalProperties: false,
          },
        },
      },
      required: ['assignmentId'],
      additionalProperties: false,
    },
    permission: 'submissions.submit',
    service: 'assignment.service.submit()',
    summarise: (args) => `Submit assignment ${args.assignmentId}`,
    async run(ctx, args) {
      const enrollmentId = args.enrollmentId ?? (await resolveEnrollmentId(ctx, {}));
      const result = await assignments.submit(ctx.actor, ctx.scope, {
        assignmentId: args.assignmentId,
        enrollmentId,
        attachments: args.attachments ?? [],
      });
      return action({ type: 'assignment_submitted', data: result, speak: 'Your assignment has been submitted.' });
    },
  },

  get_subjects: wrapAgentTool('get_subjects', {
    module: 'Academics',
    description: "The subjects the caller (or their child) studies this year, with the teacher for each. Read-only.",
    service: 'academics.service.getMyOfferings()',
  }),
};
