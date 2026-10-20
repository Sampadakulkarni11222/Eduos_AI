import * as followups from '../../../marketing/followups.service.js';
import * as marketing from '../../../marketing/marketing.service.js';
import { Lead } from '../../../../models/lead.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed, dateStr } from './_shared.js';

/**
 * Admissions and marketing (part 4) through the assistant: the counsellor's
 * follow-up queue, logging a follow-up, explained enquiry scores, counsellor
 * figures, counselling appointments, campaigns and seat capacity. Each tool
 * calls the service the Admissions / Marketing pages call.
 *
 * Enquiries are named by the child's name and matched exactly or refused when
 * ambiguous. A family that withdrew consent to be contacted cannot be logged
 * as called or messaged (the service refuses). Scores order the list and carry
 * their reasons; they never move an enquiry by themselves. Offering a seat and
 * approving a campaign stay on the screen (second-person rules).
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const aRead = { module: 'Admissions', permission: 'admissions.read' };
const aManage = { module: 'Admissions', permission: 'admissions.manage', minScope: 'ALL' };
const mRead = { module: 'Marketing', permission: 'marketing.read' };
const mManage = { module: 'Marketing', permission: 'marketing.manage', minScope: 'ALL' };
const STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];
const CHANNELS = ['CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'NOTE'];
const CAMPAIGN_CHANNELS = ['SOCIAL', 'SEARCH', 'PRINT', 'OUTDOOR', 'RADIO', 'EVENT', 'REFERRAL', 'WHATSAPP', 'EMAIL', 'WEBSITE', 'OTHER'];
const IST = 330 * 60_000;
const when = (d) => (d ? new Date(new Date(d).getTime() + IST).toISOString().slice(0, 16).replace('T', ' ') : '—');

async function enquiryNamed(childName) {
  if (!childName) throw new AppError("Which enquiry? Give the child's name.", 400, [], 'AGENT_NEEDS_INPUT');
  const rows = await Lead.find({ childName: { $regex: String(childName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).select('childName guardianName stage gradeApplying contactConsent').limit(20).lean();
  return theNamed(rows, childName, { label: 'admission enquiry', nameOf: (l) => l.childName, describe: (l) => `${l.childName} (${l.guardianName}, ${l.stage.toLowerCase()})` });
}

export const p4MarketingTools = {
  get_followup_queue: {
    ...aRead, operation: 'GET', risk: RISK.LOW,
    description: "Today's admission follow-ups: overdue (next action passed), due today, never contacted after the first-response window, and enquiries with no next action. Each with an explained warmth score (HOT/WARM/COLD) and do-not-contact flags. mine=true for only your own enquiries.",
    inputSchema: closed({ mine: { type: 'boolean' } }), service: 'followups.queue()',
    async run(ctx, args) {
      const q = await followups.queue(ctx.actor, { mine: args.mine === true, limit: 50 });
      const top = [...q.overdue, ...q.today].slice(0, 5).map((r) => `${r.childName} (${r.band.toLowerCase()}${r.doNotContact ? ', do not contact' : ''})`);
      return ok(q, { speak: `${q.counts.overdue} overdue, ${q.counts.today} due today, ${q.counts.untouched} never contacted, ${q.counts.noNextAction} with no next action.${top.length ? ` First: ${top.join(', ')}.` : ''}` });
    },
  },

  get_enquiry_score: {
    ...aRead, operation: 'GET', risk: RISK.LOW,
    description: 'The warmth score of one admission enquiry (0-100, HOT/WARM/COLD) with every reason behind it, from the record: stage, recency of contact, visits, consent, how its source converts, seats left. Explains; decides nothing.',
    inputSchema: closed({ childName: text(80) }, ['childName']), service: 'followups.leadScore()',
    async run(_ctx, args) { const l = await enquiryNamed(args.childName); const s = await followups.leadScore(String(l._id)); return ok(s, { speak: `${s.childName}: ${s.score} (${s.band.toLowerCase()}) — ${s.reasons.join('; ')}.` }); },
  },

  log_admission_followup: {
    ...aManage, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Record a follow-up on an admission enquiry: how (call, WhatsApp, email, visit or a note), what was said, the next action date, and optionally the new stage (LOST needs a reason). A new enquiry moves to CONTACTED. Refused for a family that withdrew consent to be contacted (a note is still allowed).',
    inputSchema: closed({ childName: text(80), channel: { type: 'string', enum: CHANNELS }, outcome: text(2000), nextActionOn: dateStr('YYYY-MM-DD'), stage: { type: 'string', enum: STAGES }, lostReason: text(300) }, ['childName', 'outcome']),
    service: 'followups.logFollowUp()',
    async prepare(_ctx, args) { const l = await enquiryNamed(args.childName); return { id: String(l._id), childName: l.childName, guardianName: l.guardianName, stage: l.stage }; },
    summarise: (args, _a, p) => `Log a ${(args.channel ?? 'CALL').toLowerCase()} with ${p?.guardianName ?? 'the family'} about ${p?.childName ?? args.childName}: "${args.outcome}"${args.nextActionOn ? `; next action ${args.nextActionOn}` : ''}${args.stage ? `; stage ${p?.stage ?? ''} → ${args.stage}` : ''}`,
    async run(ctx, args, p) {
      const next = args.nextActionOn ? new Date(new Date(`${args.nextActionOn}T10:00:00Z`).getTime() - IST) : undefined;
      const r = await followups.logFollowUp(ctx.actor, p.id, { channel: args.channel, outcome: args.outcome, nextActionAt: next, stage: args.stage, lostReason: args.lostReason });
      return action({ type: 'admission_followup_logged', id: p.id, data: { stage: r.lead.stage }, speak: `Logged for ${p.childName}; stage ${r.lead.stage.toLowerCase()}.` });
    },
  },

  get_counsellor_stats: {
    ...aRead, operation: 'GET', risk: RISK.LOW,
    description: 'Per counsellor over a period (default 90 days): enquiries, open, overdue follow-ups, enrolled, lost, conversion and median first-response hours.',
    inputSchema: closed({ days: { type: 'integer', minimum: 7, maximum: 730 } }), service: 'followups.counsellorStats()',
    async run(_ctx, args) { const rows = await followups.counsellorStats({ days: args.days }); return ok({ rows }, { speak: rows.map((r) => `${r.name}: ${r.leads} enquiries, ${r.overdue} overdue, ${r.conversionPct ?? 0}% enrolled`).join('; ') || 'No enquiries in that period.' }); },
  },

  list_counselling_appointments: {
    ...aRead, operation: 'GET', risk: RISK.LOW,
    description: 'Upcoming counselling appointments, campus tours, interviews and entrance tests (mine=true for only yours).',
    inputSchema: closed({ mine: { type: 'boolean' } }), service: 'marketing.listAppointments()',
    async run(ctx, args) {
      const rows = (await marketing.listAppointments(ctx.actor, { upcoming: 'true', mine: args.mine ? 'true' : 'false' })).filter((a) => a.status === 'SCHEDULED');
      return ok({ count: rows.length, rows: rows.slice(0, 100) }, { speak: rows.length ? `${rows.length} upcoming; next: ${rows[0].kind.toLowerCase().replace('_', ' ')} with ${rows[0].guardianName ?? rows[0].childName} at ${when(rows[0].at)}.` : 'No upcoming appointments.' });
    },
  },

  create_counselling_appointment: {
    ...aManage, operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Book a counselling session, campus tour, interview, entrance test, call or document check for an enquiry, with you as the counsellor. A campus tour moves a new enquiry to TOUR_SCHEDULED. Refused if you already have an appointment then.',
    inputSchema: closed({ childName: text(80), kind: { type: 'string', enum: ['CALL', 'CAMPUS_TOUR', 'COUNSELLING', 'INTERVIEW', 'ENTRANCE_TEST', 'DOCUMENT_CHECK'] }, date: dateStr(), time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, durationMinutes: { type: 'integer', minimum: 10, maximum: 240 } }, ['childName', 'kind', 'date', 'time']),
    service: 'marketing.bookAppointment()',
    async prepare(_ctx, args) { const l = await enquiryNamed(args.childName); return { id: String(l._id), childName: l.childName, guardianName: l.guardianName }; },
    summarise: (args, _a, p) => `Book a ${args.kind.toLowerCase().replace('_', ' ')} for ${p?.childName ?? args.childName} (${p?.guardianName ?? ''}) on ${args.date} at ${args.time}, ${args.durationMinutes ?? 30} minutes, with you`,
    async run(ctx, args, p) {
      const at = new Date(new Date(`${args.date}T${args.time}:00Z`).getTime() - IST);
      const a = await marketing.bookAppointment(ctx.actor, { leadId: p.id, kind: args.kind, at: at.toISOString(), durationMinutes: args.durationMinutes });
      return action({ type: 'appointment_booked', id: a.id, speak: `Booked for ${args.date} ${args.time}.` });
    },
  },

  list_marketing_campaigns: {
    ...mRead, operation: 'GET', risk: RISK.LOW,
    description: 'Marketing campaigns: name, code, objective, channels, dates, status, budget and spend, and enquiries attributed.',
    inputSchema: closed({}), service: 'marketing.listCampaigns()',
    async run() { const rows = await marketing.listCampaigns(); return ok({ count: rows.length, rows }, { speak: `${rows.length} campaign(s); ${rows.filter((c) => c.status === 'ACTIVE').length} active.` }); },
  },

  create_marketing_campaign: {
    ...mManage, operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Create a marketing campaign (name, short code used on links and QR codes, objective, channels, dates, budget in rupees, grades). It records the plan; no money is spent and nothing is posted.',
    inputSchema: closed({
      name: text(160), code: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,40}$' }, objective: { type: 'string', enum: ['ENQUIRIES', 'EVENT_FOOTFALL', 'OPEN_HOUSE', 'BRAND', 'RE_ENGAGEMENT', 'OTHER'] },
      channels: { type: 'array', items: { type: 'string', enum: CAMPAIGN_CHANNELS }, maxItems: 11 }, startsOn: dateStr(), endsOn: dateStr(),
      budgetRupees: { type: 'number', minimum: 0, maximum: 100000000 }, grades: { type: 'array', items: text(60), maxItems: 20 }, audience: text(500),
    }, ['name', 'code', 'startsOn', 'endsOn']),
    service: 'marketing.createCampaign()',
    summarise: (args) => `Create campaign "${args.name}" (${String(args.code).toUpperCase()}), ${(args.objective ?? 'ENQUIRIES').toLowerCase().replace('_', ' ')}, ${args.startsOn} to ${args.endsOn}${args.budgetRupees ? `, budget ₹${args.budgetRupees.toLocaleString('en-IN')}` : ''}${args.channels?.length ? `, on ${args.channels.join(', ').toLowerCase()}` : ''}`,
    async run(ctx, args) {
      const c = await marketing.createCampaign(ctx.actor, { name: args.name, code: args.code, objective: args.objective, channels: args.channels, startsOn: args.startsOn, endsOn: args.endsOn, budgetPaise: Math.round((args.budgetRupees ?? 0) * 100), gradesOrProgrammes: args.grades, audience: args.audience });
      return action({ type: 'campaign_created', id: c.id, speak: `Campaign ${c.code} created (${String(c.status).toLowerCase()}).` });
    },
  },

  get_admission_capacity: {
    // Seats per grade are an admissions question ("admission capacity"); not the platform seats a school buys.
    ...mRead, module: 'Admissions', operation: 'GET', risk: RISK.LOW,
    description: 'Seats per grade for the intake: capacity, offered, accepted, available and utilisation.',
    inputSchema: closed({ academicYear: text(9) }), service: 'marketing.listCapacity()',
    async run(_ctx, args) { const rows = await marketing.listCapacity({ academicYear: args.academicYear }); return ok({ rows }, { speak: rows.length ? rows.map((r) => `${r.gradeOrProgramme}: ${r.available} free of ${r.capacity}`).join('; ') : 'No seat capacity is set up.' }); },
  },
};
