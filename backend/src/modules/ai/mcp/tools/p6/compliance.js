// Part-6 coverage tools: compliance. See ./_kit.js and ../p6Coverage.js.
import * as compliance from '../../../../compliance/compliance.service.js';
import * as accreditation from '../../../../compliance/accreditation.service.js';
import * as privacy from '../../../../compliance/privacy.service.js';
import { STATUTORY_GUIDANCE } from '../../../../compliance/safeguarding.service.js';
import * as institution from '../../../../institution/institution.service.js';
import { profilesWithRoles } from '../../../../ops/common.js';
import { Role } from '../../../../../models/role.model.js';
import {
  tool, text, int, num, bool, oneOf, list, closed, dateStr, ask, notFound, pick, listed, shown, did,
  lower, words, day, idOf, excerpt, decisionArg, paiseOf, RISK, AppError, istAt,
} from './_kit.js';

/**
 * The Compliance Centre through the assistant: obligations, regulatory
 * returns, licences, policies, trainings, accreditation preparation,
 * regulatory notices and their watched sources, the data-protection overview,
 * and the static safeguarding guidance.
 *
 * Each tool is the Compliance page's own service call behind the route's own
 * guard: compliance.read to read (principal, HR, trustees, the officer),
 * compliance.manage to change (the officer, administration). The two
 * accreditation routes with no permission (my evidence items, updating one)
 * serve the person an item is assigned to, and the service lets them see and
 * change only their own.
 *
 * The rule of the module holds here too: the system tracks, people decide.
 * Whether an obligation or a notice applies, and a reviewer's decision on a
 * return, are approver-confirmed (stated by the person in their own words,
 * confirmed on the website). Nothing is filed with any authority from here:
 * a submission is recorded with the acknowledgement number the person got.
 * Approving a policy stays on the Approvals screen. Safeguarding case files,
 * reports and camera observations are never read here; only the statutory
 * guidance is.
 */

const cRead = { module: 'Compliance', permission: 'compliance.read' };
const cManage = { module: 'Compliance', permission: 'compliance.manage' };

const OBLIGATION_CATEGORIES = ['RETURN', 'LICENCE', 'POLICY', 'TRAINING', 'DISCLOSURE', 'COMMITTEE', 'INSPECTION', 'OTHER'];
const RETURN_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED_FOR_SUBMISSION', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'RESUBMISSION_REQUIRED'];
const LICENCE_KINDS = ['RECOGNITION', 'AFFILIATION', 'NOC', 'CERTIFICATE', 'REGISTRATION', 'INSURANCE', 'VEHICLE', 'SOFTWARE_SUBSCRIPTION', 'OTHER'];
const RENEWAL_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'APPLIED', 'RENEWED'];
const POLICY_CATEGORIES = ['SAFEGUARDING', 'POSH', 'ANTI_RAGGING', 'ACADEMIC', 'EXAMINATION', 'HR', 'FINANCE', 'IT_DATA', 'TRANSPORT', 'SAFETY', 'ADMISSION', 'CONDUCT', 'OTHER'];
const AUDIENCE_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'TRUSTEE', 'PARENT', 'STUDENT'];
const TOPICS = ['POCSO_CHILD_PROTECTION', 'POSH', 'ANTI_RAGGING', 'FIRE_SAFETY', 'FIRST_AID', 'EMERGENCY_DRILL', 'TRANSPORT_SAFETY', 'CYBER_SAFETY', 'DATA_PROTECTION', 'INDUCTION', 'ACADEMIC', 'OTHER'];
const NOTICE_SOURCES = ['CBSE', 'CISCE', 'STATE_BOARD', 'STATE_EDUCATION_DEPT', 'DISTRICT_COLLECTOR', 'DISTRICT_EDUCATION_OFFICE', 'MINISTRY', 'UGC', 'AICTE', 'UNIVERSITY', 'NCPCR_SCPCR', 'COURT', 'OTHER'];
const NOTICE_STATUSES = ['NEW', 'UNDER_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE', 'ACTIONED'];
const ITEM_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'READY', 'NOT_APPLICABLE'];
const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const HTTPS = /^https:\/\/\S+$/i;

const httpsOnly = (link, label = 'link') => {
  if (link && !HTTPS.test(link)) throw new AppError(`The ${label} must be an https:// address.`, 400, [], 'BAD_LINK');
};

/* ── lookups from the caller's own lists ─────────────────── */

const theObligation = async (term) => pick(await compliance.listObligations({}), term, { label: 'obligation', nameOf: (o) => o.title, refOf: (o) => o.code, describe: (o) => `${o.code} ${excerpt(o.title, 60)}` });
const theReturn = async (term) => pick(await compliance.listReturns({}), term, { label: 'return', nameOf: (r) => r.title, refOf: (r) => r.refNo, describe: (r) => `${r.refNo} ${r.title} (${words(r.status)})` });
const theLicence = async (term) => pick(await compliance.listLicences({}), term, { label: 'licence or certificate', nameOf: (l) => l.title, refOf: (l) => l.number, describe: (l) => `${l.title}${l.number ? ` (${l.number})` : ''}` });
const thePolicy = async (term) => pick(await compliance.listPolicies(), term, { label: 'policy', nameOf: (p) => p.title, refOf: (p) => p.code, describe: (p) => `${p.code} ${p.title}` });
const theTraining = async (term) => pick(await compliance.listTrainings({}), term, { label: 'training', nameOf: (t) => t.title, refOf: (t) => t.refNo, describe: (t) => `${t.refNo} ${t.title} (${day(t.scheduledAt)})` });
const theCycle = async (term) => pick(await accreditation.listCycles(), term, { label: 'accreditation cycle', nameOf: (c) => c.title, refOf: (c) => c.refNo, describe: (c) => `${c.refNo} ${c.title}` });
const theNotice = async (term) => pick(await compliance.listNotices({}), term, { label: 'regulatory notice', nameOf: (n) => n.title, refOf: (n) => n.refNo, describe: (n) => `${n.refNo} ${excerpt(n.title, 60)}` });
const theSource = async (term) => pick(await compliance.listNoticeSources(), term, { label: 'watched source', nameOf: (s) => s.name, refOf: (s) => s.url, describe: (s) => s.name });

/** A member of staff by name (owners of evidence items, notice actions, obligations). */
async function staffNamed(name, { managersOnly = false } = {}) {
  let people = await profilesWithRoles(STAFF_ROLES);
  if (managersOnly) {
    const roles = await Role.find({ 'permissions.key': 'compliance.manage' }).select('_id').lean();
    const ok = new Set(roles.map((r) => String(r._id)));
    people = people.filter((p) => ok.has(String(p.roleId?._id ?? p.roleId)));
  }
  const rows = people.map((p) => ({ id: String(p._id), name: p.displayName, role: p.roleId?.key ?? null }));
  return pick(rows, String(name ?? '').replace(/^\s*(?:mr|mrs|ms|miss|dr|sir|madam)\.?\s+/i, ''), { label: managersOnly ? 'member of staff who manages compliance' : 'member of staff', nameOf: (p) => p.name, refOf: () => null, describe: (p) => `${p.name}${p.role ? ` (${words(p.role)})` : ''}` });
}

const returnRow = (r) => ({ refNo: r.refNo, title: r.title, template: r.template, period: r.period, authority: r.authority, status: r.status, dueOn: day(r.dueOn), overdue: Boolean(r.isOverdue), errors: r.errors ?? 0, warnings: r.warnings ?? 0 });
const cycleRow = (c) => ({ refNo: c.refNo, title: c.title, framework: c.frameworkLabel, programme: c.programme ?? null, status: c.status, targetDate: day(c.targetDate), templateVerified: Boolean(c.templateVerified), readyPct: c.progress?.readyPct ?? null, items: c.progress?.items ?? 0, overdue: c.progress?.overdue ?? 0 });

/* ── reads ────────────────────────────────────────────────── */

