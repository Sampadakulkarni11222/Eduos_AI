import * as students from '../../../students/student.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { applyFieldAllowList } from '../validate.js';
import {
  RISK, objectId, resolveStudentId, studentIdentitySchema, summarise,
} from './_shared.js';

/**
 * Student and enrolment tools.
 *
 * The security note that governs this file: `student.service.update()` is
 * `Object.assign(student, updates)` and takes no actor or scope, so whatever
 * reaches it is written and nothing below it checks anything. It is safe
 * behind the REST route because `requirePermission('students.manage')` stands
 * in front. Reached from an assistant, the same function would let a model
 * write `status`, `admissionNo`, `deletedAt` or `tenantId`.
 *
 * So `update_student` here does two things the REST layer does not: it
 * enforces the permission itself, and it narrows the patch to an explicit
 * allow-list of fields a person may reasonably correct in conversation.
 * Everything else is refused out loud — silently dropping a field would mean
 * telling somebody their change was made when it was not.
 */

/**
 * Fields the assistant may change on a student record.
 *
 * Chosen to match the fields the school's own profile-correction workflow
 * already treats as amendable (`studentRequests/profileEdit.service.js`), so
 * the assistant cannot reach further than the request form a student fills in.
 * Deliberately excluded: `admissionNo` (the school's identifier for this
 * person), `status`/`deletedAt` (enrolment lifecycle, which has its own tools
 * with their own audit trail), `profileId`/`leadId`/`tenantId` (system links),
 * `anonymisedAt` (erasure state), and `photoUrl` (an upload, not a value).
 */
export const STUDENT_UPDATE_ALLOW_LIST = ['firstName', 'lastName', 'dob', 'gender', 'address'];

