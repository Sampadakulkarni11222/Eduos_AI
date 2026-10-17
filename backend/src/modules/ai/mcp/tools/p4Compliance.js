import * as privacy from '../../../compliance/privacy.service.js';
import * as compliance from '../../../compliance/compliance.service.js';
import { PRIVACY_KINDS, COMMITTEE_KINDS } from '../../../../models/supportRoles.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed, dateStr } from './_shared.js';

/**
 * Compliance and data protection (part 4) through the assistant, for the
 * compliance officer. The readiness checklist (counts and pointers) is open to
 * anyone holding compliance.read; the registers themselves -- data-principal
 * requests, breaches -- need compliance.manage, as on the page.
 *
 * Every tool calls the service the Data protection / Compliance pages call.
 * The register records what a person did (told the Board, informed the
 * people affected); nothing is sent to any authority from here. Closing a
 * request needs the outcome in words, and completing one needs the
 * requester's identity verified (the service refuses otherwise). Deciding a
 * regulatory notice and approving a policy stay on the screen.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const cRead = { module: 'Compliance', permission: 'compliance.read' };
const cManage = { module: 'Compliance', permission: 'compliance.manage', minScope: 'ALL' };
const TOPICS = ['POCSO_CHILD_PROTECTION', 'POSH', 'ANTI_RAGGING', 'FIRE_SAFETY', 'FIRST_AID', 'EMERGENCY_DRILL', 'TRANSPORT_SAFETY', 'CYBER_SAFETY', 'DATA_PROTECTION', 'INDUCTION', 'ACADEMIC', 'OTHER'];
const AUDIENCES = ['ALL_STAFF', 'TEACHING_STAFF', 'NON_TEACHING_STAFF', 'DRIVERS_ATTENDANTS', 'STUDENTS', 'PARENTS'];
const ymd = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '—');

async function requestNamed(ref) {
  const open = await privacy.listRequests({ status: 'ALL' });
  if (!ref) { const o = open.filter((r) => ['RECEIVED', 'IN_PROGRESS'].includes(r.status)); if (o.length === 1) return o[0]; throw new AppError(`Which request? ${o.slice(0, 5).map((r) => `${r.refNo} (${r.requesterName}, ${r.kindLabel})`).join('; ') || 'None is open.'}`, 400, [], 'AGENT_NEEDS_INPUT'); }
  return open.find((r) => r.refNo.toLowerCase() === String(ref).toLowerCase()) ?? theNamed(open, ref, { label: 'data request', nameOf: (r) => r.requesterName, describe: (r) => `${r.refNo} ${r.requesterName}` });
}
async function breachNamed(ref) {
  const all = await privacy.listBreaches({});
  if (!ref) { const o = all.filter((b) => b.status !== 'CLOSED'); if (o.length === 1) return o[0]; throw new AppError(`Which breach? ${o.slice(0, 5).map((b) => `${b.refNo} ${b.title}`).join('; ') || 'None is open.'}`, 400, [], 'AGENT_NEEDS_INPUT'); }
  return all.find((b) => b.refNo.toLowerCase() === String(ref).toLowerCase()) ?? theNamed(all, ref, { label: 'breach', nameOf: (b) => b.title, describe: (b) => `${b.refNo} ${b.title}` });
}

export const p4ComplianceTools = {
  get_compliance_readiness: {
    ...cRead, operation: 'GET', risk: RISK.LOW,
    description: 'The compliance readiness checklist: CBSE safety certificates on file and in date (fire, building, water, health and sanitation, affiliation), required committees (POCSO, ICC, safety, SMC, grievance), data requests answered in time, breaches reported within 72 hours, training coverage. Each line says what was found and where to act; OK means a record exists, not that the school is compliant.',
    inputSchema: closed({}), service: 'privacy.readiness()',
    async run() {
      const r = await privacy.readiness();
      const gaps = r.items.filter((i) => i.state !== 'OK');
      return ok(r, { speak: gaps.length ? `${gaps.length} item(s) need attention: ${gaps.slice(0, 6).map((g) => `${g.item} (${g.state.toLowerCase()})`).join('; ')}.` : 'Every item on the checklist has a record in date.' });
    },
  },

  list_data_requests: {
    ...cManage, operation: 'GET', risk: RISK.LOW,
    description: 'DPDP data-principal requests (default open ones): reference, kind (access, correction, erasure, consent withdrawal, grievance, nomination), requester, response date, days left, overdue.',
    inputSchema: closed({ status: { type: 'string', enum: ['OPEN', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'ALL'] } }), service: 'privacy.listRequests()',
    async run(_ctx, args) { const rows = await privacy.listRequests({ status: args.status ?? 'OPEN' }); return ok({ count: rows.length, rows: rows.map(({ history, ...r }) => r) }, { speak: `${rows.length} request(s); ${rows.filter((r) => r.overdue).length} past the response date.` }); },
  },

  log_data_request: {
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: `Log a data-principal request received under the DPDP Act (by letter, email or at the office): kind, who asked (for a child, the parent), contact and details. It gets a reference, a response date (${privacy.RESPONSE_DAYS} days by default) and a task.`,
    inputSchema: closed({ kind: { type: 'string', enum: PRIVACY_KINDS }, requesterName: text(120), requesterRelation: { type: 'string', enum: ['SELF', 'PARENT', 'GUARDIAN', 'NOMINEE'] }, contact: text(120), details: text(2000), receivedOn: dateStr() }, ['kind', 'requesterName']),
    service: 'privacy.createRequest()',
    summarise: (args) => `Log a data ${args.kind.toLowerCase().replace('_', ' ')} request from ${args.requesterName}${args.requesterRelation ? ` (${args.requesterRelation.toLowerCase()})` : ''}${args.receivedOn ? `, received ${args.receivedOn}` : ''}${args.details ? `: "${args.details}"` : ''}`,
    async run(ctx, args) { const r = await privacy.createRequest(ctx.actor, { ...args, receivedAt: args.receivedOn }); return action({ type: 'data_request_logged', id: r.id, data: { refNo: r.refNo, dueAt: r.dueAt }, speak: `Logged ${r.refNo}; respond by ${ymd(r.dueAt)}.` }); },
  },

  update_data_request: {
    ...cManage, operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: "Move a data request on: mark the requester's identity verified, start work, or close it as COMPLETED or DECLINED with the outcome in words (what was given, corrected or erased, or why not). Completing needs identity verified.",
    inputSchema: closed({ request: text(120, 'Reference (DPR/2026/0004) or requester name'), status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED', 'DECLINED'] }, identityVerified: { type: 'boolean' }, outcome: text(2000), note: text(300) }, ['request']),
    service: 'privacy.updateRequest()',
    async prepare(_ctx, args) { const r = await requestNamed(args.request); return { id: r.id, refNo: r.refNo, requester: r.requesterName, status: r.status }; },
    summarise: (args, _a, p) => `${p?.refNo} (${p?.requester}): ${[args.identityVerified !== undefined ? `identity ${args.identityVerified ? 'verified' : 'not verified'}` : null, args.status ? `${p?.status} → ${args.status}` : null, args.outcome ? `outcome "${args.outcome}"` : null, args.note ? `note "${args.note}"` : null].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) { const r = await privacy.updateRequest(ctx.actor, p.id, args); return action({ type: 'data_request_updated', id: p.id, data: { status: r.status }, speak: `${r.refNo} is ${r.status.toLowerCase().replace('_', ' ')}.` }); },
  },

  list_data_breaches: {
    ...cManage, operation: 'GET', risk: RISK.LOW,
    description: 'The personal-data breach register: each breach with when it was discovered, people affected (and whether children), status, and the 72-hour Board-report clock (hours left or overdue).',
    inputSchema: closed({}), service: 'privacy.listBreaches()',
    async run() { const rows = await privacy.listBreaches({}); const open = rows.filter((b) => b.status !== 'CLOSED'); return ok({ count: rows.length, rows: rows.map(({ history, ...b }) => b) }, { speak: open.length ? `${open.length} open breach(es); ${open.filter((b) => b.reportOverdue).length} past the 72-hour clock without a report recorded.` : 'No open breaches.' }); },
  },

  log_data_breach: {
    ...cManage, operation: 'CREATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: 'Log a personal-data breach the moment you learn of it: what happened, when it was discovered, data involved, how many people, whether children. Starts the 72-hour clock for the detailed report to the Data Protection Board and a critical task. Nothing is sent to the Board from here. Confirmed on the website.',
    inputSchema: closed({ title: text(200), discoveredAt: { type: 'string', format: 'date-time', description: 'ISO time; default now' }, description: text(4000), dataCategories: { type: 'array', items: text(60), maxItems: 20 }, affectedCount: { type: 'integer', minimum: 0, maximum: 10000000 }, childrenAffected: { type: 'boolean' }, containment: text(2000) }, ['title']),
    service: 'privacy.createBreach()',
    summarise: (args) => `Log data breach "${args.title}"${args.affectedCount ? `, ${args.affectedCount} people affected` : ''}${args.childrenAffected ? ' (children)' : ''}; the 72-hour Board-report clock starts from ${args.discoveredAt ?? 'now'}`,
    async run(ctx, args) { const b = await privacy.createBreach(ctx.actor, args); return action({ type: 'data_breach_logged', id: b.id, data: { refNo: b.refNo, reportDeadline: b.reportDeadline }, speak: `Logged ${b.refNo}. The detailed report to the Board is due by ${new Date(b.reportDeadline).toISOString().slice(0, 16).replace('T', ' ')} UTC.` }); },
  },

  update_data_breach: {
    ...cManage, operation: 'UPDATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: 'Record what was done on a breach: containment, when the Board was intimated, when the detailed report went, when the people affected were informed, the count, or the status (CONTAINED / CLOSED; closing needs the report recorded). Confirmed on the website.',
    inputSchema: closed({ breach: text(200), containment: text(2000), boardIntimatedAt: { type: 'string', format: 'date-time' }, boardReportAt: { type: 'string', format: 'date-time' }, principalsInformedAt: { type: 'string', format: 'date-time' }, affectedCount: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['OPEN', 'CONTAINED', 'CLOSED'] } }),
    service: 'privacy.updateBreach()',
    async prepare(_ctx, args) { const b = await breachNamed(args.breach); return { id: b.id, refNo: b.refNo, title: b.title }; },
    summarise: (args, _a, p) => `${p?.refNo} "${p?.title}": ${Object.entries(args).filter(([k, v]) => k !== 'breach' && v !== undefined).map(([k, v]) => `${k} ${v}`).join('; ')}`,
    async run(ctx, args, p) { const { breach, ...body } = args; const b = await privacy.updateBreach(ctx.actor, p.id, body); return action({ type: 'data_breach_updated', id: p.id, data: { status: b.status }, speak: `${b.refNo} updated (${b.status.toLowerCase()}).` }); },
  },

  list_statutory_committees: {
    ...cRead, operation: 'GET', risk: RISK.LOW,
    description: 'Statutory committees (POCSO, ICC/POSH, school safety, SMC, grievance, anti-bullying, disaster management): members, constitution and review dates, whether displayed on the website and notice board.',
    inputSchema: closed({}), service: 'privacy.listCommittees()',
    async run() { const rows = await privacy.listCommittees(); return ok({ rows }, { speak: rows.length ? `${rows.length} committee(s); ${rows.filter((c) => c.reviewOverdue).length} past their review date.` : 'No committees are recorded yet.' }); },
  },

  save_statutory_committee: {
    ...cManage, operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Record a statutory committee, or update the existing one of that kind: members (name, role, phone), constituted on, review due, last meeting, displayed on the website / notice board. A review date becomes a task.',
    inputSchema: closed({
      kind: { type: 'string', enum: COMMITTEE_KINDS }, name: text(120),
      members: { type: 'array', maxItems: 30, items: closed({ name: text(80), role: text(80), phone: text(20), external: { type: 'boolean' } }, ['name']) },
      constitutedOn: dateStr(), reviewDueOn: dateStr(), lastMeetingOn: dateStr(), displayedOnWebsite: { type: 'boolean' }, displayedOnNoticeBoard: { type: 'boolean' }, notes: text(1000),
    }, ['kind']),
    service: 'privacy.saveCommittee()',
    async prepare(_ctx, args) { const existing = (await privacy.listCommittees()).filter((c) => c.kind === args.kind); if (existing.length > 1 && !args.name) throw new AppError(`There are ${existing.length} ${args.kind} committees; name the one you mean.`, 400, [], 'AGENT_NEEDS_INPUT'); const c = args.name ? existing.find((x) => x.name.toLowerCase() === args.name.toLowerCase()) : existing[0]; return { id: c?.id ?? null, name: c?.name ?? args.name ?? null }; },
    summarise: (args, _a, p) => `${p?.id ? 'Update' : 'Record'} the ${args.kind.replace('_', ' ')} committee${p?.name ? ` "${p.name}"` : ''}${args.members ? ` with ${args.members.length} member(s)` : ''}${args.constitutedOn ? `, constituted ${args.constitutedOn}` : ''}${args.reviewDueOn ? `, review by ${args.reviewDueOn}` : ''}`,
    async run(ctx, args, p) { const c = await privacy.saveCommittee(ctx.actor, args, p.id); return action({ type: 'committee_saved', id: c.id, speak: `${c.name} saved.` }); },
  },

  get_training_coverage: {
    ...cRead, operation: 'GET', risk: RISK.LOW,
    description: 'Mandatory training coverage by topic (POCSO, POSH, fire safety, first aid, data protection, ...): staff covered in the renewal window and the percentage.',
    inputSchema: closed({}), service: 'compliance.trainingCoverage()',
    async run() { const rows = await compliance.trainingCoverage(); return ok({ rows: rows.map(({ untrained, ...r }) => ({ ...r, untrainedCount: untrained.length })) }, { speak: rows.length ? rows.map((r) => `${r.topic.toLowerCase().replace(/_/g, ' ')} ${r.pct ?? 0}%`).join('; ') : 'No completed mandatory training is recorded yet.' }); },
  },

  schedule_compliance_training: {
    ...cManage, operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Schedule a training session (POCSO, POSH, fire safety, first aid, emergency drill, data protection, ...) for an audience; everyone in it is invited in the app. Confirmed on the website.',
    inputSchema: closed({ topic: { type: 'string', enum: TOPICS }, title: text(200), audience: { type: 'string', enum: AUDIENCES }, date: dateStr(), time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, durationMinutes: { type: 'integer', minimum: 10, maximum: 600 }, mandatory: { type: 'boolean' }, facilitator: text(160), location: text(160), recurrenceMonths: { type: 'integer', minimum: 1, maximum: 60 } }, ['topic', 'title', 'audience', 'date', 'time']),
    service: 'compliance.scheduleTraining()',
    summarise: (args) => `Schedule ${args.mandatory ? 'mandatory ' : ''}training "${args.title}" (${args.topic.toLowerCase().replace(/_/g, ' ')}) for ${args.audience.toLowerCase().replace(/_/g, ' ')} on ${args.date} at ${args.time}${args.location ? `, ${args.location}` : ''}; invitations go to everyone in the audience`,
    async run(ctx, args) {
      const at = new Date(new Date(`${args.date}T${args.time}:00Z`).getTime() - 330 * 60_000);
      const t = await compliance.scheduleTraining(ctx.actor, { ...args, scheduledAt: at.toISOString() });
      return action({ type: 'training_scheduled', id: t.id, speak: `Scheduled ${t.refNo}; ${t.invited} invited.` });
    },
  },
};