const reads = {
  get_data_protection_overview: tool({
    ...cRead, operation: 'GET',
    description: 'For the principal, HR, trustees and the compliance officer: the data-protection overview in counts: open and overdue data-principal requests, open breaches and those past the 72-hour Board clock, statutory committees and their reviews, and the readiness tally. No names. Read-only.',
    service: 'privacy.service.overview()',
    async run() {
      const o = await privacy.overview();
      return shown(o, `${o.openRequests} open data request(s) (${o.overdueRequests} overdue); ${o.openBreaches} open breach(es) (${o.breachesPastClock} past the 72-hour clock); ${o.committees} committee(s), ${o.committeesReviewOverdue} past review.`);
    },
  }),

  get_data_request: tool({
    ...cManage, operation: 'GET',
    description: 'For the compliance officer: one data-principal request in full (kind, requester, how they are related, contact, details, response date, identity check, status, outcome and its history), by reference (DPR/2026/0004) or requester name. Read-only.',
    inputSchema: closed({ request: text(120, 'Reference or requester name') }, ['request']),
    service: 'privacy.service.listRequests() + getRequest()',
    async run(_ctx, args) {
      const hit = pick(await privacy.listRequests({ status: 'ALL' }), args.request, { label: 'data request', nameOf: (r) => r.requesterName, refOf: (r) => r.refNo, describe: (r) => `${r.refNo} ${r.requesterName}` });
      const r = await privacy.getRequest(idOf(hit));
      return shown(r, `${r.refNo}: ${words(r.kindLabel ?? r.kind)} from ${r.requesterName}, ${words(r.status)}${r.dueAt ? `, respond by ${day(r.dueAt)}` : ''}${r.overdue ? ' (overdue)' : ''}.`);
    },
  }),

  get_compliance_overview: tool({
    ...cRead, operation: 'GET',
    description: 'The Compliance Centre at a glance: applicable obligations and those still under review, open and overdue returns, expired and expiring licences, notices to review, policies past review, and mandatory-training coverage by topic. Read-only.',
    service: 'compliance.service.overview()',
    async run() {
      const o = await compliance.overview();
      const coverage = (o.trainingCoverage ?? []).map(({ untrained, ...t }) => ({ ...t, untrainedCount: untrained?.length ?? 0 }));
      return shown({ ...o, trainingCoverage: coverage }, `${o.applicableObligations} applicable obligation(s), ${o.obligationsUnderReview} under review; ${o.returnsOpen} open return(s), ${o.returnsOverdue} overdue; ${o.licencesExpired} licence(s) expired, ${o.licencesExpiring} expiring; ${o.noticesToReview} notice(s) to review; ${o.policiesReviewOverdue} polic${o.policiesReviewOverdue === 1 ? 'y' : 'ies'} past review.`);
    },
  }),

  list_compliance_obligations: tool({
    ...cRead, operation: 'GET',
    description: 'The compliance obligations register (returns, licences, policies, trainings, disclosures, committees, inspections): code, title, authority, how often, next due, and whether it applies here (applicable, not applicable, under review). Read-only.',
    inputSchema: closed({ applicability: oneOf(['UNDER_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE']), category: oneOf(OBLIGATION_CATEGORIES) }),
    service: 'compliance.service.listObligations()',
    async run(_ctx, args) {
      const rows = (await compliance.listObligations(args)).map((o) => ({ code: o.code, title: o.title, authority: o.authority, category: o.category, frequency: o.frequency, nextDueOn: day(o.nextDueOn), applicability: o.applicability, active: o.active !== false, note: o.applicabilityNote ?? null }));
      return listed(rows, (o) => `${o.code} (${words(o.applicability)})`, { noun: 'obligation' });
    },
  }),

  list_regulatory_returns: tool({
    ...cRead, operation: 'GET',
    description: 'Regulatory returns (UDISE+, AISHE, monthly attendance, staff strength, board candidate list, mandatory disclosure, custom): reference, period, authority, status, due date, overdue, and validation errors and warnings. Read-only.',
    inputSchema: closed({ status: oneOf(RETURN_STATUSES) }),
    service: 'compliance.service.listReturns()',
    async run(_ctx, args) {
      const rows = (await compliance.listReturns(args)).map(returnRow);
      return listed(rows, (r) => `${r.refNo} ${r.title} (${words(r.status)}${r.overdue ? ', overdue' : ''})`, { noun: 'return' });
    },
  }),

  get_regulatory_return: tool({
    ...cRead, operation: 'GET',
    description: 'One regulatory return by reference (RET/...) or title: its status, figures and where each came from, the validation findings, the submission record and the authority\'s response, and its history. The printable document and CSV are on the Compliance page. Read-only.',
    inputSchema: closed({ return: text(200, 'Reference or title') }, ['return']),
    service: 'compliance.service.listReturns() + getReturn()',
    async run(_ctx, args) {
      const r = await compliance.getReturn(idOf(await theReturn(args.return)));
      const out = { ...returnRow(r), data: r.data ?? {}, validation: r.validation ?? [], submission: r.submission ?? null, authorityResponse: r.authorityResponse ?? null, history: (r.history ?? []).map((h) => ({ at: h.at, action: h.action, by: h.actorName ?? null, note: h.note ?? null })) };
      return shown(out, `${r.refNo} ${r.title}: ${words(r.status)}, ${out.errors} error(s) and ${out.warnings} warning(s)${r.dueOn ? `, due ${day(r.dueOn)}` : ''}.`);
    },
  }),

  list_compliance_policies: tool({
    ...cRead, operation: 'GET',
    description: 'The school\'s policy register: code, title, category, current version, a version waiting for approval, who it is addressed to, acknowledgements against the audience, and review dates. Read-only.',
    service: 'compliance.service.listPolicies()',
    async run() {
      const rows = (await compliance.listPolicies()).map((p) => ({ code: p.code, title: p.title, category: p.category, currentVersion: p.currentVersion ?? null, pendingVersion: p.pendingVersion ? { version: p.pendingVersion.version, status: p.pendingVersion.status } : null, audience: p.audienceRoles, requiresAcknowledgement: Boolean(p.requiresAcknowledgement), acknowledgements: p.acknowledgements, audienceSize: p.audienceSize, nextReviewOn: day(p.nextReviewOn), reviewOverdue: Boolean(p.reviewOverdue) }));
      return listed(rows, (p) => `${p.code} ${p.title}${p.currentVersion ? ` v${p.currentVersion}` : ' (not yet approved)'}`, { noun: 'policy', speak: rows.length ? undefined : 'No policies are recorded yet.' });
    },
  }),

  get_compliance_policy: tool({
    ...cRead, operation: 'GET',
    description: 'One policy by code or title: its versions (summary, status, effective date), the current text, a pending version, who it is addressed to and the review date. Read-only.',
    inputSchema: closed({ policy: text(200, 'Code or title') }, ['policy']),
    service: 'compliance.service.listPolicies() + getPolicy()',
    async run(_ctx, args) {
      const p = await compliance.getPolicy(idOf(await thePolicy(args.policy)));
      const out = {
        code: p.code, title: p.title, category: p.category, audience: p.audienceRoles, requiresAcknowledgement: Boolean(p.requiresAcknowledgement), reviewEveryMonths: p.reviewEveryMonths, nextReviewOn: day(p.nextReviewOn), reviewOverdue: Boolean(p.reviewOverdue),
        currentVersion: p.currentVersion ?? null, current: p.current ? { version: p.current.version, summary: p.current.summary ?? null, body: p.current.body ?? null, effectiveFrom: day(p.current.effectiveFrom) } : null,
        versions: (p.versions ?? []).map((v) => ({ version: v.version, status: v.status, summary: v.summary ?? null, effectiveFrom: day(v.effectiveFrom) })),
      };
      return shown(out, `${p.code} ${p.title}: ${p.currentVersion ? `version ${p.currentVersion} in force` : 'no approved version yet'}${p.pendingVersion ? `; version ${p.pendingVersion.version} is ${words(p.pendingVersion.status)}` : ''}.`);
    },
  }),

  list_compliance_trainings: tool({
    ...cRead, operation: 'GET',
    description: 'Training sessions (POCSO, POSH, fire safety, first aid, drills, data protection ...): reference, topic, when, audience, mandatory, status, and invited / attended / acknowledged counts. Read-only.',
    inputSchema: closed({ topic: oneOf(TOPICS), status: oneOf(['SCHEDULED', 'COMPLETED', 'CANCELLED']) }),
    service: 'compliance.service.listTrainings()',
    async run(_ctx, args) {
      const rows = (await compliance.listTrainings(args)).map((t) => ({ refNo: t.refNo, title: t.title, topic: t.topic, audience: t.audience, mandatory: Boolean(t.mandatory), scheduledAt: t.scheduledAt, date: day(t.scheduledAt), location: t.location ?? null, status: t.status, invited: t.invited, attended: t.attended, acknowledged: t.acknowledged }));
      return listed(rows, (t) => `${t.refNo} ${t.title} (${t.date}, ${words(t.status)})`, { noun: 'training' });
    },
  }),

  list_accreditation_frameworks: tool({
    ...cRead, operation: 'GET',
    description: 'The accreditation frameworks a preparation cycle can start from (NAAC, NBA, a board or university inspection, custom) with their criteria headings and the note on checking them against the agency\'s current manual. Read-only.',
    service: 'accreditation.service.frameworks()',
    async run() {
      const rows = accreditation.frameworks();
      return listed(rows, (f) => `${f.label} (${f.criteria.length} criteria)`, { noun: 'framework' });
    },
  }),

  list_my_accreditation_items: tool({
    module: 'Compliance', operation: 'GET', permission: 'ai.copilot.use',
    description: 'Anyone: the accreditation evidence items assigned to you across the open preparation cycles (cycle, criterion, what is asked for, due date, status, note, evidence attached). Read-only.',
    service: 'accreditation.service.myItems()',
    async run(ctx) {
      const rows = (await accreditation.myItems(ctx.actor)).map((i) => ({ cycle: i.cycle, criterion: i.criterion, metric: i.metric, status: i.status, dueOn: day(i.dueOn), note: i.note, evidence: i.evidence.length }));
      return listed(rows, (i) => `${excerpt(i.metric, 60)} (${words(i.status)}${i.dueOn ? `, due ${i.dueOn}` : ''})`, { noun: 'evidence item', speak: rows.length ? undefined : 'No accreditation evidence is assigned to you.' });
    },
  }),

  list_accreditation_cycles: tool({
    ...cRead, operation: 'GET',
    description: 'Accreditation and inspection preparation cycles: reference, title, framework, status, target date, whether the criteria were checked against the current manual, and how much evidence is ready. Read-only.',
    service: 'accreditation.service.listCycles()',
    async run() {
      const rows = (await accreditation.listCycles()).map(cycleRow);
      return listed(rows, (c) => `${c.refNo} ${c.title} (${c.readyPct === null ? 'no items yet' : `${c.readyPct}% ready`})`, { noun: 'accreditation cycle' });
    },
  }),

  get_accreditation_cycle: tool({
    ...cRead, operation: 'GET',
    description: 'One accreditation cycle by reference (ACR/...) or title: each criterion with its evidence items (what is asked for, owner, due date, status, evidence attached), progress, the submission and the outcome. Read-only.',
    inputSchema: closed({ cycle: text(200, 'Reference or title') }, ['cycle']),
    service: 'accreditation.service.listCycles() + getCycle()',
    async run(_ctx, args) {
      const c = await accreditation.getCycle(idOf(await theCycle(args.cycle)));
      const out = { ...cycleRow(c), templateNote: c.templateNote ?? null, criteria: c.criteria.map((cr) => ({ code: cr.code, title: cr.title, ready: cr.ready, counted: cr.counted, items: cr.items.map((i) => ({ metric: i.metric, owner: i.ownerName, dueOn: day(i.dueOn), status: i.status, note: i.note, evidence: i.evidence.length })) })), submission: c.submission ?? null, outcome: c.outcome ?? null };
      return shown(out, `${c.refNo} ${c.title}: ${words(c.status)}, ${c.progress.ready} of ${c.progress.counted} item(s) ready${c.progress.overdue ? `, ${c.progress.overdue} overdue` : ''}${c.templateVerified ? '' : '; the criteria are not yet checked against the current manual'}.`);
    },
  }),

  list_regulatory_notices: tool({
    ...cRead, operation: 'GET',
    description: 'Notices and circulars from boards, the education department, the district, ministries, universities and courts: reference, source, title, status (new, under review, applicable, not applicable, actioned), whether verified genuine, and the actions that follow. Read-only.',
    inputSchema: closed({ status: oneOf(NOTICE_STATUSES) }),
    service: 'compliance.service.listNotices()',
    async run(_ctx, args) {
      const rows = (await compliance.listNotices(args)).map((n) => ({ refNo: n.refNo, source: n.source, jurisdiction: n.jurisdiction ?? null, title: n.title, status: n.status, authenticity: n.authenticity ?? 'UNVERIFIED', effectiveOn: day(n.effectiveOn), link: n.url ?? null, actions: (n.actions ?? []).map((a) => ({ title: a.title, dueOn: day(a.dueOn), done: Boolean(a.done) })) }));
      return listed(rows, (n) => `${n.refNo} ${excerpt(n.title, 60)} (${words(n.status)})`, { noun: 'notice' });
    },
  }),

  list_notice_sources: tool({
    ...cRead, operation: 'GET',
    description: 'The official web pages the school watches for new notices: name, address, body, when last checked and whether it changed or the check failed. Read-only.',
    service: 'compliance.service.listNoticeSources()',
    async run() {
      const rows = (await compliance.listNoticeSources()).map((s) => ({ name: s.name, url: s.url, source: s.source, jurisdiction: s.jurisdiction ?? null, lastCheckedAt: s.lastCheckedAt ?? null, lastStatus: s.lastStatus ?? null, lastError: s.lastError ?? null }));
      return listed(rows, (s) => `${s.name}${s.lastStatus ? ` (${words(s.lastStatus)})` : ''}`, { noun: 'watched source' });
    },
  }),

  get_safeguarding_guidance: tool({
    module: 'Safeguarding', operation: 'GET', permission: 'ai.copilot.use',
    description: 'Anyone: the statutory guidance on what to do about a child-protection concern, sexual harassment at work, ragging or a risk of self-harm (who must be told, emergency numbers 112, Childline 1098, Tele-MANAS 14416). General guidance only; no case is read or filed here: a concern is reported on the Safeguarding page. Read-only.',
    inputSchema: closed({ topic: oneOf(Object.keys(STATUTORY_GUIDANCE), 'Leave out for all of it') }),
    service: 'safeguarding.service.STATUTORY_GUIDANCE',
    async run(_ctx, args) {
      const rows = Object.entries(STATUTORY_GUIDANCE).filter(([k]) => !args.topic || k === args.topic).map(([topic, guidance]) => ({ topic, guidance }));
      return listed(rows, (g) => g.guidance, { noun: 'guidance note', speak: `${rows.map((g) => g.guidance).join(' ')} To report a concern, use the Safeguarding page; it goes straight to the designated safeguarding lead.` });
    },
  }),
};

