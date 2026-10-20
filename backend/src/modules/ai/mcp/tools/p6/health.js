// Part-6 coverage tools: health. See ./_kit.js and ../p6Coverage.js.
import * as health from '../../../../health/health.service.js';
import { childrenOf } from '../../../../ptm/relations.js';
import { NOTIFY_TRIGGERS, STOCK_KINDS } from '../../../../../models/health.model.js';
import {
  tool, text, int, num, bool, oneOf, list, closed, dateStr, hm, ask, notFound, pick, listed, shown, did,
  words, excerpt, decisionArg, RISK, AppError,
} from './_kit.js';

/**
 * The rest of the school health room through the assistant, as restricted as
 * the Health page itself (see health.service.js "Who sees what"):
 *
 *   the nurse (health.manage / health.read at ALL)   settings, stock, medication
 *       plans drafted for a parent's consent, care notes, any child's
 *       immunisations, screenings and health card
 *   a parent (health.read OWN)    their own children only: visits, plans,
 *       the family page, care notes, immunisations, screenings, health card;
 *       their consent to a plan and to sharing a care note
 *
 * Kept on the Health page by the existing product rule (tests/mcp.roleCoverage
 * ledger): countersigning a controlled dose (health.witness -- the second
 * person checking at the cabinet) and the class teacher's shared care notes
 * (health.carenotes.read -- kept out of chat transcripts altogether).
 *
 * Every tool calls the same service the page calls, so every read is audited
 * there and a child outside the caller's reach is refused there (not found).
 * Nothing here is shown to any other role; no health field appears in any
 * other tool. A parent's own consent is approver-confirmed: recorded only when
 * the parent states it, and confirmed on the website. A parent's new plan
 * needs the prescription uploaded with it, so it stays on the Health page.
 * The health register CSV is a download and stays on the page.
 */

const H = { module: 'Health room', feature: 'healthRoom' };
const FAMILY_OR_NURSE = ['PARENT', 'NURSE'];
const HMS = (description) => list(hm(), 6, description);

/** A child named in words: the parent's own children, or (the nurse) any student. */
async function childNamed(ctx, name, { required = false } = {}) {
  if (ctx.actor.roleKey === 'PARENT') {
    const kids = (await childrenOf(ctx.actor.profileId)).map((c) => ({ id: c.studentId, name: c.name, className: c.className }));
    if (!kids.length) throw notFound('No child is linked to your account.');
    if (!name) {
      if (kids.length === 1) return kids[0];
      if (!required) return null;
      throw ask(`Which child? ${kids.map((k) => k.name).join(' or ')}.`);
    }
    return pick(kids, name, { label: 'child of yours', nameOf: (k) => k.name, refOf: () => null });
  }
  if (!name) {
    if (required) throw ask('Which student? Name them.');
    return null;
  }
  const found = await health.findStudents(ctx.actor, { q: name });
  return pick(found.items, name, { label: 'student', nameOf: (r) => r.name, refOf: (r) => r.admissionNo, describe: (r) => `${r.name} (${r.className ?? r.admissionNo})` });
}

const medName = (p) => p.medicine?.name ?? 'medicine';
const planRow = (p) => ({ ref: p.refNo, child: p.studentName, className: p.className, medicine: medName(p), form: p.medicine?.form ?? null, strength: p.medicine?.strength ?? null, dose: p.dose, times: p.times, from: p.startOn, to: p.endOn, controlled: p.controlled, status: p.status, consentBy: p.consent?.byName ?? null, hasPrescription: Boolean(p.prescription), stoppedReason: p.stoppedReason });

