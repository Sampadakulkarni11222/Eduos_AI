import * as academics from '../../../academics/academics.service.js';
import * as exams from '../../../exams/exam.service.js';
import * as assignments from '../../../assignments/assignment.service.js';
import { resolveOffering } from '../../../assignments/homework.service.js';
import * as timetable from '../../../timetable/timetable.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, objectId, dateStr, noArgs, summarise, shortDate, wrapAgentTool, resolveEnrollmentId,
  studentIdentitySchema, resolveSection, classIdentitySchema, theNamed, resolveStudentId, resolveStudentEnrollment,
} from './_shared.js';
import { classKey } from '../../../../utils/classNames.js';
import {
  resolveGrade, resolveYear, resolveTerm, resolveSubject, resolveStaff, resolveOfferingRef, resolveExam,
} from './_names.js';

/**
 * Structure writes take the record they change by NAME as well as by id.
 *
 * A year, grade, term, class, subject, teacher or exam is named in every
 * sentence anybody types and by an ObjectId nowhere, so requiring one made the
 * capability unreachable from a sentence (the resolver never offers a write whose
 * required id nothing can supply). Each is resolved in prepare() -- before the
 * confirmation -- from the same lists the Academics screen reads, so the person
 * approves "Create term 'Term 2' in 2026-27", not a list of ids, and an unknown
 * or ambiguous name is a question rather than a failed write.
 */
const teacherNameSchema = (description) => ({
  type: 'string',
  maxLength: 80,
  description,
});

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayNumber = (day) => {
  const i = WEEKDAYS.indexOf(String(day ?? '').trim().toLowerCase());
  return i < 0 ? null : i + 1;
};

/** How many exam papers a single class-marks answer summarises. */
const MAX_MARKS_PAPERS = 6;

/** How a person names one exam paper: its class, subject and exam, all in words. */
const examPaperSchema = {
  ...classIdentitySchema,
  subject: { type: 'string', maxLength: 80, description: 'The subject of the paper, e.g. "Mathematics"' },
  exam: { type: 'string', maxLength: 60, description: 'The exam, e.g. "Unit Test 2"' },
};

const paperLabel = (p) => `${p.subject} (${p.examName}) for ${p.class}`;

/**
 * Resolves the exam paper a request names, at the caller's own scope.
 *
 * The marks screen chooses a paper from exams.listExamSubjects() -- for a
 * teacher, only the papers of subjects they personally teach -- so that is the
 * candidate set here too, and a paper outside it cannot be named into reach.
 * An id is passed through untouched: the service's loadOwnedExamSubject()
 * re-checks it on every read and write regardless.
 *
 * Several papers matching is a question, never a choice: entering or
 * publishing marks against the wrong paper is exactly what a family would see.
 */
