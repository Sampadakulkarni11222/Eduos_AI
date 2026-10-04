import * as dashboard from '../../../dashboard/dashboard.service.js';
import { canReadDashboard, dashboardViewForRole } from '../../../dashboard/dashboard.service.js';
import * as risk from '../../../risk/risk.service.js';
import * as growth from '../../../growth/growth.service.js';
import * as users from '../../../users/user.service.js';
import * as documents from '../../../documents/document.service.js';
import * as notifications from '../../../notifications/notification.service.js';
import * as audit from '../../../audit/audit.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, objectId, dateStr, noArgs, summarise, shortDate, resolveEnrollmentId, studentIdentitySchema,
  limitSchema, resultWindow, windowSlice, rangeOf, collectPages, collectCursor,
  resolveSection, classIdentitySchema,
  theNamed,
} from './_shared.js';

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

/**
 * A document as a person names it: by its title.
 *
 * Both document writes took only an ObjectId, so "delete the exam timetable
 * document" reached nothing. The candidates come from
 * document.service.listForActor() at the caller's own scope -- the documents
 * their own screen lists -- so a title can only ever reach one they were
 * already able to see, and the service re-checks who may change it.
 */
async function resolveDocumentId(ctx, args) {
  if (args.documentId) return String(args.documentId);
  const docs = await documents.listForActor(ctx.actor, ctx.scope, null, {});
  const found = theNamed(docs, args.title, {
    label: 'document',
    nameOf: (d) => d.title,
    describe: (d) => `"${d.title}"`,
  });
  return String(found.id ?? found._id);
}

