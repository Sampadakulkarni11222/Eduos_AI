import * as life from '../../../hostel/life.service.js';
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, CONTACT_CHANNELS, ROLL_SESSIONS, MEALS } from '../../../../models/supportRoles.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed, dateStr } from './_shared.js';

/**
 * Hostel life (part 4) through the assistant, for the warden (hostel.manage
 * at school-wide scope; reads need hostel.read). The tools call the service
 * the Hostel life page calls: roll call, the mess menu and headcount, and the
 * incident log with the parent-contact record.
 *
 * Residents are named in words and matched against the current residents
 * only, never guessed. Submitting a roll call with someone missing alerts the
 * other wardens and the principal, so it is confirmed on the website. The
 * kitchen allergy list is medical data and stays on the page; it is not chat
 * content. Contacting a family is the warden's call: the assistant records
 * that it happened, it does not message them.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const read = { module: 'Hostel', permission: 'hostel.read', minScope: 'ALL' };
const manage = { module: 'Hostel', permission: 'hostel.manage', minScope: 'ALL' };
const MARKS = ['PRESENT', 'ON_LEAVE', 'LATE', 'SICK_BAY', 'ABSENT'];

async function residentNamed(name) {
  const people = await life.residents();
  return theNamed(people, name, { label: 'hostel resident', nameOf: (p) => p.name, describe: (p) => `${p.name} (room ${p.roomNo ?? '—'})` });
}

async function rollFor(args) {
  const list = await life.listRollCalls({ from: args.date, to: args.date, limit: 10 });
  const session = args.session ?? 'NIGHT';
  const day = args.date ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const r = list.find((x) => x.date === day && x.session === session);
  if (!r) throw new AppError(`No ${session.toLowerCase()} roll call is open for ${day}. Start one first.`, 404, [], 'NOT_FOUND');
  return life.getRollCall(r.id);
}

async function incidentNamed(ref) {
  const open = await life.listIncidents({ status: 'ALL', limit: 300 });
  if (!ref) {
    const o = open.filter((i) => i.status === 'OPEN');
    if (o.length === 1) return o[0];
    throw new AppError(`Which incident? ${o.slice(0, 5).map((i) => `${i.refNo} (${i.students.map((s) => s.name).join(', ')})`).join('; ') || 'There are no open incidents.'}`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  const byRef = open.find((i) => i.refNo.toLowerCase() === String(ref).toLowerCase());
  if (byRef) return byRef;
  return theNamed(open.filter((i) => i.status === 'OPEN'), ref, { label: 'open incident', nameOf: (i) => i.students.map((s) => s.name).join(', '), describe: (i) => `${i.refNo} ${i.category.toLowerCase()}` });
}

export const p4WardenTools = {
  get_hostel_night_briefing: {
    ...read, operation: 'GET', risk: RISK.LOW,
    description: "The warden's briefing: residents, how many are away on an out-pass, dinners to cook, the last roll call (present, not accounted for), out-passes past their return time or waiting for a decision, open incidents.",
    inputSchema: closed({}), service: 'hostel.life.briefing()',
    async run() { const b = await life.briefing(); return ok(b, { speak: b.lines.join(' ') }); },
  },

  start_hostel_roll_call: {
    ...manage, operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Open tonight's (or a given date's) NIGHT or MORNING roll call for all residents or one block. Residents out on an out-pass are pre-marked on leave; returns the one already open if there is one.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD; default today'), session: { type: 'string', enum: ROLL_SESSIONS }, block: text(40) }),
    service: 'hostel.life.startRollCall()',
    summarise: (args) => `Open the ${(args.session ?? 'NIGHT').toLowerCase()} roll call for ${args.date ?? 'today'}${args.block ? `, block ${args.block}` : ', all blocks'}`,
    async run(ctx, args) { const r = await life.startRollCall(ctx.actor, args); return action({ type: 'roll_call_open', id: r.id, data: { counts: r.counts, total: r.total }, speak: `Roll call open: ${r.total} resident(s), ${r.counts.ON_LEAVE} on leave, ${r.counts.UNMARKED} to mark.` }); },
  },

  get_hostel_roll_call: {
    ...read, operation: 'GET', risk: RISK.LOW,
    description: 'A roll call (default tonight\'s NIGHT one): counts and each resident with room and status, including who is still unmarked.',
    inputSchema: closed({ date: dateStr(), session: { type: 'string', enum: ROLL_SESSIONS } }), service: 'hostel.life.getRollCall()',
    async run(_ctx, args) {
      const r = await rollFor(args);
      const unmarked = r.entries.filter((e) => e.status === 'UNMARKED').map((e) => e.name);
      return ok(r, { speak: `${r.session.toLowerCase()} ${r.date}: ${r.counts.PRESENT} present, ${r.counts.ON_LEAVE} on leave, ${r.counts.ABSENT} absent${unmarked.length ? `, unmarked: ${unmarked.slice(0, 10).join(', ')}` : ''}${r.submittedAt ? ' (submitted)' : ''}.` });
    },
  },

  mark_hostel_roll_call: {
    ...manage, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Mark residents on the open roll call: name each with PRESENT, ON_LEAVE, LATE, SICK_BAY or ABSENT, and/or allPresent to mark everyone still unmarked present. After submission only a missing resident can be marked LATE (arrived).',
    inputSchema: closed({
      date: dateStr(), session: { type: 'string', enum: ROLL_SESSIONS }, allPresent: { type: 'boolean' },
      marks: { type: 'array', maxItems: 100, items: closed({ name: text(80), status: { type: 'string', enum: MARKS }, note: text(200) }, ['name', 'status']) },
    }),
    service: 'hostel.life.markRollCall()',
    async prepare(_ctx, args) {
      if (!args.allPresent && !args.marks?.length) throw new AppError('Say who to mark, or that everyone else is present.', 400, [], 'AGENT_NEEDS_INPUT');
      const r = await rollFor(args);
      const entries = [];
      for (const m of args.marks ?? []) { const p = await residentNamed(m.name); entries.push({ studentId: p.studentId, name: p.name, status: m.status, note: m.note }); }
      return { id: r.id, date: r.date, session: r.session, entries, unmarked: r.counts.UNMARKED };
    },
    summarise: (args, _a, p) => `On the ${String(p?.session ?? '').toLowerCase()} roll call ${p?.date ?? ''}: ${(p?.entries ?? []).map((e) => `${e.name} ${e.status.toLowerCase().replace('_', ' ')}`).join(', ')}${args.allPresent ? `${p?.entries?.length ? '; ' : ''}everyone else unmarked (${p?.unmarked ?? 0}) present` : ''}`,
    async run(ctx, args, p) { const r = await life.markRollCall(ctx.actor, p.id, { entries: p.entries.map(({ studentId, status, note }) => ({ studentId, status, note })), allPresent: args.allPresent === true }); return action({ type: 'roll_call_marked', id: r.id, data: r.counts, speak: `Marked. ${r.counts.UNMARKED} still unmarked.` }); },
  },

  submit_hostel_roll_call: {
    ...manage, operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Submit the roll call. Anyone still unmarked or absent counts as not accounted for: every warden and the principal are alerted and an urgent task opens until each is found. Confirmed on the website.',
    inputSchema: closed({ date: dateStr(), session: { type: 'string', enum: ROLL_SESSIONS } }), service: 'hostel.life.submitRollCall()',
    async prepare(_ctx, args) { const r = await rollFor(args); if (r.submittedAt) throw new AppError('That roll call is already submitted.', 409, [], 'ROLL_SUBMITTED'); return { id: r.id, date: r.date, session: r.session, missing: r.entries.filter((e) => ['UNMARKED', 'ABSENT'].includes(e.status)).map((e) => e.name) }; },
    summarise: (_a, _b, p) => `Submit the ${String(p?.session ?? '').toLowerCase()} roll call ${p?.date ?? ''}${p?.missing?.length ? ` — ${p.missing.length} not accounted for (${p.missing.slice(0, 8).join(', ')}): wardens and the principal will be alerted` : ' — everyone accounted for'}`,
    async run(ctx, _args, p) { const r = await life.submitRollCall(ctx.actor, p.id); return action({ type: 'roll_call_submitted', id: r.id, data: r.counts, speak: r.unaccounted ? `Submitted. ${r.unaccounted} not accounted for; the alert has gone out.` : 'Submitted: everyone accounted for.' }); },
  },

  get_mess_menu: {
    ...read, operation: 'GET', risk: RISK.LOW,
    description: "The hostel mess menu for a week (default this week): breakfast, lunch, snacks and dinner each day, and tonight's headcount.",
    inputSchema: closed({ week: dateStr('Any date in the week') }), service: 'hostel.life.getMenu()',
    async run(_ctx, args) {
      const [m, hc] = await Promise.all([life.getMenu({ week: args.week }), life.headcount({})]);
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const d = m.days.find((x) => x.date === today);
      return ok({ ...m, headcount: hc }, { speak: `${m.saved ? '' : 'No menu saved for this week yet. '}${d ? `Today: dinner ${d.dinner || 'not set'}. ` : ''}${hc.meals} meal(s) tonight (${hc.away} away).` });
    },
  },

  update_mess_menu: {
    ...manage, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Set the mess menu for one day (any of breakfast, lunch, snacks, dinner); the rest of the week is kept.',
    inputSchema: closed({ date: dateStr(), ...Object.fromEntries(MEALS.map((k) => [k, text(200)])) }, ['date']),
    service: 'hostel.life.saveMenu()',
    summarise: (args) => `Mess menu for ${args.date}: ${MEALS.filter((k) => args[k]).map((k) => `${k} ${args[k]}`).join('; ')}`,
    async run(ctx, args) {
      const m = await life.getMenu({ week: args.date });
      const idx = m.days.findIndex((d) => d.date === args.date);
      const days = m.days.map((d, i) => ({ day: i, ...Object.fromEntries(MEALS.map((k) => [k, i === idx && args[k] !== undefined ? args[k] : d[k]])) }));
      const saved = await life.saveMenu(ctx.actor, { week: m.weekStart, days, notes: m.notes });
      return action({ type: 'mess_menu_saved', data: { weekStart: saved.weekStart }, speak: `Menu for ${args.date} saved.` });
    },
  },

  log_hostel_incident: {
    ...manage, operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Record a hostel incident or discipline note: residents involved (by name), category, severity, what happened and what was done. A HIGH one opens a follow-up task. A safeguarding concern must also be reported on the Safeguarding page (say referredToSafeguarding).',
    inputSchema: closed({
      students: { type: 'array', items: text(80), minItems: 1, maxItems: 10 }, category: { type: 'string', enum: INCIDENT_CATEGORIES },
      severity: { type: 'string', enum: INCIDENT_SEVERITIES }, description: text(2000), actionTaken: text(1000), location: text(120), referredToSafeguarding: { type: 'boolean' },
    }, ['students', 'description']),
    service: 'hostel.life.createIncident()',
    async prepare(_ctx, args) { const people = []; for (const n of args.students) people.push(await residentNamed(n)); return { ids: people.map((p) => p.studentId), names: people.map((p) => p.name) }; },
    summarise: (args, _a, p) => `Record a ${(args.severity ?? 'LOW').toLowerCase()} ${(args.category ?? 'OTHER').toLowerCase().replace('_', ' ')} incident for ${(p?.names ?? args.students).join(', ')}: "${args.description}"`,
    async run(ctx, args, p) {
      const i = await life.createIncident(ctx.actor, { ...args, studentIds: p.ids, students: undefined });
      return action({ type: 'hostel_incident_recorded', id: i.id, data: { refNo: i.refNo }, speak: `Recorded ${i.refNo}.${i.referredToSafeguarding ? ' Report the details on the Safeguarding page as well.' : ''}` });
    },
  },

  list_hostel_incidents: {
    ...read, operation: 'GET', risk: RISK.LOW,
    description: 'Hostel incidents (default open ones): reference, residents, category, severity, when, and how many times the family was contacted. Optionally for one resident.',
    inputSchema: closed({ status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'ALL'] }, student: text(80) }), service: 'hostel.life.listIncidents()',
    async run(_ctx, args) {
      const studentId = args.student ? (await residentNamed(args.student)).studentId : undefined;
      const rows = await life.listIncidents({ status: args.status ?? 'OPEN', studentId });
      return ok({ count: rows.length, rows: rows.map((i) => ({ refNo: i.refNo, students: i.students.map((s) => s.name), category: i.category, severity: i.severity, occurredAt: i.occurredAt, status: i.status, parentContacts: i.parentContacts.length })) }, { speak: `${rows.length} incident(s).` });
    },
  },

  log_parent_contact: {
    ...manage, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Record that you spoke to a family about a hostel incident (call, WhatsApp, meeting or email) and what was said. The assistant does not contact them; it records the conversation you had.',
    inputSchema: closed({ incident: text(80, 'Reference (HIN/2026/0003) or the resident\'s name'), guardianName: text(80), channel: { type: 'string', enum: CONTACT_CHANNELS }, summary: text(1000) }, ['summary']),
    service: 'hostel.life.logParentContact()',
    async prepare(_ctx, args) { const i = await incidentNamed(args.incident); return { id: i.id, refNo: i.refNo, who: i.students.map((s) => s.name).join(', ') }; },
    summarise: (args, _a, p) => `On ${p?.refNo} (${p?.who}): ${(args.channel ?? 'CALL').toLowerCase()} with ${args.guardianName ?? 'the family'} — "${args.summary}"`,
    async run(ctx, args, p) { await life.logParentContact(ctx.actor, p.id, args); return action({ type: 'parent_contact_logged', id: p.id, speak: `Logged on ${p.refNo}.` }); },
  },

  resolve_hostel_incident: {
    ...manage, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Close a hostel incident with how it was resolved.',
    inputSchema: closed({ incident: text(80), resolution: text(1000) }, ['resolution']), service: 'hostel.life.resolveIncident()',
    async prepare(_ctx, args) { const i = await incidentNamed(args.incident); if (i.status !== 'OPEN') throw new AppError(`${i.refNo} is already resolved.`, 409, [], 'ALREADY_RESOLVED'); return { id: i.id, refNo: i.refNo, who: i.students.map((s) => s.name).join(', ') }; },
    summarise: (args, _a, p) => `Resolve ${p?.refNo} (${p?.who}): "${args.resolution}"`,
    async run(ctx, args, p) { await life.resolveIncident(ctx.actor, p.id, args); return action({ type: 'hostel_incident_resolved', id: p.id, speak: `${p.refNo} resolved.` }); },
  },
};
