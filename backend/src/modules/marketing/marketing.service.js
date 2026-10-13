import { Campaign, CreativeAsset, IntakeCapacity, SeatOffer, CounsellingAppointment, ASSET_SIZES } from '../../models/marketing.model.js';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { notify } from '../notifications/notification.service.js';
import {
  requireProfile, assertObjectId, pushHistory, asPaise, parseDate, requireText, optionalText, oneOf, dto, startOfDayUtc,
} from '../ops/common.js';

/**
 * Marketing & admissions growth.
 *
 * Builds on the existing Lead (enquiry) records rather than duplicating them.
 * Adds campaigns with spend, creative assets whose factual claims must be
 * verified before approval, intake capacity with transactional seat offers
 * (no double allocation), counselling appointments, and funnel analytics.
 *
 * Marketing never sees student performance, health or welfare data, and
 * audience targeting is a description, never a sensitive profile.
 */

// ── Campaigns ────────────────────────────────────────────────────────────

const CHANNELS = ['SOCIAL', 'SEARCH', 'PRINT', 'OUTDOOR', 'RADIO', 'EVENT', 'REFERRAL', 'WHATSAPP', 'EMAIL', 'WEBSITE', 'OTHER'];

export async function createCampaign(actor, body = {}) {
  const startsOn = parseDate(body.startsOn, 'startsOn', { required: true });
  const endsOn = parseDate(body.endsOn, 'endsOn', { required: true });
  if (endsOn < startsOn) throw new AppError('endsOn must be after startsOn', 400);
  const c = new Campaign({
    name: requireText(body.name, 'name', { max: 160 }),
    code: requireText(body.code, 'code', { max: 40 }).toUpperCase().replace(/[^A-Z0-9_-]/g, '-'),
    objective: oneOf(body.objective, ['ENQUIRIES', 'EVENT_FOOTFALL', 'OPEN_HOUSE', 'BRAND', 'RE_ENGAGEMENT', 'OTHER'], 'objective', 'ENQUIRIES'),
    channels: Array.isArray(body.channels) ? body.channels.map((x) => oneOf(x, CHANNELS, 'channel')) : [],
    audience: optionalText(body.audience, { max: 500 }) || null,
    gradesOrProgrammes: Array.isArray(body.gradesOrProgrammes) ? body.gradesOrProgrammes.map((g) => String(g).slice(0, 60)).slice(0, 40) : [],
    academicYear: optionalText(body.academicYear, { max: 9 }) || null,
    startsOn, endsOn, budgetPaise: asPaise(body.budgetPaise ?? 0, 'budgetPaise'), ownerProfileId: actor.profileId,
    status: startsOn <= new Date() ? 'ACTIVE' : 'PLANNED',
  });
  pushHistory(c, actor, 'CREATED');
  try { await c.save(); } catch (err) { if (err?.code === 11000) throw new AppError('A campaign with that code exists', 409); throw err; }
  return dto(c);
}