export const analyticsTools = {
  get_at_risk_students: {
    module: 'Analytics',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Students flagged at risk from the last 30 days of attendance, published marks and overdue fees. Use for school-wide or class-wide queries asking which students are below an attendance percentage threshold, such as "which students are below 75% attendance" (pass attendanceBelowPct: 75) — it returns each student whose day-level attendance over the last 30 days is below that figure, with the percentage. Do not use for one named student. Students with no attendance marked in the last 30 days cannot be assessed and are not included. Read-only.',
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
        limit: limitSchema(),
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

      // Every flagged student, a window at a time; exactly n when n was asked for.
      const win = resultWindow(_ctx, args);
      const limited = windowSlice(items, win).items;
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
          range: rangeOf(win, limited.length, items.length),
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
    /**
     * Authorization comes from dashboard.service's own access table — the same
     * rules the REST routes state as middleware — rather than from a copy kept
     * here.
     *
     * An earlier version checked only that the caller held the view's
     * permission. That was materially weaker than the route, which also
     * requires a role whose job the dashboard is AND, for the school-wide
     * views, the permission at ALL scope. Because `students.read` and
     * `fees.read` are held at OWN by families, holding the permission at all
     * was enough: a student could ask for `view: 'finance'` and receive the
     * school's whole fee position, or `view: 'admin'` and receive its roll.
     * The role is taken from the session-resolved actor, never from an
     * argument, and `view` decides nothing on its own.
     */
    async run(ctx, args) {
      const view = args.view ?? dashboardViewForRole(ctx.actor?.roleKey);
      if (!view) {
        throw new AppError('There is no dashboard for your role.', 403);
      }
      if (!canReadDashboard(ctx.actor, view)) {
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
        limit: limitSchema(),
      },
      additionalProperties: false,
    },
    permission: 'users.read',
    minScope: 'ALL',
    service: 'user.service.listUsers()',
    async run(ctx, args) {
      // Every page of the directory, a window at a time: each page is the same
      // school-scoped read the Users screen makes.
      const win = resultWindow(ctx, args);
      const page = await collectPages((p, pageSize) => users.listUsers({
        search: args.search, roleKey: args.roleKey, status: args.status, sectionId: args.sectionId,
        page: p, pageSize,
      }), win);
      const items = page.items;
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
        {
          speak: rows.length
            ? `${page.total ?? rows.length} user(s): ${view.list}.`
            : 'No users match that.',
          range: rangeOf(win, rows.length, page.total),
        },
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
        limit: limitSchema(),
      },
      additionalProperties: false,
    },
    // Every authenticated user has their own notifications; the assistant
    // permission is what gates reaching them through the assistant at all.
    permission: 'ai.copilot.use',
    service: 'notification.service.list() + unreadCount()',
    async run(ctx, args) {
      // list() returns a page — { items, nextCursor, unreadCount } — not an array.
      // Cursor pages, followed to the end (or to what was asked for).
      let unread = 0;
      const win = resultWindow(ctx, args);
      const { items, more, cursor } = await collectCursor(async (before, limit) => {
        const page = await notifications.list(ctx.actor, { unreadOnly: args.unreadOnly, limit, ...(before && { before }) });
        unread = page.unreadCount ?? unread;
        return page;
      }, win);
      const view = summarise(items, (n) => n.title);
      return ok(
        { notifications: items, unread },
        {
          speak: items.length
            ? `${unread} unread. Notifications: ${view.list}.`
            : 'You have no notifications.',
          range: rangeOf(win, items.length, null, { cursor, more }),
        },
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
        limit: limitSchema(),
      },
      additionalProperties: false,
    },
    permission: 'materials.read',
    service: 'document.service.listForActor()',
    async run(ctx, args) {
      // Paged: called without a page size, listForActor() stops at the
      // service's 500-row cap. Each page is the same visibility-filtered read.
      const win = resultWindow(ctx, args);
      const docs = await collectPages((page, pageSize) => documents.listForActor(
        ctx.actor, ctx.scope, args.studentId ?? null, { type: args.type, page, pageSize },
      ), win);
      const items = docs.items;
      const view = summarise(items, (d) => `${d.title} (${String(d.type).replace('_', ' ').toLowerCase()})`);
      return ok(
        { documents: items, count: items.length, total: docs.total },
        {
          speak: items.length ? `${docs.total} document(s): ${view.list}. Open Documents in the sidebar to download them.` : 'No documents have been published for you yet.',
          range: rangeOf(win, items.length, docs.total),
        },
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
        limit: limitSchema(),
        cursor: { type: 'string', maxLength: 40, description: 'From a previous call, to fetch the next page' },
      },
      additionalProperties: false,
    },
    permission: 'audit.read',
    minScope: 'ALL',
    service: 'audit.service.listLogs()',
    async run(ctx, args) {
      // A trail can be very long: it is read a window at a time, from the
      // cursor given (or the start), and the answer offers the next window.
      const { cursor: startAt, limit: _asked, ...filters } = args;
      const win = resultWindow(ctx, args);
      const page = await collectCursor(async (cursor, limit) => audit.listLogs(ctx.actor, {
        ...filters, limit, ...((cursor ?? startAt) && { cursor: cursor ?? startAt }),
      }), win);
      const items = page.items;
      const view = summarise(items, (l) => `${l.action} by ${l.actorName} (${shortDate(l.createdAt)})`);
      return ok(
        { logs: items, returned: items.length, nextCursor: page.more ? page.cursor : null },
        {
          speak: items.length
            ? `Audit entries: ${view.list}.`
            : 'No audit entries match that.',
          range: rangeOf(win, items.length, null, { cursor: page.cursor, more: page.more }),
        },
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
      properties: {
        documentId: objectId('From list_documents'),
        title: { type: 'string', maxLength: 200, description: 'The document as a person names it. An ambiguous title is refused, never guessed.' },
      },
      additionalProperties: false,
    },
    permission: 'materials.manage',
    affectsOthers: true,
    service: 'document.service.listForActor() + deleteForActor()',
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
      const documentId = await resolveDocumentId(ctx, args);
      const doc = await documents.findDeletableForActor(ctx.actor, ctx.scope, documentId);
      return { documentId: String(doc._id), title: doc.title, type: doc.type };
    },
    /** What the document was, for the audit trail — a deletion leaves nothing else behind. */
    async snapshot(ctx, args, prepared) {
      try {
        // The id the PROPOSAL settled on, so the snapshot is of the document
        // that is actually about to go, not of whatever a bare title would
        // resolve to a second time.
        const doc = await documents.findDeletableForActor(
          ctx.actor, ctx.scope, prepared?.documentId ?? args.documentId,
        );
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
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const deleted = await documents.deleteForActor(ctx.actor, ctx.scope, plan.documentId);
      return action({
        type: 'document_deleted',
        id: deleted.id,
        data: deleted,
        speak: `Deleted the document "${deleted.title}".`,
      });
    },
  },

  /**
   * Course material, created and corrected.
   *
   * Both tools are thin on purpose. Every rule about what may be published and
   * by whom — a teacher restricted to course material for a class they
   * actually teach, the ID_CARD refusal, authorProfileId taken from the actor,
   * authorship and CUSTOM-type on an edit, and the field allow-list — lives in
   * document.service, where the REST routes meet it too. Repeating any of it
   * here would be a second copy free to drift from the first.
   */
  create_course_material: {
    module: 'Documents',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Publish course material to a class — notes, a worksheet or a handout already uploaded to this system. The file must be one uploaded here (an /uploads/ path); a link to anywhere else is refused. A teacher may publish only to a class they teach, and only course material. A whole class sees it, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        fileUrl: {
          type: 'string',
          maxLength: 600,
          pattern: '^/uploads/[A-Za-z0-9._-]+$',
          description: 'The path the upload endpoint returned, e.g. /uploads/chapter-3.pdf',
        },
        ...classIdentitySchema,
        sectionId: objectId('The class this material is for'),
        mimeType: { type: 'string', maxLength: 120 },
        visibleToRoles: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } },
      },
      required: ['title', 'fileUrl'],
      additionalProperties: false,
    },
    permission: 'materials.manage',
    affectsOthers: true,
    service: 'document.service.createForActor()',
    summarise: (args) => `Publish course material "${args.title}" to ${args.className ?? 'the class'}`,
    async run(ctx, args) {
      // A class named in words becomes the id the service expects; whether this
      // may happen at all is still decided by createForActor().
      const sectionId = args.sectionId
        ?? (args.className ? (await resolveSection(ctx, { className: args.className }))?.sectionId : null);
      const doc = await documents.createForActor(ctx.actor, ctx.scope, {
        title: args.title,
        fileUrl: args.fileUrl,
        ...(args.mimeType && { mimeType: args.mimeType }),
        ...(args.visibleToRoles && { visibleToRoles: args.visibleToRoles }),
        ...(sectionId && { sectionId }),
      });
      return action({
        type: 'course_material_created',
        id: String(doc._id),
        data: {
          id: String(doc._id),
          title: doc.title,
          type: doc.type,
          sectionId: doc.sectionId ? String(doc.sectionId) : null,
        },
        speak: `"${doc.title}" has been published to the class.`,
      });
    },
  },

  update_course_material: {
    module: 'Documents',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Correct course material already published — its title, the uploaded file it points at, or the class it is for. A teacher may change only material they published themselves, and only course material. Use list_documents to find the id. A class sees the result, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: objectId('From list_documents'),
        title: { type: 'string', maxLength: 200 },
        newTitle: { type: 'string', maxLength: 200, description: 'The new title, when renaming material named by its current title' },
        fileUrl: {
          type: 'string',
          maxLength: 600,
          pattern: '^/uploads/[A-Za-z0-9._-]+$',
          description: 'The path the upload endpoint returned',
        },
        ...classIdentitySchema,
        sectionId: objectId(),
        mimeType: { type: 'string', maxLength: 120 },
        visibleToRoles: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } },
      },
      // No required id: the title identifies the material when no id is given,
      // and renames it when one is. That is the same rule update_book keeps,
      // for the same reason -- nobody types an ObjectId. A teacher renaming BY
      // NAME says both names, so the new one has an argument of its own: the
      // Web's edit form (PUT /documents/:id) renames, and without `newTitle`
      // the assistant could only propose "Change nothing".
      additionalProperties: false,
    },
    permission: 'materials.manage',
    affectsOthers: true,
    service: 'document.service.listForActor() + updateForActor()',
    summarise: (args, _actor, prepared) => {
      const changed = ['fileUrl', 'mimeType', 'visibleToRoles'].filter((f) => args[f] !== undefined);
      if (args.newTitle !== undefined || (args.documentId && args.title !== undefined)) changed.push('title');
      if (args.sectionId || args.className) changed.push('class');
      const which = args.title && !args.documentId ? `"${args.title}"` : args.documentId;
      if (args.newTitle !== undefined && changed.length === 1) return `Rename course material ${which} to "${args.newTitle}"`;
      return `Change ${changed.join(', ')} on course material ${which}${args.newTitle !== undefined ? ` (new title "${args.newTitle}")` : ''}`;
    },
    async prepare(ctx, args) {
      // A proposal that changes nothing is not a proposal. It used to be put
      // to the teacher as "Change nothing on course material ..." -- confirmed,
      // audited, and a no-op. What CAN change is asked instead.
      const changes = ['newTitle', 'fileUrl', 'mimeType', 'visibleToRoles', 'sectionId', 'className']
        .some((f) => args[f] !== undefined) || Boolean(args.documentId && args.title !== undefined);
      if (!changes) {
        throw new AppError('What should change: its title, its file or its class? For example "rename it to Fraction basics".', 400);
      }
      return { documentId: await resolveDocumentId(ctx, args) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const sectionId = args.sectionId
        ?? (args.className ? (await resolveSection(ctx, { className: args.className }))?.sectionId : undefined);
      const doc = await documents.updateForActor(ctx.actor, ctx.scope, plan.documentId, {
        // A title given WITHOUT an id named the document; it is not also a
        // change to it.
        ...(args.documentId && args.title !== undefined && { title: args.title }),
        ...(args.newTitle !== undefined && { title: args.newTitle }),
        ...(args.fileUrl !== undefined && { fileUrl: args.fileUrl }),
        ...(args.mimeType !== undefined && { mimeType: args.mimeType }),
        ...(args.visibleToRoles !== undefined && { visibleToRoles: args.visibleToRoles }),
        ...(sectionId !== undefined && { sectionId }),
      });
      return action({
        type: 'course_material_updated',
        id: String(doc._id),
        data: {
          id: String(doc._id),
          title: doc.title,
          sectionId: doc.sectionId ? String(doc.sectionId) : null,
        },
        speak: `"${doc.title}" has been updated.`,
      });
    },
  },
};