/* ── obligations ──────────────────────────────────────────── */

const obligations = {
  add_standard_compliance_obligations: tool({
    ...cManage, operation: 'ACTION', risk: RISK.MEDIUM,
    description: 'For the compliance officer: load the suggested obligations for this kind of institution (POCSO, POSH, fire and building certificates, UDISE+ or AISHE, public disclosure, transport safety, DPDP consent ...) into the register. Each arrives "under review" for you to decide whether it applies; existing ones are left alone. Needs confirmation.',
    inputSchema: closed({ institutionType: oneOf(['SCHOOL', 'COLLEGE', 'COMBINED'], 'Default: the institution profile') }),
    service: 'institution.service.terminology() + compliance.service.seedCatalogue()',
    async prepare(_ctx, args) {
      const { institutionType } = await institution.terminology();
      return { institutionType: args.institutionType ?? institutionType };
    },
    summarise: (_a, _x, p) => `Load the suggested ${words(p?.institutionType ?? 'school')} obligations into the compliance register, each "under review" (obligations already there stay as they are)`,
    async run(ctx, _args, p) {
      const r = await compliance.seedCatalogue(ctx.actor, p.institutionType);
      return did('compliance_catalogue_loaded', null, `${r.added} obligation(s) added for review; ${r.total} in the register.`);
    },
  }),

  update_compliance_obligation: tool({
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: change an obligation\'s next due date, its owner (a member of staff by name), or switch it off or on. Whether it applies is recorded with record_obligation_applicability_decision. Needs confirmation.',
    inputSchema: closed({ obligation: text(300, 'Code or title'), nextDueOn: dateStr(), owner: text(120, 'A member of staff by name, or "nobody"'), active: bool('false switches it off') }, ['obligation']),
    service: 'compliance.service.listObligations() + reviewObligation()',
    async prepare(_ctx, args) {
      if (args.nextDueOn === undefined && args.owner === undefined && args.active === undefined) throw ask('What should change: the next due date, the owner, or whether it is active?');
      const o = await theObligation(args.obligation);
      const owner = args.owner === undefined ? undefined : (/^(nobody|none|no one)$/i.test(args.owner.trim()) ? null : await staffNamed(args.owner));
      return { id: idOf(o), code: o.code, title: o.title, ownerId: owner === undefined ? undefined : owner?.id ?? null, ownerName: owner?.name ?? null };
    },
    summarise: (a, _x, p) => `${p?.code ?? a.obligation} "${excerpt(p?.title, 60)}": ${[a.nextDueOn && `next due ${a.nextDueOn}`, a.owner !== undefined && `owner ${p?.ownerName ?? 'nobody'}`, a.active !== undefined && (a.active ? 'switch on' : 'switch off')].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) {
      const o = await compliance.reviewObligation(ctx.actor, p.id, { ...(args.nextDueOn !== undefined && { nextDueOn: args.nextDueOn }), ...(p.ownerId !== undefined && { ownerProfileId: p.ownerId }), ...(args.active !== undefined && { active: args.active }) });
      return did('compliance_obligation_updated', o, `${o.code} updated.`);
    },
  }),

  record_obligation_applicability_decision: tool({
    ...cManage, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: 'For the compliance officer: record whether an obligation applies to this school (applicable, not applicable, or back under review) with the reason in words. Recorded only when the officer states the decision in their own words. Confirmed on the website.',
    inputSchema: closed({ obligation: text(300, 'Code or title'), decision: decisionArg(['APPLICABLE', 'NOT_APPLICABLE', 'UNDER_REVIEW'], 'the compliance officer'), note: text(2000, 'Why it does or does not apply') }, ['obligation', 'decision', 'note']),
    service: 'compliance.service.listObligations() + reviewObligation()',
    async prepare(_ctx, args) {
      if (!String(args.note ?? '').trim()) throw ask('Why does it, or does it not, apply? The register keeps the reason.');
      const o = await theObligation(args.obligation);
      return { id: idOf(o), code: o.code, title: o.title, from: o.applicability };
    },
    summarise: (a, _x, p) => `Record that ${p?.code ?? a.obligation} "${excerpt(p?.title, 60)}" is ${words(a.decision)} (was ${words(p?.from ?? 'under review')}) — reason: "${excerpt(a.note, 120)}"`,
    async run(ctx, args, p) {
      const o = await compliance.reviewObligation(ctx.actor, p.id, { applicability: args.decision, note: args.note });
      return did('compliance_obligation_applicability', o, `${o.code} is recorded as ${words(o.applicability)}.`);
    },
  }),
};

/* ── regulatory returns ───────────────────────────────────── */

const returns = {
  generate_regulatory_return: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: generate a regulatory return as a draft from the school\'s records (UDISE+ profile, AISHE profile, monthly attendance for a YYYY-MM, staff strength, board candidate list for a class, mandatory disclosure, or a custom one), with every figure\'s source and the validation findings. Nothing is filed. Needs confirmation.',
    inputSchema: closed({
      template: oneOf(['UDISE_PLUS_PROFILE', 'AISHE_PROFILE', 'MONTHLY_ATTENDANCE', 'STAFF_STRENGTH', 'BOARD_CANDIDATE_LIST', 'MANDATORY_DISCLOSURE', 'CUSTOM']),
      period: text(20, 'e.g. 2026-27, 2026-09 (monthly attendance), or the class for a candidate list'),
      title: text(200), authority: text(200), dueOn: dateStr(), obligation: text(300, 'The obligation it answers, by code or title'),
    }, ['template', 'period']),
    service: 'compliance.service.createReturn()',
    async prepare(_ctx, args) {
      const o = args.obligation ? await theObligation(args.obligation) : null;
      return { obligationId: o ? idOf(o) : null, obligation: o?.code ?? null };
    },
    summarise: (a, _x, p) => `Generate a draft ${words(a.template)} return for ${a.period}${a.title ? ` titled "${a.title}"` : ''}${a.dueOn ? `, due ${a.dueOn}` : ''}${p?.obligation ? ` (obligation ${p.obligation})` : ''} from the school's records`,
    async run(ctx, args, p) {
      const { obligation: _o, ...body } = args;
      const r = await compliance.createReturn(ctx.actor, { ...body, ...(p.obligationId && { obligationId: p.obligationId }) });
      return did('regulatory_return_generated', r, `Generated ${r.refNo} as a draft: ${r.errors} error(s), ${r.warnings} warning(s) to look at.`);
    },
  }),

  edit_regulatory_return_figures: tool({
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: correct or enter figures on a draft return (a custom return\'s figures, or an adjustment), each as a field and value, with a note saying what changed and why; the change is logged on the return. Needs confirmation.',
    inputSchema: closed({
      return: text(200, 'Reference or title'),
      changes: list(closed({ field: text(80), value: text(500, 'A number or text') }, ['field', 'value']), 30),
      note: text(1000, 'What was changed and why'),
    }, ['return', 'changes', 'note']),
    service: 'compliance.service.listReturns() + editReturnData()',
    async prepare(_ctx, args) {
      if (!args.changes?.length) throw ask('Which figures should change, and to what?');
      const r = await theReturn(args.return);
      if (r.status !== 'DRAFT') throw new AppError(`${r.refNo} is ${words(r.status)}; only a draft return can be edited.`, 409, [], 'NOT_DRAFT');
      return { id: idOf(r), refNo: r.refNo, title: r.title };
    },
    summarise: (a, _x, p) => `On ${p?.refNo ?? a.return}: ${(a.changes ?? []).map((c) => `${c.field} = ${c.value}`).join('; ')} — note "${excerpt(a.note, 100)}"`,
    async run(ctx, args, p) {
      const data = Object.fromEntries(args.changes.map((c) => [c.field, /^-?\d+(\.\d+)?$/.test(String(c.value).trim()) ? Number(c.value) : c.value]));
      const r = await compliance.editReturnData(ctx.actor, p.id, { data, note: args.note });
      return did('regulatory_return_figures_edited', r, `${r.refNo}: ${args.changes.length} figure(s) updated.`);
    },
  }),

  move_regulatory_return: tool({
    ...cManage, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: move a return along: regenerate a draft from fresh records; send it for review (to a colleague who manages compliance, by name; validation errors must be acknowledged); record that it was submitted to the authority (method and the acknowledgement number you received — nothing is filed from here); record the authority\'s outcome (accepted, or rejected with what they said); or reopen a rejected one for resubmission. Confirmed on the website.',
    inputSchema: closed({
      return: text(200, 'Reference or title'),
      step: oneOf(['regenerate', 'send_for_review', 'record_submission', 'record_outcome', 'reopen']),
      reviewer: text(120, 'send_for_review: who reviews it'), acknowledgeErrors: bool('send_for_review: send it although it has validation errors'),
      method: oneOf(['PORTAL_MANUAL', 'EMAIL', 'POST', 'HAND'], 'record_submission'), acknowledgementNo: text(120, 'record_submission: the portal acknowledgement or receipt number'), submittedOn: dateStr('record_submission: default today'),
      outcome: oneOf(['ACCEPTED', 'REJECTED'], 'record_outcome'), response: text(4000, 'record_outcome: what the authority said (required when rejected)'),
      note: text(1000),
    }, ['return', 'step']),
    service: 'compliance.service.regenerateReturn() / sendReturnForReview() / recordSubmission() / recordOutcome() / reopenForResubmission()',
    async prepare(_ctx, args) {
      const r = await theReturn(args.return);
      let reviewer = null;
      if (args.step === 'send_for_review' && args.reviewer) reviewer = await staffNamed(args.reviewer, { managersOnly: true });
      if (args.step === 'record_submission') {
        if (!args.method) throw ask('How was it submitted: on the portal, by email, by post or by hand?');
        if (!args.acknowledgementNo) throw ask('What acknowledgement or receipt number did the authority give? A generated file is not a filing.');
      }
      if (args.step === 'record_outcome') {
        if (!args.outcome) throw ask('Did the authority accept it or reject it?');
        if (args.outcome === 'REJECTED' && !args.response) throw ask('What did the authority say?');
      }
      return { id: idOf(r), refNo: r.refNo, title: r.title, status: r.status, reviewerId: reviewer?.id ?? null, reviewer: reviewer?.name ?? null };
    },
    summarise: (a, _x, p) => {
      const ref = `${p?.refNo ?? a.return} "${excerpt(p?.title, 60)}"`;
      switch (a.step) {
        case 'regenerate': return `Regenerate draft ${ref} from fresh records (the figures and findings are replaced)`;
        case 'send_for_review': return `Send ${ref} for review${p?.reviewer ? ` to ${p.reviewer}` : ''}${a.acknowledgeErrors ? ', acknowledging its validation errors' : ''}`;
        case 'record_submission': return `Record that ${ref} was submitted ${words(a.method)} on ${a.submittedOn ?? 'today'}, acknowledgement ${a.acknowledgementNo}`;
        case 'record_outcome': return `Record the authority's outcome on ${ref}: ${words(a.outcome)}${a.response ? ` — "${excerpt(a.response, 100)}"` : ''}`;
        default: return `Reopen ${ref} for resubmission (it returns to draft and is regenerated)`;
      }
    },
    async run(ctx, args, p) {
      let r;
      if (args.step === 'regenerate') r = await compliance.regenerateReturn(ctx.actor, p.id);
      else if (args.step === 'send_for_review') r = await compliance.sendReturnForReview(ctx.actor, p.id, { ...(p.reviewerId && { reviewerProfileId: p.reviewerId }), acknowledgeErrors: args.acknowledgeErrors === true, note: args.note });
      else if (args.step === 'record_submission') r = await compliance.recordSubmission(ctx.actor, p.id, { method: args.method, acknowledgementNo: args.acknowledgementNo, at: args.submittedOn ? istAt(args.submittedOn, '12:00') : undefined });
      else if (args.step === 'record_outcome') r = await compliance.recordOutcome(ctx.actor, p.id, { outcome: args.outcome, response: args.response });
      else r = await compliance.reopenForResubmission(ctx.actor, p.id);
      return did('regulatory_return_moved', r, `${r.refNo} is now ${words(r.status)}.`);
    },
  }),

  record_return_review_decision: tool({
    ...cManage, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: 'For the reviewer of a regulatory return in review: send it back to the preparer (with a note saying what to fix) or pass it on for the principal\'s approval for submission. Recorded only when the reviewer states the decision in their own words; the preparer can never review their own return. Confirmed on the website.',
    inputSchema: closed({ return: text(200, 'Reference or title'), decision: decisionArg(['SEND_BACK', 'REQUEST_APPROVAL'], 'the reviewer'), note: text(1000, 'Required to send it back') }, ['return', 'decision']),
    service: 'compliance.service.listReturns() + reviewReturn()',
    async prepare(ctx, args) {
      const r = await theReturn(args.return);
      if (r.status !== 'IN_REVIEW') throw new AppError(`${r.refNo} is ${words(r.status)}, not in review.`, 409, [], 'NOT_IN_REVIEW');
      if (String(r.preparerProfileId) === String(ctx.actor.profileId)) throw new AppError('You prepared this return, so a colleague reviews it.', 403, [], 'SELF_REVIEW');
      if (args.decision === 'SEND_BACK' && !args.note) throw ask('What should the preparer fix?');
      return { id: idOf(r), refNo: r.refNo, title: r.title, authority: r.authority };
    },
    summarise: (a, _x, p) => (a.decision === 'SEND_BACK'
      ? `Send ${p?.refNo ?? a.return} "${excerpt(p?.title, 60)}" back to the preparer: "${excerpt(a.note, 120)}"`
      : `Mark ${p?.refNo ?? a.return} "${excerpt(p?.title, 60)}" as reviewed and ask the principal to approve it for submission to ${p?.authority ?? 'the authority'}`),
    async run(ctx, args, p) {
      const r = await compliance.reviewReturn(ctx.actor, p.id, { decision: args.decision === 'SEND_BACK' ? 'RETURN' : 'REQUEST_APPROVAL', note: args.note });
      return did('regulatory_return_reviewed', r, args.decision === 'SEND_BACK' ? `${r.refNo} is back with the preparer.` : `${r.refNo} is with the principal for approval.`);
    },
  }),
};

/* ── licences ─────────────────────────────────────────────── */

const licenceFields = {
  kind: oneOf(LICENCE_KINDS), title: text(200), issuer: text(200), number: text(120, 'Certificate or registration number'), campusCode: text(40),
  issuedOn: dateStr(), validFrom: dateStr(), expiresOn: dateStr(), renewalLeadDays: int(0, 730, 'Days before expiry to start renewing (default 60)'),
  renewalCostRupees: num(0, 100000000), renewalStatus: oneOf(RENEWAL_STATUSES), publicDisclosure: bool('Shown in the public disclosure'), notes: text(500),
};
const licenceBody = (a) => {
  const { licence: _l, renewalCostRupees, ...rest } = a;
  return { ...rest, ...(renewalCostRupees !== undefined && { renewalCostPaise: renewalCostRupees === 0 ? 0 : paiseOf(renewalCostRupees, 'renewal cost') }) };
};
const licenceWords = (a) => [a.kind && words(a.kind), a.number && `no. ${a.number}`, a.issuer && `from ${a.issuer}`, a.expiresOn && `expires ${a.expiresOn}`, a.renewalStatus && `renewal ${words(a.renewalStatus)}`, a.renewalCostRupees !== undefined && `renewal ₹${a.renewalCostRupees}`, a.publicDisclosure !== undefined && (a.publicDisclosure ? 'in the public disclosure' : 'not in the public disclosure')].filter(Boolean).join(', ');

const licences = {
  add_compliance_licence: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: add a licence, certificate, recognition, affiliation, NOC, registration or insurance to the register with its number, issuer and dates; its status comes from the expiry date and a renewal reminder follows. Needs confirmation.',
    inputSchema: closed(licenceFields, ['kind', 'title']),
    service: 'compliance.service.createLicence()',
    summarise: (a) => `Add "${a.title}" (${licenceWords(a)}) to the licence register`,
    async run(ctx, args) {
      const l = await compliance.createLicence(ctx.actor, licenceBody(args));
      return did('licence_added', l, `Added "${l.title}" (${words(l.status)}).`);
    },
  }),

  update_compliance_licence: tool({
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: update a licence or certificate: new dates after renewal (the old period stays in its history), renewal progress, number, issuer, cost, notes or public disclosure. Needs confirmation.',
    inputSchema: closed({ licence: text(200, 'Its title or number'), ...licenceFields }, ['licence']),
    service: 'compliance.service.listLicences() + updateLicence()',
    async prepare(_ctx, args) {
      const l = await theLicence(args.licence);
      return { id: idOf(l), title: l.title, expiresOn: day(l.expiresOn) };
    },
    summarise: (a, _x, p) => `Update "${p?.title ?? a.licence}"${a.title ? ` → "${a.title}"` : ''}: ${licenceWords(a) || (a.notes ? `note "${excerpt(a.notes, 80)}"` : 'no change')}${a.expiresOn && p?.expiresOn ? ` (was ${p.expiresOn})` : ''}`,
    async run(ctx, args, p) {
      const l = await compliance.updateLicence(ctx.actor, p.id, licenceBody(args));
      return did('licence_updated', l, `"${l.title}" updated (${words(l.status)}${l.expiresOn ? `, expires ${day(l.expiresOn)}` : ''}).`);
    },
  }),
};