export async function updateCampaign(actor, id, body = {}) {
  const c = await Campaign.findById(assertObjectId(id));
  if (!c) throw new AppError('Campaign not found', 404);
  if (body.status) c.status = oneOf(body.status, ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'], 'status');
  if (body.spentPaise !== undefined) {
    const spent = asPaise(body.spentPaise, 'spentPaise');
    if (spent > c.budgetPaise && !optionalText(body.note)) throw new AppError('Spend exceeds budget; add a note explaining it.', 400, [], 'REASON_REQUIRED');
    c.spentPaise = spent;
  }
  if (body.budgetPaise !== undefined) c.budgetPaise = asPaise(body.budgetPaise, 'budgetPaise');
  pushHistory(c, actor, 'UPDATED', { note: body.note });
  await c.save();
  return dto(c);
}

export async function listCampaigns() {
  const rows = await Campaign.find({}).sort({ startsOn: -1 }).lean();
  const ids = rows.map((r) => r._id);
  const [leads, enrolled] = await Promise.all([
    Lead.aggregate([{ $match: { campaignId: { $in: ids } } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { campaignId: { $in: ids }, stage: 'ENROLLED' } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }]),
  ]);
  const l = new Map(leads.map((x) => [String(x._id), x.n]));
  const e = new Map(enrolled.map((x) => [String(x._id), x.n]));
  return rows.map((r) => {
    const enquiries = l.get(String(r._id)) ?? 0;
    const enrolments = e.get(String(r._id)) ?? 0;
    return {
      ...dto(r), enquiries, enrolments,
      costPerEnquiryPaise: enquiries ? Math.round(r.spentPaise / enquiries) : null,
      costPerEnrolmentPaise: enrolments ? Math.round(r.spentPaise / enrolments) : null,
      // Attribution here is last-touch: the campaign recorded on the enquiry.
      attribution: 'LAST_TOUCH_RECORDED_ON_ENQUIRY',
    };
  });
}

// ── Creative assets ──────────────────────────────────────────────────────

export async function createAsset(actor, body = {}) {
  const a = new CreativeAsset({
    campaignId: body.campaignId ? assertObjectId(body.campaignId, 'campaignId') : null,
    kind: oneOf(body.kind, ['POSTER', 'BANNER', 'SOCIAL_POST', 'BROCHURE', 'VIDEO', 'LANDING_PAGE', 'OTHER'], 'kind'),
    title: requireText(body.title, 'title', { max: 160 }),
    size: oneOf(body.size, Object.keys(ASSET_SIZES), 'size', 'OTHER'),
    headline: optionalText(body.headline, { max: 200 }) || null,
    copy: optionalText(body.copy, { max: 5000 }) || null,
    callToAction: optionalText(body.callToAction, { max: 120 }) || null,
    altText: optionalText(body.altText, { max: 500 }) || null,
    claims: Array.isArray(body.claims) ? body.claims.slice(0, 20).map((c) => ({ text: requireText(c.text ?? c, 'claim', { max: 300 }), verified: false })) : [],
    aiAssisted: body.aiAssisted === true,
  });
  if (body.url) a.versions.push({ version: 1, url: String(body.url).slice(0, 1000), byProfileId: actor.profileId });
  pushHistory(a, actor, 'CREATED');
  await a.save();
  return { ...dto(a), dimensions: ASSET_SIZES[a.size] };
}

export async function updateAsset(actor, id, body = {}) {
  const a = await CreativeAsset.findById(assertObjectId(id));
  if (!a) throw new AppError('Asset not found', 404);
  for (const f of ['headline', 'copy', 'callToAction', 'altText']) if (body[f] !== undefined) a[f] = optionalText(body[f], { max: 5000 }) || null;
  if (body.url) a.versions.push({ version: (a.versions.at(-1)?.version ?? 0) + 1, url: String(body.url).slice(0, 1000), note: optionalText(body.versionNote, { max: 300 }) || null, byProfileId: actor.profileId });
  if (Array.isArray(body.claims)) a.claims = body.claims.slice(0, 20).map((c) => ({ text: requireText(c.text, 'claim', { max: 300 }), verified: c.verified === true && Boolean(c.evidence), evidence: optionalText(c.evidence, { max: 500 }) || null, verifiedByProfileId: c.verified ? actor.profileId : null }));
  if (Array.isArray(body.featuredStudentIds)) a.featuredStudentIds = body.featuredStudentIds.map((x) => assertObjectId(x, 'featuredStudentIds'));
  if (body.status) {
    const to = oneOf(body.status, ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'], 'status');
    if (to === 'APPROVED') {
      if (a.claims.some((c) => !c.verified)) throw new AppError('Every factual claim needs verified evidence before approval.', 409, [], 'CLAIMS_UNVERIFIED');
      if (!a.altText && ['POSTER', 'BANNER', 'SOCIAL_POST'].includes(a.kind)) throw new AppError('Add alt text so the asset is accessible.', 400);
      if (a.featuredStudentIds.length) {
        const { MediaConsent } = await import('../../models/community.model.js');
        const ok = await MediaConsent.countDocuments({ studentId: { $in: a.featuredStudentIds }, level: 'PUBLIC', withdrawnAt: null });
        if (ok < a.featuredStudentIds.length) throw new AppError('A featured student has no public media consent.', 409, [], 'CONSENT_MISSING');
      }
      // The reviewer cannot be the asset's last editor.
      const lastEditor = a.versions.at(-1)?.byProfileId;
      if (lastEditor && String(lastEditor) === String(actor.profileId)) throw new AppError('Another person must review and approve this asset.', 403, [], 'SELF_REVIEW');
      a.reviewedByProfileId = actor.profileId;
    }
    if (to === 'PUBLISHED') {
      if (a.status !== 'APPROVED') throw new AppError('Only an approved asset can be published.', 409);
      a.publishedTo.push({ channel: requireText(body.channel, 'channel', { max: 40 }), at: new Date(), url: optionalText(body.publishedUrl, { max: 1000 }) || null });
    }
    pushHistory(a, actor, to, { from: a.status, to });
    a.status = to;
  }
  await a.save();
  return { ...dto(a), dimensions: ASSET_SIZES[a.size] };
}

export async function listAssets(query = {}) {
  const filter = {};
  if (query.campaignId) filter.campaignId = assertObjectId(query.campaignId);
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await CreativeAsset.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
  return rows.map((a) => ({ ...dto(a), dimensions: ASSET_SIZES[a.size] }));
}

export function assetSizes() { return ASSET_SIZES; }

// ── Leads: consent, response time, duplicates ────────────────────────────

/** Extra enquiry details the original CRM did not hold. */
export async function updateLeadMarketing(actor, leadId, body = {}) {
  const lead = await Lead.findById(assertObjectId(leadId, 'leadId'));
  if (!lead) throw new AppError('Lead not found', 404);
  if (body.campaignId !== undefined) lead.campaignId = body.campaignId ? assertObjectId(body.campaignId) : null;
  if (body.sourceDetail !== undefined) lead.sourceDetail = optionalText(body.sourceDetail, { max: 200 }) || null;
  if (body.academicYear !== undefined) lead.academicYear = optionalText(body.academicYear, { max: 9 }) || null;
  if (body.programme !== undefined) lead.programme = optionalText(body.programme, { max: 120 }) || null;
  if (body.lostReason !== undefined) lead.lostReason = optionalText(body.lostReason, { max: 500 }) || null;
  if (body.contactConsent !== undefined) {
    if (body.contactConsent === false) lead.contactConsent = { ...(lead.contactConsent?.toObject?.() ?? {}), withdrawnAt: new Date() };
    else lead.contactConsent = { given: true, channels: Array.isArray(body.contactConsent.channels) ? body.contactConsent.channels.map((c) => String(c).toUpperCase().slice(0, 20)) : ['PHONE'], at: new Date(), withdrawnAt: null };
  }
  if (body.responded === true && !lead.firstResponseAt) lead.firstResponseAt = new Date();
  await lead.save();
  return dto(lead);
}

const digits = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

/** Enquiries that share a phone number (last 10 digits) — likely duplicates to merge by hand. */
export async function duplicateLeads() {
  const rows = await Lead.find({}).select('childName guardianName phone stage createdAt').lean();
  const groups = new Map();
  for (const r of rows) {
    const k = digits(r.phone);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.map((r) => ({ id: String(r._id), childName: r.childName, guardianName: r.guardianName, stage: r.stage, createdAt: r.createdAt })));
}

// ── Capacity & seat offers ───────────────────────────────────────────────

export async function setCapacity(actor, body = {}) {
  const academicYear = requireText(body.academicYear, 'academicYear', { max: 9 });
  const gradeOrProgramme = requireText(body.gradeOrProgramme, 'gradeOrProgramme', { max: 80 });
  const capacity = Number.parseInt(body.capacity, 10);
  if (!Number.isInteger(capacity) || capacity < 0) throw new AppError('capacity must be a whole number', 400);
  const reserved = Array.isArray(body.reserved) ? body.reserved.slice(0, 10).map((r) => ({ category: requireText(r.category, 'category', { max: 40 }).toUpperCase(), seats: Math.max(0, Number.parseInt(r.seats, 10) || 0), note: optionalText(r.note, { max: 300 }) || null })) : [];
  if (reserved.reduce((n, r) => n + r.seats, 0) > capacity) throw new AppError('Reserved seats exceed capacity', 400);
  const existing = await IntakeCapacity.findOne({ academicYear, gradeOrProgramme }).lean();
  if (existing && capacity < existing.offered + existing.accepted) throw new AppError(`Capacity cannot drop below seats already offered/accepted (${existing.offered + existing.accepted}).`, 409);
  const doc = await IntakeCapacity.findOneAndUpdate({ academicYear, gradeOrProgramme }, { $set: { capacity, reserved }, $setOnInsert: { offered: 0, accepted: 0 } }, { upsert: true, new: true }).lean();
  return { ...dto(doc), available: doc.capacity - doc.offered - doc.accepted };
}

export async function listCapacity(query = {}) {
  const rows = await IntakeCapacity.find(query.academicYear ? { academicYear: String(query.academicYear) } : {}).sort({ gradeOrProgramme: 1 }).lean();
  return rows.map((r) => ({ ...dto(r), available: r.capacity - r.offered - r.accepted, utilisationPct: r.capacity ? Math.round(((r.offered + r.accepted) / r.capacity) * 100) : null }));
}

/**
 * Offers a seat, or waitlists when none is free. Seat accounting runs in a
 * transaction with a conditional increment, so two counsellors offering the
 * last seat at once cannot both succeed.
 */
export async function offerSeat(actor, body = {}) {
  requireProfile(actor);
  const leadId = assertObjectId(body.leadId, 'leadId');
  const academicYear = requireText(body.academicYear, 'academicYear', { max: 9 });
  const gradeOrProgramme = requireText(body.gradeOrProgramme, 'gradeOrProgramme', { max: 80 });
  const category = optionalText(body.category, { max: 40 })?.toUpperCase() || 'GENERAL';
  return runInAmbientTransaction(async () => {
    const lead = await Lead.findById(leadId);
    if (!lead) throw new AppError('Lead not found', 404);
    if (await SeatOffer.exists({ leadId, academicYear, status: { $nin: ['DECLINED', 'EXPIRED', 'WITHDRAWN'] } })) throw new AppError('This applicant already has an offer or waitlist place for that year.', 409, [], 'DUPLICATE_OFFER');
    const cap = await IntakeCapacity.findOne({ academicYear, gradeOrProgramme }).lean();
    if (!cap) throw new AppError('Set the intake capacity for this class/programme first.', 409, [], 'NO_CAPACITY');
    const reservedForOthers = cap.reserved.filter((r) => r.category !== category).reduce((n, r) => n + r.seats, 0);
    const reservedMine = cap.reserved.find((r) => r.category === category)?.seats ?? 0;
    // Seats reserved for other categories are not available to this one.
    const limit = cap.capacity - reservedForOthers;
    const won = await IntakeCapacity.findOneAndUpdate(
      { _id: cap._id, $expr: { $lt: [{ $add: ['$offered', '$accepted'] }, limit] } },
      { $inc: { offered: 1 } }, { new: true },
    );
    const offer = new SeatOffer({ leadId, academicYear, gradeOrProgramme, category, status: won ? 'OFFERED' : 'WAITLISTED' });
    if (won) offer.offerExpiresOn = parseDate(body.offerExpiresOn, 'offerExpiresOn') ?? new Date(Date.now() + 7 * 86_400_000);
    else offer.waitlistPosition = (await SeatOffer.countDocuments({ academicYear, gradeOrProgramme, status: 'WAITLISTED' })) + 1;
    pushHistory(offer, actor, offer.status, { note: reservedMine ? `${category} category` : null });
    await offer.save();
    await LeadInteraction.create({ leadId, type: 'STAGE_CHANGE', body: won ? `Seat offered (${gradeOrProgramme}, ${academicYear})` : `Waitlisted #${offer.waitlistPosition}`, authorProfileId: actor.profileId });
    return dto(offer);
  });
}

const OFFER_MACHINE = {
  WAITLISTED: ['OFFERED', 'WITHDRAWN'],
  OFFERED: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'],
  ACCEPTED: ['FEE_PAID', 'WITHDRAWN'],
  FEE_PAID: ['ENROLLED', 'WITHDRAWN'],
  ENROLLED: [], DECLINED: [], EXPIRED: [], WITHDRAWN: [],
};

/**
 * Moves an offer along. FEE_PAID requires the invoice that was paid (the fee
 * module is the source of truth for money); ENROLLED requires the student record.
 */
export async function moveOffer(actor, id, body = {}) {
  return runInAmbientTransaction(async () => {
    const o = await SeatOffer.findById(assertObjectId(id));
    if (!o) throw new AppError('Offer not found', 404);
    const to = oneOf(body.to, Object.keys(OFFER_MACHINE), 'to');
    if (!OFFER_MACHINE[o.status].includes(to)) throw new AppError(`An offer cannot move from ${o.status} to ${to}.`, 409, [], 'INVALID_TRANSITION');
    const capFilter = { academicYear: o.academicYear, gradeOrProgramme: o.gradeOrProgramme };
    if (to === 'OFFERED') {
      const cap = await IntakeCapacity.findOne(capFilter).lean();
      const won = await IntakeCapacity.findOneAndUpdate({ ...capFilter, $expr: { $lt: [{ $add: ['$offered', '$accepted'] }, cap?.capacity ?? 0] } }, { $inc: { offered: 1 } }, { new: true });
      if (!won) throw new AppError('No seat is free.', 409, [], 'NO_SEAT');
      o.waitlistPosition = null;
      o.offerExpiresOn = new Date(Date.now() + 7 * 86_400_000);
    }
    if (to === 'ACCEPTED') await IntakeCapacity.updateOne(capFilter, { $inc: { offered: -1, accepted: 1 } });
    if (['DECLINED', 'EXPIRED'].includes(to) || (to === 'WITHDRAWN' && o.status === 'OFFERED')) await IntakeCapacity.updateOne(capFilter, { $inc: { offered: -1 } });
    if (to === 'WITHDRAWN' && ['ACCEPTED', 'FEE_PAID'].includes(o.status)) await IntakeCapacity.updateOne(capFilter, { $inc: { accepted: -1 } });
    if (to === 'FEE_PAID') {
      const { Invoice } = await import('../../models/fee.model.js');
      const inv = await Invoice.findById(assertObjectId(body.invoiceId, 'invoiceId')).lean();
      if (!inv) throw new AppError('Invoice not found', 404);
      if (!['PAID'].includes(inv.status)) throw new AppError('That invoice is not paid in the fees module.', 409, [], 'NOT_PAID');
      o.invoiceId = inv._id;
    }
    if (to === 'ENROLLED') o.studentId = assertObjectId(body.studentId, 'studentId');
    pushHistory(o, actor, to, { from: o.status, to, note: body.note });
    o.status = to;
    await o.save();
    if (to === 'ENROLLED') await Lead.updateOne({ _id: o.leadId }, { $set: { stage: 'ENROLLED' } });
    if (to === 'DECLINED' || to === 'WITHDRAWN') await Lead.updateOne({ _id: o.leadId }, { $set: { stage: 'LOST', lostReason: optionalText(body.note, { max: 500 }) || to.toLowerCase() } });
    return dto(o);
  });
}

export async function listOffers(query = {}) {
  const filter = {};
  if (query.academicYear) filter.academicYear = String(query.academicYear);
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await SeatOffer.find(filter).sort({ status: 1, waitlistPosition: 1, createdAt: 1 }).populate('leadId', 'childName guardianName phone').lean();
  return rows.map((o) => ({ ...dto(o), leadId: String(o.leadId?._id ?? o.leadId), childName: o.leadId?.childName, guardianName: o.leadId?.guardianName }));
}

// ── Appointments ─────────────────────────────────────────────────────────

export async function bookAppointment(actor, body = {}) {
  const at = parseDate(body.at, 'at', { required: true });
  const counsellorProfileId = body.counsellorProfileId ? assertObjectId(body.counsellorProfileId) : actor.profileId;
  const durationMinutes = Math.max(10, Math.min(Number.parseInt(body.durationMinutes, 10) || 30, 240));
  const end = new Date(at.getTime() + durationMinutes * 60_000);
  const clash = await CounsellingAppointment.findOne({ counsellorProfileId, status: 'SCHEDULED', at: { $lt: end, $gte: new Date(at.getTime() - 240 * 60_000) } }).lean();
  if (clash && new Date(clash.at.getTime() + clash.durationMinutes * 60_000) > at) throw new AppError('The counsellor already has an appointment then.', 409, [], 'APPOINTMENT_CLASH');
  const a = await CounsellingAppointment.create({ leadId: assertObjectId(body.leadId, 'leadId'), counsellorProfileId, kind: oneOf(body.kind, ['CALL', 'CAMPUS_TOUR', 'COUNSELLING', 'INTERVIEW', 'ENTRANCE_TEST', 'DOCUMENT_CHECK'], 'kind'), at, durationMinutes });
  await Lead.updateOne({ _id: a.leadId, firstResponseAt: null }, { $set: { firstResponseAt: new Date() } });
  if (a.kind === 'CAMPUS_TOUR') await Lead.updateOne({ _id: a.leadId, stage: { $in: ['NEW', 'CONTACTED'] } }, { $set: { stage: 'TOUR_SCHEDULED' } });
  if (String(counsellorProfileId) !== String(actor.profileId)) await notify({ recipientProfileIds: [String(counsellorProfileId)], type: 'SYSTEM', title: `New ${a.kind.toLowerCase().replace('_', ' ')}`, body: at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', link: '/marketing?tab=appointments' });
  return dto(a);
}

export async function updateAppointment(actor, id, body = {}) {
  const a = await CounsellingAppointment.findById(assertObjectId(id));
  if (!a) throw new AppError('Appointment not found', 404);
  a.status = oneOf(body.status, ['SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED'], 'status');
  a.outcome = optionalText(body.outcome, { max: 1000 }) || a.outcome;
  await a.save();
  return dto(a);
}

export async function listAppointments(actor, query = {}) {
  const filter = query.mine === 'true' ? { counsellorProfileId: actor.profileId } : {};
  if (query.upcoming === 'true') filter.at = { $gte: startOfDayUtc() };
  const rows = await CounsellingAppointment.find(filter).sort({ at: 1 }).limit(500).populate('leadId', 'childName guardianName').lean();
  return rows.map((a) => ({ ...dto(a), leadId: String(a.leadId?._id ?? a.leadId), childName: a.leadId?.childName, guardianName: a.leadId?.guardianName }));
}

// ── Analytics ────────────────────────────────────────────────────────────

const ORDER = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED'];

/**
 * Funnel and response metrics. Each metric names its definition; counts of
 * zero and "no data" are kept distinct.
 */
export async function analytics({ from, to } = {}) {
  const f = parseDate(from, 'from');
  const t = parseDate(to, 'to');
  const match = {};
  if (f || t) match.createdAt = { ...(f ? { $gte: f } : {}), ...(t ? { $lt: t } : {}) };
  const leads = await Lead.find(match).select('stage source campaignId createdAt firstResponseAt').lean();
  const reached = (stage) => leads.filter((l) => l.stage !== 'LOST' && ORDER.indexOf(l.stage) >= ORDER.indexOf(stage)).length;
  const funnel = ORDER.map((s) => ({ stage: s, count: reached(s) }));
  const bySource = {};
  for (const l of leads) {
    const s = l.source || 'UNKNOWN';
    bySource[s] = bySource[s] ?? { source: s, enquiries: 0, enrolled: 0 };
    bySource[s].enquiries += 1;
    if (l.stage === 'ENROLLED') bySource[s].enrolled += 1;
  }
  const responded = leads.filter((l) => l.firstResponseAt);
  const hours = responded.map((l) => (new Date(l.firstResponseAt) - new Date(l.createdAt)) / 3600_000).sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;
  const [capacity, offers] = await Promise.all([listCapacity({}), SeatOffer.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])]);
  const offerCounts = Object.fromEntries(offers.map((o) => [o._id, o.n]));
  return {
    window: { from: f, to: t },
    enquiries: leads.length,
    lost: leads.filter((l) => l.stage === 'LOST').length,
    funnel,
    conversionPct: leads.length ? Math.round((reached('ENROLLED') / leads.length) * 1000) / 10 : null,
    bySource: Object.values(bySource).sort((a, b) => b.enquiries - a.enquiries),
    response: {
      definition: 'Hours from enquiry creation to first recorded response (appointment or marked response); unresponded enquiries excluded from the median and counted separately.',
      medianHours: median === null ? null : Math.round(median * 10) / 10,
      unresponded: leads.length - responded.length,
    },
    offers: offerCounts,
    capacity,
    dataNotes: leads.some((l) => !l.firstResponseAt && l.stage !== 'NEW') ? ['Some enquiries moved stage without a recorded first response; response time is understated for them.'] : [],
  };
}
