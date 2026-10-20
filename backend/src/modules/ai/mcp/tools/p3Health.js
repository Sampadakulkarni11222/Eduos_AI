import * as health from '../../../health/health.service.js';
import { childrenOf } from '../../../ptm/relations.js';
import { VISIT_OUTCOMES, DOSE_STATUSES } from '../../../../models/health.model.js';
import { FEATURES } from '../../../../constants/features.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed } from './_shared.js';

/**
 * The school health room, through the assistant: deliberately narrow.
 *
 * Health data is restricted. The assistant reads only what the health role
 * (health.manage at school-wide scope: the nurse) or a parent for their own
 * child may already read on the Health page, and calls the same service, so
 * every read is audited there exactly as the page's is. Four tools:
 *
 *   get_health_visits_today    the nurse: today's visits and the doses due
 *   get_child_medication_log   a parent: their own child's medication log
 *                              (the nurse: any child's)
 *   log_health_visit           the nurse records a visit (confirmed)
 *   log_medicine_dose          the nurse records a dose (confirmed on the website only)
 *
 * Not here, on purpose: care notes (the class teacher reads them on the page;
 * they are not chat content), countersigning a controlled medicine (a second
 * person, at the cabinet, on the website), the principal's counts, consent,
 * prescriptions and stock. Tool names avoid the deciding verbs (record_,
 * approve_, ...) the registry reserves.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const HM = '^([01]\\d|2[0-3]):[0-5]\\d$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const OUTCOME_WORDS = {
  RETURNED_TO_CLASS: 'returned to class', REST: 'rested', FIRST_AID: 'first aid', SENT_HOME: 'sent home', REFERRED: 'referred',
};

async function requireOn() {
  if (!(await featureEnabled('healthRoom'))) {
    throw new AppError(`${FEATURES.healthRoom.label} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  }
}

function behind(tool) {
  const { run, prepare } = tool;
  return {
    ...tool,
    feature: 'healthRoom',
    async run(ctx, args, prepared) { await requireOn(); return run.call(this, ctx, args, prepared); },
    ...(prepare && { async prepare(ctx, args) { await requireOn(); return prepare.call(this, ctx, args); } }),
  };
}

/** A child named in words: the parent's own children, or (the nurse) any student. */
async function childNamed(ctx, name) {
  if (ctx.actor.roleKey === 'PARENT') {
    const kids = (await childrenOf(ctx.actor.profileId)).map((c) => ({ id: c.studentId, name: c.name, className: c.className }));
    if (!kids.length) throw new AppError('No child is linked to your account.', 404);
    if (!name) {
      if (kids.length === 1) return kids[0];
      throw new AppError(`Which child? ${kids.map((k) => k.name).join(' or ')}.`, 400, [], 'AGENT_NEEDS_INPUT');
    }
    return theNamed(kids, name, { label: 'child of yours', nameOf: (k) => k.name });
  }
  if (!name) throw new AppError('Which student? Name them.', 400, [], 'AGENT_NEEDS_INPUT');
  const found = await health.findStudents(ctx.actor, { q: name });
  return theNamed(found.items, name, { label: 'student', nameOf: (r) => r.name, describe: (r) => `${r.name} (${r.className ?? r.admissionNo})` });
}