/** One of the caller's readable plans for a child, by medicine name or reference. */
async function planFor(ctx, args, statuses) {
  const child = await childNamed(ctx, args.childName, { required: true });
  const rows = (await health.listPlans(ctx.actor, { studentId: child.id })).items.filter((p) => statuses.includes(p.status));
  if (!rows.length) throw notFound(`${child.name} has no ${statuses.map((s) => words(s)).join(' or ')} medication plan.`);
  const p = pick(rows, args.medicine, { label: `medication plan for ${child.name}`, nameOf: medName, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${medName(x)} (${x.dose})` });
  return { plan: p, child };
}

/** One of the caller's readable active care notes for a child, by its words. */
async function careNoteFor(ctx, args) {
  const child = await childNamed(ctx, args.childName, { required: true });
  const rows = (await health.listCareNotes(ctx.actor, { studentId: child.id })).items;
  if (!rows.length) throw notFound(`${child.name} has no care note.`);
  const n = pick(rows, args.note, { label: `care note for ${child.name}`, nameOf: (x) => x.text, refOf: () => null, describe: (x) => `"${excerpt(x.text, 50)}"` });
  return { note: n, child };
}

/* ── reads ────────────────────────────────────────────────── */

const reads = {

  get_family_health: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: ['PARENT'],
    description: "A parent: the Health page for their own children: recent health-room visits, medication plans (and any waiting for their consent), the medication log and care notes. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80, 'One child; leave out for all your children') }),
    service: 'health.service.family()',
    async run(ctx, args) {
      const f = await health.family(ctx.actor);
      let kids = f.children;
      if (args.childName) { const c = pick(kids, args.childName, { label: 'child of yours', nameOf: (k) => k.name, refOf: () => null }); kids = [c]; }
      const children = kids.map((c) => ({
        child: c.name, className: c.className,
        visits: c.visits.slice(0, 10).map((v) => ({ ref: v.refNo, at: v.arrivedAt, complaint: v.complaint, outcome: v.outcomeLabel })),
        plans: c.plans.map(planRow), medicationLog: c.medicationLog.slice(0, 10).map((d) => ({ date: d.date, time: d.slot, medicine: d.medicine, status: d.status })),
        careNotes: c.careNotes.map((n) => ({ note: n.text, severity: n.severity, sharedWithClassTeacher: n.shared })),
      }));
      const speak = children.length ? children.map((c) => `${c.child}: ${c.visits.length} recent visit(s), ${c.plans.filter((p) => p.status === 'ACTIVE').length} active plan(s)${c.plans.some((p) => p.status === 'AWAITING_CONSENT') ? ', a plan waiting for your consent' : ''}, ${c.careNotes.length} care note(s)`).join('; ') : 'No child is linked to your account.';
      return shown({ children }, `${speak}.`);
    },
  }),

  list_child_health_visits: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: ['PARENT'],
    description: "A parent: their own child's health-room visits (when, the complaint, what was done, the outcome, whether they were told). Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80, 'A parent with one child may leave it out'), from: dateStr(), to: dateStr() }),
    service: 'health.service.listVisits()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName);
      const r = await health.listVisits(ctx.actor, { ...(child && { studentId: child.id }), from: args.from, to: args.to, limit: 50 });
      const rows = r.items.map((v) => ({ ref: v.refNo, child: v.studentName, at: v.arrivedAt, left: v.leftAt, complaint: v.complaint, action: v.action, outcome: v.outcomeLabel, injury: v.injury, medicineGiven: v.medicineGiven, parentTold: Boolean(v.parentNotified) }));
      return listed(rows, (v) => `${v.child} ${v.ref}: ${v.complaint ?? ''} (${v.outcome})`, { noun: 'visit', speak: rows.length ? undefined : `No health-room visits${child ? ` for ${child.name}` : ''}.` });
    },
  }),

  get_health_room_settings: tool({
    ...H, operation: 'GET', permission: 'health.manage', minScope: 'ALL',
    description: 'School nurse only: when parents are told about a health-room visit (sent home, referred, injury, medicine given) and how many days ahead stock expiry reminders start. Read-only.',
    service: 'health.service.getSettings()',
    async run() {
      const s = await health.getSettings();
      return shown(s, `Parents are told when: ${s.notifyOn.map(words).join(', ') || 'never by default'}; stock expiry reminders start ${s.expiryLeadDays} day(s) ahead.`);
    },
  }),

  list_medication_plans: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "Medication plans at school: a parent sees their own children's; the school nurse sees every child's (or one named). Medicine, dose, times, dates, controlled or not, status (waiting for consent, active, stopped) and who consented. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80), status: oneOf(['AWAITING_CONSENT', 'ACTIVE', 'STOPPED', 'COMPLETED']) }),
    service: 'health.service.listPlans()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName);
      const r = await health.listPlans(ctx.actor, { ...(child && { studentId: child.id }), ...(args.status && { status: args.status }) });
      const rows = r.items.map(planRow);
      return listed(rows, (p) => `${p.child}: ${p.medicine} ${p.dose} at ${p.times.join(', ')} (${words(p.status)})`, { noun: 'medication plan' });
    },
  }),

  list_care_notes: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "Care notes (a short line for the class teacher, e.g. an allergy): a parent sees their own children's; the school nurse sees every child's (or one named). Whether each is shared with the class teacher. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80) }),
    service: 'health.service.listCareNotes()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName);
      const r = await health.listCareNotes(ctx.actor, child ? { studentId: child.id } : {});
      const rows = r.items.map((n) => ({ child: n.studentName, className: n.className, note: n.text, severity: n.severity, sharedWithClassTeacher: n.shared, by: n.createdBy }));
      return listed(rows, (n) => `${n.child}: "${excerpt(n.note, 60)}"${n.sharedWithClassTeacher ? ' (shared)' : ' (not shared)'}`, { noun: 'care note' });
    },
  }),

  list_child_health_entries: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "A child's immunisations and screenings (height, weight, BMI, vision, dental, hearing): a parent for their own child, the school nurse for any. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80, 'A parent with one child may leave it out'), kind: oneOf(['IMMUNISATION', 'SCREENING']) }),
    service: 'health.service.listEntries()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName, { required: true });
      const r = await health.listEntries(ctx.actor, child.id, args.kind ? { kind: args.kind } : {});
      const rows = r.items.map((e) => ({ kind: e.kind, on: e.on, academicYear: e.academicYear, ...e.data }));
      return listed(rows, (e) => (e.kind === 'IMMUNISATION' ? `${e.vaccine}${e.doseNo ? ` dose ${e.doseNo}` : ''} on ${e.on}` : `screening on ${e.on}${e.bmi ? ` (BMI ${e.bmi})` : ''}`), { noun: 'entry', extra: { child: child.name }, speak: rows.length ? undefined : `No immunisations or screenings are recorded for ${child.name}.` });
    },
  }),

  get_child_health_card: tool({
    ...H, operation: 'GET', permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "A child's annual health card: blood group, allergies, this year's screenings, immunisations and the number of health-room visits: a parent for their own child, the school nurse for any. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80, 'A parent with one child may leave it out'), academicYear: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'e.g. 2026-27; default this year' } }),
    service: 'health.service.healthCard()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName, { required: true });
      const c = await health.healthCard(ctx.actor, child.id, args.academicYear ? { academicYear: args.academicYear } : {});
      return shown(c, `${c.student.name}, ${c.academicYear}: blood group ${c.bloodGroup ?? 'not recorded'}; ${c.allergies.length ? `allergies ${c.allergies.map((a) => a.name ?? a).join(', ')}` : 'no allergies recorded'}; ${c.immunisations.length} immunisation(s); ${c.latestScreening ? `last screened ${c.latestScreening.on}` : 'not screened this year'}; ${c.visitsThisYear} visit(s) this year.`);
    },
  }),
};

/* ── the nurse's desk ─────────────────────────────────────── */

const nurse = {
  update_health_room_settings: tool({
    ...H, operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, permission: 'health.manage', minScope: 'ALL',
    description: 'School nurse only: choose when parents are told about a health-room visit (sent home, referred, injury, medicine given) and how many days ahead stock expiry reminders start (0-180). Applies to the whole school. Confirmed on the website.',
    inputSchema: closed({ notifyOn: list(oneOf(NOTIFY_TRIGGERS), 4, 'The full list of outcomes that tell parents'), expiryLeadDays: int(0, 180) }),
    service: 'health.service.updateSettings()',
    async prepare() {
      return { before: await health.getSettings() };
    },
    summarise: (a, _x, p) => [a.notifyOn && `Tell parents when: ${a.notifyOn.map(words).join(', ') || 'never by default'}${p?.before ? ` (was ${p.before.notifyOn.map(words).join(', ') || 'never'})` : ''}`, a.expiryLeadDays !== undefined && `start stock expiry reminders ${a.expiryLeadDays} day(s) ahead${p?.before ? ` (was ${p.before.expiryLeadDays})` : ''}`].filter(Boolean).join('; ') || 'No change to the health-room settings',
    async run(ctx, args) {
      if (args.notifyOn === undefined && args.expiryLeadDays === undefined) throw ask('What should change: when parents are told, or the expiry reminder days?');
      const s = await health.updateSettings(ctx.actor, args);
      return did('health_settings_updated', { id: 'default', ...s }, `Saved. Parents are told when: ${s.notifyOn.map(words).join(', ') || 'never by default'}; reminders ${s.expiryLeadDays} day(s) ahead.`);
    },
  }),

  add_health_stock: tool({
    ...H, operation: 'CREATE', risk: RISK.MEDIUM, permission: 'health.manage', minScope: 'ALL',
    description: 'School nurse only: add a first-aid item, medicine or piece of equipment to the health-room stock (name, kind, batch, quantity and unit, reorder level, expiry date, where it is kept, controlled or not). An expiry reminder follows in Tasks. Needs confirmation.',
    inputSchema: closed({ name: text(120), kind: oneOf(STOCK_KINDS), batchNo: text(60), quantity: num(0, 100000), unit: text(30, 'e.g. tablets, strips, bottles'), reorderLevel: num(0, 100000), expiresOn: dateStr(), location: text(80), controlled: bool() }, ['name', 'quantity']),
    service: 'health.service.addStock()',
    summarise: (a) => `Add ${a.quantity} ${a.unit ?? 'units'} of ${a.name} (${words(a.kind ?? 'FIRST_AID')}${a.batchNo ? `, batch ${a.batchNo}` : ''}${a.expiresOn ? `, expires ${a.expiresOn}` : ''}${a.controlled ? ', controlled' : ''}) to the health-room stock`,
    async run(ctx, args) {
      const s = await health.addStock(ctx.actor, args);
      return did('health_stock_added', s, `Added ${s.name}: ${s.quantity} ${s.unit}${s.low ? ' (at or below the reorder level)' : ''}.`);
    },
  }),

  create_medication_plan: tool({
    ...H, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, permission: 'health.read', forRoles: ['NURSE'],
    description: "School nurse only: draft a medication plan for a student (medicine, form and strength, dose, the times of day HH:MM, the dates, instructions, controlled or not). It waits for a parent's consent and prescription before any dose is given, and the parents are asked on the Health page. A parent adds their own plan with the prescription on the Health page. Confirmed on the website.",
    inputSchema: closed({
      studentName: text(80), medicine: text(120), form: text(40, 'e.g. tablet, syrup, inhaler'), strength: text(60), dose: text(120, 'e.g. 5 ml, 1 tablet'),
      times: HMS('Times of day, HH:MM'), startOn: dateStr(), endOn: dateStr(), instructions: text(500), controlled: bool(),
    }, ['studentName', 'medicine', 'dose', 'times', 'startOn', 'endOn']),
    service: 'health.service.createPlan()',
    async prepare(ctx, args) {
      if (!args.times?.length) throw ask('At what time(s) of day is it given?');
      const st = await childNamed(ctx, args.studentName, { required: true });
      return { studentId: st.id, name: st.name, className: st.className ?? null };
    },
    summarise: (a, _x, p) => `Draft a plan for ${p?.name ?? a.studentName}${p?.className ? ` (${p.className})` : ''}: ${a.medicine}${a.strength ? ` ${a.strength}` : ''} ${a.dose} at ${(a.times ?? []).join(', ')}, ${a.startOn} to ${a.endOn}${a.controlled ? ', controlled' : ''}; the parents are asked for consent and the prescription`,
    async run(ctx, args, p) {
      const plan = await health.createPlan(ctx.actor, { studentId: p.studentId, medicine: { name: args.medicine, form: args.form, strength: args.strength }, dose: args.dose, times: args.times, startOn: args.startOn, endOn: args.endOn, instructions: args.instructions, controlled: args.controlled });
      return did('medication_plan_drafted', plan, `Drafted ${plan.refNo} for ${plan.studentName}; it waits for the parents' consent.`);
    },
  }),

  cancel_medication_plan: tool({
    ...H, operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "Stop a medication plan that is active or waiting for consent, with the reason (a parent for their own child, or the school nurse). No further doses are given; nothing is deleted. Confirmed on the website.",
    inputSchema: closed({ childName: text(80, 'The child (a parent with one child may leave it out)'), medicine: text(120, 'The medicine, or the plan reference'), reason: text(300) }, ['reason']),
    service: 'health.service.listPlans() + stopPlan()',
    async prepare(ctx, args) {
      const { plan, child } = await planFor(ctx, args, ['ACTIVE', 'AWAITING_CONSENT']);
      return { id: plan.id, ref: plan.refNo, child: child.name, medicine: medName(plan), dose: plan.dose };
    },
    summarise: (a, _x, p) => `Stop ${p?.child ?? a.childName}'s plan ${p?.ref ?? ''} for ${p?.medicine ?? a.medicine} (${p?.dose ?? ''}) — reason: "${excerpt(a.reason, 100)}"`,
    async run(ctx, args, p) {
      const plan = await health.stopPlan(ctx.actor, p.id, { reason: args.reason });
      return did('medication_plan_stopped', plan, `${plan.refNo} is stopped; no further doses will be given.`);
    },
  }),

};