async function resolveExamPaper(ctx, { examSubjectId, sectionId, className, subject, exam } = {}) {
  if (examSubjectId) return { id: String(examSubjectId), label: null };
  if (!sectionId && !className && !subject && !exam) {
    throw new AppError('Which exam paper? Name the class, the subject and the exam.', 400, [], 'AGENT_NEEDS_INPUT');
  }
  const section = sectionId || className ? await resolveSection(ctx, { sectionId, className }) : null;
  const papers = (await exams.listExamSubjects(ctx.actor, ctx.scope, null)) ?? [];
  const has = (value, wanted) => !wanted || String(value ?? '').toLowerCase().includes(String(wanted).toLowerCase());
  // Either way round for the exam: "Mathematics Unit Test 2" names the paper
  // "Unit Test 2" of Mathematics, as "Unit Test" names it too.
  const hasExam = (name) => !exam || has(name, exam) || has(exam, name);
  const matching = papers.filter((p) =>
    (!section || classKey(p.class) === classKey(section.label)) && has(p.subject, subject) && hasExam(p.examName));

  if (!matching.length) {
    const named = [subject, exam, section?.label].filter(Boolean).join(', ');
    throw new AppError(`None of your exam papers match ${named}.`, 404, [], 'NOT_FOUND');
  }
  if (matching.length > 1) {
    throw new AppError(`Which paper — ${matching.slice(0, 6).map(paperLabel).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return { id: String(matching[0].id), label: paperLabel(matching[0]), class: matching[0].class };
}

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
      const view = summarise(rows, (s) => `${s.grade ?? ''} ${s.name}`.trim());
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
      // One numbered line per class, with the subjects taught there
      // (agent/present.js), rather than every class run into one sentence.
      const subjectsIn = (sectionId) => [...new Set(offAll
        .filter((o) => o.sectionId === sectionId && o.row.subject)
        .map((o) => o.row.subject))].join(', ');
      const view = secRows.length && !wanted
        ? {
          type: 'list.numbered',
          intro: `You have ${secRows.length} ${secRows.length === 1 ? 'class' : 'classes'}:`,
          items: secRows.map((s) => ({ label: `${s.grade ?? ''} ${s.name}`.trim(), detail: subjectsIn(s.sectionId) || null })),
        }
        : null;
      return ok(
        { sections: secRows, offerings: offRows },
        {
          view,
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
        grade: { type: 'string', maxLength: 60, description: 'The grade as a person names it, e.g. "Class 7". Alternative to gradeId.' },
        name: { type: 'string', maxLength: 40, description: 'e.g. "A"' },
        classTeacherId: objectId('Teacher profile id'),
        classTeacher: teacherNameSchema('The class teacher as a person names them. Alternative to classTeacherId.'),
      },
      // The grade is identified by id OR by name (see prepare); neither is
      // required by the schema, because a grade named in words is as good as
      // one named by id and the id cannot be typed.
      required: ['name'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createSection()',
    summarise: (args, _actor, prepared) => `Create section "${prepared?.name ?? args.name}" in ${prepared?.gradeName ?? `grade ${args.gradeId}`}`
      + `${prepared?.classTeacherName ? ` with ${prepared.classTeacherName} as class teacher` : ''}`,
    async prepare(_ctx, args) {
      const grade = await resolveGrade({ gradeId: args.gradeId, grade: args.grade });
      if (!grade) throw new AppError('Which grade is the section in? For example "Class 7".', 400, [], 'AGENT_NEEDS_INPUT');
      const teacher = await resolveStaff('TEACHER', { profileId: args.classTeacherId, name: args.classTeacher });
      // "Section B" names section B: the noun is not part of the name.
      const name = String(args.name).replace(/^(?:section|division|div)\s+/i, '').trim();
      return { gradeId: grade.id, gradeName: grade.name, name, ...(teacher && { classTeacherId: teacher.id, classTeacherName: teacher.name }) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const section = await academics.createSection({
        gradeId: plan.gradeId, name: plan.name, ...(plan.classTeacherId && { classTeacherId: plan.classTeacherId }),
      });
      return action({ type: 'section_created', id: section._id, data: section, speak: `Section ${section.name} created.` });
    },
  },

  // The rest of the structure the Academics page builds one row at a time. The
  // CSV imports beside them stay web-only: MCP has no file channel.
  create_academic_year: {
    module: 'Academics',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create an academic year, e.g. "2027-28", with its start and end dates. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120, description: 'e.g. "2027-28"' },
        startsOn: dateStr(),
        endsOn: dateStr(),
      },
      required: ['name', 'startsOn', 'endsOn'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createYear()',
    summarise: (args) => `Create academic year "${args.name}" (${args.startsOn} to ${args.endsOn})`,
    async run(_ctx, args) {
      const year = await academics.createYear({ name: args.name, startsOn: args.startsOn, endsOn: args.endsOn });
      return action({
        type: 'academic_year_created',
        id: year._id,
        data: { academicYearId: String(year._id), name: year.name },
        speak: `Academic year ${year.name} created.`,
      });
    },
  },

  create_term: {
    module: 'Academics',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create a term inside an academic year, e.g. "Term 1", with its start and end dates. Name the year ("2026-27"), or leave it out for the current one. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        academicYearId: objectId(),
        academicYear: { type: 'string', maxLength: 40, description: 'The year as a person names it, e.g. "2026-27". Omit for the current year.' },
        name: { type: 'string', maxLength: 120, description: 'e.g. "Term 1"' },
        startsOn: dateStr(),
        endsOn: dateStr(),
      },
      required: ['name', 'startsOn', 'endsOn'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createTerm()',
    summarise: (args, _actor, prepared) =>
      `Create term "${args.name}" (${args.startsOn} to ${args.endsOn}) in academic year ${prepared?.yearName ?? args.academicYearId}`
      + `${prepared?.assumed ? ' (the current year)' : ''}`,
    async prepare(_ctx, args) {
      const year = await resolveYear({ academicYearId: args.academicYearId, academicYear: args.academicYear });
      return { academicYearId: year.id, yearName: year.name, assumed: Boolean(year.assumed) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const { academicYear: _named, ...rest } = args;
      const term = await academics.createTerm({ ...rest, academicYearId: plan.academicYearId });
      return action({
        type: 'term_created',
        id: term._id,
        data: { termId: String(term._id), name: term.name, academicYearId: String(term.academicYearId) },
        speak: `Term ${term.name} created.`,
      });
    },
  },

  create_grade: {
    module: 'Academics',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create a grade (a class level such as "Class 5") with its level number, used to order grades. Sections are added to it with create_section. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120, description: 'e.g. "Class 5"' },
        level: { type: 'integer', minimum: 1, maximum: 20, description: 'e.g. 5 for Class 5' },
      },
      required: ['name', 'level'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createGrade()',
    summarise: (args) => `Create grade "${args.name}" at level ${args.level}`,
    async run(_ctx, args) {
      const grade = await academics.createGrade(args);
      return action({
        type: 'grade_created',
        id: grade._id,
        data: { gradeId: String(grade._id), name: grade.name, level: grade.level },
        speak: `Grade ${grade.name} created.`,
      });
    },
  },

  create_subject: {
    module: 'Academics',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add a subject to the school\'s subject list, e.g. "Physics", with an optional short code. Teaching it in a class is a separate step, assign_teacher_to_subject. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120, description: 'e.g. "Physics"' },
        code: { type: 'string', maxLength: 20, description: 'e.g. "PHY"' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.createSubject()',
    summarise: (args) => `Create subject "${args.name}"${args.code ? ` (${args.code})` : ''}`,
    async run(_ctx, args) {
      const subject = await academics.createSubject(args);
      return action({
        type: 'subject_created',
        id: subject._id,
        data: { subjectId: String(subject._id), name: subject.name, code: subject.code ?? null },
        speak: `Subject ${subject.name} created.`,
      });
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
        ...classIdentitySchema,
        name: { type: 'string', maxLength: 40, description: 'A NEW name for the section' },
        classTeacherId: objectId(),
        classTeacher: teacherNameSchema('The new class teacher as a person names them. Alternative to classTeacherId.'),
      },
      // The class is named ("Class 6-B") as it is in every sentence; the id is
      // for a caller that already holds one.
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    service: 'academics.service.updateSection()',
    summarise: (args, _actor, prepared) => {
      const what = [];
      if (prepared?.updates?.classTeacherId) what.push(`its class teacher to ${prepared.classTeacherName}`);
      if (prepared?.updates?.name) what.push(`its name to "${prepared.updates.name}"`);
      return `Change ${what.join(' and ') || 'nothing'} on ${prepared?.label ?? `section ${args.sectionId}`}`;
    },
    async prepare(ctx, args) {
      const section = await resolveSection(ctx, { sectionId: args.sectionId, className: args.className });
      if (!section) throw new AppError('Which class? For example "Class 6-B".', 400, [], 'AGENT_NEEDS_INPUT');
      const teacher = await resolveStaff('TEACHER', { profileId: args.classTeacherId, name: args.classTeacher });
      const updates = {
        ...(args.name !== undefined && { name: String(args.name).replace(/^(?:section|division|div)\s+/i, '').trim() }),
        ...(teacher && { classTeacherId: teacher.id }),
      };
      if (!Object.keys(updates).length) {
        throw new AppError('What should change on that class: its class teacher or its name?', 400, [], 'AGENT_NEEDS_INPUT');
      }
      return { sectionId: section.sectionId, label: section.label, updates, classTeacherName: teacher?.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const sectionId = plan.sectionId;
      const updates = plan.updates;
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
        subject: { type: 'string', maxLength: 80, description: 'The subject as a person names it, e.g. "Science". Alternative to subjectId.' },
        sectionId: objectId(),
        ...classIdentitySchema,
        termId: objectId(),
        term: { type: 'string', maxLength: 60, description: 'The term as a person names it, e.g. "Term 1". Omit for the running term.' },
        teacherId: objectId('Teacher profile id'),
        teacherName: teacherNameSchema('The teacher as a person names them. Alternative to teacherId.'),
      },
      // Each of the three is named or identified: the subject, the class and
      // (by default the running) term. See prepare().
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'academics.service.createOffering()',
    summarise: (args, _actor, prepared) =>
      `Assign ${prepared?.subjectName ?? `subject ${args.subjectId}`} to ${prepared?.label ?? `section ${args.sectionId}`}`
      + `${prepared?.termName ? ` for ${prepared.termName}` : ''}`
      + `${prepared?.teacherName ? ` with ${prepared.teacherName} as the teacher` : ''}`,
    async prepare(ctx, args) {
      const subject = await resolveSubject({ subjectId: args.subjectId, subject: args.subject });
      if (!subject) throw new AppError('Which subject? For example "Science".', 400, [], 'AGENT_NEEDS_INPUT');
      const section = await resolveSection(ctx, { sectionId: args.sectionId, className: args.className });
      if (!section) throw new AppError('Which class? For example "Class 6-A".', 400, [], 'AGENT_NEEDS_INPUT');
      const term = await resolveTerm({ termId: args.termId, term: args.term });
      const teacher = await resolveStaff('TEACHER', { profileId: args.teacherId, name: args.teacherName });
      return {
        subjectId: subject.id, subjectName: subject.name, sectionId: section.sectionId, label: section.label,
        termId: term.id, termName: term.name, ...(teacher && { teacherId: teacher.id, teacherName: teacher.name }),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const offering = await academics.createOffering({
        subjectId: plan.subjectId, sectionId: plan.sectionId, termId: plan.termId, ...(plan.teacherId && { teacherId: plan.teacherId }),
      });
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
        subject: { type: 'string', maxLength: 80, description: 'The subject of the offering as a person names it, e.g. "Art". Identifies the offering with className.' },
        ...classIdentitySchema,
        termId: objectId(),
        term: { type: 'string', maxLength: 60, description: 'The term, when the class teaches the subject in more than one' },
        teacherId: objectId(),
        teacherName: teacherNameSchema('The new teacher as a person names them. Alternative to teacherId.'),
        isElective: { type: 'boolean' },
        capacity: { type: 'integer', minimum: 1, maximum: 500 },
      },
      // The offering is named by its subject and class -- "Art in Class 6-A" --
      // as nobody holds its id.
      additionalProperties: false,
    },
    permission: 'academics.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'academics.service.updateOffering()',
    summarise: (args, _actor, prepared) => {
      const what = [];
      if (prepared?.updates?.teacherId) what.push(`the teacher to ${prepared.teacherName}`);
      if (prepared?.updates?.isElective !== undefined) what.push(prepared.updates.isElective ? 'it to an elective' : 'it to a regular subject');
      if (prepared?.updates?.capacity !== undefined) what.push(`the capacity to ${prepared.updates.capacity}`);
      return `Change ${what.join(', ') || 'nothing'} on ${prepared?.subjectName ?? 'the subject'}${prepared?.label ? ` in ${prepared.label}` : ''}`;
    },
    async prepare(ctx, args) {
      let target;
      if (args.offeringId) {
        target = await resolveOfferingRef({ offeringId: args.offeringId });
      } else {
        const section = await resolveSection(ctx, { className: args.className });
        if (!section) throw new AppError('Which class teaches it? For example "Class 6-A".', 400, [], 'AGENT_NEEDS_INPUT');
        const term = args.termId || args.term ? await resolveTerm({ termId: args.termId, term: args.term }) : null;
        target = await resolveOfferingRef({ subject: args.subject, sectionId: section.sectionId, termId: term?.id });
        target.label = section.label;
      }
      const teacher = await resolveStaff('TEACHER', { profileId: args.teacherId, name: args.teacherName });
      const updates = {
        ...(teacher && { teacherId: teacher.id }),
        ...(args.isElective !== undefined && { isElective: args.isElective }),
        ...(args.capacity !== undefined && { capacity: args.capacity }),
      };
      if (!Object.keys(updates).length) {
        throw new AppError('What should change: the teacher, whether it is an elective, or its capacity?', 400, [], 'AGENT_NEEDS_INPUT');
      }
      return { offeringId: target.id, subjectName: target.subject, label: target.label, updates, teacherName: teacher?.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const offeringId = plan.offeringId;
      const updates = plan.updates;
      const offering = await academics.updateOffering(offeringId, updates);
      return action({ type: 'offering_updated', id: offeringId, data: offering, speak: 'The subject offering has been updated.' });
    },
  },

  /* ── Timetable ───────────────────────────────────────── */
  get_timetable: wrapAgentTool('get_timetable', {
    module: 'Timetable',
    description:
      'The timetable for a day or the whole week, with the subject and the teacher for each period. Name a class to see that class alone; without one, a teacher sees the periods they teach, a student or parent their own section, and a school-wide reader the school. Accepts a weekday name, today/tomorrow/yesterday, or "week" for the weekly timetable. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        day: { type: 'string', maxLength: 24, description: 'Weekday name, today/tomorrow/yesterday, or "week" for the whole week' },
        ...classIdentitySchema,
        sectionId: objectId('The class section, when the id is already known'),
      },
      additionalProperties: false,
    },
    // The class is resolved to a section at the caller's own scope before the
    // agent tool runs, so a class they do not teach is refused by name rather
    // than quietly widened to everything they can see.
    resolveClass: true,
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
        ...classIdentitySchema,
        dayOfWeek: { type: 'integer', minimum: 1, maximum: 7, description: '1 = Monday … 7 = Sunday' },
        day: { type: 'string', maxLength: 12, description: 'The weekday by name, e.g. "Monday". Alternative to dayOfWeek.' },
        periodNo: { type: 'integer', minimum: 1, maximum: 12 },
        startTime: { type: 'string', maxLength: 8, description: 'HH:MM' },
        endTime: { type: 'string', maxLength: 8, description: 'HH:MM' },
        subjectOfferingId: objectId('Omit for a break'),
        subject: { type: 'string', maxLength: 80, description: 'The subject taught in the period, e.g. "Mathematics". Omit for a break.' },
      },
      // The class, the day and the subject are named in words; see prepare().
      required: ['periodNo', 'startTime', 'endTime'],
      additionalProperties: false,
    },
    permission: 'timetable.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'timetable.service.upsertSlot()',
    summarise: (args, _actor, prepared) =>
      `Set ${prepared?.subjectName ?? 'a break'} in period ${args.periodNo} (${args.startTime}–${args.endTime}) on `
      + `${WEEKDAYS[(prepared?.dayOfWeek ?? args.dayOfWeek) - 1] ?? `day ${args.dayOfWeek}`} for ${prepared?.label ?? `section ${args.sectionId}`}`,
    async prepare(ctx, args) {
      const section = await resolveSection(ctx, { sectionId: args.sectionId, className: args.className });
      if (!section) throw new AppError('Which class? For example "Class 6-A".', 400, [], 'AGENT_NEEDS_INPUT');
      const dayOfWeek = args.dayOfWeek ?? dayNumber(args.day);
      if (!dayOfWeek) throw new AppError('Which day? For example "Monday".', 400, [], 'AGENT_NEEDS_INPUT');
      let offering = null;
      if (args.subjectOfferingId || args.subject) {
        offering = await resolveOfferingRef({
          offeringId: args.subjectOfferingId, subject: args.subject, sectionId: section.sectionId,
        });
      }
      return {
        sectionId: section.sectionId, label: section.label, dayOfWeek,
        ...(offering && { subjectOfferingId: offering.id, subjectName: offering.subject }),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const slot = await timetable.upsertSlot({
        sectionId: plan.sectionId,
        dayOfWeek: plan.dayOfWeek,
        periodNo: args.periodNo,
        startTime: args.startTime,
        endTime: args.endTime,
        ...(plan.subjectOfferingId && { subjectOfferingId: plan.subjectOfferingId }),
      });
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
        subject: { type: 'string', maxLength: 80, description: 'Narrow to one subject, e.g. "Mathematics"' },
      },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'exam.service.getReportCard()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      const card = await exams.getReportCard(ctx.actor, ctx.scope, { enrollmentId, exam: args.exam });
      // One subject asked for: the same authorized report card, narrowed to
      // that subject's rows. "My Mathematics marks" is a question about those
      // rows; the overall percentage answers something else, and the class
      // marks sheet -- where it used to go -- is not a student's to read.
      if (args.subject) {
        const wanted = String(args.subject).toLowerCase();
        const rows = (card.subjects ?? []).filter((r) => String(r.subject ?? '').toLowerCase().includes(wanted));
        return ok({ ...card, subjects: rows, subject: args.subject }, {
          speak: rows.length
            ? `${args.subject}: ${rows.map((r) => `${r.exam ? `${r.exam} ` : ''}${r.marks ?? '—'}/${r.maxMarks ?? '—'}`).join('; ')}.`
            : `No published ${args.subject} results yet.`,
        });
      }
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
    // A class's sheet: nobody without a class of their own can be answered.
    requiresClass: true,
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
      // The student NAMED, resolved at the caller's own scope. Passing only
      // `studentId` dropped a name or admission number on the floor, and the
      // service -- given nobody -- answered about the caller: "Rahul's
      // history" came back as the asking student's own.
      const studentId = args.studentId || args.studentName || args.admissionNo
        ? await resolveStudentId(ctx, args)
        : undefined;
      const history = await exams.getPerformanceHistory(ctx.actor, ctx.scope, { studentId });
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
        term: { type: 'string', maxLength: 60, description: 'The term as a person names it, e.g. "Term 1". Omit for the running term.' },
        startsOn: dateStr(),
        endsOn: dateStr(),
      },
      required: ['name', 'startsOn', 'endsOn'],
      additionalProperties: false,
    },
    permission: 'exams.manage',
    minScope: 'ALL',
    service: 'exam.service.createExam()',
    summarise: (args, _actor, prepared) =>
      `Create the exam "${args.name}" in ${prepared?.termName ?? 'the term'} (${args.startsOn} to ${args.endsOn})`,
    async prepare(_ctx, args) {
      const term = await resolveTerm({ termId: args.termId, term: args.term });
      return { termId: term.id, termName: term.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const { term: _named, ...rest } = args;
      const exam = await exams.createExam({ ...rest, termId: plan.termId });
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
        exam: { type: 'string', maxLength: 80, description: 'The exam as a person names it, e.g. "Half Yearly". Alternative to examId.' },
        subjectOfferingId: objectId(),
        subject: { type: 'string', maxLength: 80, description: 'The subject of the paper, e.g. "Mathematics". With className, alternative to subjectOfferingId.' },
        ...classIdentitySchema,
        maxMarks: { type: 'integer', minimum: 1, maximum: 1000 },
        examDate: dateStr(),
      },
      // The exam and the paper's subject-and-class are named; see prepare().
      required: ['maxMarks'],
      additionalProperties: false,
    },
    permission: 'exams.manage',
    minScope: 'ALL',
    service: 'exam.service.createExamSubject()',
    summarise: (args, _actor, prepared) =>
      `Add ${prepared?.subjectName ?? 'a subject'}${prepared?.label ? ` for ${prepared.label}` : ''} to the exam `
      + `${prepared?.examName ? `"${prepared.examName}"` : args.examId} worth ${args.maxMarks} marks`,
    async prepare(ctx, args) {
      const exam = await resolveExam({ examId: args.examId, exam: args.exam });
      if (!exam) throw new AppError('Which exam? For example "Half Yearly".', 400, [], 'AGENT_NEEDS_INPUT');
      let offering;
      let label = null;
      if (args.subjectOfferingId) {
        offering = await resolveOfferingRef({ offeringId: args.subjectOfferingId });
      } else {
        const section = await resolveSection(ctx, { className: args.className });
        if (!section) throw new AppError('Which class is the paper for? For example "Class 6-A".', 400, [], 'AGENT_NEEDS_INPUT');
        offering = await resolveOfferingRef({ subject: args.subject, sectionId: section.sectionId });
        label = section.label;
      }
      return { examId: exam.id, examName: exam.name, subjectOfferingId: offering.id, subjectName: offering.subject, label };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const subject = await exams.createExamSubject({
        examId: plan.examId,
        subjectOfferingId: plan.subjectOfferingId,
        maxMarks: args.maxMarks,
        ...(args.examDate && { examDate: args.examDate }),
      });
      return action({ type: 'exam_subject_created', id: subject._id, data: subject, speak: 'The exam subject has been added.' });
    },
  },

  enter_marks: {
    module: 'Exams',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      "Record, enter, submit or update marks for students in one exam paper. Name the paper by class, subject and exam, and each student by name or admission number with their marks; re-entering a student's marks updates them. Marks stay unpublished until publish_marks, so students do not see them yet, and marks already published cannot be changed. Writes to other people's academic records, so it needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        examSubjectId: objectId('The exam paper, when the id is already known'),
        ...examPaperSchema,
        students: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          description: 'Students named directly, each with their marks',
          items: {
            type: 'object',
            properties: {
              studentId: objectId(),
              admissionNo: { type: 'string', maxLength: 40 },
              studentName: { type: 'string', maxLength: 80, description: 'An ambiguous name is refused, never guessed' },
              marks: { type: 'number', minimum: 0 },
            },
            required: ['marks'],
            additionalProperties: false,
          },
        },
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
      additionalProperties: false,
    },
    permission: 'marks.enter',
    affectsOthers: true,
    service: 'exam.service.enterMarks()',
    summarise: (args, _actor, prepared) => {
      const plan = prepared ?? { entries: args.entries ?? [], names: [] };
      const who = plan.names?.length ? `: ${plan.names.join(', ')}` : '';
      return `Enter marks for ${plan.entries.length} student(s) in ${plan.label ?? `exam subject ${plan.examSubjectId ?? args.examSubjectId}`}${who}`;
    },
    /**
     * Resolves the paper and the students before anything is proposed, so the
     * confirmation names them. Students are resolved at the caller's own
     * students.read scope (resolveStudentEnrollment) and must be in the
     * paper's class; enterMarks() re-checks both the paper's ownership and
     * each enrolment at execution time.
     */
    async prepare(ctx, args) {
      if (args.students && args.entries) {
        throw new AppError('Give either named students or enrolment entries, not both.', 400);
      }
      const paper = await resolveExamPaper(ctx, args);
      if (args.entries?.length) {
        return { examSubjectId: paper.id, label: paper.label, entries: args.entries, names: [] };
      }
      if (!args.students?.length) {
        throw new AppError('Whose marks, and how many? For example "Rahul Sharma 41, Priya Verma 38".', 400, [], 'AGENT_NEEDS_INPUT');
      }
      const resolved = [];
      for (const { marks, ...ident } of args.students) {
        const found = await resolveStudentEnrollment(ctx, ident);
        if (paper.class && classKey(found.class) !== classKey(paper.class)) {
          throw new AppError(`${found.name} is not in ${paper.class}.`, 400, [], 'AGENT_NEEDS_INPUT');
        }
        resolved.push({ enrollmentId: found.enrollmentId, marks, name: found.name });
      }
      return {
        examSubjectId: paper.id,
        label: paper.label,
        entries: resolved.map(({ enrollmentId, marks }) => ({ enrollmentId, marks })),
        names: resolved.map((r) => `${r.name} ${r.marks}`),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await exams.enterMarks(ctx.actor, ctx.scope, { examSubjectId: plan.examSubjectId, entries: plan.entries });
      return action({
        type: 'marks_entered',
        id: plan.examSubjectId,
        data: result,
        speak: `Marks recorded for ${plan.entries.length} student(s)${plan.label ? ` in ${plan.label}` : ''}. They are not published yet.`,
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
      properties: { examSubjectId: objectId('The exam paper, when the id is already known'), ...examPaperSchema },
      additionalProperties: false,
    },
    permission: 'marks.publish',
    affectsOthers: true,
    service: 'exam.service.publishMarks()',
    summarise: (args, _actor, prepared) =>
      `Publish the marks for ${prepared?.label ?? `exam subject ${prepared?.examSubjectId ?? args.examSubjectId}`} to students and parents`,
    /** Which paper, resolved before the proposal so the confirmation names it. */
    async prepare(ctx, args) {
      const paper = await resolveExamPaper(ctx, args);
      return { examSubjectId: paper.id, label: paper.label };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await exams.publishMarks(ctx.actor, ctx.scope, plan.examSubjectId);
      return action({ type: 'marks_published', id: plan.examSubjectId, data: result, speak: 'The marks are now published and visible to families.' });
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
        status: {
          type: 'string',
          enum: ['PENDING', 'SUBMITTED', 'ALL'],
          description: 'For a student or parent: their work still to submit (PENDING), already handed in (SUBMITTED), or both',
        },
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
      // one, or a teacher's, is about the work itself. A status asked for is a
      // filter over the same rows: "my SUBMITTED assignments" used to be
      // answered with the ones still due, which is the opposite set.
      const handedIn = (a) => ['SUBMITTED', 'LATE', 'GRADED'].includes(a.mySubmission?.status);
      const pendingOnly = isFamily && (args.status === 'PENDING' || (!args.status && !wantedSubject && !section));
      if (pendingOnly) rows = rows.filter((a) => !handedIn(a));
      if (isFamily && args.status === 'SUBMITTED') rows = rows.filter(handedIn);

      const ordered = [...rows].sort((a, b) => new Date(a.dueAt ?? 0) - new Date(b.dueAt ?? 0));
      // Every assignment in scope; "Read more" keeps a long list readable.
      const shown = ordered.map((a) => ({
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
          {
            speak: scopeLabel
              ? `No homework found for ${scopeLabel}.`
              : (pendingOnly ? 'You have nothing due.' : args.status === 'SUBMITTED' ? 'Nothing has been submitted yet.' : 'No homework has been set.'),
          },
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
          speak: `${ordered.length} ${pendingOnly ? 'still to submit' : isFamily && args.status === 'SUBMITTED' ? 'submitted' : 'homework item(s)'}${scopeLabel ? ` for ${scopeLabel}` : ''}: ${view.list}${view.more ? ', …' : ''}.`,
          // A table (agent/present.js). The class is shown whenever the rows
          // span more than one: "Chapter 1 Assignment" four times over was
          // four different classes, indistinguishable in a sentence.
          view: {
            type: 'assignments.list',
            audience: isFamily ? 'family' : 'staff',
            kind: pendingOnly ? 'pending' : isFamily && args.status === 'SUBMITTED' ? 'submitted' : 'all',
            scope: scopeLabel || null,
            total: ordered.length,
            showClass: !isFamily && new Set(shown.map((a) => a.class)).size > 1,
            items: shown.map((a) => ({
              title: a.title,
              subject: a.subject ?? null,
              class: a.class ?? null,
              dueAt: a.dueAt ? new Date(a.dueAt).toISOString().slice(0, 10) : null,
              submissions: isFamily ? null : (a.submissionCount ?? 0),
              status: isFamily ? (a.status ?? 'PENDING') : null,
            })),
          },
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
      'Set an assignment or homework for a class. Identify the class and subject by name -- "Mathematics" for "Class 5-A" -- or by subjectOfferingId when you have one. Every student in that section sees it, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectOfferingId: objectId('The class and subject it is for, when known'),
        ...classIdentitySchema,
        subject: { type: 'string', maxLength: 80, description: 'The subject, as a person names it, e.g. "Mathematics"' },
        title: { type: 'string', maxLength: 200, description: 'What the work is -- the task, or its topic' },
        description: { type: 'string', maxLength: 4000 },
        dueAt: dateStr('When it must be handed in'),
        maxMarks: { type: 'integer', minimum: 1, maximum: 1000 },
        type: { type: 'string', enum: ['HOMEWORK', 'PROJECT', 'WORKSHEET', 'LAB'] },
        chapter: { type: 'string', maxLength: 120 },
      },
      // subjectOfferingId is no longer required: nobody types an ObjectId, and
      // requiring one made the capability unreachable from a sentence -- which
      // is how "create Mathematics homework for Class 5-A" reached the AI
      // DRAFTING tool instead of the one that simply sets the work. The class
      // and subject are resolved below, at the caller's own scope, exactly as
      // the Web's own offering picker is filtered.
      required: ['title', 'dueAt'],
      additionalProperties: false,
    },
    permission: 'assignments.manage',
    affectsOthers: true,
    service: 'homework.service.resolveOffering() + assignment.service.create()',
    summarise: (args, _actor, prepared) => {
      const offering = prepared?.offering;
      const subject = offering?.subject ?? args.subject;
      const className = offering?.className ?? args.className;
      return `Set "${args.title}"${subject ? ` (${subject})` : ''}`
        + `${className ? ` for ${className}` : ' for the class'}, due ${args.dueAt}`;
    },
    /**
     * Which class and subject, resolved BEFORE the proposal -- the same set the
     * Web's offering picker shows. Without it a teacher was asked to confirm
     * homework for a class they do not teach and refused only after saying
     * yes; nothing was written, but a confirmation is a promise the system
     * can keep, and that one could not.
     */
    async prepare(ctx, args) {
      const { className, subject, subjectOfferingId } = args ?? {};
      return { offering: await resolveOffering(ctx.actor, ctx.scope, { subjectOfferingId, subject, className }) };
    },
    async run(ctx, args, prepared) {
      const { className, subject, subjectOfferingId, ...rest } = args;
      // Resolved at ctx.scope: a teacher reaches only the classes they teach,
      // an administrator holding assignments.manage school-wide reaches any
      // offering in their school, and an ambiguous or unknown pair is asked
      // about rather than guessed at. Resolved again at execution, by the id
      // the proposal fixed, so a class lost between proposal and yes is refused.
      const offering = await resolveOffering(ctx.actor, ctx.scope, prepared?.offering?.id
        ? { subjectOfferingId: prepared.offering.id }
        : { subjectOfferingId, subject, className });
      const created = await assignments.create(ctx.actor, ctx.scope, { ...rest, subjectOfferingId: offering.id });
      return action({
        type: 'assignment_created',
        id: created._id,
        data: created,
        speak: `"${created.title}" has been set for ${offering.className} ${offering.subject}.`,
      });
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
    description: "Grade one student's assignment submission: record a mark and optional feedback. Name the student, and the assignment by its title or subject when they have submitted more than one. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: objectId('The assignment, when the id is already known'),
        enrollmentId: objectId("The student's enrolment, when the id is already known"),
        ...studentIdentitySchema,
        title: { type: 'string', maxLength: 200, description: 'The assignment as a person names it, e.g. "Fractions worksheet"' },
        subject: { type: 'string', maxLength: 80, description: 'The subject of the assignment, e.g. "Mathematics"' },
        marks: { type: 'number', minimum: 0 },
        feedback: { type: 'string', maxLength: 2000 },
      },
      required: ['marks'],
      additionalProperties: false,
    },
    permission: 'submissions.grade',
    affectsOthers: true,
    service: 'assignment.service.gradeSubmission()',
    summarise: (args, _actor, prepared) => prepared?.label
      ? `Grade ${prepared.label} with ${args.marks} mark(s)${args.feedback ? ` and the feedback "${args.feedback}"` : ''}`
      : `Grade submission for enrolment ${args.enrollmentId} with ${args.marks} mark(s)`,
    /**
     * Which student and which assignment, resolved before the proposal -- the
     * grading screen's own candidates. The student is resolved at the caller's
     * students.read scope; the assignment from assignment.service.list(), which
     * for a teacher is only work they set, narrowed to the student's class and
     * to a title or subject when named. Several candidates are a question,
     * never a choice. gradeSubmission() re-checks ownership, enrolment and
     * that work was actually submitted, when it runs.
     */
    async prepare(ctx, args) {
      if (args.assignmentId && args.enrollmentId) return { assignmentId: args.assignmentId, enrollmentId: args.enrollmentId, label: null };
      const student = args.enrollmentId
        ? { enrollmentId: args.enrollmentId, name: null, sectionId: null }
        : await resolveStudentEnrollment(ctx, { studentId: args.studentId, admissionNo: args.admissionNo, studentName: args.studentName });
      let assignmentId = args.assignmentId ?? null;
      let title = null;
      if (!assignmentId) {
        // Every word the person used to name the work narrows it, whether it
        // is in the title or the subject -- "the Fractions worksheet" is read
        // as a subject by one reader and a title by another -- and the
        // student's own name, which rides along in "Priya's worksheet", is
        // not a word about the work.
        const nameWords = new Set(String(student.name ?? args.studentName ?? '').toLowerCase().split(/\s+/));
        const words = [args.title, args.subject].filter(Boolean).join(' ').toLowerCase()
          .replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 2 && !nameWords.has(w) && !['submission', 'assignment', 'homework', 'the', 'for'].includes(w));
        const candidates = (await assignments.list(ctx.actor, ctx.scope, {}))
          .filter((a) => !student.sectionId || String(a.sectionId) === String(student.sectionId))
          .filter((a) => words.every((w) => `${a.title} ${a.subject}`.toLowerCase().includes(w)));
        if (!candidates.length) {
          throw new AppError(`None of your assignments${student.name ? ` for ${student.name}'s class` : ''} match that.`, 404, [], 'NOT_FOUND');
        }
        if (candidates.length > 1) {
          throw new AppError(`Which assignment — ${candidates.slice(0, 6).map((a) => `${a.title} (${a.subject})`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
        }
        assignmentId = String(candidates[0].id);
        title = candidates[0].title;
      }
      return {
        assignmentId: String(assignmentId),
        enrollmentId: String(student.enrollmentId),
        label: `${student.name ?? 'the student'}'s submission${title ? ` for "${title}"` : ''}`,
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await assignments.gradeSubmission(ctx.actor, ctx.scope, {
        assignmentId: plan.assignmentId, enrollmentId: plan.enrollmentId, marks: args.marks, feedback: args.feedback,
      });
      return action({ type: 'submission_graded', data: result, speak: `Graded: ${args.marks} mark(s) recorded.` });
    },
  },

  submit_assignment: {
    module: 'Assignments',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Submit one of the caller's own assignments. Name it by its subject or title, e.g. \"my Mathematics assignment\"; with only one still to submit, no name is needed. Needs confirmation, because a submission is a deadline-bearing act the student should mean to make.",
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: objectId('Omit it and name the subject or title instead'),
        subject: { type: 'string', maxLength: 80, description: 'The subject, e.g. "Mathematics"' },
        title: { type: 'string', maxLength: 200, description: 'The assignment title, when the subject has several' },
        // The work itself, as a link -- what a conversation can carry. A file
        // is uploaded on the Assignments page; the service accepts either.
        link: { type: 'string', maxLength: 500, pattern: '^https?://', description: 'A link to the work, e.g. a Google Drive link' },
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
      // A student says "submit my Mathematics assignment", never an id -- and
      // requiring one made the capability unreachable from a sentence.
      additionalProperties: false,
    },
    permission: 'submissions.submit',
    service: 'assignment.service.list() + submit()',
    summarise: (args, _actor, prepared) => (prepared?.title
      ? `Submit "${prepared.title}"${prepared.subject ? ` (${prepared.subject})` : ''}`
      : `Submit assignment ${args.assignmentId ?? args.title ?? args.subject ?? ''}`.trim()),
    /**
     * Which assignment, from the caller's OWN list -- the same
     * assignment.service.list() the Assignments page reads, at the caller's
     * scope, so a subject or title can only ever reach work set for them.
     * Only work not yet handed in is a candidate; more than one match is asked
     * about, never guessed.
     */
    async prepare(ctx, args) {
      // The service refuses an empty submission ("attach a file or paste a
      // link"), so a submission with nothing in it is asked about BEFORE it is
      // proposed -- never confirmed and then refused.
      if (!(args.attachments ?? []).length && !args.link) {
        throw new AppError(
          'Paste a link to your work (for example a Google Drive link) and I\'ll submit it — or upload the file on the Assignments page.',
          400, [], 'AGENT_NEEDS_INPUT',
        );
      }
      if (args.assignmentId) return { assignmentId: String(args.assignmentId), title: null, subject: null };
      const mine = await assignments.list(ctx.actor, ctx.scope, {});
      const open = (mine ?? []).filter((a) => !['SUBMITTED', 'LATE', 'GRADED'].includes(a.mySubmission?.status));
      const describe = (a) => `${a.title} (${a.subject})`;
      // Resubmitting REPLACES the attachments (assignment.service.submit
      // upserts them), and a conversation carries no file -- so work already
      // handed in is never resubmitted from here with nothing attached. That
      // would erase what the student uploaded and call it a change.
      const handedIn = (mine ?? []).filter((a) => ['SUBMITTED', 'LATE'].includes(a.mySubmission?.status));
      const alreadyIn = (rows) => {
        if (rows.length) {
          throw new AppError(
            `"${rows[0].title}" is already submitted. To change it, replace the file on the Assignments page — resubmitting from here would replace what you uploaded.`,
            409, [], 'ALREADY_SUBMITTED',
          );
        }
      };
      const oneOf = (rows, what) => {
        if (!rows.length) throw new AppError(`You have no ${what}still to submit.`, 404, [], 'NOTHING_TO_SUBMIT');
        if (rows.length > 1) {
          throw new AppError(
            `You have ${rows.length} ${what}still to submit: ${rows.slice(0, 5).map(describe).join(', ')}. Which one?`,
            400, [], 'AGENT_NEEDS_INPUT',
          );
        }
        return rows[0];
      };
      let found;
      if (args.title) {
        const named = (a) => String(a.title ?? '').toLowerCase().includes(String(args.title).toLowerCase());
        if (!open.some(named)) alreadyIn(handedIn.filter(named));
        found = theNamed(open, args.title, { label: 'assignment still to submit', nameOf: (a) => a.title, describe });
      } else if (args.subject) {
        const wanted = String(args.subject).toLowerCase();
        const ofSubject = (a) => String(a.subject ?? '').toLowerCase().includes(wanted);
        if (!open.some(ofSubject)) alreadyIn(handedIn.filter(ofSubject));
        found = oneOf(open.filter(ofSubject), `${args.subject} assignment(s) `);
      } else {
        found = oneOf(open, 'assignment(s) ');
      }
      return { assignmentId: String(found.id), title: found.title, subject: found.subject };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const enrollmentId = args.enrollmentId ?? (await resolveEnrollmentId(ctx, {}));
      const result = await assignments.submit(ctx.actor, ctx.scope, {
        assignmentId: plan.assignmentId,
        enrollmentId,
        attachments: [
          ...(args.attachments ?? []),
          ...(args.link ? [{ fileUrl: args.link, name: 'Link' }] : []),
        ],
      });
      return action({
        type: 'assignment_submitted',
        id: plan.assignmentId,
        data: result,
        speak: `Your assignment${plan.title ? ` "${plan.title}"` : ''} has been submitted.`,
      });
    },
  },

  get_subjects: wrapAgentTool('get_subjects', {
    module: 'Academics',
    description: "The subjects the caller (or their child) studies this year, with the teacher for each. Read-only.",
    service: 'academics.service.getMyOfferings()',
  }),
};
