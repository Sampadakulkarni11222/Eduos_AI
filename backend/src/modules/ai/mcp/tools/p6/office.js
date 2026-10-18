// Part-6 coverage tools: office. See ./_kit.js and ../p6Coverage.js.
import * as docRequests from '../../../../documentRequests/documentRequest.service.js';
import * as docTypes from '../../../../documentRequests/documentType.service.js';
import * as certificates from '../../../../leadership/certificates.service.js';
import * as customization from '../../../../customization/customization.service.js';
import * as approvals from '../../../../approvals/approval.service.js';
import * as messaging from '../../../../messaging/messaging.service.js';
import * as institution from '../../../../institution/institution.service.js';
import * as approverMode from '../../../../policy/approverMode.service.js';
import * as correspondence from '../../../../administration/correspondence.service.js';
import * as facilities from '../../../../administration/facility.service.js';
import * as events from '../../../../administration/events.service.js';
import * as governance from '../../../../governance/governance.service.js';
import * as opps from '../../../../p4StudentAlumnus/opportunities.service.js';
import { profilesWithRoles } from '../../../../ops/common.js';
import { describeFeatures, setFeatures } from '../../../../../utils/features.js';
import { FEATURES, FEATURE_KEYS } from '../../../../../constants/features.js';
import { APPROVAL_CATEGORIES } from '../../../../../models/approval.model.js';
import { FACILITY_KINDS } from '../../../../../models/facility.model.js';
import { OPPORTUNITY_KINDS, OPPORTUNITY_AUDIENCES } from '../../../../../models/alumniOpportunity.model.js';
import {
  tool, text, int, num, bool, oneOf, list, closed, hm, ask, forbidden, rowsOf, lower, words, day, time,
  istAt, stripTitle, excerpt, pick, listed, shown, did, decisionArg, dateStr, RISK,
} from './_kit.js';

/**
 * The school office's remaining routes, each the route's own service call
 * behind the route's own guard (see ./_kit.js):
 *
 *   document requests   a family or alumnus reads one of their own requests in
 *                       full; the office reads one, starts reviewing it and
 *                       records its approve/reject decision (approver-confirmed);
 *                       document types are configured; a certificate is
 *                       previewed before it is generated.
 *   approvals           the summary, policies (set or reset), delegations
 *                       (create, revoke), the register, raising a request,
 *                       resubmitting or withdrawing one's own, declaring a
 *                       conflict and escalating. Deciding stays where it is.
 *   messaging           channel status, the outbox, releasing deferred
 *                       messages, one's own contact preferences.
 *   institution         terminology, modules switched on, the profile,
 *                       single-approver mode, the theme and dropdowns.
 *   correspondence      stats, deadlines found in a letter, one letter, assign,
 *                       verify the source, move it along its register
 *                       (acknowledge, work, no action, dispatch, delivery,
 *                       close), send a reply for approval, reminders, legal hold.
 *   facilities          stats, add or change a facility, a sample campus,
 *                       bookings (list, cancel, the manager's decision), work
 *                       orders.
 *   events, agreements  propose, read, change, send for approval, move along.
 *   governance          one meeting, availability, fixing its time, recording
 *                       the meeting, the chair's approval of the minutes
 *                       (approver-confirmed), cancelling, reminders.
 *   alumni offers       the coordinator's board, posting, closing and the
 *                       publish/reject decision (approver-confirmed).
 *
 * Left to the screen: file uploads and downloads (issuing a document file,
 * downloading one, the printable letter).
 */

/* ── helpers ──────────────────────────────────────────────── */

const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE', 'TRUSTEE'];
const rupeesOf = (p) => `₹${(Number(p ?? 0) / 100).toLocaleString('en-IN')}`;
const label = (s) => words(s).replace(/^\w/, (c) => c.toUpperCase());

/** A member of staff by name, from the school's own active profiles. */
async function staffNamed(term, what = 'person', roles = STAFF_ROLES) {
  const rows = (await profilesWithRoles(roles)).map((p) => ({ id: String(p._id), name: p.displayName, role: p.roleId?.key ?? null }));
  return pick(rows, stripTitle(term), { label: what, nameOf: (r) => r.name, refOf: () => '', describe: (r) => `${r.name} (${words(r.role)})` });
}

/* ── Document requests and types ──────────────────────────── */

const docRef = {
  document: text(120, 'The kind of document, e.g. "bonafide", "transfer certificate"'),
  studentName: text(120, 'The student it is for (or their admission number)'),
};

/** One of the family's (or alumnus's) own requests, by document name. */
async function myRequest(ctx, document) {
  const rows = await docRequests.listMine(ctx.actor, {});
  return pick(rows, document, {
    label: 'request of yours', nameOf: (r) => `${r.documentTypeName}${r.studentName ? ` ${r.studentName}` : ''}`, refOf: () => '',
    describe: (r) => `${r.documentTypeName}${r.studentName ? ` for ${r.studentName}` : ''} (${words(r.status)})`,
  });
}

/** One office request, by student and/or document kind. */
async function officeRequest(args, statuses) {
  let rows = await docRequests.listForSchool({ ...(statuses && { status: statuses }), ...(args.studentName && { q: stripTitle(args.studentName) }) });
  if (args.document) rows = rows.filter((r) => lower(r.documentTypeName).includes(lower(args.document)));
  return pick(rows, null, { label: `${statuses ? `${words(statuses).replace(/,/g, ' or ')} ` : ''}document request${args.studentName ? ` for ${args.studentName}` : ''}`, describe: (r) => `${r.documentTypeName} for ${r.student?.name ?? 'a student'} (${words(r.status)})` });
}

const requestView = (r) => ({
  document: r.documentTypeName, student: r.student?.name ?? r.studentName ?? null, admissionNo: r.student?.admissionNo ?? null, className: r.student?.className ?? null,
  status: r.status, purpose: r.purpose, requiredBy: r.requiredBy, answers: (r.requestData ?? []).map((a) => `${a.label}: ${a.value ?? '—'}`),
  additionalInformation: r.additionalInformation, requestedAt: r.requestedAt, reviewedAt: r.reviewedAt, approvedAt: r.approvedAt,
  rejectionReason: r.rejectionReason, remarks: r.adminRemarks, issuedAt: r.issuedAt, ready: Boolean(r.document), versions: (r.versions ?? []).length || undefined,
});
const speakRequest = (r) => `${r.documentTypeName}${r.student?.name ? ` for ${r.student.name}` : ''}: ${words(r.status)}${r.rejectionReason ? ` (${r.rejectionReason})` : ''}${r.document ? '; the document is ready to download on the Certificates page' : ''}.`;

const QUESTION = closed({ label: text(80), kind: oneOf(['text', 'textarea', 'date', 'number', 'select']), required: bool(), options: list(text(80), 30) }, ['label']);
const typeFields = {
  description: text(2000), instructions: text(2000, 'What the requester should say'),
  requestable: bool('Open to requests from students and families'), active: bool(),
  maxFileSizeMb: int(1, 50), fileTypes: list(oneOf(['pdf', 'png', 'jpeg']), 3, 'Formats the issued file may be'),
  questions: list(QUESTION, 20, 'Extra questions the requester answers (replaces the existing ones)'),
};
const typeBody = (a) => ({
  ...(a.description !== undefined && { description: a.description }), ...(a.instructions !== undefined && { instructions: a.instructions }),
  ...(a.requestable !== undefined && { requestEnabled: a.requestable }), ...(a.active !== undefined && { isActive: a.active }),
  ...(a.maxFileSizeMb !== undefined && { maxFileSizeMb: a.maxFileSizeMb }), ...(a.fileTypes && { allowedFileTypes: a.fileTypes }),
  ...(a.questions && { fields: a.questions }),
});

async function typeNamed(name) {
  return pick(await docTypes.list(), name, { label: 'document type', refOf: () => '' });
}

