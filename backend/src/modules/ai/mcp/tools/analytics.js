import * as dashboard from '../../../dashboard/dashboard.service.js';
import * as risk from '../../../risk/risk.service.js';
import * as growth from '../../../growth/growth.service.js';
import * as users from '../../../users/user.service.js';
import * as documents from '../../../documents/document.service.js';
import * as notifications from '../../../notifications/notification.service.js';
import * as audit from '../../../audit/audit.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, objectId, dateStr, noArgs, summarise, shortDate, resolveEnrollmentId, studentIdentitySchema } from './_shared.js';

/**
 * Analytics, dashboards, directory and audit — all read-only.
 *
 * `get_at_risk_students` is the tool behind "who is below the attendance
 * threshold". It fronts `risk.service.scan()`, which is the only place in the
 * ERP that computes a per-student picture from attendance, published marks and
 * overdue fees together. Nothing here recomputes that; the threshold filtering
 * is selection over what scan() already returned.
 */

const DASHBOARDS = ['admin', 'finance', 'teacher', 'student', 'parent', 'warden', 'librarian'];

export const analyticsTools = {
  get_at_risk_students: {
    module: 'Analytics',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Students flagged at risk from the last 30 days of attendance, published marks and overdue fees. To answer "who is below 75% attendance", pass attendanceBelowPct: 75 — it returns each student whose day-level attendance over the last 30 days is below that figure, with the percentage. Students with no attendance marked in the last 30 days cannot be assessed and are not included. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        attendanceBelowPct: {
          type: 'integer', minimum: 1, maximum: 100,
          description: 'Only students whose 30-day attendance is below this percentage, e.g. 75',
        },
        level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Risk level' },
        type: { type: 'string', enum: ['ATTENDANCE', 'ACADEMIC_DECLINE', 'FEE_DEFAULT'], description: 'Risk type' },
        sectionId: objectId(),
        gradeName: { type: 'string', maxLength: 40 },
        search: { type: 'string', maxLength: 80 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'ai.insights.read',
    minScope: 'ALL',
    service: 'risk.service.scan()',
    /**
     * The attendance percentage is the one risk.service already computed:
     * every ATTENDANCE row carries it as topFeatures[0] (`attendance_pct_30d`).
     * Nothing is recomputed here — the threshold is selection over the scan's
     * own figures. (An earlier version of this tool filtered on a field the
     * scan never returns, so it answered "nobody" to every threshold question.)
     *
     * No pageSize is passed: scan() paginates only when asked to, and a first
     * page silently cut at an arbitrary size would make "who is below 75%"
     * incomplete without saying so.
     */
    async run(_ctx, args) {
      const threshold = args.attendanceBelowPct ?? null;
      const result = await risk.scan({
        level: args.level,
        type: threshold != null ? 'ATTENDANCE' : args.type,
        sectionId: args.sectionId,
        gradeName: args.gradeName,
        search: args.search,
      });

      let items = (result.items ?? []).map((i) => ({
        studentId: i.studentId,
        enrollmentId: i.enrollmentId,
        studentName: i.studentName,
        class: i.class,
        type: i.type,
        level: i.level,
        probability: i.probability,
        attendancePct: i.type === 'ATTENDANCE' ? (i.topFeatures?.[0]?.value ?? null) : null,
        summary: i.summary,
      }));

      if (threshold != null) {
        items = items
          .filter((i) => i.type === 'ATTENDANCE' && i.attendancePct != null && i.attendancePct < threshold)
          .sort((a, b) => a.attendancePct - b.attendancePct);
      }

      const limited = items.slice(0, Math.min(Number(args.limit) || 25, 100));
      const view = summarise(limited, (i) =>
        `${i.studentName}${i.class ? ` (${i.class})` : ''}${i.attendancePct != null ? ` — ${i.attendancePct}%` : ` — ${i.type}`}`);

      return ok(
        { students: limited, matched: items.length, returned: limited.length, threshold, counts: result.counts ?? {} },
        {
          speak: items.length
            ? `${items.length} student(s)${threshold != null ? ` below ${threshold}% attendance over the last 30 days` : ' flagged at risk'}: ${view.list}.`
            : threshold != null
              ? `No students are below ${threshold}% attendance over the last 30 days.`
              : 'No students are currently flagged at risk.',
        },
      );
    },
  },

  get_growth_score: {
    module: 'Analytics',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A student's growth score for a period, blending attendance, academics and participation. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        enrollmentId: objectId(),
        period: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Month as YYYY-MM; defaults to the current month' },
      },
      additionalProperties: false,
    },
    permission: 'ai.insights.read',
    service: 'growth.service.getScore()',
    async run(ctx, args) {
      const enrollmentId = await resolveEnrollmentId(ctx, args);
      if (!enrollmentId) throw new AppError('Name a student — by id, admission number or name.', 400);
      // getScore() splits the period as YYYY-MM and has no default of its own.
      const now = new Date();
      const period = args.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const score = await growth.getScore(enrollmentId, period);
      return ok(score, { speak: score?.score != null ? `Growth score: ${score.score}.` : 'No growth score is available for that period.' });
    },
  },

  get_dashboard: {
    module: 'Analytics',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "The school's dashboard figures. Pass a `view` to choose which: admin (roll, tickets, announcements), finance (collection), teacher, student, parent, warden or librarian. Omit it and the caller's own role decides. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { view: { type: 'string', enum: DASHBOARDS } },
      additionalProperties: false,
    },
    // Deliberately the same key the /dashboard/admin route requires; the
    // per-view permission is checked below, so a teacher cannot read the
    // finance dashboard by naming it.
    permission: 'students.read',
    service: 'dashboard.service.get*Dashboard()',
    async run(ctx, args) {
      const roleView = {
        ADMIN: 'admin', SUPER_ADMIN: 'admin', PRINCIPAL: 'admin',
        FINANCE: 'finance', TEACHER: 'teacher', STUDENT: 'student',
        PARENT: 'parent', WARDEN: 'warden', LIBRARIAN: 'librarian',
      }[ctx.actor?.roleKey] ?? 'admin';
      const view = args.view ?? roleView;

      // Each dashboard carries a different slice of the school, so each is
      // gated on the permission its own REST route requires. Without this, the
      // single `students.read` above would have been a way for anyone holding
      // it to read the finance dashboard.
      const required = {
        admin: 'students.read', finance: 'fees.read', teacher: 'timetable.read',
        student: 'attendance.read', parent: 'students.read', warden: 'hostel.read',
        librarian: 'library.read',
      }[view];
      if (!ctx.actor?.permissions?.[required]) {
        throw new AppError(`You are not authorized to view the ${view} dashboard.`, 403);
      }

      const data = await {
        admin: () => dashboard.getAdminDashboard(ctx.actor),
        finance: () => dashboard.getFinanceDashboard(),
        teacher: () => dashboard.getTeacherDashboard(ctx.actor.profileId),
        student: () => dashboard.getStudentDashboard(ctx.actor.profileId),
        parent: () => dashboard.getParentDashboard(ctx.actor.profileId),
        warden: () => dashboard.getWardenDashboard(),
        librarian: () => dashboard.getLibrarianDashboard(),
      }[view]();

      return ok(
        { view, ...data },
        { speak: `${view.charAt(0).toUpperCase() + view.slice(1)} dashboard figures retrieved.` },
      );
    },
  },

  list_users: {
    module: 'Users',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Staff and user accounts, searchable by name, phone or email and filterable by role. Returns each person\'s profile id, which the notification tool needs. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 80 },
        roleKey: { type: 'string', maxLength: 40, description: 'e.g. TEACHER, FINANCE' },
        status: { type: 'string', maxLength: 20 },
        sectionId: objectId(),
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'users.read',
    minScope: 'ALL',
    service: 'user.service.listUsers()',
    async run(_ctx, args) {
      const page = await users.listUsers({
        search: args.search, roleKey: args.roleKey, status: args.status, sectionId: args.sectionId,
        page: 1, pageSize: Math.min(Number(args.limit) || 25, 100),
      });
      const items = page.items ?? page ?? [];
      const rows = items.map((u) => ({
        profileId: String(u.profileId ?? u.id),
        name: u.displayName ?? u.name,
        role: u.roleKey ?? u.role,
        status: u.status,
        // Contact details are deliberately not returned: naming who works here
        // is a directory read, handing out their phone number is not.
      }));
      const view = summarise(rows, (u) => `${u.name} (${u.role})`);
      return ok(
        { users: rows, total: page.total ?? rows.length },
        { speak: rows.length ? `${page.total ?? rows.length} user(s): ${view.list}.` : 'No users match that.' },
      );
    },
  },

  list_notifications: {
    module: 'Notifications',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own in-app notifications, and how many are unread. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        unreadOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    // Every authenticated user has their own notifications; the assistant
    // permission is what gates reaching them through the assistant at all.
    permission: 'ai.copilot.use',
    service: 'notification.service.list() + unreadCount()',
    async run(ctx, args) {
      // list() returns a page — { items, nextCursor, unreadCount } — not an array.
      const { items, unreadCount: unread } = await notifications.list(ctx.actor, {
        unreadOnly: args.unreadOnly, limit: args.limit ?? 20,
      });
      const view = summarise(items, (n) => n.title);
      return ok(
        { notifications: items, unread },
        { speak: items.length ? `${unread} unread. Latest: ${view.list}.` : 'You have no notifications.' },
      );
    },
  },

  list_documents: {
    module: 'Documents',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Documents published to the caller — report cards, transfer certificates, letters and course material. Returns titles and types; the files themselves are downloaded from the Documents screen. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        studentId: objectId(),
        type: { type: 'string', maxLength: 40 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    permission: 'materials.read',
    service: 'document.service.listForActor()',
    async run(ctx, args) {
      const docs = await documents.listForActor(ctx.actor, ctx.scope, args.studentId ?? null, { type: args.type });
      const items = (Array.isArray(docs) ? docs : (docs?.items ?? [])).slice(0, Math.min(Number(args.limit) || 20, 50));
      const view = summarise(items, (d) => `${d.title} (${String(d.type).replace('_', ' ').toLowerCase()})`);
      return ok(
        { documents: items, count: items.length },
        { speak: items.length ? `${items.length} document(s): ${view.list}. Open Documents in the sidebar to download them.` : 'No documents have been published for you yet.' },
      );
    },
  },

  list_audit_logs: {
    module: 'Audit',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'The audit trail: who did what and when, including every action the assistant performed (action names beginning "agent."). Defaults to staff activity; narrow it by action, role, person, a date range, a month (YYYY-MM) or a year. Import and export entries are shown only to callers who may manage users. Sensitive fields in the entries are redacted. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', maxLength: 80, description: 'Exact action name, e.g. "agent.mark_attendance"' },
        roleKey: { type: 'string', maxLength: 40, description: 'Only actions by holders of this role, e.g. FINANCE' },
        actorProfileId: objectId('Only actions by this person'),
        from: dateStr(),
        to: dateStr(),
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM' },
        year: { type: 'string', pattern: '^\\d{4}$', description: 'YYYY' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string', maxLength: 40, description: 'From a previous call, to fetch the next page' },
      },
      additionalProperties: false,
    },
    permission: 'audit.read',
    minScope: 'ALL',
    service: 'audit.service.listLogs()',
    async run(ctx, args) {
      const page = await audit.listLogs(ctx.actor, { ...args, limit: args.limit ?? 25 });
      const items = page.items ?? [];
      const view = summarise(items, (l) => `${l.action} by ${l.actorName} (${shortDate(l.createdAt)})`);
      return ok(
        { logs: items, returned: items.length, nextCursor: page.nextCursor ?? null },
        { speak: items.length ? `${items.length} audit entry/entries: ${view.list}.` : 'No audit entries match that.' },
      );
    },
  },

  delete_document: {
    module: 'Documents',
    operation: 'DELETE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Permanently delete a published document — a report card, certificate, letter or course material. A school-wide holder of the permission may delete any document; anyone else only documents they uploaded themselves. Always needs confirmation. Use list_documents to find the document id.',
    inputSchema: {
      type: 'object',
      properties: { documentId: objectId('From list_documents') },
      required: ['documentId'],
      additionalProperties: false,
    },
    permission: 'materials.manage',
    affectsOthers: true,
    service: 'document.service.deleteForActor()',
    summarise: (args, _actor, prepared) =>
      `Permanently delete ${prepared?.type ? `the ${String(prepared.type).replace('_', ' ').toLowerCase()} ` : 'document '}` +
      `"${prepared?.title ?? args.documentId}" — this cannot be undone`,
    /**
     * Checks the same rule the deletion applies — the document exists in this
     * school, and a caller without school-wide scope wrote it — before anyone
     * is asked to confirm, so the prompt names the document and a deletion that
     * cannot happen is refused instead of offered.
     */
    async prepare(ctx, args) {
      const doc = await documents.findDeletableForActor(ctx.actor, ctx.scope, args.documentId);
      return { documentId: String(doc._id), title: doc.title, type: doc.type };
    },
    /** What the document was, for the audit trail — a deletion leaves nothing else behind. */
    async snapshot(ctx, args) {
      try {
        const doc = await documents.findDeletableForActor(ctx.actor, ctx.scope, args.documentId);
        return {
          exists: true,
          title: doc.title,
          type: doc.type,
          authorProfileId: String(doc.authorProfileId),
          visibleToRoles: doc.visibleToRoles ?? [],
          studentId: doc.studentId ? String(doc.studentId) : null,
          sectionId: doc.sectionId ? String(doc.sectionId) : null,
          createdAt: doc.createdAt ?? null,
        };
      } catch (err) {
        if (err?.statusCode === 404) return { exists: false };
        throw err;
      }
    },
    async run(ctx, args) {
      const deleted = await documents.deleteForActor(ctx.actor, ctx.scope, args.documentId);
      return action({
        type: 'document_deleted',
        id: deleted.id,
        data: deleted,
        speak: `Deleted the document "${deleted.title}".`,
      });
    },
  },
};