export const healthTools = {
  get_health_visits_today: behind({
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: "School nurse only: today's health-room visits (who, time in/out, complaint, outcome) and the medicine doses due today with what has been given. Read-only; every read is audited.",
    inputSchema: closed({}),
    permission: 'health.manage', minScope: 'ALL',
    service: 'health.service.today()',
    async run(ctx) {
      const t = await health.today(ctx.actor);
      const visits = t.visits.map((v) => ({ ref: v.refNo, student: v.studentName, className: v.className, in: v.arrivedAt, out: v.leftAt, complaint: v.complaint, outcome: v.outcomeLabel, parentTold: Boolean(v.parentNotified) }));
      const doses = t.doses.map((d) => ({ student: d.studentName, medicine: d.medicine, dose: d.dose, at: d.slot, status: d.status, controlled: d.controlled, awaitingCountersign: d.awaitingCountersign }));
      const pending = doses.filter((d) => d.status === 'DUE' || d.status === 'OVERDUE');
      return ok({ date: t.date, visits, doses, stock: t.stock }, {
        speak: `${visits.length} visit(s) today; ${pending.length} dose(s) still to give${pending.some((d) => d.status === 'OVERDUE') ? ' (some overdue)' : ''}.`,
      });
    },
  }),

  get_child_medication_log: behind({
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: "A parent: the medication log for their own child at school (each dose given, missed or refused, when and by whom). The school nurse may ask for any student. Read-only; every read is audited.",
    inputSchema: closed({ childName: text(80, 'The child, e.g. "Rahul". A parent with one child may leave it out.') }),
    permission: 'health.read',
    forRoles: ['PARENT', 'NURSE'],
    service: 'health.service.medicationLog()',
    async run(ctx, args) {
      const child = await childNamed(ctx, args.childName);
      const log = await health.medicationLog(ctx.actor, child.id, { limit: 30 });
      const rows = log.items.map((d) => ({ date: d.date, time: d.slot, medicine: d.medicine, status: d.status, by: d.by }));
      return ok({ child: child.name, doses: rows }, {
        speak: rows.length ? `${rows.length} dose(s) recorded for ${child.name}; the latest: ${rows[0].medicine} on ${rows[0].date} at ${rows[0].time}, ${rows[0].status.toLowerCase()}.` : `No doses are recorded for ${child.name}.`,
      });
    },
  }),

  log_health_visit: behind({
    module: 'Health room', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'School nurse only: record a health-room visit (student, complaint, what was done, outcome: returned to class, rest, first aid, sent home or referred; injury or medicine given). Parents are told for the outcomes the school chose. Needs confirmation.',
    inputSchema: closed({
      studentName: text(80, 'The student, e.g. "Rahul Sharma"'),
      complaint: text(500), action: text(1000, 'What was done'),
      outcome: { type: 'string', enum: VISIT_OUTCOMES },
      injury: { type: 'boolean' }, medicineGiven: { type: 'boolean' },
      temperatureC: { type: 'number', minimum: 30, maximum: 45 },
      notifyParent: { type: 'boolean', description: 'Tell the parents even when the outcome is not one the school notifies by default' },
    }, ['studentName', 'complaint', 'outcome']),
    permission: 'health.manage', minScope: 'ALL',
    service: 'health.service.recordVisit()',
    async prepare(ctx, args) {
      const child = await childNamed(ctx, args.studentName);
      return { studentId: child.id, name: child.name, className: child.className ?? null };
    },
    summarise: (args, _a, p) => `Record a health-room visit for ${p?.name ?? args.studentName}${p?.className ? ` (${p.className})` : ''}: "${args.complaint}" — ${OUTCOME_WORDS[args.outcome] ?? args.outcome}${args.injury ? ', injury' : ''}${args.medicineGiven ? ', medicine given' : ''}`,
    async run(ctx, args, p) {
      const v = await health.recordVisit(ctx.actor, {
        studentId: p.studentId, complaint: args.complaint, action: args.action, outcome: args.outcome,
        injury: args.injury, medicineGiven: args.medicineGiven, notifyParent: args.notifyParent,
        vitals: args.temperatureC ? { temperatureC: args.temperatureC } : null,
      }, { channel: ctx.channel ?? 'WEB' });
      return action({ type: 'health_visit_recorded', id: v.id, data: { ref: v.refNo, outcome: v.outcomeLabel, parentTold: Boolean(v.parentNotified) }, speak: `Recorded ${v.refNo} for ${v.studentName}${v.parentNotified ? '; the parents have been told to check the Health page' : ''}.` });
    },
  }),

  log_medicine_dose: behind({
    module: 'Health room', operation: 'CREATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "School nurse only: record a scheduled medicine dose from a consented plan as given, missed or refused (student and the dose time, e.g. 12:30). A controlled medicine then waits for a second person's countersignature on the Health page. Confirmed on the website only.",
    inputSchema: closed({
      studentName: text(80), time: { type: 'string', pattern: HM, description: 'The scheduled dose time, HH:MM' },
      status: { type: 'string', enum: DOSE_STATUSES }, date: { type: 'string', pattern: DATE, description: 'YYYY-MM-DD; default today' },
      note: text(500),
    }, ['studentName', 'time', 'status']),
    permission: 'health.manage', minScope: 'ALL',
    service: 'health.service.recordDose()',
    async prepare(ctx, args) {
      const child = await childNamed(ctx, args.studentName);
      const due = await health.dosesDue(ctx.actor, { date: args.date });
      const matches = due.items.filter((d) => d.studentId === child.id && d.slot === args.time);
      if (!matches.length) throw new AppError(`${child.name} has no consented dose due at ${args.time}${args.date ? ` on ${args.date}` : ' today'}.`, 404, [], 'NOT_FOUND');
      if (matches.length > 1) throw new AppError(`${child.name} has more than one medicine at ${args.time}: ${matches.map((m) => m.medicine).join(', ')}. Record these on the Health page.`, 400, [], 'AGENT_NEEDS_INPUT');
      const [d] = matches;
      if (d.doseId) throw new AppError(`The ${args.time} dose for ${child.name} is already recorded (${d.status.toLowerCase()}).`, 409, [], 'DOSE_ALREADY_RECORDED');
      return { planId: d.planId, name: child.name, medicine: d.medicine, dose: d.dose, controlled: d.controlled, date: due.date };
    },
    summarise: (args, _a, p) => `Mark ${p?.name ?? args.studentName}'s ${args.time} dose${p?.medicine ? ` of ${p.medicine} (${p.dose})` : ''} on ${p?.date ?? args.date ?? 'today'} as ${String(args.status).toLowerCase()}${p?.controlled ? ' — controlled: a second person countersigns on the Health page' : ''}`,
    async run(ctx, args, p) {
      const d = await health.recordDose(ctx.actor, { planId: p.planId, slot: args.time, status: args.status, date: p.date, note: args.note }, { channel: ctx.channel ?? 'WEB' });
      return action({ type: 'health_dose_recorded', id: d.id, data: { status: d.status, awaitingCountersign: Boolean(d.countersign?.required) }, speak: `Recorded: ${d.studentName}, ${d.slot}, ${d.status.toLowerCase()}${d.countersign?.required ? '. Ask a second person to countersign it on the Health page.' : '.'}` });
    },
  }),
};