/* ── care notes and a parent's consent ────────────────────── */

const family = {
  record_medication_consent_decision: tool({
    ...H, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, permission: 'health.read', forRoles: ['PARENT'],
    description: "A parent: give or decline consent for a medication plan the school nurse drafted for their own child. Consent needs the prescription on the plan (uploaded on the Health page); declining stops the plan with your reason. Recorded only when the parent states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ childName: text(80, 'A parent with one child may leave it out'), medicine: text(120, 'The medicine, or the plan reference'), decision: decisionArg(['GIVE_CONSENT', 'DECLINE'], 'the parent'), reason: text(300, 'Required to decline') }, ['decision']),
    service: 'health.service.listPlans() + consentPlan() / stopPlan()',
    async prepare(ctx, args) {
      const { plan, child } = await planFor(ctx, args, ['AWAITING_CONSENT']);
      if (args.decision === 'GIVE_CONSENT' && !plan.prescription) throw new AppError('Your consent goes with the prescription (or the doctor\'s note). Upload it with your consent on the Health page.', 400, [], 'PRESCRIPTION_REQUIRED');
      if (args.decision === 'DECLINE' && !args.reason) throw ask('Why are you declining? The nurse sees your reason.');
      return { id: plan.id, ref: plan.refNo, child: child.name, medicine: medName(plan), dose: plan.dose, times: plan.times };
    },
    summarise: (a, _x, p) => (a.decision === 'GIVE_CONSENT'
      ? `Give your consent for the school to give ${p?.child ?? 'your child'} ${p?.medicine ?? a.medicine} (${p?.dose ?? ''}) at ${(p?.times ?? []).join(', ')} as prescribed (plan ${p?.ref ?? ''})`
      : `Decline consent for ${p?.child ?? 'your child'}'s plan ${p?.ref ?? ''} for ${p?.medicine ?? a.medicine}; the plan is stopped — reason: "${excerpt(a.reason, 100)}"`),
    async run(ctx, args, p) {
      const plan = args.decision === 'GIVE_CONSENT'
        ? await health.consentPlan(ctx.actor, p.id, { consent: true })
        : await health.stopPlan(ctx.actor, p.id, { reason: `Parent declined consent: ${args.reason}` });
      return did('medication_consent_recorded', plan, args.decision === 'GIVE_CONSENT' ? `Thank you: consent recorded; ${plan.refNo} is active.` : `${plan.refNo} is stopped; the nurse can see your reason.`);
    },
  }),

  add_care_note: tool({
    ...H, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "Write a short care note for the class teacher (up to 160 characters, e.g. \"Severe peanut allergy: EpiPen in the front pocket of the bag\"). A parent writes one for their own child and chooses whether to share it with the class teacher now; the school nurse drafts one, which is shared only once a parent agrees (the parents are asked). Confirmed on the website.",
    inputSchema: closed({ childName: text(80, 'The child (a parent with one child may leave it out)'), text: text(160), severity: oneOf(['INFO', 'IMPORTANT', 'SEVERE']), share: bool('A parent: share it with the class teacher now') }, ['text']),
    service: 'health.service.createCareNote()',
    async prepare(ctx, args) {
      const child = await childNamed(ctx, args.childName, { required: true });
      return { studentId: child.id, name: child.name, parent: ctx.actor.roleKey === 'PARENT' };
    },
    summarise: (a, _x, p) => `Add a ${words(a.severity ?? 'IMPORTANT')} care note for ${p?.name ?? a.childName}: "${a.text}"${p?.parent ? (a.share ? ', shared with the class teacher' : ', not shared yet') : '; the parents are asked whether to share it with the class teacher'}`,
    async run(ctx, args, p) {
      const n = await health.createCareNote(ctx.actor, { studentId: p.studentId, text: args.text, severity: args.severity, share: args.share === true });
      return did('care_note_added', n, `Care note saved for ${n.studentName}${n.shared ? '; the class teacher can see it' : ''}.`);
    },
  }),

  record_care_note_sharing_decision: tool({
    ...H, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, permission: 'health.read', forRoles: ['PARENT'],
    description: "A parent: share one of their own child's care notes with the class teacher, or stop sharing it (it is hidden from the teacher at once). Recorded only when the parent states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ childName: text(80, 'A parent with one child may leave it out'), note: text(160, 'Words from the care note'), decision: decisionArg(['SHARE', 'STOP_SHARING'], 'the parent') }, ['decision']),
    service: 'health.service.listCareNotes() + setCareNoteConsent()',
    async prepare(ctx, args) {
      const { note, child } = await careNoteFor(ctx, args);
      return { id: note.id, child: child.name, text: note.text, shared: note.shared };
    },
    summarise: (a, _x, p) => `${a.decision === 'SHARE' ? 'Share' : 'Stop sharing'} ${p?.child ?? 'your child'}'s care note "${excerpt(p?.text ?? a.note, 80)}" ${a.decision === 'SHARE' ? 'with' : 'from'} the class teacher${p && p.shared === (a.decision === 'SHARE') ? ` (it is already ${p.shared ? 'shared' : 'not shared'})` : ''}`,
    async run(ctx, args, p) {
      const n = await health.setCareNoteConsent(ctx.actor, p.id, { share: args.decision === 'SHARE' });
      return did('care_note_sharing_recorded', n, n.shared ? 'The class teacher can now see this care note.' : 'The class teacher can no longer see this care note.');
    },
  }),

  retire_care_note: tool({
    ...H, operation: 'DELETE', risk: RISK.MEDIUM, affectsOthers: true, permission: 'health.read', forRoles: FAMILY_OR_NURSE,
    description: "Remove a care note that no longer applies (a parent for their own child, or the school nurse); the class teacher stops seeing it and it stays in the record's history. Confirmed on the website.",
    inputSchema: closed({ childName: text(80, 'The child (a parent with one child may leave it out)'), note: text(160, 'Words from the care note') }),
    service: 'health.service.listCareNotes() + retireCareNote()',
    async prepare(ctx, args) {
      const { note, child } = await careNoteFor(ctx, args);
      return { id: note.id, child: child.name, text: note.text };
    },
    summarise: (a, _x, p) => `Remove ${p?.child ?? a.childName}'s care note "${excerpt(p?.text ?? a.note, 80)}" (the class teacher stops seeing it)`,
    async run(ctx, _args, p) {
      const n = await health.retireCareNote(ctx.actor, p.id);
      return did('care_note_retired', n, 'Care note removed.');
    },
  }),
};

export const tools = { ...reads, ...nurse, ...family };