/* ── policies ─────────────────────────────────────────────── */

const policies = {
  create_compliance_policy: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: create a school policy (code, title, category, who it is addressed to, whether they must acknowledge it, review interval) with its first version as a draft (summary and text). Sending it for approval is a separate step. Needs confirmation.',
    inputSchema: closed({
      code: text(30), title: text(200), category: oneOf(POLICY_CATEGORIES), audienceRoles: list(oneOf(AUDIENCE_ROLES), 12, 'Who it is addressed to'),
      requiresAcknowledgement: bool(), reviewEveryMonths: int(1, 60, 'Default 12'), summary: text(2000), body: text(50000, 'The policy text'),
    }, ['code', 'title', 'category']),
    service: 'compliance.service.createPolicy()',
    summarise: (a) => `Create policy ${String(a.code).toUpperCase()} "${a.title}" (${words(a.category)})${a.audienceRoles?.length ? ` for ${a.audienceRoles.map(words).join(', ')}` : ''}${a.requiresAcknowledgement ? ', to be acknowledged' : ''}, version 1 as a draft${a.body ? '' : ' (no text yet)'}`,
    async run(ctx, args) {
      const p = await compliance.createPolicy(ctx.actor, args);
      return did('policy_created', p, `Created ${p.code} with version 1 as a draft.`);
    },
  }),

  draft_policy_version: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: write the next version of a policy (or edit the draft already open): summary of what changed and the text. It stays a draft until sent for approval. Needs confirmation.',
    inputSchema: closed({ policy: text(200, 'Code or title'), summary: text(2000), body: text(50000) }, ['policy']),
    service: 'compliance.service.listPolicies() + draftPolicyVersion()',
    async prepare(_ctx, args) {
      if (!args.summary && !args.body) throw ask('What is in the new version: a summary of the change, the text, or both?');
      const p = await thePolicy(args.policy);
      if (p.pendingVersion?.status === 'AWAITING_APPROVAL') throw new AppError(`Version ${p.pendingVersion.version} of ${p.code} is with the approver; wait for the decision.`, 409, [], 'IN_APPROVAL');
      return { id: idOf(p), code: p.code, title: p.title, editing: p.pendingVersion?.status === 'DRAFT' ? p.pendingVersion.version : null, next: (p.versions?.at(-1)?.version ?? 0) + 1 };
    },
    summarise: (a, _x, p) => `${p?.editing ? `Edit draft version ${p.editing}` : `Draft version ${p?.next ?? 'next'}`} of ${p?.code ?? a.policy} "${excerpt(p?.title, 60)}"${a.summary ? `: "${excerpt(a.summary, 100)}"` : ''}${a.body ? ' (with the text)' : ''}`,
    async run(ctx, args, p) {
      const out = await compliance.draftPolicyVersion(ctx.actor, p.id, { summary: args.summary, body: args.body });
      return did('policy_version_drafted', out, `Draft version ${out.pendingVersion?.version ?? ''} of ${out.code} saved.`);
    },
  }),

  send_policy_for_approval: tool({
    ...cManage, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: send a policy\'s draft version for approval, with the date it takes effect. The approver decides on the Approvals screen; once approved, everyone it is addressed to is asked to acknowledge it. Confirmed on the website.',
    inputSchema: closed({ policy: text(200, 'Code or title'), effectiveFrom: dateStr('Default the day it is approved') }, ['policy']),
    service: 'compliance.service.listPolicies() + submitPolicy()',
    async prepare(_ctx, args) {
      const p = await thePolicy(args.policy);
      if (p.pendingVersion?.status !== 'DRAFT') throw new AppError(`${p.code} has no draft version to send.`, 409, [], 'NO_DRAFT');
      return { id: idOf(p), code: p.code, title: p.title, version: p.pendingVersion.version };
    },
    summarise: (a, _x, p) => `Send version ${p?.version} of ${p?.code ?? a.policy} "${excerpt(p?.title, 60)}" for approval${a.effectiveFrom ? `, effective ${a.effectiveFrom}` : ''}`,
    async run(ctx, args, p) {
      const out = await compliance.submitPolicy(ctx.actor, p.id, { ...(args.effectiveFrom && { effectiveFrom: args.effectiveFrom }) });
      return did('policy_sent_for_approval', out, `${out.code} version ${p.version} is with the approver.`);
    },
  }),
};

