import mongoose from 'mongoose';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { CounsellingAppointment } from '../../models/marketing.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { updateLead } from '../admissions/admission.service.js';
import { listCapacity } from './marketing.service.js';

/**
 * Admissions follow-ups, part 4: the counsellor's day.
 *
 *   queue      every open enquiry that needs a touch today, in four buckets:
 *              overdue (next action passed), due today, never contacted past the
 *              first-response window (FIRST_RESPONSE_HOURS), and no next action set
 *   log        record a call / WhatsApp / visit with its outcome and the next
 *              action date (and, optionally, the stage) in one step
 *   score      an explainable warmth score per enquiry: each point has a reason
 *              drawn from the record (stage, recency, visits, consent, how this
 *              source converts, seats left). It ranks the queue; a person decides.
 *   counsellors  per counsellor: open enquiries, overdue, first-response time,
 *              conversion. For the admissions head.
 *
 * Contact rules hold: an enquiry whose contact consent was withdrawn is listed
 * but marked do-not-contact, and logging a WhatsApp/call to it is refused.
 */

export const FIRST_RESPONSE_HOURS = 24;
const DAY = 86_400_000;
const IST = 330 * 60_000;
const OPEN = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION'];
const CHANNELS = ['CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'NOTE'];
const endOfIstToday = (now = new Date()) => new Date(Math.floor((now.getTime() + IST) / DAY) * DAY + DAY - IST - 1);
const oid = (v, label) => {
  if (!v || !mongoose.isValidObjectId(String(v))) throw new AppError(`Invalid ${label}`, 400, [], 'INVALID_ID');
  return String(v);
};
const doNotContact = (l) => Boolean(l.contactConsent?.withdrawnAt) || l.contactConsent?.given === false;

/** Conversion rate of each source over the last year (enrolled / enquiries), for the score. */
async function sourceRates(now = new Date()) {
  const rows = await Lead.aggregate([
    { $match: { createdAt: { $gte: new Date(now.getTime() - 365 * DAY) } } },
    { $group: { _id: '$source', n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$stage', 'ENROLLED'] }, 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [r._id ?? 'UNKNOWN', r.n >= 5 ? r.won / r.n : null]));
}

async function seatsLeft() {
  const cap = await listCapacity({}).catch(() => []);
  return new Map(cap.map((c) => [String(c.gradeOrProgramme).toLowerCase(), c.available]));
}

/** The explainable score: 0-100 with the reasons that make it up. */
export function scoreLead(l, { lastTouchAt = null, visits = 0, noShows = 0, rates = new Map(), seats = new Map(), now = new Date() } = {}) {
  const reasons = [];
  let s = 20;
  const stagePts = { NEW: 0, CONTACTED: 10, TOUR_SCHEDULED: 25, APPLICATION: 35 }[l.stage] ?? 0;
  if (stagePts) { s += stagePts; reasons.push(`+${stagePts} stage ${l.stage.toLowerCase().replace('_', ' ')}`); }
  if (visits) { const p = Math.min(visits * 8, 16); s += p; reasons.push(`+${p} ${visits} visit/counselling session(s) done`); }
  if (noShows) { const p = Math.min(noShows * 8, 16); s -= p; reasons.push(`-${p} ${noShows} missed appointment(s)`); }
  const last = lastTouchAt ?? l.firstResponseAt ?? null;
  const idleDays = last ? Math.floor((now - new Date(last)) / DAY) : Math.floor((now - new Date(l.createdAt)) / DAY);
  if (idleDays <= 3) { s += 10; reasons.push(`+10 in touch within ${idleDays} day(s)`); } else if (idleDays > 14) { s -= 15; reasons.push(`-15 no contact for ${idleDays} days`); } else if (idleDays > 7) { s -= 5; reasons.push(`-5 no contact for ${idleDays} days`); }
  const rate = rates.get(l.source ?? 'UNKNOWN');
  if (rate !== null && rate !== undefined) { const p = Math.round((rate - 0.15) * 40); if (p) { s += p; reasons.push(`${p > 0 ? '+' : ''}${p} ${String(l.source).toLowerCase()} enquiries convert at ${Math.round(rate * 100)}%`); } }
  if (l.contactConsent?.given) { s += 5; reasons.push('+5 consent to contact recorded'); }
  if (doNotContact(l)) { s -= 30; reasons.push('-30 consent to contact withdrawn: do not contact'); }
  const left = l.gradeApplying ? seats.get(String(l.gradeApplying).toLowerCase()) : undefined;
  if (left !== undefined && left <= 0) { s -= 10; reasons.push(`-10 no seats left in ${l.gradeApplying} (waitlist)`); }
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, band: score >= 65 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD', reasons };
}

function row(l, extra) {
  return {
    id: String(l._id), childName: l.childName, guardianName: l.guardianName, phone: l.phone, gradeApplying: l.gradeApplying ?? null, source: l.source,
    stage: l.stage, nextActionAt: l.nextActionAt ?? null, createdAt: l.createdAt, firstResponseAt: l.firstResponseAt ?? null,
    assigneeProfileId: l.assigneeProfileId ? String(l.assigneeProfileId) : null, doNotContact: doNotContact(l), ...extra,
  };
}

export async function queue(actor, { mine = false, limit = 200, now = new Date() } = {}) {
  const filter = { stage: { $in: OPEN } };
  if (mine === true || mine === 'true') filter.assigneeProfileId = actor?.profileId ?? null;
  const leads = await Lead.find(filter).sort({ nextActionAt: 1, createdAt: 1 }).limit(2000).lean();
  const ids = leads.map((l) => l._id);
  const [touches, appts, rates, seats, people] = await Promise.all([
    LeadInteraction.aggregate([{ $match: { leadId: { $in: ids } } }, { $group: { _id: '$leadId', last: { $max: '$createdAt' } } }]),
    CounsellingAppointment.aggregate([{ $match: { leadId: { $in: ids } } }, { $group: { _id: '$leadId', done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } }, noShow: { $sum: { $cond: [{ $eq: ['$status', 'NO_SHOW'] }, 1, 0] } }, next: { $min: { $cond: [{ $and: [{ $eq: ['$status', 'SCHEDULED'] }, { $gte: ['$at', now] }] }, '$at', null] } } } }]),
    sourceRates(now), seatsLeft(),
    Profile.find({ _id: { $in: [...new Set(leads.map((l) => l.assigneeProfileId).filter(Boolean))] } }).select('displayName').lean(),
  ]);
  const lastBy = new Map(touches.map((t) => [String(t._id), t.last]));
  const apptBy = new Map(appts.map((a) => [String(a._id), a]));
  const nameBy = new Map(people.map((p) => [String(p._id), p.displayName]));
  const eod = endOfIstToday(now);
  const buckets = { overdue: [], today: [], untouched: [], noNextAction: [] };
  for (const l of leads) {
    const a = apptBy.get(String(l._id));
    const sc = scoreLead(l, { lastTouchAt: lastBy.get(String(l._id)), visits: a?.done ?? 0, noShows: a?.noShow ?? 0, rates, seats, now });
    const r = row(l, { ...sc, assignee: l.assigneeProfileId ? nameBy.get(String(l.assigneeProfileId)) ?? null : null, lastTouchAt: lastBy.get(String(l._id)) ?? null, nextAppointmentAt: a?.next ?? null });
    if (l.nextActionAt && new Date(l.nextActionAt) < new Date(eod.getTime() - DAY + 1)) buckets.overdue.push(r);
    else if (l.nextActionAt && new Date(l.nextActionAt) <= eod) buckets.today.push(r);
    else if (!l.firstResponseAt && !lastBy.get(String(l._id)) && now - new Date(l.createdAt) > FIRST_RESPONSE_HOURS * 3600_000) buckets.untouched.push(r);
    else if (!l.nextActionAt && !a?.next) buckets.noNextAction.push(r);
  }
  const cap = Math.min(Number(limit) || 200, 500);
  for (const k of Object.keys(buckets)) buckets[k] = buckets[k].sort((x, y) => y.score - x.score).slice(0, cap);
  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    ...buckets,
    rules: { firstResponseHours: FIRST_RESPONSE_HOURS, scoring: 'Each point in a score has a reason from the record; the score orders the list and decides nothing.' },
  };
}

export async function leadScore(leadId, { now = new Date() } = {}) {
  const l = await Lead.findById(oid(leadId, 'enquiry id')).lean();
  if (!l) throw new AppError('Enquiry not found', 404);
  const [last, appts, rates, seats] = await Promise.all([
    LeadInteraction.findOne({ leadId: l._id }).sort({ createdAt: -1 }).select('createdAt').lean(),
    CounsellingAppointment.find({ leadId: l._id }).select('status').lean(), sourceRates(now), seatsLeft(),
  ]);
  return { ...row(l), ...scoreLead(l, { lastTouchAt: last?.createdAt, visits: appts.filter((a) => a.status === 'DONE').length, noShows: appts.filter((a) => a.status === 'NO_SHOW').length, rates, seats, now }) };
}

/**
 * Logs a follow-up (what was done and said), sets the next action, and
 * optionally moves the stage through the admissions service, so an ENROLLED
 * move still creates the student exactly as the CRM board does.
 */
export async function logFollowUp(actor, leadId, { channel = 'CALL', outcome, nextActionAt, stage, lostReason } = {}) {
  if (!CHANNELS.includes(channel)) throw new AppError(`channel must be one of ${CHANNELS.join(', ')}`, 400);
  const summary = String(outcome ?? '').trim();
  if (!summary) throw new AppError('Write what happened on the follow-up.', 400, [], 'OUTCOME_REQUIRED');
  const lead = await Lead.findById(oid(leadId, 'enquiry id'));
  if (!lead) throw new AppError('Enquiry not found', 404);
  if (doNotContact(lead) && ['CALL', 'WHATSAPP', 'EMAIL'].includes(channel)) {
    throw new AppError('This family withdrew consent to be contacted. Record a note instead, or ask them to give consent again.', 409, [], 'CONTACT_CONSENT_WITHDRAWN');
  }
  let next;
  if (nextActionAt !== undefined && nextActionAt !== null && nextActionAt !== '') {
    next = new Date(nextActionAt);
    if (Number.isNaN(next.getTime())) throw new AppError('nextActionAt is not a valid date', 400);
  }
  if (stage === 'LOST' && !String(lostReason ?? '').trim()) throw new AppError('Say why the enquiry was lost.', 400, [], 'LOST_REASON_REQUIRED');
  const interaction = await LeadInteraction.create({ leadId: lead._id, type: channel, body: summary.slice(0, 2000), authorProfileId: actor?.profileId ?? null });
  if (!lead.firstResponseAt && channel !== 'NOTE') await Lead.updateOne({ _id: lead._id, firstResponseAt: null }, { $set: { firstResponseAt: new Date() } });
  if (stage === 'LOST') await Lead.updateOne({ _id: lead._id }, { $set: { lostReason: String(lostReason).slice(0, 300) } });
  const updated = await updateLead({
    leadId: lead._id, actorProfileId: actor?.profileId ?? null,
    ...(stage ? { stage } : (lead.stage === 'NEW' && channel !== 'NOTE' ? { stage: 'CONTACTED' } : {})),
    ...(next !== undefined ? { nextActionAt: next } : {}),
  });
  await recordAudit({ actor, action: 'admissions.followup.log', entityType: 'Lead', entityId: lead._id, after: { channel, stage: updated.stage, nextActionAt: next ?? null } });
  return { interactionId: String(interaction._id), lead: updated };
}

export async function counsellorStats({ days = 90, now = new Date() } = {}) {
  const since = new Date(now.getTime() - Math.min(Math.max(Number(days) || 90, 7), 730) * DAY);
  const leads = await Lead.find({ createdAt: { $gte: since } }).select('assigneeProfileId stage createdAt firstResponseAt nextActionAt').lean();
  const eod = endOfIstToday(now);
  const by = new Map();
  for (const l of leads) {
    const k = l.assigneeProfileId ? String(l.assigneeProfileId) : 'UNASSIGNED';
    if (!by.has(k)) by.set(k, { leads: 0, open: 0, overdue: 0, enrolled: 0, lost: 0, responseHours: [] });
    const b = by.get(k);
    b.leads += 1;
    if (OPEN.includes(l.stage)) { b.open += 1; if (l.nextActionAt && new Date(l.nextActionAt) < new Date(eod.getTime() - DAY + 1)) b.overdue += 1; }
    if (l.stage === 'ENROLLED') b.enrolled += 1;
    if (l.stage === 'LOST') b.lost += 1;
    if (l.firstResponseAt) b.responseHours.push((new Date(l.firstResponseAt) - new Date(l.createdAt)) / 3600_000);
  }
  const people = await Profile.find({ _id: { $in: [...by.keys()].filter((k) => k !== 'UNASSIGNED') } }).select('displayName').lean();
  const nameBy = new Map(people.map((p) => [String(p._id), p.displayName]));
  return [...by.entries()].map(([k, b]) => {
    const h = b.responseHours.sort((x, y) => x - y);
    return { profileId: k === 'UNASSIGNED' ? null : k, name: k === 'UNASSIGNED' ? 'Unassigned' : nameBy.get(k) ?? 'Unknown', leads: b.leads, open: b.open, overdue: b.overdue, enrolled: b.enrolled, lost: b.lost, conversionPct: b.leads ? Math.round((b.enrolled / b.leads) * 1000) / 10 : null, medianFirstResponseHours: h.length ? Math.round(h[Math.floor(h.length / 2)] * 10) / 10 : null };
  }).sort((a, b) => b.leads - a.leads);
}