const ENROLLMENT_STATUSES = ['ACTIVE', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED'];

/** Sections get_student_overview can return, and the ones it returns by default. */
const OVERVIEW_SECTIONS = ['profile', 'personal', 'guardians', 'attendance', 'performance', 'assignments', 'medical'];
const DEFAULT_OVERVIEW = ['profile', 'attendance', 'performance'];

/** The fields each overview section may carry. Anything else a service returns stays behind. */
const ATTENDANCE_FIELDS = ['yearMonth', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY', 'workingDays', 'pctPresent'];
const RESULT_FIELDS = ['exam', 'examDate', 'termName', 'academicYearName', 'subject', 'marks', 'maxMarks', 'pct'];
const ASSIGNMENT_FIELDS = ['id', 'title', 'subject', 'dueAt', 'status', 'marks', 'maxMarks'];
const MEDICAL_FIELDS = ['bloodGroup', 'heightCm', 'weightKg', 'allergies', 'medications', 'emergencyContact', 'history', 'updatedAt'];

/** A copy of `obj` carrying only `fields`; a missing object stays null. */
function pick(obj, fields) {
  if (!obj) return null;
  return Object.fromEntries(fields.filter((f) => obj[f] !== undefined).map((f) => [f, obj[f]]));
}

export const studentTools = {
  search_students: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Find students by name, admission number or class. Use this first whenever the user names a student but you do not have their id. Returns each match with class, roll number, student id and enrolment id. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 80, description: 'Name, admission number or class, e.g. "Rahul", "OAK-12", "Class 6 A"' },
        sectionId: objectId('Restrict to one section'),
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    permission: 'students.read',
    service: 'student.service.list()',
    async run(ctx, args) {
      const page = await students.list(ctx.actor, ctx.scope, {
        search: args.query,
        ...(args.sectionId && { sectionId: args.sectionId }),
        page: 1,
        pageSize: Math.min(Number(args.limit) || 20, 50),
      });
      const items = page.items ?? [];
      // Minimised on purpose: a search result is a way to pick a student, not a
      // way to read their file. Date of birth, address and guardian contact
      // stay behind get_student, whose read is audited.
      const rows = items.map((s) => ({
        studentId: s.id,
        admissionNo: s.admissionNo,
        name: s.name,
        class: s.enrollment?.class ?? null,
        rollNo: s.enrollment?.rollNo ?? null,
        enrollmentId: s.enrollment?.id ?? null,
      }));
      const view = summarise(rows, (s) => `${s.name}${s.class ? ` (${s.class})` : ''}`);
      return ok(
        { students: rows, total: page.total ?? rows.length, returned: rows.length },
        {
          speak: rows.length
            ? `Found ${page.total ?? rows.length} student(s) matching "${args.query}": ${view.list}.`
            : `No students match "${args.query}".`,
        },
      );
    },
  },

  get_student: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "One student's record: name, admission number, class, roll number and enrolment status. Identify the student by id, admission number or name. Reading this is recorded as a personal-data access. Read-only.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'students.read',
    service: 'student.service.getById() + listEnrollments()',
    async run(ctx, args) {
      const id = await resolveStudentId(ctx, args);
      if (!id) throw new AppError('Name a student — by id, admission number or name.', 400);
      // Audited inside the service: this is a personal-data read, recorded at
      // that single choke point rather than here.
      const student = await students.getById(ctx.actor, ctx.scope, id, { via: 'mcp.get_student' });
      const enrolments = await students.listEnrollments({ studentId: student._id });
      const active = enrolments.find((e) => e.status === 'ACTIVE') ?? enrolments[0] ?? null;
      const name = `${student.firstName} ${student.lastName ?? ''}`.trim();
      return ok(
        {
          studentId: student._id.toString(),
          admissionNo: student.admissionNo,
          name,
          class: active?.class ?? null,
          rollNo: active?.rollNo ?? null,
          enrollmentId: active?.id ?? null,
          enrollmentStatus: active?.status ?? null,
          status: student.status,
        },
        {
          speak:
            `${name} (${student.admissionNo})${active?.class ? `, ${active.class}` : ''}` +
            `${active?.rollNo ? `, roll no ${active.rollNo}` : ''}.`,
        },
      );
    },
  },

  get_student_overview: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "Several facets of one student in one call. Choose only what the question needs with `include`: profile (class, roll number, class teacher's name), personal (date of birth, gender, address), guardians (names, relation, contact numbers), attendance (this month), performance (published results), assignments (submission status), medical (only returned if the caller may read medical records). Defaults to profile, attendance and performance. For a single fact prefer the narrower tool. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        include: {
          type: 'array',
          maxItems: OVERVIEW_SECTIONS.length,
          items: { type: 'string', enum: OVERVIEW_SECTIONS },
          description: `Any of: ${OVERVIEW_SECTIONS.join(', ')}. Default: ${DEFAULT_OVERVIEW.join(', ')}`,
        },
      },
      additionalProperties: false,
    },
    permission: 'students.read',
    service: 'student.service.getOverview() — narrowed to the requested sections',
    /**
     * getOverview() builds the whole student panel — date of birth, address,
     * photo, both guardians' phone numbers and emails, the class teacher's
     * phone and email, medical data where permitted, marks and submissions. The
     * panel needs all of it; a model answering "how is Rahul doing?" does not.
     *
     * So the service is called unchanged (its ownership check and PII audit
     * stay exactly where they are) and the result is narrowed here to the
     * sections asked for. Never returned at all: the photo URL, and the class
     * teacher's phone and email — a question about a student is not a way to
     * collect staff contact details. Medical data additionally requires the
     * caller to hold medical.read, on top of the service's own class-teacher
     * rule, so asking for it cannot be a way around that permission.
     */
    async run(ctx, args) {
      const id = await resolveStudentId(ctx, args);
      if (!id) throw new AppError('Name a student — by id, admission number or name.', 400);

      const include = new Set(args.include?.length ? args.include : DEFAULT_OVERVIEW);
      const mayReadMedical = Boolean(ctx.actor?.permissions?.['medical.read']);
      // Only the sections asked for are loaded. Medical data is not even
      // requested from the service for a caller without medical.read, so it is
      // neither decrypted nor written to the audit trail as disclosed.
      const o = await students.getOverview(ctx.actor, ctx.scope, id, {
        sections: [...include].filter((s) => s !== 'medical' || mayReadMedical),
      });

      // Every section is built from an explicit list of fields rather than
      // passed through, so a field a service adds later is not disclosed by
      // default. Internal record ids (exam, term, year, medical record) are
      // left out: nothing the assistant does next takes them.
      const out = { studentId: o.id, admissionNo: o.admissionNo, name: o.name, included: [...include] };

      if (include.has('profile')) {
        out.profile = {
          class: o.enrollment?.class ?? null,
          rollNo: o.enrollment?.rollNo ?? null,
          classTeacher: o.enrollment?.classTeacher?.name ?? null,
          classRepresentative: o.enrollment?.classRepresentative?.name ?? null,
        };
      }
      if (include.has('personal')) {
        out.personal = { dob: o.dob ?? null, gender: o.gender ?? null, address: o.address ?? null };
      }
      if (include.has('guardians')) {
        out.guardians = (o.guardians ?? []).map((g) => ({
          name: g.name, relation: g.relation, phone: g.phone ?? null, email: g.email ?? null, isPrimary: Boolean(g.isPrimary),
        }));
      }
      if (include.has('attendance')) out.attendance = pick(o.attendance, ATTENDANCE_FIELDS);
      if (include.has('performance')) {
        out.performance = o.performance
          ? {
              overallAvgPct: o.performance.overallAvgPct ?? null,
              bestSubject: o.performance.bestSubject ?? null,
              needsSupport: o.performance.needsSupport ?? null,
              results: (o.performance.results ?? []).map((r) => pick(r, RESULT_FIELDS)),
            }
          : null;
      }
      if (include.has('assignments')) out.assignments = (o.assignments ?? []).map((a) => pick(a, ASSIGNMENT_FIELDS));
      if (include.has('medical')) {
        if (mayReadMedical) {
          out.medical = o.medical
            ? {
                ...pick(o.medical, MEDICAL_FIELDS),
                // Attachment names only: the files are opened from the medical
                // screen, and a URL in a chat transcript outlives the permission.
                attachments: (o.medical.attachments ?? []).map((a) => a?.name ?? 'attachment'),
              }
            : null;
        } else {
          out.medical = null;
          out.withheld = ['medical'];
        }
      }

      const bits = [];
      if (out.profile?.class) bits.push(out.profile.class);
      if (out.attendance?.pctPresent != null) bits.push(`${out.attendance.pctPresent}% attendance this month`);
      if (out.performance?.overallAvgPct != null) bits.push(`${out.performance.overallAvgPct}% average in published results`);
      return ok(out, { speak: `${o.name} (${o.admissionNo})${bits.length ? `: ${bits.join(', ')}` : ''}.` });
    },
  },

  list_guardians: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "The guardians linked to a student — name, relation and whether they are the primary contact. Read-only.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'students.read',
    service: 'student.service.listGuardians()',
    async run(ctx, args) {
      const id = await resolveStudentId(ctx, args);
      if (!id) throw new AppError('Name a student — by id, admission number or name.', 400);
      // listGuardians() returns link rows with the guardian's profile
      // populated; the name lives on the profile, not on the link.
      const links = await students.listGuardians(ctx.actor, id);
      const guardians = links.map((g) => ({
        profileId: String(g.guardianProfileId?._id ?? g.guardianProfileId),
        name: g.guardianProfileId?.displayName ?? 'Unnamed guardian',
        relation: g.relation,
        isPrimary: Boolean(g.isPrimary),
      }));
      return ok(
        { guardians, count: guardians.length },
        {
          speak: guardians.length
            ? `${guardians.length} guardian(s): ${guardians.map((g) => `${g.name} (${g.relation})`).join('; ')}.`
            : 'No guardians are linked to that student.',
        },
      );
    },
  },

  list_enrollments: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Enrolment rows — student, class, roll number and enrolment status — optionally narrowed to one section or one student. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: objectId(),
        studentId: objectId(),
        status: { type: 'string', enum: ENROLLMENT_STATUSES },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    permission: 'students.read',
    minScope: 'ALL',
    service: 'student.service.listEnrollments()',
    async run(_ctx, args) {
      const filter = {
        ...(args.sectionId && { sectionId: args.sectionId }),
        ...(args.studentId && { studentId: args.studentId }),
        ...(args.status && { status: args.status }),
      };
      const rows = await students.listEnrollments(filter);
      const limited = rows.slice(0, Math.min(Number(args.limit) || 50, 200));
      const view = summarise(limited, (e) => `${e.studentName} (${e.class}${e.rollNo ? `, roll ${e.rollNo}` : ''})`);
      return ok(
        { enrollments: limited, total: rows.length, returned: limited.length },
        { speak: rows.length ? `${rows.length} enrolment(s). First ${view.shown}: ${view.list}.` : 'No enrolments match that.' },
      );
    },
  },

  create_student: {
    module: 'Students',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Create a new student record. Requires an admission number and first name. This creates ERP data and needs confirmation before it happens. It does NOT enrol the student in a class — use enroll_student afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        admissionNo: { type: 'string', maxLength: 40, description: 'Unique within the school' },
        firstName: { type: 'string', maxLength: 80 },
        lastName: { type: 'string', maxLength: 80 },
        dob: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
        gender: { type: 'string', maxLength: 40 },
        address: { type: 'string', maxLength: 500 },
      },
      required: ['admissionNo', 'firstName'],
      additionalProperties: false,
    },
    permission: 'students.manage',
    minScope: 'ALL',
    service: 'student.service.create()',
    summarise: (args) => `Create a student record for ${args.firstName} ${args.lastName ?? ''}`.trim() + ` (admission no ${args.admissionNo})`,
    async run(_ctx, args) {
      const student = await students.create(args);
      return action({
        type: 'student_created',
        id: student._id,
        data: { studentId: student._id.toString(), admissionNo: student.admissionNo, name: `${student.firstName} ${student.lastName ?? ''}`.trim() },
        speak: `Created student ${student.firstName} ${student.lastName ?? ''} with admission number ${student.admissionNo}.`.replace(/\s+/g, ' '),
      });
    },
  },

  enroll_student: {
    module: 'Students',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Enrol an existing student into a section for an academic year, optionally with a roll number. Changes ERP data; needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        studentId: objectId('The student to enrol'),
        sectionId: objectId('The class section'),
        academicYearId: objectId(),
        rollNo: { type: 'integer', minimum: 1, maximum: 9999 },
      },
      required: ['studentId', 'sectionId', 'academicYearId'],
      additionalProperties: false,
    },
    permission: 'enrollments.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'student.service.enroll()',
    summarise: (args) => `Enrol student ${args.studentId} into section ${args.sectionId}${args.rollNo ? ` as roll no ${args.rollNo}` : ''}`,
    async run(_ctx, args) {
      const enrollment = await students.enroll(args);
      return action({
        type: 'student_enrolled',
        id: enrollment._id ?? enrollment.id,
        data: enrollment,
        speak: 'The student has been enrolled.',
      });
    },
  },

  update_student: {
    module: 'Students',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Correct a student's personal details. Only first name, last name, date of birth, gender and address may be changed here — admission number, class, roll number and enrolment status are the school's own record and are refused. Changes ERP data; needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        fields: {
          type: 'object',
          description: 'The values to change. Only firstName, lastName, dob, gender and address are accepted.',
          properties: {
            firstName: { type: 'string', maxLength: 80 },
            lastName: { type: 'string', maxLength: 80 },
            dob: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            gender: { type: 'string', maxLength: 40 },
            address: { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
      required: ['fields'],
      additionalProperties: false,
    },
    permission: 'students.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'student.service.update() — behind an MCP field allow-list',
    // The person approving a change sees who it is for and every new value —
    // not merely which fields — because that is what they are agreeing to.
    summarise: (args, _actor, prepared) => {
      const who = prepared?.studentName ?? args.studentName ?? args.admissionNo ?? args.studentId;
      const changes = Object.entries(prepared?.fields ?? args.fields ?? {}).map(([k, v]) => `${k} → "${v}"`).join(', ');
      return `Update ${who}: ${changes}`;
    },
    /**
     * Runs before the confirmation summary is shown, so a rejected field is a
     * refusal the user sees immediately rather than after they approve it.
     */
    async prepare(ctx, args) {
      const { ok: allowed, fields, rejected } = applyFieldAllowList(args.fields, STUDENT_UPDATE_ALLOW_LIST);
      if (rejected.length) {
        throw new AppError(
          `I cannot change ${rejected.join(', ')} through the assistant. ` +
            `Only ${STUDENT_UPDATE_ALLOW_LIST.join(', ')} can be corrected here.`,
          400, [], 'FIELD_NOT_ALLOWED',
        );
      }
      if (!allowed) throw new AppError('Name at least one field to change.', 400);
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400);
      const student = await students.getById(ctx.actor, ctx.scope, studentId, { via: 'mcp.update_student', audit: false });
      return { studentId, studentName: `${student.firstName} ${student.lastName ?? ''}`.trim(), fields };
    },
    async snapshot(ctx, args, prepared) {
      if (!prepared?.studentId) return null;
      const before = await students.getById(ctx.actor, ctx.scope, prepared.studentId, { via: 'mcp.update_student', audit: false });
      return Object.fromEntries(STUDENT_UPDATE_ALLOW_LIST.map((f) => [f, before[f] ?? null]));
    },
    async run(ctx, args, prepared) {
      // Re-derived rather than trusted, in case this executes from a stored
      // proposal: the allow-list has to hold at execution time too.
      const plan = prepared ?? (await this.prepare(ctx, args));
      const updated = await students.update(plan.studentId, plan.fields);
      return action({
        type: 'student_updated',
        id: updated._id,
        data: { studentId: updated._id.toString(), changed: Object.keys(plan.fields) },
        speak: `Updated ${Object.keys(plan.fields).join(', ')} for ${updated.firstName} ${updated.lastName ?? ''}.`.replace(/\s+/g, ' '),
      });
    },
  },

  update_enrollment_status: {
    module: 'Students',
    operation: 'UPDATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      "Change an enrolment's status to ACTIVE, TRANSFERRED, WITHDRAWN or GRADUATED. This is the school's formal record of whether a student is on roll. Changes ERP data; needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        enrollmentId: objectId('From search_students or list_enrollments'),
        status: { type: 'string', enum: ENROLLMENT_STATUSES },
      },
      required: ['enrollmentId', 'status'],
      additionalProperties: false,
    },
    permission: 'enrollments.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'student.service.updateEnrollmentStatus()',
    summarise: (args) => `Set enrolment ${args.enrollmentId} to ${args.status}`,
    async run(_ctx, args) {
      const enrollment = await students.updateEnrollmentStatus(args.enrollmentId, args.status);
      return action({
        type: 'enrollment_status_changed',
        id: enrollment._id,
        data: { enrollmentId: String(enrollment._id), status: enrollment.status },
        speak: `The enrolment is now ${enrollment.status}.`,
      });
    },
  },

  archive_student: {
    module: 'Students',
    operation: 'DELETE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Deactivate a student record and withdraw their active enrolments. This is a soft delete — the record is retained and can be reviewed afterwards. It does NOT erase personal data; use anonymise_student for that. Always needs confirmation.',
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'students.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'student.service.softDelete()',
    summarise: (args) => `Deactivate student ${args.studentName ?? args.admissionNo ?? args.studentId} and withdraw their enrolments`,
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400);
      return { studentId };
    },
    async snapshot(ctx, args, prepared) {
      if (!prepared?.studentId) return null;
      const s = await students.getById(ctx.actor, ctx.scope, prepared.studentId, { via: 'mcp.archive_student', audit: false });
      return { studentId: prepared.studentId, admissionNo: s.admissionNo, status: s.status, deletedAt: s.deletedAt };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await students.softDelete(plan.studentId);
      return action({
        type: 'student_archived',
        id: plan.studentId,
        data: { studentId: plan.studentId },
        speak: 'The student record has been deactivated and their active enrolments withdrawn.',
      });
    },
  },

  anonymise_student: {
    module: 'Students',
    operation: 'DELETE',
    risk: RISK.CRITICAL,
    confirm: true,
    description:
      "IRREVERSIBLE. Permanently erase a student's personal data (name, date of birth, gender, address, photo) while keeping the anonymous academic record. Use only for a data-erasure request. Cannot be undone. Always needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        reason: { type: 'string', maxLength: 300, description: 'Why erasure was requested — recorded in the audit trail' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    permission: 'students.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'student.service.anonymiseStudent()',
    summarise: (args) =>
      `PERMANENTLY erase the personal data of student ${args.studentName ?? args.admissionNo ?? args.studentId} — this cannot be undone`,
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400);
      return { studentId };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await students.anonymiseStudent(ctx.actor, plan.studentId, { reason: args.reason });
      return action({
        type: 'student_anonymised',
        id: plan.studentId,
        data: result,
        speak: result?.alreadyAnonymised
          ? "That student's personal data had already been erased."
          : "The student's personal data has been permanently erased.",
      });
    },
  },
};