const documentTools = {
  get_my_document_request: tool({
    module: 'Certificates', operation: 'GET',
    description: "For a student or parent: one of their own (or their child's) document requests in full: answers given, dates, the office's remarks or rejection reason and whether the document is ready. Read-only.",
    inputSchema: closed({ document: text(120, 'The kind of document, e.g. "bonafide"') }),
    permission: 'students.read', forRoles: ['STUDENT', 'PARENT'],
    service: 'documentRequest.service.listMine() + getMine()',
    async run(ctx, args) {
      const r = await docRequests.getMine(ctx.actor, (await myRequest(ctx, args.document)).id);
      return shown(requestView(r), speakRequest(r));
    },
  }),

  get_my_alumni_document_request: tool({
    module: 'Alumni', operation: 'GET', feature: 'alumni',
    description: 'For a former student: one of their own certificate requests in full (answers, dates, the office remarks or rejection reason, whether it is ready). Read-only.',
    inputSchema: closed({ document: text(120, 'The kind of certificate, e.g. "character"') }),
    permission: 'alumni.directory.read', forRoles: ['ALUMNUS'],
    service: 'documentRequest.service.listMine() + getMine()',
    async run(ctx, args) {
      const r = await docRequests.getMine(ctx.actor, (await myRequest(ctx, args.document)).id);
      return shown(requestView(r), speakRequest(r));
    },
  }),

  get_document_request: tool({
    module: 'Certificates', operation: 'GET',
    description: "School office: one student's document request in full — the student and class, the answers, purpose, required-by date, where it stands and every issued version. Read-only.",
    inputSchema: closed({ ...docRef }),
    permission: 'students.manage', minScope: 'ALL',
    service: 'documentRequest.service.listForSchool() + getForSchool()',
    async run(_ctx, args) {
      const r = await docRequests.getForSchool((await officeRequest(args)).id);
      return shown(requestView(r), speakRequest(r));
    },
  }),

  start_document_request_review: tool({
    module: 'Certificates', operation: 'ACTION', affectsOthers: true,
    description: 'School office: mark a pending document request as under review (the student and family are told the office is looking at it). Needs confirmation.',
    inputSchema: closed({ ...docRef }),
    permission: 'students.manage', minScope: 'ALL',
    service: 'documentRequest.service.startReview()',
    async prepare(_ctx, args) {
      const r = await officeRequest(args, 'PENDING');
      return { id: r.id, what: `${r.documentTypeName} for ${r.student?.name ?? 'the student'}` };
    },
    summarise: (a, _actor, p) => `Start reviewing the ${p?.what ?? `${a.document ?? 'document'} request${a.studentName ? ` for ${a.studentName}` : ''}`}; the family is told`,
    async run(ctx, _args, p) {
      const r = await docRequests.startReview(ctx.actor, p.id);
      return did('document_request_under_review', r, `The ${p.what} is now under review.`);
    },
  }),

  record_document_request_decision: tool({
    module: 'Certificates', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "School office: record your own decision on a student's document request that is pending or under review — APPROVE (with optional remarks) or REJECT (with the reason the family will read). Recorded only when you state the decision in your own words; never suggested. Generating or uploading the document is a separate step. Confirmed on the website.",
    inputSchema: closed({ ...docRef, decision: decisionArg(['APPROVE', 'REJECT'], 'The office'), reason: text(1000, 'Required to reject; remarks when approving') }, ['decision']),
    permission: 'students.manage', minScope: 'ALL',
    service: 'documentRequest.service.approve() / reject()',
    async prepare(_ctx, args) {
      if (args.decision === 'REJECT' && String(args.reason ?? '').trim().length < 3) throw ask('Give the reason for rejecting, so the family knows what to do.');
      const r = await officeRequest(args, 'PENDING,UNDER_REVIEW');
      return { id: r.id, what: `${r.documentTypeName} for ${r.student?.name ?? 'the student'}` };
    },
    summarise: (a, _actor, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Reject'} the ${p?.what ?? 'document request'}${a.reason ? ` — ${excerpt(a.reason, 120)}` : ''}; the family is told`,
    async run(ctx, args, p) {
      const r = args.decision === 'APPROVE'
        ? await docRequests.approve(ctx.actor, p.id, { remarks: args.reason })
        : await docRequests.reject(ctx.actor, p.id, { reason: args.reason });
      return did('document_request_decided', r, `Recorded: the ${p.what} is ${words(r.status)}.`);
    },
  }),

  get_certificate_preview: tool({
    module: 'Certificates', operation: 'GET',
    description: "School office: preview the certificate that would be generated for a student's request — the particulars taken from the records, the office details you add, and whether dues must be cleared first. Nothing is saved. Read-only.",
    inputSchema: closed({
      ...docRef, reasonForLeaving: text(300), conduct: text(60), promotion: text(200), subjects: text(400), lastExam: text(200),
      purpose: text(200), remarks: text(500), leavingDate: text(20, 'As it should be printed'),
    }),
    permission: 'students.manage', minScope: 'ALL',
    service: 'leadership/certificates.service.preview()',
    async run(ctx, args) {
      const r = await officeRequest(args);
      const { document: _d, studentName: _s, ...office } = args;
      const v = await certificates.preview(ctx.actor, r.id, office);
      const dues = v.needsClearance && !v.clearance?.clear;
      return shown({ title: v.title, kind: v.kind, student: r.student?.name, rows: v.rows ?? null, body: v.body ?? null, needsClearance: v.needsClearance, clearance: v.clearance }, `${v.title} for ${r.student?.name}: ${(v.rows ?? []).length ? `${v.rows.length} particulars filled from the records` : 'text drafted from the records'}.${dues ? ' Dues are open, so it cannot be generated until they are cleared or a reason is given.' : ''}`);
    },
  }),

  list_document_types: tool({
    module: 'Certificates', operation: 'GET',
    description: 'The document types the school issues (bonafide, transfer, character ...), whether each is open to requests, its questions and allowed file formats. Read-only.',
    permission: 'settings.manage',
    service: 'documentType.service.list()',
    async run() {
      return listed(await docTypes.list(), (t) => `${t.name}${t.isActive ? '' : ' (inactive)'}${t.isActive && !t.requestEnabled ? ' (not requestable)' : ''}`, { noun: 'document type' });
    },
  }),

  create_document_type: tool({
    module: 'Certificates', operation: 'CREATE',
    description: 'Add a document type the school issues (e.g. "Migration certificate"), with what to tell the requester, extra questions, and whether students and families can request it yet. Needs confirmation.',
    inputSchema: closed({ name: text(120), ...typeFields }, ['name']),
    permission: 'settings.manage',
    service: 'documentType.service.create()',
    summarise: (a) => `Add the document type "${a.name}"${a.requestable === false ? ' (not open to requests yet)' : ''}${a.questions?.length ? ` with ${a.questions.length} question(s)` : ''}`,
    async run(ctx, args) {
      const t = await docTypes.create(ctx.actor, { name: args.name, isActive: args.active ?? true, requestEnabled: args.requestable ?? true, maxFileSizeMb: 5, allowedFileTypes: ['pdf'], ...typeBody(args) });
      return did('document_type_created', t, `Added "${t.name}".`);
    },
  }),

  add_suggested_document_types: tool({
    module: 'Certificates', operation: 'CREATE',
    description: 'Add the standard document types the school does not have yet (bonafide, study, character, fee, leaving, transfer, enrolment certificates), as ordinary editable types. Needs confirmation.',
    permission: 'settings.manage',
    service: 'documentType.service.addSuggested()',
    summarise: () => 'Add the suggested document types the school does not have yet (bonafide, study, character, fee, leaving, transfer, enrolment)',
    async run(ctx) {
      const out = await docTypes.addSuggested(ctx.actor);
      const created = out.created ?? out.items ?? (Array.isArray(out) ? out : []);
      return did('document_types_added', null, created.length ? `Added ${created.length}: ${created.map((t) => t.name).join(', ')}.` : 'The school already has every suggested type.');
    },
  }),

  update_document_type: tool({
    module: 'Certificates', operation: 'UPDATE',
    description: 'Change a document type: rename it, its instructions, questions, file formats, or switch it on/off for requests. Needs confirmation.',
    inputSchema: closed({ documentType: text(120, 'Its current name'), newName: text(120), ...typeFields }, ['documentType']),
    permission: 'settings.manage',
    service: 'documentType.service.list() + update()',
    async prepare(_ctx, args) {
      const t = await typeNamed(args.documentType);
      const body = { ...typeBody(args), ...(args.newName && { name: args.newName }) };
      if (!Object.keys(body).length) throw ask('What should change on it?');
      return { id: t.id, name: t.name, changes: Object.keys(body) };
    },
    summarise: (a, _actor, p) => `Change the document type "${p?.name ?? a.documentType}": ${(p?.changes ?? []).map(words).join(', ')}${a.newName ? ` (renamed to "${a.newName}")` : ''}`,
    async run(ctx, args, p) {
      const t = await docTypes.update(ctx.actor, p.id, { ...typeBody(args), ...(args.newName && { name: args.newName }) });
      return did('document_type_updated', t, `"${t.name}" is updated.`);
    },
  }),

  delete_document_type: tool({
    module: 'Certificates', operation: 'DELETE',
    description: 'Delete a document type nobody has requested yet (one with requests is switched off instead, so its history keeps its meaning). Needs confirmation.',
    inputSchema: closed({ documentType: text(120) }, ['documentType']),
    permission: 'settings.manage',
    service: 'documentType.service.remove()',
    async prepare(_ctx, args) { const t = await typeNamed(args.documentType); return { id: t.id, name: t.name }; },
    summarise: (a, _actor, p) => `Delete the document type "${p?.name ?? a.documentType}"`,
    async run(ctx, _args, p) {
      await docTypes.remove(ctx.actor, p.id);
      return did('document_type_deleted', { id: p.id }, `Deleted "${p.name}".`);
    },
  }),
};

/* ── Approvals ────────────────────────────────────────────── */

const STAGE_ROLES = ['PRINCIPAL', 'FINANCE', 'TRUSTEE', 'ADMIN', 'HR', 'COMPLIANCE'];
const readScope = (ctx) => ctx.actor?.permissions?.['approvals.read'] ?? 'OWN';
const requestRow = (r) => ({ ref: r.refNo, title: r.title, category: r.category, status: r.status, amount: r.amountPaise ? rupeesOf(r.amountPaise) : null, stage: r.currentStageName, approver: r.currentApproverRole, requestedBy: r.requesterName, dueOn: day(r.dueAt), overdue: Boolean(r.isOverdue), escalated: Boolean(r.escalation?.escalated) });

/** An approval request the caller can see (raised by them, at their stage, or any at ALL), by reference or title. */
async function approvalNamed(ctx, term, { mine = false, statuses } = {}) {
  const [listedRows, waiting] = await Promise.all([
    approvals.list(ctx.actor, readScope(ctx), { pageSize: 200, ...(mine && { mine: 'true' }) }),
    mine ? [] : approvals.inbox(ctx.actor),
  ]);
  const seen = new Set();
  let pool = [...rowsOf(listedRows), ...rowsOf(waiting)].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  if (statuses) pool = pool.filter((r) => statuses.includes(r.status));
  return pick(pool, term, { label: 'approval request', nameOf: (r) => r.title, describe: (r) => `${r.refNo} ${r.title} (${words(r.status)})` });
}

const approvalTools = {
  get_approvals_summary: tool({
    module: 'Approvals', operation: 'GET',
    description: 'How many approval requests are waiting on the caller, how many are overdue and how many urgent. Read-only.',
    permission: 'approvals.read',
    service: 'approval.service.summaryFor()',
    async run(ctx) {
      const s = await approvals.summaryFor(ctx.actor);
      return shown(s, s.waitingOnMe ? `${s.waitingOnMe} request(s) waiting on you, ${s.overdue} overdue, ${s.urgent} urgent. Decide them on the Approvals page.` : 'Nothing is waiting on you.');
    },
  }),

  list_approval_policies: tool({
    module: 'Approvals', operation: 'GET',
    description: 'The approval route for each kind of request (purchases, payments, events, agreements ...): its stages, who approves each, the amount from which a stage applies and the days allowed. Read-only.',
    inputSchema: closed({ category: oneOf(APPROVAL_CATEGORIES) }),
    permission: 'approvals.read',
    service: 'approval.service.listPolicies()',
    async run(_ctx, args) {
      const rows = (await approvals.listPolicies()).filter((p) => !args.category || p.category === args.category);
      return listed(rows, (p) => `${label(p.category)}: ${p.stages.map((s) => `${s.name} (${words(s.approverRole)}${s.minAmountPaise ? ` from ${rupeesOf(s.minAmountPaise)}` : ''})`).join(' → ')}${p.custom ? ' [custom]' : ''}`, { noun: 'policy' });
    },
  }),

  configure_approval_policy: tool({
    module: 'Approvals', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Set the approval route for one kind of request (1 to 6 stages, each with its approver role and the amount in rupees from which it applies; one stage must apply to every amount, and the days allowed), or reset it to the school default. Applies to new requests across the school. Confirmed on the website.",
    inputSchema: closed({
      category: oneOf(APPROVAL_CATEGORIES), step: oneOf(['SET', 'RESET_TO_DEFAULT']),
      stages: list(closed({ name: text(80), approverRole: oneOf(STAGE_ROLES), fromRupees: num(0, 1e10, 'Applies from this amount (0 = always)') }, ['name', 'approverRole']), 6),
      dueDays: int(1, 60), note: text(500),
    }, ['category', 'step']),
    permission: 'approvals.configure',
    service: 'approval.service.setPolicy() / resetPolicy()',
    async prepare(_ctx, args) {
      if (args.step === 'SET' && !(args.stages ?? []).length) throw ask('List the stages: a name and the approver role for each.');
      return undefined;
    },
    summarise: (a) => (a.step === 'RESET_TO_DEFAULT'
      ? `Reset the ${label(a.category)} approval route to the school default`
      : `Set the ${label(a.category)} approval route to: ${(a.stages ?? []).map((s) => `${s.name} (${words(s.approverRole)}${s.fromRupees ? ` from ₹${s.fromRupees}` : ''})`).join(' → ')}${a.dueDays ? `, ${a.dueDays} day(s) allowed` : ''}`),
    async run(ctx, args) {
      const p = args.step === 'RESET_TO_DEFAULT'
        ? await approvals.resetPolicy(args.category)
        : await approvals.setPolicy(ctx.actor, args.category, { stages: args.stages.map((s) => ({ name: s.name, approverRole: s.approverRole, minAmountPaise: Math.round((s.fromRupees ?? 0) * 100) })), dueDays: args.dueDays, note: args.note });
      return did('approval_policy_set', { id: p.category, ...p }, `${label(p.category)}: ${p.stages.map((s) => s.name).join(' → ')}${p.custom ? '' : ' (default)'}.`);
    },
  }),

  list_approval_delegations: tool({
    module: 'Approvals', operation: 'GET',
    description: 'Approval delegations the caller gave or received: to whom, for which kinds of request, the amount limit and the dates. Read-only.',
    permission: 'approvals.read',
    service: 'approval.service.listDelegations()',
    async run(ctx) {
      const me = String(ctx.actor.profileId);
      const rows = await approvals.listDelegations(ctx.actor);
      return listed(rows, (d) => `${String(d.fromProfileId) === me ? `to ${d.toName}` : `from ${words(d.fromRole)}`} ${day(d.startsOn)} – ${day(d.endsOn)}${d.revokedAt ? ' (revoked)' : ''}`, { noun: 'delegation' });
    },
  }),

  delegate_approvals: tool({
    module: 'Approvals', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Hand your approval stages to a colleague for a period (at most 90 days), e.g. while you are on leave: optionally only some kinds of request and up to an amount. They are told. Confirmed on the website.",
    inputSchema: closed({
      to: text(120, 'The colleague, by name'), from: dateStr('First day'), until: dateStr('Last day'),
      categories: list(oneOf(APPROVAL_CATEGORIES), 21), maxRupees: num(1, 1e10), reason: text(500),
    }, ['to', 'from', 'until']),
    permission: 'approvals.decide',
    service: 'approval.service.createDelegation()',
    async prepare(ctx, args) {
      const p = await staffNamed(args.to, 'colleague');
      if (p.id === String(ctx.actor.profileId)) throw ask('Choose someone other than yourself.');
      return { toProfileId: p.id, name: p.name };
    },
    summarise: (a, _actor, p) => `Delegate your approvals to ${p?.name ?? a.to} from ${a.from} to ${a.until}${a.categories?.length ? ` for ${a.categories.map(words).join(', ')}` : ''}${a.maxRupees ? ` up to ₹${a.maxRupees}` : ''}`,
    async run(ctx, args, p) {
      const d = await approvals.createDelegation(ctx.actor, { toProfileId: p.toProfileId, startsOn: args.from, endsOn: `${args.until}T23:59:59+05:30`, categories: args.categories, maxAmountPaise: args.maxRupees ? Math.round(args.maxRupees * 100) : null, reason: args.reason });
      return did('approvals_delegated', d, `${p.name} can decide your approvals from ${args.from} to ${args.until}.`);
    },
  }),

  revoke_approval_delegation: tool({
    module: 'Approvals', operation: 'ACTION', affectsOthers: true,
    description: 'End an approval delegation you gave, named by the colleague. Needs confirmation.',
    inputSchema: closed({ to: text(120, 'The colleague you delegated to') }),
    permission: 'approvals.decide',
    service: 'approval.service.listDelegations() + revokeDelegation()',
    async prepare(ctx, args) {
      const now = new Date();
      const rows = (await approvals.listDelegations(ctx.actor)).filter((d) => String(d.fromProfileId) === String(ctx.actor.profileId) && !d.revokedAt && new Date(d.endsOn) >= now);
      const d = pick(rows, args.to ? stripTitle(args.to) : null, { label: 'active delegation of yours', nameOf: (x) => x.toName, refOf: () => '', describe: (x) => `to ${x.toName} until ${day(x.endsOn)}` });
      return { id: d.id, name: d.toName, until: day(d.endsOn) };
    },
    summarise: (a, _actor, p) => `End your approval delegation to ${p?.name ?? a.to}${p?.until ? ` (was until ${p.until})` : ''}`,
    async run(ctx, _args, p) {
      const d = await approvals.revokeDelegation(ctx.actor, p.id);
      return did('approval_delegation_revoked', d, `The delegation to ${p.name} has ended.`);
    },
  }),

  list_approval_requests: tool({
    module: 'Approvals', operation: 'GET',
    description: 'The approval request register: requests the caller raised (or every request, school-wide), with their stage, amount and status. Filter by status or kind. Read-only; deciding happens on the Approvals page.',
    inputSchema: closed({ status: oneOf(['PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'WITHDRAWN']), category: oneOf(APPROVAL_CATEGORIES), mine: bool('Only the ones I raised') }),
    permission: 'approvals.read',
    service: 'approval.service.list()',
    async run(ctx, args) {
      const out = await approvals.list(ctx.actor, ctx.scope, { pageSize: 200, status: args.status, category: args.category, ...(args.mine && { mine: 'true' }) });
      return listed(rowsOf(out).map(requestRow), (r) => `${r.ref} ${r.title} (${words(r.status)}${r.stage ? `, at ${r.stage}` : ''}${r.overdue ? ', overdue' : ''})`, { noun: 'request' });
    },
  }),

  get_approval_request: tool({
    module: 'Approvals', operation: 'GET',
    description: 'One approval request in full: what is asked, amount, every stage and who decided it with their comments, the history and conflicts declared. Read-only.',
    inputSchema: closed({ request: text(200, 'Its reference (APR-...) or title') }, ['request']),
    permission: 'approvals.read',
    service: 'approval.service.getRequest()',
    async run(ctx, args) {
      const r = await approvals.getRequest(ctx.actor, ctx.scope, (await approvalNamed(ctx, args.request)).id);
      return shown({ ...requestRow(r), summary: r.summary, recommendation: r.recommendation, stages: (r.stages ?? []).map((s) => ({ name: s.name, approver: s.approverRole, status: s.status, decidedBy: s.decidedByName ?? null, comment: s.comment ?? null })), history: (r.history ?? []).map((h) => `${h.action} ${h.byName ?? ''}${h.note ? `: ${h.note}` : ''}`), canDecide: r.canDecide }, `${r.refNo} ${r.title}: ${words(r.status)}${r.currentStageName ? `, at ${r.currentStageName}` : ''}.`);
    },
  }),

  submit_approval_request: tool({
    module: 'Approvals', operation: 'CREATE', affectsOthers: true,
    description: 'Raise an approval request for something with no record of its own elsewhere (travel, a public communication, an academic action, other): title, what and why, an amount in rupees if any, priority and a due date. It goes to the first approver on the route. Needs confirmation.',
    inputSchema: closed({
      category: oneOf(APPROVAL_CATEGORIES), title: text(200), summary: text(5000), amountRupees: num(0, 1e10),
      priority: oneOf(['LOW', 'NORMAL', 'HIGH', 'URGENT']), dueDate: dateStr(), department: text(80), recommendation: text(2000),
    }, ['category', 'title']),
    permission: 'approvals.submit',
    service: 'approval.service.createRequest()',
    summarise: (a) => `Raise a ${words(a.category)} approval request "${a.title}"${a.amountRupees ? ` for ₹${a.amountRupees}` : ''}${a.priority ? ` (${words(a.priority)})` : ''}${a.dueDate ? `, due ${a.dueDate}` : ''}`,
    async run(ctx, args) {
      const r = await approvals.createRequest(ctx.actor, { category: args.category, title: args.title, summary: args.summary, amountPaise: args.amountRupees ? Math.round(args.amountRupees * 100) : 0, priority: args.priority, dueAt: args.dueDate ? `${args.dueDate}T18:00:00+05:30` : undefined, department: args.department, recommendation: args.recommendation });
      return did('approval_requested', r, `Raised ${r.refNo}; it is with ${r.currentStageName ?? 'the first approver'}.`);
    },
  }),

  update_my_approval_request: tool({
    module: 'Approvals', operation: 'ACTION',
    description: "For the person who raised an approval request: RESUBMIT one that was returned (say what you changed; optionally a new summary or amount) or WITHDRAW one that is pending or returned. Needs confirmation.",
    inputSchema: closed({ request: text(200, 'Its reference (APR-...) or title'), step: oneOf(['RESUBMIT', 'WITHDRAW']), note: text(2000, 'What changed (resubmit) or why (withdraw)'), summary: text(5000), amountRupees: num(0, 1e10) }, ['step']),
    permission: 'approvals.submit',
    service: 'approval.service.resubmit() / withdraw()',
    async prepare(ctx, args) {
      if (args.step === 'RESUBMIT' && !args.note) throw ask('Say what you changed, for the approver.');
      const r = await approvalNamed(ctx, args.request, { mine: true, statuses: args.step === 'RESUBMIT' ? ['RETURNED'] : ['PENDING', 'RETURNED'] });
      return { id: r.id, ref: r.refNo, title: r.title };
    },
    summarise: (a, _actor, p) => `${a.step === 'RESUBMIT' ? 'Resubmit' : 'Withdraw'} ${p?.ref ?? a.request ?? 'your request'} "${excerpt(p?.title ?? '', 80)}"${a.note ? ` — ${excerpt(a.note, 120)}` : ''}${a.amountRupees !== undefined ? `, amount ₹${a.amountRupees}` : ''}`,
    async run(ctx, args, p) {
      const r = args.step === 'RESUBMIT'
        ? await approvals.resubmit(ctx.actor, p.id, { changeNote: args.note, ...(args.summary !== undefined && { summary: args.summary }), ...(args.amountRupees !== undefined && { amountPaise: Math.round(args.amountRupees * 100) }) })
        : await approvals.withdraw(ctx.actor, p.id, { reason: args.note });
      return did(args.step === 'RESUBMIT' ? 'approval_resubmitted' : 'approval_withdrawn', r, `${r.refNo} is ${words(r.status)}.`);
    },
  }),

  declare_approval_conflict: tool({
    module: 'Approvals', operation: 'ACTION', risk: RISK.LOW,
    description: 'As an approver: declare a conflict of interest on a request (e.g. a relative is the vendor). You are taken off deciding it. Needs confirmation.',
    inputSchema: closed({ request: text(200, 'Its reference (APR-...) or title'), declaration: text(1000) }, ['request', 'declaration']),
    permission: 'approvals.decide',
    service: 'approval.service.declareConflict()',
    async prepare(ctx, args) { const r = await approvalNamed(ctx, args.request); return { id: r.id, ref: r.refNo, title: r.title }; },
    summarise: (a, _actor, p) => `Declare a conflict of interest on ${p?.ref ?? a.request} "${excerpt(p?.title ?? '', 80)}": ${excerpt(a.declaration, 150)}`,
    async run(ctx, args, p) {
      const r = await approvals.declareConflict(ctx.actor, p.id, { declaration: args.declaration });
      return did('approval_conflict_declared', r, `Conflict recorded on ${r.refNo}; you will not decide it.`);
    },
  }),

  escalate_approval_request: tool({
    module: 'Approvals', operation: 'ACTION', affectsOthers: true,
    description: "Raise an overdue (or urgent) pending request to the next level's attention (finance → principal → trustees). Only its requester or the stage approver can. Needs confirmation.",
    inputSchema: closed({ request: text(200, 'Its reference (APR-...) or title'), reason: text(1000) }, ['request']),
    permission: 'approvals.read',
    service: 'approval.service.escalate()',
    async prepare(ctx, args) { const r = await approvalNamed(ctx, args.request, { statuses: ['PENDING'] }); return { id: r.id, ref: r.refNo, title: r.title }; },
    summarise: (a, _actor, p) => `Escalate ${p?.ref ?? a.request} "${excerpt(p?.title ?? '', 80)}"${a.reason ? ` — ${excerpt(a.reason, 120)}` : ''}`,
    async run(ctx, args, p) {
      const r = await approvals.escalate(ctx.actor, p.id, { reason: args.reason });
      return did('approval_escalated', r, `${r.refNo} is escalated to the ${words(r.escalation?.toRole ?? 'next level')}.`);
    },
  }),
};

/* ── Messaging, institution, customization, policy ───────── */

const SWITCHABLE = FEATURE_KEYS.filter((k) => k !== 'camera');

const settingsTools = {
  get_my_message_preferences: tool({
    module: 'Notifications', operation: 'GET',
    description: 'How the school contacts you: WhatsApp updates on or off, email, the language of school messages and your quiet hours. Read-only.',
    permission: 'ai.copilot.use',
    service: 'messaging.service.getPreferences()',
    async run(ctx) {
      const p = await messaging.getPreferences(ctx.actor);
      return shown({ whatsapp: p.whatsappOptIn?.status ?? 'UNKNOWN', emailOff: Boolean(p.emailOptOut), language: p.language, quietHours: p.quietHours }, `WhatsApp: ${words(p.whatsappOptIn?.status ?? 'unknown')}; email ${p.emailOptOut ? 'off' : 'on'}; language ${p.language}; quiet hours ${p.quietHours?.enabled ? `${p.quietHours.startHour}:00 to ${p.quietHours.endHour}:00` : 'off'}.`);
    },
  }),

  get_messaging_channels: tool({
    module: 'Notifications', operation: 'GET',
    description: 'Whether WhatsApp and email are live or in simulation, SMS status, and which WhatsApp message templates are configured. Read-only.',
    permission: 'messaging.read',
    service: 'messaging.service.channelStatus()',
    async run() {
      const c = messaging.channelStatus();
      const missing = c.whatsapp.templates.filter((t) => !t.configuredName).length;
      return shown(c, `WhatsApp ${words(c.whatsapp.mode)} (${missing} of ${c.whatsapp.templates.length} templates not configured), email ${words(c.email.mode)}, SMS ${words(c.sms.mode)}.`);
    },
  }),

  list_message_outbox: tool({
    module: 'Notifications', operation: 'GET',
    description: 'The outgoing WhatsApp/email message log and each delivery state (queued, deferred for quiet hours, sent, delivered, failed, skipped for no consent). School-wide for the office, otherwise your own. Read-only.',
    inputSchema: closed({ status: oneOf(['QUEUED', 'DEFERRED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN', 'SIMULATED', 'SKIPPED_NO_CONTACT', 'SKIPPED_NO_CONSENT', 'SKIPPED_TEMPLATE_NOT_CONFIGURED']) }),
    permission: 'messaging.read',
    service: 'messaging.service.listOutbox()',
    async run(ctx, args) {
      const out = await messaging.listOutbox(ctx.actor, ctx.scope, { status: args.status, pageSize: 100 });
      const rows = rowsOf(out).map((m) => ({ template: m.templateKey, channel: m.channel, to: m.recipientMasked, status: m.status, reason: m.statusReason, at: m.createdAt, scheduledFor: m.scheduledFor }));
      return listed(rows, (m) => `${words(m.template)} by ${words(m.channel)} to ${m.to ?? 'a recipient'}: ${words(m.status)}`, { noun: 'message' });
    },
  }),

  release_deferred_messages: tool({
    module: 'Notifications', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Send the WhatsApp messages that were held back for quiet hours and are now due (consent and contact details are checked again first). Confirmed on the website.',
    permission: 'messaging.manage',
    service: 'messaging.service.releaseDeferred()',
    summarise: () => 'Send the deferred WhatsApp messages that are now due',
    async run(ctx) {
      const r = await messaging.releaseDeferred(ctx.actor);
      return did('deferred_messages_released', null, r.released ? `Released ${r.released}: ${Object.entries(r.byStatus).map(([k, v]) => `${v} ${words(k)}`).join(', ')}.` : 'No deferred messages were due.');
    },
  }),

  get_institution_terminology: tool({
    module: 'Organisation', operation: 'GET',
    description: 'The words this institution uses: Class or Programme, Section or Batch, Class teacher or Mentor, Term or Semester, and so on. Read-only.',
    permission: 'ai.copilot.use',
    service: 'institution.service.terminology()',
    async run() {
      const t = await institution.terminology();
      return shown(t, `${label(t.institutionType)}: ${t.grade} / ${t.section}, ${t.classTeacher}, ${t.term}, head is the ${t.head}, governing body the ${t.governingBody}.`);
    },
  }),

  list_school_features: tool({
    module: 'Customization', operation: 'GET',
    description: 'Which modules this school has switched on or off (clubs, alumni, PTM, bills, labs, fleet, health room ...), and what each needs. Read-only.',
    permission: 'ai.copilot.use',
    service: 'utils/features.describeFeatures()',
    async run() {
      const rows = await describeFeatures();
      return listed(rows, (f) => `${f.label}: ${f.enabled ? 'on' : 'off'}`, { noun: 'module', speak: `On: ${rows.filter((f) => f.enabled).map((f) => f.label).join(', ') || 'none'}. Off: ${rows.filter((f) => !f.enabled).map((f) => f.label).join(', ') || 'none'}.` });
    },
  }),

  set_module_switches: tool({
    module: 'Settings', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Switch modules on or off for the whole school (e.g. turn on hostel out-pass, turn off sustainability). Screens and the assistant hide what is off. Camera review is switched on the screen only. Confirmed on the website.",
    inputSchema: closed({ turnOn: list(oneOf(SWITCHABLE), SWITCHABLE.length), turnOff: list(oneOf(SWITCHABLE), SWITCHABLE.length) }),
    permission: 'settings.manage', minScope: 'ALL',
    service: 'utils/features.setFeatures()',
    async prepare(_ctx, args) {
      if (!(args.turnOn?.length || args.turnOff?.length)) throw ask('Which modules should be switched on or off?');
      const both = (args.turnOn ?? []).filter((k) => (args.turnOff ?? []).includes(k));
      if (both.length) throw ask(`${both.map((k) => FEATURES[k].label).join(', ')} cannot be both on and off.`);
      return undefined;
    },
    summarise: (a) => [a.turnOn?.length ? `Switch ON: ${a.turnOn.map((k) => FEATURES[k].label).join(', ')}` : '', a.turnOff?.length ? `Switch OFF: ${a.turnOff.map((k) => FEATURES[k].label).join(', ')}` : ''].filter(Boolean).join('; ') + ' — for the whole school',
    async run(_ctx, args) {
      const changes = Object.fromEntries([...(args.turnOn ?? []).map((k) => [k, true]), ...(args.turnOff ?? []).map((k) => [k, false])]);
      const rows = await setFeatures(changes);
      return did('school_features_set', null, `Done. ${Object.keys(changes).map((k) => `${FEATURES[k].label}: ${rows.find((r) => r.key === k)?.enabled ? 'on' : 'off'}`).join('; ')}.`);
    },
  }),

  get_institution_profile: tool({
    module: 'Organisation', operation: 'GET',
    description: "The institution profile: names, type, management, legal entity, contact, boards, campuses, affiliations, public disclosures, the academic and financial year start, and what is still missing from it. Read-only.",
    permission: 'institution.read',
    service: 'institution.service.getProfile()',
    async run() {
      const p = await institution.getProfile();
      return shown(p, `${p.displayName}${p.legalName ? ` (${p.legalName})` : ''}, ${words(p.institutionType)}; ${(p.campuses ?? []).length} campus(es), ${(p.affiliations ?? []).length} affiliation(s). Profile ${p.completeness.percent}% complete${p.completeness.missing.length ? `; missing: ${p.completeness.missing.join(', ')}` : ''}.`);
    },
  }),

  update_institution_profile: tool({
    module: 'Organisation', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Change the institution profile: display, legal and short name, motto, about, website, year established, management, contact email and phone, boards, the months the academic and financial years start, and the words used for class, section, term and so on. Campuses, affiliations and disclosures are edited on the Institution screen. Confirmed on the website.",
    inputSchema: closed({
      displayName: text(160), legalName: text(300), shortName: text(300), motto: text(300), about: text(5000), website: text(300),
      establishedYear: int(1700, 2100), management: oneOf(['PRIVATE_UNAIDED', 'PRIVATE_AIDED', 'GOVERNMENT', 'CENTRAL', 'OTHER']),
      email: text(200), phone: text(30), boards: list(text(30), 10), academicYearStartMonth: int(1, 12), financialYearStartMonth: int(1, 12),
      words: closed(Object.fromEntries(['grade', 'section', 'classTeacher', 'term', 'head', 'student', 'guardian', 'faculty', 'department', 'course', 'governingBody'].map((k) => [k, text(60)])), []),
    }),
    permission: 'institution.manage',
    service: 'institution.service.updateProfile()',
    async prepare(_ctx, args) {
      if (!Object.keys(args).length) throw ask('What should change on the profile?');
      return undefined;
    },
    summarise: (a) => `Update the institution profile: ${Object.entries(a).map(([k, v]) => `${words(k)} → ${typeof v === 'object' ? JSON.stringify(v) : excerpt(String(v), 60)}`).join('; ')}`,
    async run(ctx, args) {
      const { email, phone, words: terms, ...rest } = args;
      const current = await institution.getProfile();
      const body = { ...rest };
      if (email !== undefined || phone !== undefined) body.contact = { email: email ?? current.contact?.email ?? null, phone: phone ?? current.contact?.phone ?? null };
      if (terms) {
        const base = institution.TERMINOLOGY[current.institutionType ?? 'SCHOOL'];
        const overridden = Object.fromEntries(Object.entries(current.terminology ?? {}).filter(([k, v]) => base[k] !== v));
        body.terminology = { ...overridden, ...terms };
      }
      const p = await institution.updateProfile(ctx.actor, body);
      return did('institution_profile_updated', p, `Saved. The profile is ${p.completeness.percent}% complete.`);
    },
  }),

  get_single_approver_mode: tool({
    module: 'Customization', operation: 'GET',
    description: "Whether the school is in single-approver mode (a principal or administrator may approve their own showcase entry, fixture result, offline campaign or bill payment because there is no second approver), who switched it and why. Read-only.",
    permission: 'ai.copilot.use',
    service: 'approverMode.service.getApproverMode()',
    async run() {
      const m = await approverMode.getApproverMode();
      return shown(m, m.singleApproverMode ? `Single-approver mode is ON (since ${day(m.changedAt)}, by ${m.changedBy ?? 'the office'}: ${m.reason ?? 'no reason given'}).` : 'Single-approver mode is off: a second person approves.');
    },
  }),

  set_single_approver_mode: tool({
    module: 'Settings', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Switch single-approver mode on (say why the school has no second approver) or off. When on, a principal or administrator may approve their own showcase entry, fixture result, offline campaign or bill payment, each marked and audit-logged. Confirmed on the website.",
    inputSchema: closed({ on: bool(), reason: text(500) }, ['on']),
    permission: 'settings.manage', minScope: 'ALL',
    service: 'approverMode.service.setApproverMode()',
    async prepare(_ctx, args) {
      if (args.on && !args.reason) throw ask('Say why the school has no second approver.');
      return undefined;
    },
    summarise: (a) => `Switch single-approver mode ${a.on ? `ON — ${excerpt(a.reason, 120)}` : 'OFF (a second person approves again)'}`,
    async run(ctx, args) {
      const m = await approverMode.setApproverMode(ctx.actor, { enabled: args.on, reason: args.reason });
      return did('single_approver_mode_set', { id: 'singleApproverMode', ...m }, `Single-approver mode is ${m.singleApproverMode ? 'on' : 'off'}.`);
    },
  }),

  get_school_theme: tool({
    module: 'Customization', operation: 'GET',
    description: "This school's look: its name and tagline as branded, colours, header and sidebar settings. Read-only.",
    permission: 'ai.copilot.use',
    service: 'customization.service.getTheme()',
    async run() {
      const t = await customization.getTheme();
      return shown({ branding: t.branding, theme: t.theme, header: t.header, sidebar: t.sidebar }, `${t.branding?.displayName ?? 'The school'}${t.branding?.tagline ? ` — ${t.branding.tagline}` : ''}${t.theme?.primaryColor ? `; primary colour ${t.theme.primaryColor}` : ''}.`);
    },
  }),

  get_school_dropdown: tool({
    module: 'Customization', operation: 'GET',
    description: 'The options one of this school\'s form lists offers, e.g. its houses or zones. Read-only.',
    inputSchema: closed({ list: text(40, 'e.g. "house"') }, ['list']),
    permission: 'ai.copilot.use',
    service: 'customization.service.getDropdown()',
    async run(_ctx, args) {
      const d = await customization.getDropdown(args.list);
      return listed(d.options, (o) => o.label ?? o.value ?? String(o), { noun: 'option', speak: d.options.length ? `${d.label}: ${d.options.map((o) => o.label ?? o.value).join(', ')}.` : `This school has no "${d.key}" list.` });
    },
  }),
};

/* ── Correspondence ───────────────────────────────────────── */

const letterArg = text(300, 'Its reference (INW-.../OUT-...) or subject');

async function letterNamed(ctx, term) {
  const out = await correspondence.list(ctx.actor, ctx.scope, { pageSize: 200, ...(term && { q: String(term).slice(0, 100) }) });
  return pick(rowsOf(out), term, { label: 'letter', nameOf: (c) => c.subject, describe: (c) => `${c.refNo} "${excerpt(c.subject, 50)}" (${words(c.status)})` });
}
const letterSpeak = (c) => `${c.refNo} "${excerpt(c.subject, 80)}" ${c.direction === 'INWARD' ? 'from' : 'to'} ${c.counterpartyName}: ${words(c.status)}${c.dueOn ? `, due ${day(c.dueOn)}` : ''}${c.isOverdue ? ' (overdue)' : ''}.`;

const correspondenceTools = {
  get_correspondence_stats: tool({
    module: 'Correspondence', operation: 'GET',
    description: 'Correspondence register counts: open letters, overdue, due within a week, replies awaiting approval and approved replies waiting to be dispatched. Read-only.',
    permission: 'correspondence.read',
    service: 'correspondence.service.stats()',
    async run(ctx) {
      const s = await correspondence.stats(ctx.actor, ctx.scope);
      return shown(s, `${s.open} open, ${s.overdue} overdue, ${s.dueSoon} due this week, ${s.awaitingApproval} awaiting approval, ${s.toDispatch} to dispatch.`);
    },
  }),

  get_letter_deadlines: tool({
    module: 'Correspondence', operation: 'GET',
    description: "Find the deadlines and required actions in a letter: either a letter already in the register (by reference or subject) or pasted text. Pattern-matching, no AI; a person decides what to apply. Read-only.",
    inputSchema: closed({ letter: letterArg, text: text(50000, 'Pasted letter text'), receivedOn: dateStr('For pasted text: when it arrived (for "within N days")') }),
    permission: 'correspondence.read',
    service: 'correspondence.service.suggest() / extractTasks()',
    async run(ctx, args) {
      if (!args.letter && !args.text) throw ask('Which letter? Give its reference, or paste the text.');
      const out = args.letter
        ? await correspondence.suggest(ctx.actor, ctx.scope, (await letterNamed(ctx, args.letter)).id)
        : correspondence.extractTasks(args.text, args.receivedOn ? new Date(args.receivedOn) : new Date());
      return shown(out, `${out.deadlines.length ? `Dates found: ${out.deadlines.map((d) => `${d.date} ("${d.text}")`).join('; ')}.` : 'No dates found.'}${out.suggestedDueOn ? ` Suggested due date ${out.suggestedDueOn}.` : ''}${out.actions.length ? ` ${out.actions.length} action sentence(s): ${out.actions.slice(0, 3).map((a) => excerpt(a, 100)).join(' | ')}` : ''}`);
    },
  }),

  send_correspondence_reminders: tool({
    module: 'Correspondence', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Run the correspondence reminders now: everyone owning or assigned an open letter due within the next days (or overdue), and any reminder whose time has come, is messaged. Safe to repeat the same day. Confirmed on the website.',
    inputSchema: closed({ withinDays: int(0, 30, 'Default 3') }),
    permission: 'correspondence.manage',
    service: 'correspondence.service.sendDueReminders()',
    summarise: (a) => `Send reminders for open letters due within ${a.withinDays ?? 3} day(s) or overdue, and any reminders now due`,
    async run(ctx, args) {
      const r = await correspondence.sendDueReminders(ctx.actor, { withinDays: args.withinDays ?? 3 });
      return did('correspondence_reminders_sent', null, `${r.itemsDue} letter(s) due; ${r.notified} reminder(s) sent.`);
    },
  }),

  get_correspondence_letter: tool({
    module: 'Correspondence', operation: 'GET',
    description: 'One letter in the register in full: sender or addressee, their reference, dates, status, owner and assignees, the latest draft reply, dispatch and acknowledgement, reminders and history. Read-only.',
    inputSchema: closed({ letter: letterArg }, ['letter']),
    permission: 'correspondence.read',
    service: 'correspondence.service.get()',
    async run(ctx, args) {
      const c = await correspondence.get(ctx.actor, ctx.scope, (await letterNamed(ctx, args.letter)).id);
      return shown({ refNo: c.refNo, direction: c.direction, subject: c.subject, counterparty: c.counterpartyName, theirReference: c.theirReference, status: c.status, receivedOn: day(c.receivedOn), dueOn: day(c.dueOn), overdue: c.isOverdue, summary: c.summary, latestDraft: c.latestDraft?.body ?? null, dispatch: c.dispatch ?? null, legalHold: Boolean(c.legalHold), sourceVerified: Boolean(c.source?.verified), reminders: (c.reminders ?? []).map((r) => ({ on: day(r.at), note: r.note, sent: Boolean(r.sentAt) })), history: (c.history ?? []).map((h) => `${h.action}${h.note ? `: ${h.note}` : ''}`) }, letterSpeak(c));
    },
  }),

  assign_correspondence: tool({
    module: 'Correspondence', operation: 'ACTION', affectsOthers: true,
    description: 'Give a letter an owner and/or assignees (by name) and a due date; they are told. Needs confirmation.',
    inputSchema: closed({ letter: letterArg, owner: text(120), assignees: list(text(120), 20), dueOn: dateStr(), note: text(500) }, ['letter']),
    permission: 'correspondence.manage',
    service: 'correspondence.service.assign()',
    async prepare(ctx, args) {
      if (!args.owner && !args.assignees?.length && !args.dueOn) throw ask('Who should own it or work on it, or by when?');
      const c = await letterNamed(ctx, args.letter);
      const owner = args.owner ? await staffNamed(args.owner, 'owner') : null;
      const assignees = [];
      for (const n of args.assignees ?? []) assignees.push(await staffNamed(n, 'assignee')); // eslint-disable-line no-await-in-loop
      return { id: c.id, ref: c.refNo, subject: c.subject, owner, assignees };
    },
    summarise: (a, _actor, p) => `On ${p?.ref ?? a.letter}${p?.subject ? ` "${excerpt(p.subject, 60)}"` : ''}: ${[p?.owner ? `owner ${p.owner.name}` : '', p?.assignees?.length ? `assign ${p.assignees.map((x) => x.name).join(', ')}` : '', a.dueOn ? `due ${a.dueOn}` : ''].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const c = await correspondence.assign(ctx.actor, ctx.scope, p.id, { ...(p.owner && { ownerProfileId: p.owner.id }), ...(p.assignees.length && { assigneeProfileIds: p.assignees.map((x) => x.id) }), ...(args.dueOn && { dueOn: args.dueOn }), note: args.note });
      return did('correspondence_assigned', c, `${c.refNo} assigned.`);
    },
  }),

  verify_correspondence_source: tool({
    module: 'Correspondence', operation: 'ACTION', risk: RISK.LOW,
    description: "Record how a letter's source was verified (e.g. called the issuing office, checked on the board's portal). For the letter's owner, an assignee or the office. Needs confirmation.",
    inputSchema: closed({ letter: letterArg, method: text(80, 'How it was verified'), note: text(500) }, ['letter', 'method']),
    permission: 'correspondence.read',
    service: 'correspondence.service.verifySource()',
    async prepare(ctx, args) { const c = await letterNamed(ctx, args.letter); return { id: c.id, ref: c.refNo }; },
    summarise: (a, _actor, p) => `Record ${p?.ref ?? a.letter} as source-verified: ${a.method}${a.note ? ` (${excerpt(a.note, 80)})` : ''}`,
    async run(ctx, args, p) {
      const c = await correspondence.verifySource(ctx.actor, ctx.scope, p.id, { method: args.method, note: args.note });
      return did('correspondence_source_verified', c, `${c.refNo}: source verified.`);
    },
  }),

  move_correspondence_letter: tool({
    module: 'Correspondence', operation: 'ACTION',
    description: "Move a letter along the register: ACKNOWLEDGE receipt, START_WORK on it, NO_ACTION (with the reason), DISPATCH an approved reply (how it went, tracking number), RECORD_DELIVERY (the acknowledgement), or CLOSE it (with the resolution; without a delivery acknowledgement only if you say so). Needs confirmation.",
    inputSchema: closed({
      letter: letterArg, step: oneOf(['ACKNOWLEDGE', 'START_WORK', 'NO_ACTION', 'DISPATCH', 'RECORD_DELIVERY', 'CLOSE']),
      note: text(2000, 'Reason (no action), resolution (close), acknowledgement (delivery) or a note'),
      channel: oneOf(['POST', 'EMAIL', 'PORTAL', 'HAND', 'WHATSAPP', 'COURIER', 'OTHER']), on: dateStr('When it went out / was delivered (default today)'),
      trackingNo: text(120), withoutAcknowledgement: bool('Close although no delivery acknowledgement is recorded'),
    }, ['letter', 'step']),
    permission: 'correspondence.manage',
    service: 'correspondence.service.transition() / dispatch() / recordAcknowledgement() / close()',
    async prepare(ctx, args) {
      if (['NO_ACTION', 'RECORD_DELIVERY', 'CLOSE'].includes(args.step) && !args.note) throw ask({ NO_ACTION: 'Why is no action needed?', RECORD_DELIVERY: 'What acknowledgement was received?', CLOSE: 'What was the outcome (the resolution)?' }[args.step]);
      if (args.step === 'DISPATCH' && !args.channel) throw ask('How did it go out (post, email, courier, by hand ...)?');
      const c = await letterNamed(ctx, args.letter);
      return { id: c.id, ref: c.refNo, subject: c.subject, status: c.status };
    },
    summarise: (a, _actor, p) => `${{ ACKNOWLEDGE: 'Acknowledge', START_WORK: 'Start work on', NO_ACTION: 'Close as needing no action', DISPATCH: 'Record dispatch of', RECORD_DELIVERY: 'Record delivery of', CLOSE: 'Close' }[a.step]} ${p?.ref ?? a.letter}${p?.subject ? ` "${excerpt(p.subject, 60)}"` : ''}${a.channel ? ` by ${words(a.channel)}` : ''}${a.trackingNo ? ` (${a.trackingNo})` : ''}${a.note ? ` — ${excerpt(a.note, 120)}` : ''}`,
    async run(ctx, args, p) {
      const at = args.on ? `${args.on}T12:00:00+05:30` : undefined;
      let c;
      if (args.step === 'DISPATCH') c = await correspondence.dispatch(ctx.actor, ctx.scope, p.id, { channel: args.channel, at, trackingNo: args.trackingNo, note: args.note });
      else if (args.step === 'RECORD_DELIVERY') c = await correspondence.recordAcknowledgement(ctx.actor, ctx.scope, p.id, { acknowledgement: args.note, deliveredAt: at });
      else if (args.step === 'CLOSE') c = await correspondence.close(ctx.actor, ctx.scope, p.id, { resolution: args.note, withoutAcknowledgement: args.withoutAcknowledgement === true });
      else c = await correspondence.transition(ctx.actor, ctx.scope, p.id, { to: { ACKNOWLEDGE: 'ACKNOWLEDGED', START_WORK: 'IN_PROGRESS', NO_ACTION: 'NO_ACTION' }[args.step], note: args.note });
      return did('correspondence_moved', c, `${c.refNo} is ${words(c.status)}.`);
    },
  }),

  send_correspondence_reply_for_approval: tool({
    module: 'Correspondence', operation: 'ACTION', affectsOthers: true,
    description: "Send the latest draft reply (or outgoing letter) for approval; it goes to the approver on the correspondence route. For the letter's owner, an assignee or the office. Needs confirmation.",
    inputSchema: closed({ letter: letterArg, priority: oneOf(['LOW', 'NORMAL', 'HIGH', 'URGENT']) }, ['letter']),
    permission: 'correspondence.read',
    service: 'correspondence.service.submitForApproval()',
    async prepare(ctx, args) {
      const c = await letterNamed(ctx, args.letter);
      if (!c.latestDraft && !['REPLY_DRAFTED', 'DRAFT'].includes(c.status)) throw ask(`${c.refNo} has no draft yet. Draft the reply first.`);
      return { id: c.id, ref: c.refNo, subject: c.subject };
    },
    summarise: (a, _actor, p) => `Send the draft reply on ${p?.ref ?? a.letter}${p?.subject ? ` "${excerpt(p.subject, 60)}"` : ''} for approval${a.priority ? ` (${words(a.priority)})` : ''}`,
    async run(ctx, args, p) {
      const c = await correspondence.submitForApproval(ctx.actor, ctx.scope, p.id, { priority: args.priority });
      return did('correspondence_sent_for_approval', c, `${c.refNo} is with the approver.`);
    },
  }),

  add_correspondence_reminder: tool({
    module: 'Correspondence', operation: 'CREATE', risk: RISK.LOW,
    description: "Set a reminder on a letter for a day (the owner and assignees are reminded then). Needs confirmation.",
    inputSchema: closed({ letter: letterArg, on: dateStr('The day'), at: hm('Time, HH:MM (default 09:00)'), note: text(300) }, ['letter', 'on']),
    permission: 'correspondence.read',
    service: 'correspondence.service.addReminder()',
    async prepare(ctx, args) { const c = await letterNamed(ctx, args.letter); return { id: c.id, ref: c.refNo }; },
    summarise: (a, _actor, p) => `Remind about ${p?.ref ?? a.letter} on ${a.on} at ${a.at ?? '09:00'}${a.note ? `: ${excerpt(a.note, 80)}` : ''}`,
    async run(ctx, args, p) {
      const c = await correspondence.addReminder(ctx.actor, ctx.scope, p.id, { at: istAt(args.on, args.at ?? '09:00').toISOString(), note: args.note });
      return did('correspondence_reminder_set', c, `Reminder set on ${c.refNo} for ${args.on}.`);
    },
  }),

  set_correspondence_legal_hold: tool({
    module: 'Correspondence', operation: 'UPDATE',
    description: 'Put a letter on legal hold (it is kept whatever the retention rules say) or lift the hold. Needs confirmation.',
    inputSchema: closed({ letter: letterArg, hold: bool('true to hold, false to lift') }, ['letter', 'hold']),
    permission: 'correspondence.manage',
    service: 'correspondence.service.setLegalHold()',
    async prepare(ctx, args) { const c = await letterNamed(ctx, args.letter); return { id: c.id, ref: c.refNo }; },
    summarise: (a, _actor, p) => `${a.hold ? 'Put' : 'Lift the legal hold on'} ${p?.ref ?? a.letter}${a.hold ? ' on legal hold' : ''}`,
    async run(ctx, args, p) {
      const c = await correspondence.setLegalHold(ctx.actor, ctx.scope, p.id, { hold: args.hold });
      return did('correspondence_legal_hold', c, `${c.refNo}: legal hold ${c.legalHold ? 'on' : 'off'}.`);
    },
  }),
};

/* ── Facilities ───────────────────────────────────────────── */

async function facilityNamed(ctx, term, what = 'facility') {
  return pick(await facilities.listFacilities(ctx.actor, {}), term, { label: what, describe: (f) => `${f.code} ${f.name}` });
}

const facilityFields = {
  kind: oneOf(FACILITY_KINDS), campusCode: text(80), department: text(80), floorNo: int(-5, 200), capacity: int(0, 100000), areaSqm: num(0, 1e7),
  accessible: bool(), bookable: bool(), restricted: bool(), equipment: list(text(80), 50), inside: text(120, 'The building or floor it is in, by name or code'), inCharge: text(120, 'The person in charge, by name'),
};
async function facilityBody(ctx, a) {
  const { code, name, kind, campusCode, department, floorNo, capacity, areaSqm, accessible, bookable, restricted, equipment, status } = a;
  const body = Object.fromEntries(Object.entries({ code, name, kind, campusCode, department, floorNo, capacity, areaSqm, accessible, bookable, restricted, equipment, status }).filter(([, v]) => v !== undefined));
  const shownAs = {};
  if (a.inside) { const parent = await facilityNamed(ctx, a.inside, 'building or floor'); body.parentId = parent.id; shownAs.inside = parent.name; }
  if (a.inCharge) { const p = await staffNamed(a.inCharge, 'person in charge'); body.inChargeProfileId = p.id; shownAs.inCharge = p.name; }
  return { body, shownAs };
}

const facilityTools = {
  get_facility_stats: tool({
    module: 'Facilities', operation: 'GET',
    description: 'Facilities at a glance: open, overdue and urgent work orders, booking requests waiting, and rooms out of use. Read-only.',
    permission: 'facilities.read',
    service: 'facility.service.stats()',
    async run() {
      const s = await facilities.stats();
      return shown(s, `${s.openWorkOrders} open work order(s) (${s.overdueWorkOrders} overdue, ${s.urgentWorkOrders} urgent), ${s.pendingBookings} booking request(s) waiting, ${s.facilitiesOutOfUse} place(s) out of use.`);
    },
  }),

  create_facility: tool({
    module: 'Facilities', operation: 'CREATE',
    description: 'Add a room, lab, hall, ground or building to the facilities register: code, name, kind, where it is, capacity, whether it can be booked, equipment and who is in charge. Needs confirmation.',
    inputSchema: closed({ code: text(30), name: text(120), ...facilityFields }, ['code', 'name', 'kind']),
    permission: 'facilities.manage',
    service: 'facility.service.createFacility()',
    async prepare(ctx, args) { return facilityBody(ctx, args); },
    summarise: (a, _actor, p) => `Add ${words(a.kind ?? "facility")} ${String(a.code ?? "").toUpperCase()} "${a.name}"${p?.shownAs?.inside ? ` in ${p.shownAs.inside}` : ''}${a.capacity ? `, capacity ${a.capacity}` : ''}${a.bookable ? ', bookable' : ''}${p?.shownAs?.inCharge ? `, in charge ${p.shownAs.inCharge}` : ''}`,
    async run(_ctx, _args, p) {
      const f = await facilities.createFacility(p.body);
      return did('facility_created', f, `Added ${f.code} ${f.name}.`);
    },
  }),

  create_sample_campus: tool({
    module: 'Facilities', operation: 'CREATE',
    description: "For a school that has not mapped its buildings yet: create a clearly labelled SAMPLE campus (buildings, floors, rooms) so the campus map has something to show. Refused once any facility exists. Needs confirmation.",
    inputSchema: closed({ institutionType: oneOf(['SCHOOL', 'COLLEGE', 'COMBINED']) }),
    permission: 'facilities.manage',
    service: 'institution.service.terminology() + facility.service.createSampleCampus()',
    summarise: (a) => `Create a labelled sample ${words(a.institutionType ?? 'campus')} layout for the campus map`,
    async run(_ctx, args) {
      const { institutionType } = await institution.terminology();
      const out = await facilities.createSampleCampus({ institutionType: args.institutionType ?? institutionType });
      return did('sample_campus_created', null, `Sample campus created${out?.created ? ` (${out.created} places)` : ''}. It is marked as a sample on the map.`);
    },
  }),

  list_facility_bookings: tool({
    module: 'Facilities', operation: 'GET',
    description: 'Room and ground bookings: your own, or every booking for the facilities manager — by status, place and dates. Read-only.',
    inputSchema: closed({ status: oneOf(['REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED']), place: text(120), from: dateStr(), to: dateStr() }),
    permission: 'facilities.read',
    service: 'facility.service.listBookings()',
    async run(ctx, args) {
      const facilityId = args.place ? (await facilityNamed(ctx, args.place, 'place')).id : undefined;
      const rows = await facilities.listBookings(ctx.actor, { status: args.status, facilityId, from: args.from ? istAt(args.from).toISOString() : undefined, to: args.to ? istAt(args.to, '23:59').toISOString() : undefined });
      return listed(rows.map((b) => ({ title: b.title, place: b.facilityName, on: day(b.startsAt), from: time(b.startsAt), to: time(b.endsAt), status: b.status, by: b.bookedByName })), (b) => `${b.place} ${b.on} ${b.from}–${b.to} "${b.title}" (${words(b.status)})`, { noun: 'booking' });
    },
  }),

  record_facility_booking_decision: tool({
    module: 'Facilities', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "Facilities manager: record your own decision on a requested room or ground booking — CONFIRM or REJECT (with a note). Recorded only when you state the decision in your own words; never suggested. A clash is refused. The person who asked is told. Confirmed on the website.",
    inputSchema: closed({ place: text(120), date: dateStr('The booking day'), title: text(160, 'What it is for'), decision: decisionArg(['CONFIRM', 'REJECT'], 'The facilities manager'), note: text(500) }, ['decision']),
    permission: 'facilities.manage',
    service: 'facility.service.listBookings() + decideBooking()',
    async prepare(ctx, args) {
      let rows = await facilities.listBookings(ctx.actor, { status: 'REQUESTED' });
      if (args.place) rows = rows.filter((b) => lower(b.facilityName).includes(lower(args.place)));
      if (args.date) rows = rows.filter((b) => day(b.startsAt) === args.date);
      const b = pick(rows, args.title, { label: 'booking request', nameOf: (x) => x.title, refOf: () => '', describe: (x) => `${x.facilityName} ${day(x.startsAt)} ${time(x.startsAt)} "${x.title}" by ${x.bookedByName}` });
      return { id: b.id, what: `${b.facilityName} on ${day(b.startsAt)} ${time(b.startsAt)}–${time(b.endsAt)} "${b.title}" for ${b.bookedByName}` };
    },
    summarise: (a, _actor, p) => `${a.decision === 'CONFIRM' ? 'Confirm' : 'Reject'} the booking of ${p?.what ?? a.place}${a.note ? ` — ${excerpt(a.note, 100)}` : ''}`,
    async run(ctx, args, p) {
      const b = await facilities.decideBooking(ctx.actor, p.id, { decision: args.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED', note: args.note });
      return did('facility_booking_decided', b, `Recorded: ${p.what} is ${words(b.status)}.`);
    },
  }),

  cancel_facility_booking: tool({
    module: 'Facilities', operation: 'DELETE', risk: RISK.LOW,
    description: 'Cancel one of your own room or ground bookings (requested or confirmed); the facilities manager can cancel any. Needs confirmation.',
    inputSchema: closed({ place: text(120), date: dateStr('The booking day'), title: text(160) }),
    permission: 'facilities.request',
    service: 'facility.service.listBookings() + cancelBooking()',
    async prepare(ctx, args) {
      let rows = (await facilities.listBookings(ctx.actor, {})).filter((b) => ['REQUESTED', 'CONFIRMED'].includes(b.status));
      if (!ctx.actor.permissions?.['facilities.manage']) rows = rows.filter((b) => String(b.bookedByProfileId) === String(ctx.actor.profileId));
      if (args.place) rows = rows.filter((b) => lower(b.facilityName).includes(lower(args.place)));
      if (args.date) rows = rows.filter((b) => day(b.startsAt) === args.date);
      const b = pick(rows, args.title, { label: 'booking', nameOf: (x) => x.title, refOf: () => '', describe: (x) => `${x.facilityName} ${day(x.startsAt)} ${time(x.startsAt)} "${x.title}"` });
      return { id: b.id, what: `${b.facilityName} on ${day(b.startsAt)} ${time(b.startsAt)} "${b.title}"` };
    },
    summarise: (a, _actor, p) => `Cancel the booking of ${p?.what ?? a.place ?? 'the room'}`,
    async run(ctx, _args, p) {
      const b = await facilities.cancelBooking(ctx.actor, p.id);
      return did('facility_booking_cancelled', b, `Cancelled: ${p.what}.`);
    },
  }),

  update_work_order: tool({
    module: 'Facilities', operation: 'UPDATE', affectsOthers: true,
    description: "Facilities manager: work a maintenance work order — assign it to a person or vendor, record the cost, mark that it closes the room, or move it (in progress, on hold, resolved with what was done, closed, cancelled). The reporter is told when it is resolved. Needs confirmation.",
    inputSchema: closed({
      workOrder: text(160, 'Its reference (WO-...) or title'), assignTo: text(120, 'A member of staff, by name'), vendor: text(160), costRupees: num(0, 1e9),
      closesRoom: bool('The fault puts the room out of use'), status: oneOf(['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED']),
      resolution: text(2000, 'Required when resolving'), note: text(500),
    }, ['workOrder']),
    permission: 'facilities.manage',
    service: 'facility.service.listWorkOrders() + updateWorkOrder()',
    async prepare(ctx, args) {
      if (args.status === 'RESOLVED' && !args.resolution) throw ask('What was done to resolve it?');
      const w = pick(rowsOf(await facilities.listWorkOrders(ctx.actor, { pageSize: 200 })), args.workOrder, { label: 'work order', nameOf: (x) => x.title, describe: (x) => `${x.refNo} ${x.title} (${words(x.status)})` });
      const person = args.assignTo ? await staffNamed(args.assignTo, 'assignee') : null;
      return { id: w.id, ref: w.refNo, title: w.title, assignee: person };
    },
    summarise: (a, _actor, p) => `Work order ${p?.ref ?? a.workOrder}${p?.title ? ` "${excerpt(p.title, 60)}"` : ''}: ${[p?.assignee ? `assign ${p.assignee.name}` : '', a.vendor ? `vendor ${a.vendor}` : '', a.costRupees !== undefined ? `cost ₹${a.costRupees}` : '', a.closesRoom !== undefined ? (a.closesRoom ? 'room out of use' : 'room usable') : '', a.status ? words(a.status) : '', a.resolution ? `— ${excerpt(a.resolution, 80)}` : ''].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const w = await facilities.updateWorkOrder(ctx.actor, p.id, {
        ...(p.assignee && { assigneeProfileId: p.assignee.id }), ...(args.vendor !== undefined && { vendorName: args.vendor }),
        ...(args.costRupees !== undefined && { costPaise: Math.round(args.costRupees * 100) }), ...(args.closesRoom !== undefined && { closesFacility: args.closesRoom }),
        ...(args.status && { status: args.status }), ...(args.resolution && { resolution: args.resolution }), ...(args.note && { note: args.note }),
      });
      return did('work_order_updated', w, `${w.refNo} is ${words(w.status)}.`);
    },
  }),

  update_facility: tool({
    module: 'Facilities', operation: 'UPDATE',
    description: 'Change a facility in the register: rename it, its kind, capacity, equipment, whether it can be booked, who is in charge, or its status (active, under maintenance, closed). Needs confirmation.',
    inputSchema: closed({ facility: text(120, 'Its current name or code'), name: text(120), code: text(30), status: oneOf(['ACTIVE', 'UNDER_MAINTENANCE', 'CLOSED']), ...facilityFields }, ['facility']),
    permission: 'facilities.manage',
    service: 'facility.service.updateFacility()',
    async prepare(ctx, args) {
      const f = await facilityNamed(ctx, args.facility);
      const { facility: _f, ...rest } = args;
      const built = await facilityBody(ctx, rest);
      if (!Object.keys(built.body).length) throw ask('What should change on it?');
      return { id: f.id, name: f.name, ...built };
    },
    summarise: (a, _actor, p) => `Change ${p?.name ?? a.facility}: ${Object.entries(p?.body ?? {}).map(([k, v]) => `${words(k)} → ${p?.shownAs?.[k === 'parentId' ? 'inside' : 'inCharge'] && /Id$/.test(k) ? p.shownAs[k === 'parentId' ? 'inside' : 'inCharge'] : Array.isArray(v) ? v.join(', ') : v}`).join('; ')}`,
    async run(_ctx, _args, p) {
      const f = await facilities.updateFacility(p.id, p.body);
      return did('facility_updated', f, `${f.name} is updated.`);
    },
  }),
};

/* ── Events and agreements ────────────────────────────────── */

const EVENT_KINDS = ['FEST', 'CEREMONY', 'SPORTS', 'CULTURAL', 'COMPETITION', 'MEETING', 'PTM', 'VISIT', 'TRIP', 'WORKSHOP', 'OTHER'];
const BUDGET_LINE = closed({ head: text(80), rupees: num(0, 1e10) }, ['head', 'rupees']);
const eventArg = text(160, 'Its reference (EVT-...) or title');

async function eventNamed(ctx, term) {
  return pick(rowsOf(await events.listEvents(ctx.actor, { pageSize: 200 })), term, { label: 'event', describe: (e) => `${e.refNo} ${e.title} (${day(e.startsAt)}, ${words(e.status)})` });
}
const eventSpeak = (e) => `${e.refNo} "${e.title}" on ${day(e.startsAt)}: ${words(e.status)}${e.readiness !== null && e.readiness !== undefined ? `, ${e.readiness}% ready` : ''}${e.budgetPaise ? `, budget ${rupeesOf(e.budgetPaise)}` : ''}${(e.conflicts ?? []).length ? `. Conflicts: ${e.conflicts.join('; ')}` : ''}.`;

const agreementArg = text(200, 'Its reference (AGR-...), title or the other party');
async function agreementNamed(ctx, term) {
  return pick(await events.listContracts(ctx.actor, {}), term, { label: 'agreement', nameOf: (c) => `${c.title} ${c.counterparty}`, describe: (c) => `${c.refNo} ${c.title} with ${c.counterparty} (${words(c.status)})` });
}
const agreementSpeak = (c) => `${c.refNo} "${c.title}" with ${c.counterparty}: ${words(c.status)}${c.valuePaise ? `, ${rupeesOf(c.valuePaise)}` : ''}${c.endsOn ? `, ends ${day(c.endsOn)}` : ''}${c.renewalAttention ? ' (renewal due soon)' : ''}.`;

const eventTools = {
  propose_fest_plan: tool({
    module: 'Events', operation: 'CREATE',
    description: 'Propose a school event (fest, ceremony, sports day, trip, workshop ...): title, kind, day and times, venue (a facility by name, or written out), audience, expected attendance, budget lines, guardian consent and plans. Clashes with exams, holidays and other events are flagged. It stays a proposal until sent for approval. Needs confirmation.',
    inputSchema: closed({
      title: text(160), kind: oneOf(EVENT_KINDS), date: dateStr('The (first) day'), from: hm('Start, HH:MM'), endDate: dateStr('Last day, if it runs over several'), to: hm('End, HH:MM'),
      venue: text(200), audience: oneOf(['INSTITUTION', 'STUDENTS', 'PARENTS', 'STAFF', 'PUBLIC', 'INVITED']), expectedAttendance: int(0, 100000),
      budget: list(BUDGET_LINE, 40), consentRequired: bool(), description: text(5000), safetyPlan: text(4000), transportPlan: text(2000),
    }, ['title', 'kind', 'date', 'from', 'to']),
    permission: 'approvals.submit',
    service: 'events.service.proposeEvent()',
    async prepare(ctx, args) {
      const startsAt = istAt(args.date, args.from);
      const endsAt = istAt(args.endDate ?? args.date, args.to);
      if (endsAt <= startsAt) throw ask('The event must end after it starts.');
      let facilityId = null; let venueText = null; let venue = null;
      if (args.venue) {
        const rows = (await facilities.listFacilities(ctx.actor, {})).filter((f) => lower(f.name) === lower(args.venue) || lower(f.code) === lower(args.venue) || lower(f.name).includes(lower(args.venue)));
        if (rows.length === 1) { facilityId = rows[0].id; venue = rows[0].name; } else if (rows.length > 1) throw ask(`Which place — ${rows.slice(0, 6).map((f) => f.name).join(', ')}?`); else { venueText = args.venue; venue = args.venue; }
      }
      return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), facilityId, venueText, venue };
    },
    summarise: (a, _actor, p) => `Propose the ${words(a.kind)} "${a.title}" on ${a.date} ${a.from}–${a.endDate && a.endDate !== a.date ? `${a.endDate} ` : ''}${a.to}${p?.venue ? ` at ${p.venue}` : ''}${a.expectedAttendance ? `, ${a.expectedAttendance} expected` : ''}${a.budget?.length ? `, budget ₹${a.budget.reduce((n, l) => n + l.rupees, 0)}` : ''}`,
    async run(ctx, args, p) {
      const e = await events.proposeEvent(ctx.actor, {
        title: args.title, kind: args.kind, startsAt: p.startsAt, endsAt: p.endsAt, facilityId: p.facilityId, venueText: p.venueText, audience: args.audience,
        expectedAttendance: args.expectedAttendance, budgetLines: (args.budget ?? []).map((l) => ({ head: l.head, amountPaise: Math.round(l.rupees * 100) })),
        consentRequired: args.consentRequired, description: args.description, safetyPlan: args.safetyPlan, transportPlan: args.transportPlan,
      });
      return did('institution_event_proposed', e, `Proposed ${e.refNo}.${e.conflicts?.length ? ` Note: ${e.conflicts.join('; ')}.` : ''} Send it for approval when ready.`);
    },
  }),

  get_fest_plan: tool({
    module: 'Events', operation: 'GET',
    description: "One school event in full: dates, venue, audience, budget and spend, tasks and how ready it is, consents received, plans, conflicts and outcome. Read-only.",
    inputSchema: closed({ event: eventArg }, ['event']),
    permission: 'events.read',
    service: 'events.service.getEvent()',
    async run(ctx, args) {
      const e = await events.getEvent(ctx.actor, (await eventNamed(ctx, args.event)).id);
      return shown({ refNo: e.refNo, title: e.title, kind: e.kind, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venueText, audience: e.audience, expectedAttendance: e.expectedAttendance, budget: rupeesOf(e.budgetPaise), spent: rupeesOf(e.actualSpendPaise), tasks: (e.tasks ?? []).map((t) => ({ title: t.title, owner: t.ownerName, due: day(t.dueOn), status: t.status })), readiness: e.readiness, consentRequired: e.consentRequired, consentsReceived: e.consentsReceived, conflicts: e.conflicts, outcome: e.outcome ?? null }, eventSpeak(e));
    },
  }),

  update_fest_plan: tool({
    module: 'Events', operation: 'UPDATE',
    description: "Change a school event you organise (or any, for the events team): its plans and text, expected attendance and budget (while still a proposal), add tasks or mark tasks done, consents received and money spent. Needs confirmation.",
    inputSchema: closed({
      event: eventArg, title: text(160), description: text(5000), venue: text(200), safetyPlan: text(4000), accessibilityPlan: text(4000), transportPlan: text(2000),
      expectedAttendance: int(0, 100000), budget: list(BUDGET_LINE, 40), consentsReceived: int(0, 100000), spentRupees: num(0, 1e10),
      addTasks: list(closed({ title: text(160), department: text(60), owner: text(120), dueOn: dateStr() }, ['title']), 50), doneTasks: list(text(160), 50, 'Titles of tasks now done'),
    }, ['event']),
    permission: 'events.read',
    service: 'events.service.getEvent() + updateEvent()',
    async prepare(ctx, args) {
      const e = await events.getEvent(ctx.actor, (await eventNamed(ctx, args.event)).id);
      const { event: _e, ...changes } = args;
      if (!Object.keys(changes).length) throw ask('What should change on the event?');
      for (const t of args.doneTasks ?? []) pick(e.tasks ?? [], t, { label: 'task', nameOf: (x) => x.title, refOf: () => '' });
      return { id: e.id, ref: e.refNo, title: e.title };
    },
    summarise: (a, _actor, p) => `Update ${p?.ref ?? a.event} "${excerpt(p?.title ?? '', 60)}": ${Object.keys(a).filter((k) => k !== 'event').map((k) => (k === 'addTasks' ? `add ${a.addTasks.length} task(s)` : k === 'doneTasks' ? `mark done: ${a.doneTasks.join(', ')}` : words(k))).join(', ')}`,
    async run(ctx, args, p) {
      const body = {};
      for (const k of ['title', 'description', 'safetyPlan', 'accessibilityPlan', 'transportPlan', 'expectedAttendance', 'consentsReceived']) if (args[k] !== undefined) body[k] = args[k];
      if (args.venue !== undefined) body.venueText = args.venue;
      if (args.budget) body.budgetLines = args.budget.map((l) => ({ head: l.head, amountPaise: Math.round(l.rupees * 100) }));
      if (args.spentRupees !== undefined) body.actualSpendPaise = Math.round(args.spentRupees * 100);
      if (args.addTasks?.length || args.doneTasks?.length) {
        const e = await events.getEvent(ctx.actor, p.id);
        const done = new Set((args.doneTasks ?? []).map((t) => String(pick(e.tasks ?? [], t, { label: 'task', nameOf: (x) => x.title, refOf: () => '' })._id)));
        body.tasks = [
          ...(e.tasks ?? []).map((t) => ({ title: t.title, department: t.department, ownerProfileId: t.ownerProfileId ? String(t.ownerProfileId) : null, ownerName: t.ownerName, dueOn: t.dueOn ?? null, status: done.has(String(t._id)) ? 'DONE' : t.status })),
          ...(args.addTasks ?? []).map((t) => ({ title: t.title, department: t.department, ownerName: t.owner, dueOn: t.dueOn, status: 'TODO' })),
        ];
      }
      const e = await events.updateEvent(ctx.actor, p.id, body);
      return did('institution_event_updated', e, `Saved. ${eventSpeak(e)}`);
    },
  }),

  submit_fest_plan: tool({
    module: 'Events', operation: 'ACTION', affectsOthers: true,
    description: 'Send a proposed event for approval: its venue is requested and it goes to the approvers on the event route (budget check, principal). Needs confirmation.',
    inputSchema: closed({ event: eventArg }, ['event']),
    permission: 'approvals.submit',
    service: 'events.service.submitEvent()',
    async prepare(ctx, args) { const e = await eventNamed(ctx, args.event); return { id: e.id, ref: e.refNo, title: e.title }; },
    summarise: (a, _actor, p) => `Send ${p?.ref ?? a.event} "${excerpt(p?.title ?? '', 60)}" for approval (its venue is requested)`,
    async run(ctx, _args, p) {
      const e = await events.submitEvent(ctx.actor, p.id);
      return did('institution_event_submitted', e, `${e.refNo} is with the approvers.`);
    },
  }),

  move_fest_plan: tool({
    module: 'Events', operation: 'ACTION', affectsOthers: true,
    description: "Move an approved event along: IN_PREPARATION, LIVE, CANCELLED (with the reason; its booking and calendar entry are withdrawn) or COMPLETED (with a summary, attendance, highlights and the final spend). Needs confirmation.",
    inputSchema: closed({ event: eventArg, step: oneOf(['IN_PREPARATION', 'LIVE', 'CANCELLED', 'COMPLETED']), note: text(5000, 'Reason (cancel) or the outcome summary (complete)'), attendance: int(0, 100000), highlights: list(text(300), 20), spentRupees: num(0, 1e10) }, ['event', 'step']),
    permission: 'events.read',
    service: 'events.service.moveEvent() / completeEvent()',
    async prepare(ctx, args) {
      if (args.step === 'CANCELLED' && !args.note) throw ask('Why is it cancelled?');
      if (args.step === 'COMPLETED' && !args.note) throw ask('Give a short summary of how it went.');
      const e = await eventNamed(ctx, args.event);
      return { id: e.id, ref: e.refNo, title: e.title };
    },
    summarise: (a, _actor, p) => `Mark ${p?.ref ?? a.event} "${excerpt(p?.title ?? '', 60)}" ${words(a.step)}${a.note ? ` — ${excerpt(a.note, 120)}` : ''}${a.attendance !== undefined ? `, attendance ${a.attendance}` : ''}`,
    async run(ctx, args, p) {
      const e = args.step === 'COMPLETED'
        ? await events.completeEvent(ctx.actor, p.id, { summary: args.note, attendance: args.attendance, highlights: args.highlights, ...(args.spentRupees !== undefined && { actualSpendPaise: Math.round(args.spentRupees * 100) }) })
        : await events.moveEvent(ctx.actor, p.id, { to: args.step, note: args.note });
      return did('institution_event_moved', e, `${e.refNo} is ${words(e.status)}.`);
    },
  }),

  list_agreements: tool({
    module: 'Compliance', operation: 'GET',
    description: "The school's agreements (vendor, service, lease, transport, MOUs ...): the other party, value, dates, status and which need renewal attention; optionally only those expiring within some days. Read-only.",
    inputSchema: closed({ status: oneOf(['REQUESTED', 'DRAFTING', 'UNDER_REVIEW', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'REJECTED']), expiringWithinDays: int(1, 730) }),
    permission: 'contracts.read',
    service: 'events.service.listContracts()',
    async run(ctx, args) {
      const rows = await events.listContracts(ctx.actor, { status: args.status, expiringWithinDays: args.expiringWithinDays });
      return listed(rows.map((c) => ({ ref: c.refNo, title: c.title, party: c.counterparty, kind: c.kind, value: rupeesOf(c.valuePaise), endsOn: day(c.endsOn), status: c.status, renewalAttention: Boolean(c.renewalAttention) })), (c) => `${c.ref} ${c.title} with ${c.party} (${words(c.status)}${c.endsOn ? `, ends ${c.endsOn}` : ''})`, { noun: 'agreement' });
    },
  }),

  create_agreement: tool({
    module: 'Compliance', operation: 'CREATE',
    description: 'Start an agreement record (vendor, service, staff, lease, transport, facilities, MOU, partnership): title, the other party, value in rupees, dates, notice period and auto-renewal. Needs confirmation.',
    inputSchema: closed({
      title: text(200), kind: oneOf(['VENDOR', 'SERVICE', 'STAFF', 'LEASE', 'TRANSPORT', 'FACILITIES', 'MOU', 'PARTNERSHIP', 'OTHER']), counterparty: text(200),
      valueRupees: num(0, 1e11), startsOn: dateStr(), endsOn: dateStr(), noticePeriodDays: int(0, 365), autoRenews: bool(), drafting: bool('Start straight in drafting'),
    }, ['title', 'kind', 'counterparty']),
    permission: 'contracts.manage',
    service: 'events.service.createContract()',
    summarise: (a) => `Start the ${words(a.kind)} agreement "${a.title}" with ${a.counterparty}${a.valueRupees ? ` worth ₹${a.valueRupees}` : ''}${a.startsOn ? ` from ${a.startsOn}` : ''}${a.endsOn ? ` to ${a.endsOn}` : ''}`,
    async run(ctx, args) {
      const c = await events.createContract(ctx.actor, { title: args.title, kind: args.kind, counterparty: args.counterparty, valuePaise: args.valueRupees ? Math.round(args.valueRupees * 100) : 0, startsOn: args.startsOn, endsOn: args.endsOn, noticePeriodDays: args.noticePeriodDays, autoRenews: args.autoRenews, draft: args.drafting === true });
      return did('agreement_created', c, `Created ${c.refNo}.`);
    },
  }),

  get_agreement: tool({
    module: 'Compliance', operation: 'GET',
    description: 'One agreement in full: party, value, dates, notice deadline, legal review note, how it was signed, obligations and versions. Read-only.',
    inputSchema: closed({ agreement: agreementArg }, ['agreement']),
    permission: 'contracts.read',
    service: 'events.service.getContract()',
    async run(ctx, args) {
      const c = await events.getContract(ctx.actor, (await agreementNamed(ctx, args.agreement)).id);
      return shown({ refNo: c.refNo, title: c.title, kind: c.kind, party: c.counterparty, value: rupeesOf(c.valuePaise), status: c.status, startsOn: day(c.startsOn), endsOn: day(c.endsOn), noticeDeadline: day(c.noticeDeadline), autoRenews: c.autoRenews, legalReviewNote: c.legalReviewNote, signatureMethod: c.signatureMethod, obligations: (c.obligations ?? []).map((o) => ({ title: o.title, due: day(o.dueOn), done: o.done })), versions: (c.versions ?? []).length }, agreementSpeak(c));
    },
  }),

  update_agreement: tool({
    module: 'Compliance', operation: 'UPDATE',
    description: "Change an agreement: title, party, dates, notice period, value (before approval), legal review note, how it was signed, add obligations, or move it (drafting, under review, executed, active, expired, terminated). Sending it for approval is a separate step. Needs confirmation.",
    inputSchema: closed({
      agreement: agreementArg, title: text(200), counterparty: text(200), startsOn: dateStr(), endsOn: dateStr(), noticePeriodDays: int(0, 365), valueRupees: num(0, 1e11),
      legalReviewNote: text(4000), signatureMethod: oneOf(['WET_INK', 'AADHAAR_ESIGN', 'DSC', 'OTHER']), addObligations: list(closed({ title: text(200), dueOn: dateStr() }, ['title']), 50),
      step: oneOf(['DRAFTING', 'UNDER_REVIEW', 'EXECUTED', 'ACTIVE', 'EXPIRED', 'TERMINATED']), executedOn: dateStr(), note: text(500),
    }, ['agreement']),
    permission: 'contracts.manage',
    service: 'events.service.getContract() + updateContract()',
    async prepare(ctx, args) {
      const c = await agreementNamed(ctx, args.agreement);
      const { agreement: _a, ...changes } = args;
      if (!Object.keys(changes).length) throw ask('What should change on the agreement?');
      return { id: c.id, ref: c.refNo, title: c.title };
    },
    summarise: (a, _actor, p) => `Update ${p?.ref ?? a.agreement} "${excerpt(p?.title ?? '', 60)}": ${Object.keys(a).filter((k) => k !== 'agreement').map((k) => (k === 'step' ? `move to ${words(a.step)}` : k === 'addObligations' ? `add ${a.addObligations.length} obligation(s)` : words(k))).join(', ')}`,
    async run(ctx, args, p) {
      const body = {};
      for (const k of ['title', 'counterparty', 'startsOn', 'endsOn', 'noticePeriodDays', 'legalReviewNote', 'signatureMethod', 'executedOn', 'note']) if (args[k] !== undefined) body[k] = args[k];
      if (args.valueRupees !== undefined) body.valuePaise = Math.round(args.valueRupees * 100);
      if (args.step) body.to = args.step;
      if (args.addObligations?.length) {
        const c = await events.getContract(ctx.actor, p.id);
        body.obligations = [...(c.obligations ?? []).map((o) => ({ title: o.title, dueOn: o.dueOn ?? null, ownerProfileId: o.ownerProfileId ? String(o.ownerProfileId) : null, done: o.done })), ...args.addObligations.map((o) => ({ title: o.title, dueOn: o.dueOn }))];
      }
      const c = await events.updateContract(ctx.actor, p.id, body);
      return did('agreement_updated', c, `Saved. ${agreementSpeak(c)}`);
    },
  }),

  submit_agreement_for_approval: tool({
    module: 'Compliance', operation: 'ACTION', affectsOthers: true,
    description: 'Send an agreement in drafting or review for approval; it goes to the approvers on the agreement route (finance, principal, trustees above the threshold). Needs confirmation.',
    inputSchema: closed({ agreement: agreementArg }, ['agreement']),
    permission: 'contracts.manage',
    service: 'events.service.submitContract()',
    async prepare(ctx, args) { const c = await agreementNamed(ctx, args.agreement); return { id: c.id, ref: c.refNo, title: c.title, value: c.valuePaise }; },
    summarise: (a, _actor, p) => `Send ${p?.ref ?? a.agreement} "${excerpt(p?.title ?? '', 60)}"${p?.value ? ` (${rupeesOf(p.value)})` : ''} for approval`,
    async run(ctx, _args, p) {
      const c = await events.submitContract(ctx.actor, p.id);
      return did('agreement_submitted', c, `${c.refNo} is with the approvers.`);
    },
  }),
};

/* ── Governance ───────────────────────────────────────────── */

const meetingArg = text(200, 'Its title or reference (MTG-...); the next upcoming one when left out');
const govRead = (ctx) => ctx.actor?.permissions?.['governance.read'] ?? null;

async function meetingNamed(ctx, term) {
  const rows = await governance.list(ctx.actor, govRead(ctx) ?? ctx.scope, {});
  if (!term) {
    const upcoming = rows.filter((m) => m.status !== 'CANCELLED' && (!m.scheduledAt || new Date(m.scheduledAt) >= new Date()))
      .sort((a, b) => new Date(a.scheduledAt ?? 8.64e15) - new Date(b.scheduledAt ?? 8.64e15));
    if (upcoming[0]) return upcoming[0];
  }
  return pick(rows, term, { label: 'meeting', describe: (m) => `${m.refNo} ${m.title} (${words(m.status)})` });
}
const meetingSpeak = (m) => `${m.refNo} "${m.title}": ${words(m.status)}${m.scheduledAt ? ` on ${day(m.scheduledAt)} at ${time(m.scheduledAt)}` : ''}${m.location ? `, ${m.location}` : ''}; ${m.accepted ?? 0} accepted; agenda ${words(m.agendaStatus ?? 'none')}; minutes ${words(m.minutes?.status ?? 'none')}; ${m.openActions ?? 0} open action(s).`;

const governanceTools = {
  send_board_meeting_reminders: tool({
    module: 'Governance', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Remind the members of every governance meeting scheduled in the next hours (default 48) by WhatsApp or notification; each meeting is reminded once. Confirmed on the website.',
    inputSchema: closed({ hours: int(1, 336) }),
    permission: 'governance.manage',
    service: 'governance.service.sendReminders()',
    summarise: (a) => `Remind members of every meeting in the next ${a.hours ?? 48} hours`,
    async run(ctx, args) {
      const r = await governance.sendReminders(ctx.actor, { hours: args.hours ?? 48 });
      return did('board_meeting_reminders_sent', null, `${r.meetings} meeting(s); ${r.messages} reminder(s) sent.`);
    },
  }),

  get_board_meeting: tool({
    module: 'Governance', operation: 'GET',
    description: 'One governance meeting you can see in full: when and where, members and replies, proposed times and availability, agenda, attendance and quorum, minutes, resolutions and actions. Read-only.',
    inputSchema: closed({ meeting: meetingArg }),
    permission: 'governance.read',
    service: 'governance.service.get()',
    async run(ctx, args) {
      const m = await governance.get(ctx.actor, ctx.scope, (await meetingNamed(ctx, args.meeting)).id);
      return shown({
        refNo: m.refNo, title: m.title, body: m.body, status: m.status, scheduledAt: m.scheduledAt, location: m.location, mode: m.mode, quorum: m.quorum, quorumMet: m.quorumMet,
        members: (m.members ?? []).map((x) => ({ name: x.name, role: x.role, reply: x.rsvp ?? null, attended: x.attended ?? null })),
        proposedTimes: (m.proposedSlots ?? []).map((s, i) => ({ option: i + 1, on: day(s.at), at: time(s.at), available: (s.available ?? []).length })),
        agenda: (m.agenda ?? []).map((a) => ({ item: a.order, title: a.title, decisionNeeded: a.decisionNeeded })), minutes: m.minutes?.body ?? null, minutesStatus: m.minutes?.status ?? null,
        resolutions: (m.resolutions ?? []).map((r) => ({ number: r.number, text: r.text, outcome: r.outcome, for: r.votesFor, against: r.votesAgainst })),
        actions: (m.actions ?? []).map((a) => ({ title: a.title, owner: a.ownerName, due: day(a.dueOn), status: a.status })), canApproveMinutes: m.canApproveMinutes,
      }, meetingSpeak(m));
    },
  }),

  mark_board_meeting_availability: tool({
    module: 'Governance', operation: 'UPDATE', risk: RISK.LOW,
    description: 'For a member: say which of the proposed times for a meeting you can attend (by option number, as listed in the meeting), replacing what you said before; give none to say none suits. Needs confirmation.',
    inputSchema: closed({ meeting: meetingArg, options: list(int(1, 10), 10, 'The option numbers you can attend') }, ['options']),
    permission: 'governance.read',
    service: 'governance.service.markAvailability()',
    async prepare(ctx, args) {
      const m = await governance.get(ctx.actor, ctx.scope, (await meetingNamed(ctx, args.meeting)).id);
      if (!m.isMember) throw forbidden(`You are not a member of ${m.refNo}.`);
      const slots = m.proposedSlots ?? [];
      if (!slots.length) throw ask(`${m.refNo} has no proposed times to choose from.`);
      const bad = args.options.filter((o) => o > slots.length);
      if (bad.length) throw ask(`${m.refNo} has ${slots.length} proposed time(s); there is no option ${bad.join(', ')}.`);
      return { id: m.id, ref: m.refNo, title: m.title, chosen: args.options.map((o) => `${day(slots[o - 1].at)} ${time(slots[o - 1].at)}`) };
    },
    summarise: (a, _actor, p) => `For ${p?.ref ?? a.meeting} "${excerpt(p?.title ?? '', 60)}", you can attend: ${p?.chosen?.length ? p.chosen.join('; ') : 'none of the proposed times'}`,
    async run(ctx, args, p) {
      await governance.markAvailability(ctx.actor, ctx.scope, p.id, { slotIndexes: args.options.map((o) => o - 1) });
      return did('board_availability_marked', { id: p.id }, `Saved your availability for ${p.ref}.`);
    },
  }),

  set_board_meeting_time: tool({
    module: 'Governance', operation: 'UPDATE', affectsOthers: true,
    description: "Fix (or move) a governance meeting's date and time — one of its proposed options or a new date and time — and optionally its place or link; members are told. Needs confirmation.",
    inputSchema: closed({ meeting: meetingArg, option: int(1, 10, 'A proposed time, by its number'), date: dateStr(), time: hm('HH:MM'), location: text(200), meetingLink: text(500) }),
    permission: 'governance.manage',
    service: 'governance.service.schedule()',
    async prepare(ctx, args) {
      if (!args.option && !(args.date && args.time)) throw ask('Which time: a proposed option number, or a date and time?');
      const m = await governance.get(ctx.actor, 'ALL', (await meetingNamed(ctx, args.meeting)).id);
      let when;
      if (args.option) {
        const s = (m.proposedSlots ?? [])[args.option - 1];
        if (!s) throw ask(`${m.refNo} has no proposed option ${args.option}.`);
        when = `${day(s.at)} ${time(s.at)}`;
      } else {
        const at = istAt(args.date, args.time);
        if (at < new Date()) throw ask('Choose a time in the future.');
        when = `${args.date} ${args.time}`;
      }
      return { id: m.id, ref: m.refNo, title: m.title, when, at: args.option ? null : istAt(args.date, args.time).toISOString() };
    },
    summarise: (a, _actor, p) => `Fix ${p?.ref ?? a.meeting} "${excerpt(p?.title ?? '', 60)}" for ${p?.when ?? `${a.date} ${a.time}`}${a.location ? ` at ${a.location}` : ''}; members are told`,
    async run(ctx, args, p) {
      const m = await governance.schedule(ctx.actor, 'ALL', p.id, { ...(args.option ? { slotIndex: args.option - 1 } : { scheduledAt: p.at }), ...(args.location !== undefined && { location: args.location }), ...(args.meetingLink !== undefined && { meetingLink: args.meetingLink }) });
      return did('board_meeting_time_set', m, `${m.refNo} is set for ${p.when}; members have been told.`);
    },
  }),

  record_board_meeting: tool({
    module: 'Governance', operation: 'UPDATE', affectsOthers: true,
    description: "Secretary: record a meeting that has been held — who attended (by name; the others are recorded absent), the draft minutes, resolutions with their votes (checked against the voting members present, quorum and declared conflicts), and actions with owners and due dates (added to any already recorded). Closed once the minutes are approved. Needs confirmation.",
    inputSchema: closed({
      meeting: meetingArg, present: list(text(120), 60, 'Members who attended'), minutes: text(100000),
      resolutions: list(closed({ text: text(4000), agendaItem: int(1, 40), votesFor: int(0, 100), votesAgainst: int(0, 100), abstentions: int(0, 100), outcome: oneOf(['PASSED', 'FAILED', 'DEFERRED', 'WITHDRAWN']), proposer: text(120), seconder: text(120) }, ['text']), 50),
      actions: list(closed({ title: text(300), owner: text(120), dueOn: dateStr() }, ['title']), 100),
    }),
    permission: 'governance.manage',
    service: 'governance.service.get() + record()',
    async prepare(ctx, args) {
      if (!args.present && args.minutes === undefined && !args.resolutions && !args.actions) throw ask('What should be recorded: attendance, minutes, resolutions or actions?');
      const m = await governance.get(ctx.actor, 'ALL', (await meetingNamed(ctx, args.meeting)).id);
      const attended = (args.present ?? []).map((n) => pick(m.members ?? [], stripTitle(n), { label: `member of ${m.refNo}`, refOf: () => '' }));
      return { id: m.id, ref: m.refNo, title: m.title, attended: attended.map((x) => ({ id: String(x._id), name: x.name })) };
    },
    summarise: (a, _actor, p) => `Record ${p?.ref ?? a.meeting} "${excerpt(p?.title ?? '', 60)}": ${[a.present ? `present ${p?.attended?.map((x) => x.name).join(', ') || 'nobody'}` : '', a.minutes !== undefined ? 'draft minutes' : '', a.resolutions?.length ? `${a.resolutions.length} resolution(s)` : '', a.actions?.length ? `${a.actions.length} action(s)` : ''].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) {
      const m = await governance.get(ctx.actor, 'ALL', p.id);
      const body = {};
      if (args.present) {
        const here = new Set(p.attended.map((x) => x.id));
        body.attendance = (m.members ?? []).map((x) => ({ memberId: String(x._id), attended: here.has(String(x._id)) }));
      }
      if (args.minutes !== undefined) body.minutes = args.minutes;
      if (args.resolutions?.length) {
        body.resolutions = [
          ...(m.resolutions ?? []).map((r) => ({ number: r.number, agendaOrder: r.agendaOrder, text: r.text, proposer: r.proposer, seconder: r.seconder, votesFor: r.votesFor, votesAgainst: r.votesAgainst, abstentions: r.abstentions, outcome: r.outcome })),
          ...args.resolutions.map((r) => ({ text: r.text, agendaOrder: r.agendaItem, votesFor: r.votesFor, votesAgainst: r.votesAgainst, abstentions: r.abstentions, outcome: r.outcome, proposer: r.proposer, seconder: r.seconder })),
        ];
      }
      if (args.actions?.length) {
        const ownerOf = (name) => (m.members ?? []).find((x) => x.profileId && lower(x.name) === lower(stripTitle(name)));
        body.actions = [
          ...(m.actions ?? []).map((a) => ({ title: a.title, ownerProfileId: a.ownerProfileId ? String(a.ownerProfileId) : null, ownerName: a.ownerName, dueOn: a.dueOn ?? null, status: a.status, resolutionNumber: a.resolutionNumber })),
          ...args.actions.map((a) => { const o = a.owner ? ownerOf(a.owner) : null; return { title: a.title, ownerProfileId: o ? String(o.profileId) : null, ownerName: a.owner ?? null, dueOn: a.dueOn, status: 'OPEN' }; }),
        ];
      }
      const out = await governance.record(ctx.actor, 'ALL', p.id, body);
      return did('board_meeting_recorded', out, `Recorded. ${meetingSpeak(out)}`);
    },
  }),

  record_board_minutes_approval: tool({
    module: 'Governance', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For the chair of a governance meeting (or the principal): record your approval of its draft minutes, which closes the record and sends the minutes and open actions to members. Recorded only when you say in your own words that you approve them; never suggested. Confirmed on the website.",
    inputSchema: closed({ meeting: meetingArg, decision: decisionArg(['APPROVE'], 'The chair') }, ['decision']),
    permission: 'governance.read',
    service: 'governance.service.approveMinutes()',
    async prepare(ctx, args) {
      const m = await governance.get(ctx.actor, ctx.scope, (await meetingNamed(ctx, args.meeting)).id);
      if (!m.canApproveMinutes) throw forbidden(`The chair of ${m.refNo} or the principal approves its minutes.`);
      if (m.minutes?.status !== 'DRAFT') throw ask(`${m.refNo} has no draft minutes waiting.`);
      return { id: m.id, ref: m.refNo, title: m.title };
    },
    summarise: (_a, _actor, p) => `Approve the minutes of ${p?.ref ?? 'the meeting'} "${excerpt(p?.title ?? '', 60)}"; they are sent to members and can no longer change`,
    async run(ctx, _args, p) {
      const m = await governance.approveMinutes(ctx.actor, ctx.scope, p.id);
      return did('board_minutes_approved', m, `The minutes of ${m.refNo} are approved and sent to members.`);
    },
  }),

  cancel_board_meeting: tool({
    module: 'Governance', operation: 'DELETE', affectsOthers: true,
    description: 'Cancel a governance meeting that has not been held, with the reason; members are told. Needs confirmation.',
    inputSchema: closed({ meeting: meetingArg, reason: text(500) }, ['reason']),
    permission: 'governance.manage',
    service: 'governance.service.cancel()',
    async prepare(ctx, args) { const m = await meetingNamed(ctx, args.meeting); return { id: m.id, ref: m.refNo, title: m.title }; },
    summarise: (a, _actor, p) => `Cancel ${p?.ref ?? a.meeting} "${excerpt(p?.title ?? '', 60)}": ${excerpt(a.reason, 120)}; members are told`,
    async run(ctx, args, p) {
      const m = await governance.cancel(ctx.actor, 'ALL', p.id, { reason: args.reason });
      return did('board_meeting_cancelled', m, `${m.refNo} is cancelled; members have been told.`);
    },
  }),
};

/* ── Alumni offers (the coordinator's side) ───────────────── */

async function offerNamed(ctx, term, query) {
  return pick(await opps.list(ctx.actor, query), term, { label: 'offer', refOf: () => '', describe: (o) => `${o.title} by ${o.postedBy ?? 'the school'} (${words(o.status)})` });
}

const alumniTools = {
  list_alumni_offers_for_school: tool({
    module: 'Alumni', operation: 'GET', feature: 'alumni',
    description: "Alumni coordinator: the give-back board as the school sees it — offers waiting for review, published, rejected, withdrawn or closed (or only the ones you posted), with who posted them and who is interested. Read-only.",
    inputSchema: closed({ status: oneOf(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'CLOSED']), kind: oneOf(OPPORTUNITY_KINDS), mine: bool('Only offers I posted') }),
    permission: 'alumni.manage',
    service: 'opportunities.service.list() / mine()',
    async run(ctx, args) {
      const rows = args.mine ? await opps.mine(ctx.actor) : await opps.list(ctx.actor, { status: args.status, kind: args.kind });
      return listed(rows.map((o) => ({ title: o.title, kind: o.kindLabel, by: o.postedBy, batch: o.batchLabel, audience: o.audience, status: o.status, applyBy: day(o.applyBy), interested: o.interestCount ?? 0 })), (o) => `${o.title} (${o.kind}, ${words(o.status)}${o.by ? `, by ${o.by}` : ''}, ${o.interested} interested)`, { noun: 'offer' });
    },
  }),

  add_alumni_opportunity: tool({
    module: 'Alumni', operation: 'CREATE', affectsOthers: true, feature: 'alumni',
    description: "Alumni coordinator: post an opportunity on the give-back board for the school (career talk, mentoring, internship, job, scholarship, volunteering); a school post is published straight away to the audience chosen. Needs confirmation.",
    inputSchema: closed({
      kind: oneOf(OPPORTUNITY_KINDS), title: text(150), description: text(3000), organisation: text(120), location: text(120), mode: oneOf(['IN_PERSON', 'ONLINE', 'HYBRID']),
      applyBy: dateStr(), audience: oneOf(OPPORTUNITY_AUDIENCES), link: text(500, 'https link, shown to adults only'),
    }, ['kind', 'title', 'description']),
    permission: 'alumni.manage',
    service: 'opportunities.service.create()',
    summarise: (a) => `Post "${a.title}" (${words(a.kind)}) on the alumni board for ${words(a.audience ?? 'SENIOR_STUDENTS')}${a.applyBy ? `, apply by ${a.applyBy}` : ''}`,
    async run(ctx, args) {
      const o = await opps.create(ctx.actor, args);
      return did('alumni_opportunity_posted', o, o.status === 'PUBLISHED' ? `"${o.title}" is published.` : `"${o.title}" is waiting for review.`);
    },
  }),

  close_alumni_opportunity: tool({
    module: 'Alumni', operation: 'ACTION', affectsOthers: true, feature: 'alumni',
    description: 'Alumni coordinator: take an offer off the board (it is closed; one you posted yourself is withdrawn). Needs confirmation.',
    inputSchema: closed({ offer: text(150, 'Its title') }, ['offer']),
    permission: 'alumni.manage',
    service: 'opportunities.service.withdraw()',
    async prepare(ctx, args) {
      const rows = [...await opps.list(ctx.actor, { status: 'PUBLISHED' }), ...await opps.list(ctx.actor, { status: 'PENDING_REVIEW' })];
      const o = pick(rows, args.offer, { label: 'open offer', refOf: () => '', describe: (x) => `${x.title} (${words(x.status)})` });
      return { id: o.id, title: o.title, by: o.postedBy };
    },
    summarise: (a, _actor, p) => `Take "${p?.title ?? a.offer}"${p?.by ? ` (posted by ${p.by})` : ''} off the alumni board`,
    async run(ctx, _args, p) {
      const o = await opps.withdraw(ctx.actor, p.id);
      return did('alumni_opportunity_closed', o, `"${o.title}" is ${words(o.status)}.`);
    },
  }),

  record_alumni_offer_decision: tool({
    module: 'Alumni', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'alumni',
    description: "Alumni coordinator: record your own decision on an alumnus's offer waiting for review — PUBLISH it to the audience it names, or REJECT it (with the reason the alumnus will read). Recorded only when you state the decision in your own words; never suggested. Nobody reviews their own offer. Confirmed on the website.",
    inputSchema: closed({ offer: text(150, 'Its title'), decision: decisionArg(['PUBLISH', 'REJECT'], 'The alumni coordinator'), note: text(500, 'Required to reject') }, ['decision']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'opportunities.service.review()',
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.note) throw ask('Say why, for the alumnus.');
      const o = await offerNamed(ctx, args.offer, { status: 'PENDING_REVIEW' });
      return { id: o.id, title: o.title, by: o.postedBy, audience: o.audience };
    },
    summarise: (a, _actor, p) => `${a.decision === 'PUBLISH' ? `Publish "${p?.title ?? a.offer}" to ${words(p?.audience ?? '')}` : `Reject "${p?.title ?? a.offer}"`}${p?.by ? ` (from ${p.by})` : ''}${a.note ? ` — ${excerpt(a.note, 100)}` : ''}`,
    async run(ctx, args, p) {
      const o = await opps.review(ctx.actor, p.id, { decision: args.decision, note: args.note });
      return did('alumni_offer_decided', o, `Recorded: "${o.title}" is ${words(o.status)}; ${p.by ?? 'the alumnus'} is told.`);
    },
  }),
};

export const tools = {
  ...documentTools,
  ...approvalTools,
  ...settingsTools,
  ...correspondenceTools,
  ...facilityTools,
  ...eventTools,
  ...governanceTools,
  ...alumniTools,
};