/* ── trainings ────────────────────────────────────────────── */

const trainings = {
  update_training_attendance: tool({
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer, after a training has been held: mark who attended, was absent or exempt (by name, with an assessment score if there was one), a head count for a group, notes, and complete it (needs notes or evidence); or cancel a session that has not been completed. Confirmed on the website.',
    inputSchema: closed({
      training: text(200, 'Reference or title'),
      attendance: list(closed({ person: text(120), status: oneOf(['ATTENDED', 'ABSENT', 'EXEMPT', 'INVITED']), score: int(0, 100) }, ['person', 'status']), 200),
      groupAttendance: int(0, 100000, 'Head count, for an audience without names (students, drivers)'),
      complete: bool(), cancel: bool(), notes: text(4000),
    }, ['training']),
    service: 'compliance.service.listTrainings() + recordTrainingAttendance()',
    async prepare(_ctx, args) {
      if (args.complete && args.cancel) throw ask('Complete it or cancel it, not both.');
      const t = await theTraining(args.training);
      const rows = (args.attendance ?? []).map((a) => {
        const who = pick((t.participants ?? []).map((x) => ({ id: String(x.profileId), name: x.name })), a.person, { label: `person invited to ${t.title}`, nameOf: (x) => x.name, refOf: () => null });
        return { profileId: who.id, name: who.name, status: a.status, ...(a.score !== undefined && { assessmentScore: a.score }) };
      });
      return { id: idOf(t), refNo: t.refNo, title: t.title, rows };
    },
    summarise: (a, _x, p) => `${p?.refNo ?? a.training} "${excerpt(p?.title, 60)}": ${[p?.rows?.length && p.rows.map((r) => `${r.name} ${words(r.status)}`).join(', '), a.groupAttendance !== undefined && `head count ${a.groupAttendance}`, a.notes && `notes "${excerpt(a.notes, 80)}"`, a.complete && 'mark it completed', a.cancel && 'cancel it'].filter(Boolean).join('; ') || 'no change'}`,
    async run(ctx, args, p) {
      const t = await compliance.recordTrainingAttendance(ctx.actor, p.id, { attendance: p.rows, ...(args.groupAttendance !== undefined && { groupAttendance: args.groupAttendance }), ...(args.notes !== undefined && { notes: args.notes }), complete: args.complete === true, cancel: args.cancel === true });
      return did('training_attendance_recorded', t, `${t.refNo}: ${t.attended} of ${t.invited} attended; ${words(t.status)}.`);
    },
  }),
};

/* ── accreditation ────────────────────────────────────────── */

async function itemFor(ctx, args) {
  const manager = Boolean(ctx.actor.permissions?.['compliance.manage']) && Boolean(ctx.actor.permissions?.['compliance.read']);
  let rows;
  if (manager) {
    const cycles = (await accreditation.listCycles()).filter((c) => c.status === 'PREPARING');
    rows = cycles.flatMap((c) => c.criteria.flatMap((cr) => cr.items.map((i) => ({ cycleId: c.id, cycle: c.title, cycleRef: c.refNo, criterion: `${cr.code} ${cr.title}`, itemId: i.id, metric: i.metric, status: i.status, owner: i.ownerName, evidence: i.evidence.length }))));
  } else {
    rows = (await accreditation.myItems(ctx.actor)).map((i) => ({ ...i, evidence: i.evidence.length }));
  }
  if (args.cycle) {
    const w = lower(args.cycle);
    rows = rows.filter((r) => lower(r.cycle).includes(w) || lower(r.cycleRef) === w);
  }
  if (!rows.length) throw notFound(manager ? 'No open accreditation cycle has that item.' : 'No accreditation evidence is assigned to you.');
  return pick(rows, args.item, { label: manager ? 'evidence item' : 'evidence item of yours', nameOf: (r) => r.metric, refOf: () => null, describe: (r) => `"${excerpt(r.metric, 50)}" (${r.criterion})` });
}

const accreditationTools = {
  create_accreditation_cycle: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the compliance officer: start an accreditation or inspection preparation cycle (NAAC, NBA, a board or university inspection, or custom) with a title, programme and target date. It starts with the framework\'s criteria headings, to be checked against the agency\'s current manual. Needs confirmation.',
    inputSchema: closed({ framework: oneOf(Object.keys(accreditation.FRAMEWORKS)), title: text(200), programme: text(200), targetDate: dateStr() }, ['framework', 'title']),
    service: 'accreditation.service.createCycle()',
    summarise: (a) => `Start a ${accreditation.FRAMEWORKS[a.framework]?.label ?? a.framework} cycle "${a.title}"${a.programme ? ` for ${a.programme}` : ''}${a.targetDate ? `, target ${a.targetDate}` : ''}`,
    async run(ctx, args) {
      const c = await accreditation.createCycle(ctx.actor, args);
      return did('accreditation_cycle_created', c, `Started ${c.refNo} with ${c.criteria.length} criteria heading(s).`);
    },
  }),

  add_accreditation_criterion: tool({
    ...cManage, operation: 'CREATE', risk: RISK.LOW,
    description: 'For the compliance officer: add a criterion heading (code and title) to an accreditation cycle still being prepared. Needs confirmation.',
    inputSchema: closed({ cycle: text(200, 'Reference or title'), code: text(20), title: text(200) }, ['cycle', 'code', 'title']),
    service: 'accreditation.service.listCycles() + addCriterion()',
    async prepare(_ctx, args) { const c = await theCycle(args.cycle); return { id: idOf(c), refNo: c.refNo, title: c.title }; },
    summarise: (a, _x, p) => `Add criterion ${a.code} "${a.title}" to ${p?.refNo ?? a.cycle} "${excerpt(p?.title, 60)}"`,
    async run(ctx, args, p) {
      const c = await accreditation.addCriterion(ctx.actor, p.id, { code: args.code, title: args.title });
      return did('accreditation_criterion_added', c, `Added ${args.code} to ${c.refNo}.`);
    },
  }),

  add_accreditation_item: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: add an evidence item under a criterion of an accreditation cycle (what is asked for), with an owner from the staff by name (they are told), a due date and a note. Confirmed on the website.',
    inputSchema: closed({ cycle: text(200, 'Reference or title'), criterion: text(200, 'Criterion code or title'), metric: text(500, 'What evidence is asked for'), owner: text(120), dueOn: dateStr(), note: text(2000) }, ['cycle', 'criterion', 'metric']),
    service: 'accreditation.service.listCycles() + addItem()',
    async prepare(_ctx, args) {
      const c = await theCycle(args.cycle);
      const cr = pick(c.criteria, args.criterion, { label: `criterion of ${c.title}`, nameOf: (x) => x.title, refOf: (x) => x.code, describe: (x) => `${x.code} ${x.title}` });
      const owner = args.owner ? await staffNamed(args.owner) : null;
      return { id: idOf(c), refNo: c.refNo, criterionId: cr.id, criterion: `${cr.code} ${cr.title}`, ownerId: owner?.id ?? null, owner: owner?.name ?? null };
    },
    summarise: (a, _x, p) => `Add to ${p?.refNo ?? a.cycle}, ${p?.criterion ?? a.criterion}: "${excerpt(a.metric, 100)}"${p?.owner ? `, owner ${p.owner} (told)` : ''}${a.dueOn ? `, due ${a.dueOn}` : ''}`,
    async run(ctx, args, p) {
      const c = await accreditation.addItem(ctx.actor, p.id, p.criterionId, { metric: args.metric, ...(p.ownerId && { ownerProfileId: p.ownerId }), dueOn: args.dueOn, note: args.note });
      return did('accreditation_item_added', c, `Evidence item added to ${c.refNo}${p.owner ? `; ${p.owner} has been told` : ''}.`);
    },
  }),

  update_accreditation_item: tool({
    module: 'Compliance', operation: 'UPDATE', risk: RISK.MEDIUM, permission: 'ai.copilot.use',
    description: 'The owner of an accreditation evidence item (or the compliance officer): change its status (not started, in progress, ready — needs evidence attached on the page — or not applicable with a reason) and its note. The officer may also change what is asked for, the due date and the owner. Evidence files are attached on the Compliance page. Needs confirmation.',
    inputSchema: closed({
      item: text(500, 'What the item asks for (its wording)'), cycle: text(200, 'Reference or title, to narrow it down'),
      status: oneOf(ITEM_STATUSES), note: text(2000),
      metric: text(500, 'Officer only: new wording'), dueOn: dateStr('Officer only'), owner: text(120, 'Officer only: a member of staff by name'),
    }, ['item']),
    service: 'accreditation.service.myItems() / listCycles() + updateItem()',
    async prepare(ctx, args) {
      const manager = Boolean(ctx.actor.permissions?.['compliance.manage']);
      if (!manager && (args.metric || args.dueOn || args.owner)) throw new AppError('Only the compliance officer changes what is asked for, the due date or the owner.', 403, [], 'NOT_A_MANAGER');
      if (args.status === 'NOT_APPLICABLE' && !args.note) throw ask('Why does this item not apply? Put the reason in the note.');
      const i = await itemFor(ctx, args);
      const owner = args.owner ? await staffNamed(args.owner) : null;
      return { cycleId: i.cycleId, itemId: i.itemId, metric: i.metric, cycle: i.cycle, from: i.status, ownerId: owner?.id ?? null, owner: owner?.name ?? null };
    },
    summarise: (a, _x, p) => `"${excerpt(p?.metric ?? a.item, 70)}" (${p?.cycle ?? 'accreditation'}): ${[a.status && `${words(p?.from ?? '')} → ${words(a.status)}`, a.note && `note "${excerpt(a.note, 80)}"`, a.metric && `wording "${excerpt(a.metric, 60)}"`, a.dueOn && `due ${a.dueOn}`, p?.owner && `owner ${p.owner}`].filter(Boolean).join('; ') || 'no change'}`,
    async run(ctx, args, p) {
      const c = await accreditation.updateItem(ctx.actor, p.cycleId, p.itemId, { ...(args.status && { status: args.status }), ...(args.note !== undefined && { note: args.note }), ...(args.metric && { metric: args.metric }), ...(args.dueOn && { dueOn: args.dueOn }), ...(p.ownerId && { ownerProfileId: p.ownerId }) });
      const item = c.criteria.flatMap((cr) => cr.items).find((x) => x.id === p.itemId);
      return did('accreditation_item_updated', { id: p.itemId, ...item }, `Updated: ${words(item?.status ?? args.status ?? '')}.`);
    },
  }),

  move_accreditation_cycle: tool({
    ...cManage, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: record that a cycle\'s criteria were checked against the agency\'s current manual; record that the school submitted to the agency (the reference you received; the system submits nothing; incomplete evidence must be acknowledged, and evidence is then locked); or record the agency\'s outcome after submission (closes the cycle). Confirmed on the website.',
    inputSchema: closed({
      cycle: text(200, 'Reference or title'), step: oneOf(['mark_template_verified', 'record_submission', 'record_outcome']),
      note: text(500, 'mark_template_verified: what was checked'), reference: text(200, 'record_submission: the agency reference'), submittedOn: dateStr('record_submission: default today'),
      acknowledgeIncomplete: bool('record_submission: record it although some evidence is not ready'), outcome: text(1000, 'record_outcome: what the agency decided'),
    }, ['cycle', 'step']),
    service: 'accreditation.service.verifyTemplate() / recordSubmission() / recordOutcome()',
    async prepare(_ctx, args) {
      if (args.step === 'record_submission' && !args.reference) throw ask('What reference did the agency give for the submission?');
      if (args.step === 'record_outcome' && !args.outcome) throw ask('What did the agency decide?');
      const c = await theCycle(args.cycle);
      return { id: idOf(c), refNo: c.refNo, title: c.title, ready: c.progress?.ready ?? 0, counted: c.progress?.counted ?? 0 };
    },
    summarise: (a, _x, p) => {
      const ref = `${p?.refNo ?? a.cycle} "${excerpt(p?.title, 60)}"`;
      if (a.step === 'mark_template_verified') return `Record that the criteria of ${ref} were checked against the agency's current manual${a.note ? ` ("${excerpt(a.note, 80)}")` : ''}`;
      if (a.step === 'record_submission') return `Record that ${ref} was submitted to the agency on ${a.submittedOn ?? 'today'}, reference ${a.reference} (${p?.ready ?? 0} of ${p?.counted ?? 0} item(s) ready${a.acknowledgeIncomplete ? ', incomplete acknowledged' : ''}); its evidence is then locked`;
      return `Record the agency's outcome on ${ref}: "${excerpt(a.outcome, 120)}" (the cycle closes)`;
    },
    async run(ctx, args, p) {
      let c;
      if (args.step === 'mark_template_verified') c = await accreditation.verifyTemplate(ctx.actor, p.id, { note: args.note });
      else if (args.step === 'record_submission') c = await accreditation.recordSubmission(ctx.actor, p.id, { reference: args.reference, acknowledgeIncomplete: args.acknowledgeIncomplete === true, ...(args.submittedOn && { at: istAt(args.submittedOn, '12:00') }) });
      else c = await accreditation.recordOutcome(ctx.actor, p.id, { outcome: args.outcome });
      return did('accreditation_cycle_moved', c, `${c.refNo}: ${args.step === 'mark_template_verified' ? 'criteria marked as checked' : words(c.status)}.`);
    },
  }),
};

/* ── notices and watched sources ──────────────────────────── */

const notices = {
  log_regulatory_notice: tool({
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: record a notice or circular received from a board, the education department, the district, a ministry, a university or a court (title, their reference, link, dates, summary). It starts new and unverified, and the compliance officer and principal are told to review it. Confirmed on the website.',
    inputSchema: closed({ source: oneOf(NOTICE_SOURCES), title: text(300), jurisdiction: text(120), theirReference: text(120), link: text(1000, 'https:// address of the notice'), publishedOn: dateStr(), effectiveOn: dateStr(), summary: text(10000) }, ['source', 'title']),
    service: 'compliance.service.createNotice()',
    summarise: (a) => `Record a ${words(a.source)} notice "${excerpt(a.title, 100)}"${a.theirReference ? ` (ref ${a.theirReference})` : ''}${a.effectiveOn ? `, effective ${a.effectiveOn}` : ''}; the compliance officer and principal are told to review it`,
    async run(ctx, args) {
      httpsOnly(args.link);
      const { link, ...rest } = args;
      const n = await compliance.createNotice(ctx.actor, { ...rest, ...(link && { url: link }), receivedVia: 'MANUAL' });
      return did('regulatory_notice_logged', n, `Recorded ${n.refNo}; verify that it is genuine before deciding whether it applies.`);
    },
  }),

  update_regulatory_notice: tool({
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: record whether a notice was verified as genuine (or looks suspect) and how; and, once it is recorded as applicable, add the actions that follow (title, owner from the staff by name — they are told — and due date) or mark actions done. Whether it applies is recorded with record_notice_applicability_decision. Confirmed on the website.',
    inputSchema: closed({
      notice: text(300, 'Reference or title'), authenticity: oneOf(['VERIFIED', 'SUSPECT', 'UNVERIFIED']), authenticityNote: text(500, 'How it was checked'),
      addActions: list(closed({ title: text(300), owner: text(120), dueOn: dateStr() }, ['title']), 20), markDone: list(text(300), 20, 'Titles of actions now done'),
    }, ['notice']),
    service: 'compliance.service.listNotices() + decideNotice()',
    async prepare(_ctx, args) {
      if (!args.authenticity && !args.addActions?.length && !args.markDone?.length) throw ask('What should be recorded: whether it is genuine, new actions, or actions done?');
      const n = await theNotice(args.notice);
      let actions = null;
      if (args.addActions?.length || args.markDone?.length) {
        if (!['APPLICABLE', 'ACTIONED'].includes(n.status)) throw new AppError(`${n.refNo} is ${words(n.status)}; actions follow a decision that it applies.`, 409, [], 'NOT_APPLICABLE_YET');
        const existing = (n.actions ?? []).map((a) => ({ title: a.title, ownerProfileId: a.ownerProfileId ? String(a.ownerProfileId) : null, dueOn: a.dueOn ? day(a.dueOn) : null, done: Boolean(a.done), linkedType: a.linkedType ?? null, linkedId: a.linkedId ?? null }));
        for (const t of args.markDone ?? []) pick(existing, t, { label: `action on ${n.refNo}`, nameOf: (a) => a.title, refOf: () => null }).done = true;
        const added = [];
        for (const a of args.addActions ?? []) {
          // eslint-disable-next-line no-await-in-loop
          const owner = a.owner ? await staffNamed(a.owner) : null;
          added.push({ title: a.title, ownerProfileId: owner?.id ?? null, ownerName: owner?.name ?? null, dueOn: a.dueOn ?? null, done: false });
        }
        actions = [...existing, ...added];
      }
      return { id: idOf(n), refNo: n.refNo, title: n.title, actions };
    },
    summarise: (a, _x, p) => `${p?.refNo ?? a.notice} "${excerpt(p?.title, 60)}": ${[a.authenticity && `mark ${words(a.authenticity)}${a.authenticityNote ? ` ("${excerpt(a.authenticityNote, 60)}")` : ''}`, a.addActions?.length && `add action(s) ${(p?.actions ?? []).filter((x) => x.ownerName !== undefined).map((x) => `"${excerpt(x.title, 40)}"${x.ownerName ? ` for ${x.ownerName}` : ''}${x.dueOn ? ` by ${x.dueOn}` : ''}`).join(', ')}`, a.markDone?.length && `mark done: ${a.markDone.join(', ')}`].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) {
      const body = {};
      if (args.authenticity) Object.assign(body, { authenticity: args.authenticity, authenticityNote: args.authenticityNote });
      if (p.actions) body.actions = p.actions.map(({ ownerName: _n, ...x }) => x);
      const n = await compliance.decideNotice(ctx.actor, p.id, body);
      return did('regulatory_notice_updated', n, `${n.refNo}: ${words(n.authenticity ?? 'unverified')}, ${words(n.status)}${(n.actions ?? []).length ? `, ${(n.actions ?? []).filter((x) => x.done).length} of ${n.actions.length} action(s) done` : ''}.`);
    },
  }),

  record_notice_applicability_decision: tool({
    ...cManage, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: 'For the compliance officer: record whether a regulatory notice applies to this school, with the rationale. It must first be verified as genuine to be applicable. A notice changes no policy or obligation by itself; the actions that follow are added after. Recorded only when the officer states the decision in their own words. Confirmed on the website.',
    inputSchema: closed({ notice: text(300, 'Reference or title'), decision: decisionArg(['APPLICABLE', 'NOT_APPLICABLE'], 'the compliance officer'), rationale: text(3000) }, ['notice', 'decision', 'rationale']),
    service: 'compliance.service.listNotices() + decideNotice()',
    async prepare(_ctx, args) {
      if (!String(args.rationale ?? '').trim()) throw ask('Why does it, or does it not, apply?');
      const n = await theNotice(args.notice);
      if (args.decision === 'APPLICABLE' && n.authenticity !== 'VERIFIED') throw new AppError(`Verify that ${n.refNo} is genuine before recording that it applies.`, 409, [], 'UNVERIFIED_NOTICE');
      return { id: idOf(n), refNo: n.refNo, title: n.title };
    },
    summarise: (a, _x, p) => `Record that ${p?.refNo ?? a.notice} "${excerpt(p?.title, 60)}" is ${words(a.decision)} — rationale: "${excerpt(a.rationale, 120)}"`,
    async run(ctx, args, p) {
      const n = await compliance.decideNotice(ctx.actor, p.id, { applicability: args.decision, rationale: args.rationale });
      return did('regulatory_notice_decided', n, `${n.refNo} is recorded as ${words(n.status)}.`);
    },
  }),

  add_notice_source: tool({
    ...cManage, operation: 'CREATE', risk: RISK.LOW,
    description: 'For the compliance officer: watch an official web page (https only) for new notices: its name, address, which body publishes it and the jurisdiction. A change creates a notice for review. Needs confirmation.',
    inputSchema: closed({ name: text(160), link: text(1000, 'https:// address'), source: oneOf(NOTICE_SOURCES), jurisdiction: text(120) }, ['name', 'link', 'source']),
    service: 'compliance.service.addNoticeSource()',
    summarise: (a) => `Watch "${a.name}" (${a.link}) for ${words(a.source)} notices`,
    async run(_ctx, args) {
      httpsOnly(args.link);
      const s = await compliance.addNoticeSource({ name: args.name, url: args.link, source: args.source, jurisdiction: args.jurisdiction });
      return did('notice_source_added', s, `Watching ${s.name}.`);
    },
  }),

  check_notice_source: tool({
    ...cManage, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'For the compliance officer: check a watched page now. If it changed since the last check a new, unverified notice is created and the compliance officer and principal are told; a failed check is recorded as failed. Confirmed on the website.',
    inputSchema: closed({ source: text(300, 'Its name or address') }, ['source']),
    service: 'compliance.service.listNoticeSources() + checkNoticeSource()',
    async prepare(_ctx, args) { const s = await theSource(args.source); return { id: idOf(s), name: s.name }; },
    summarise: (a, _x, p) => `Check "${p?.name ?? a.source}" now for a change (a change creates a notice to review)`,
    async run(ctx, _args, p) {
      const r = await compliance.checkNoticeSource(ctx.actor, p.id);
      const st = r.source.lastStatus;
      return did('notice_source_checked', r.source, st === 'FAILED' ? `The check of ${p.name} failed: ${r.source.lastError}.` : r.notice ? `${p.name} changed; ${r.notice.refNo} was created for review.` : `${p.name} has not changed.`);
    },
  }),
};

export const tools = {
  ...reads, ...obligations, ...returns, ...licences, ...policies, ...trainings, ...accreditationTools, ...notices,
};
