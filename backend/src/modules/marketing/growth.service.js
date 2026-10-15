import mongoose from 'mongoose';
import { OfflineCampaign, HeardFromOption, LeadTouch, AdMetric, MarketingSetting, OFFLINE_CHANNELS, OFFLINE_STATUSES, TOUCH_VIA } from '../../models/marketingGrowth.model.js';
import { Campaign, CounsellingAppointment } from '../../models/marketing.model.js';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { OnlineApplication } from '../../models/onlineApplication.model.js';
import { Bill } from '../../models/bill.model.js';
import { AppError } from '../../utils/AppError.js';
import {
  requireProfile, assertObjectId, pushHistory, toPaise, asPaise, parseDate, requireText, optionalText, oneOf, dto,
  cleanAttachments,
} from '../ops/common.js';

/**
 * Offline marketing and lead attribution.
 *
 * An offline campaign (banner, pamphlet, poster, newspaper ad, radio spot,
 * local TV, open house, seminar, referral drive, society activation, fair
 * stall) has placements, dates, quantity, vendor and cost, creative files, and
 * goes through approval by a second person before it runs. Its tracking code
 * is the short link / QR target and the utm_campaign of the online form; a
 * tracking phone number, a promo code, or a "how did you hear about us"
 * answer recorded at enquiry trace an enquiry back to it as well.
 *
 * Each trace is one LeadTouch. An enquiry is credited to its EARLIEST touch
 * (the thing that brought the family in); later touches are kept as history.
 * Results — enquiries, visits, applications, admissions, cost per enquiry and
 * per admission, ROI — are computed from the CRM records, never typed in.
 */

export const CHANNEL_LABELS = {
  BANNER_HOARDING: 'Banner / hoarding', PAMPHLET_FLYER: 'Pamphlet / flyer', POSTER: 'Poster', NEWSPAPER_AD: 'Newspaper ad',
  RADIO_SPOT: 'Radio spot', LOCAL_TV_CABLE: 'Local TV / cable', SCHOOL_EVENT_OPEN_HOUSE: 'School event / open house', SEMINAR: 'Seminar',
  REFERRAL_DRIVE: 'Referral drive', SOCIETY_ACTIVATION: 'Society / apartment activation', SCHOOL_FAIR_STALL: 'School fair stall', OTHER_OFFLINE: 'Other offline',
  META_ADS: 'Meta ads (Facebook / Instagram)', GOOGLE_ADS: 'Google Ads', GA4: 'Website (Google Analytics)', YOUTUBE: 'YouTube', LINKEDIN: 'LinkedIn', CSV: 'Imported (CSV)',
  ONLINE_SOCIAL: 'Social media (organic)', ONLINE_SEARCH: 'Search engine', ONLINE_WEBSITE: 'School website', WORD_OF_MOUTH: 'Word of mouth / friend',
  WALK_IN: 'Walk-in', ONLINE_CAMPAIGN: 'Online campaign', UNATTRIBUTED: 'Not known',
};
const OTHER_CHANNELS = ['ONLINE_SOCIAL', 'ONLINE_SEARCH', 'ONLINE_WEBSITE', 'WORD_OF_MOUTH', 'WALK_IN', 'META_ADS', 'GOOGLE_ADS', 'YOUTUBE', 'LINKEDIN', 'OTHER'];
export const HEARD_FROM_CHANNELS = [...OFFLINE_CHANNELS, ...OTHER_CHANNELS];

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
function assertMarketingStaff(actor) {
  requireProfile(actor);
  if (FAMILY.has(actor.roleKey)) throw new AppError('Marketing is for school staff.', 403, [], 'STAFF_ONLY');
}

const codeOf = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const digits10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

function cleanPlacements(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((p, i) => ({
    location: requireText(p?.location, `placement ${i + 1} location`, { max: 200 }),
    detail: optionalText(p?.detail, { max: 300 }) || null,
    quantity: p?.quantity === undefined || p?.quantity === null || p?.quantity === '' ? null : wholeNumber(p.quantity, `placement ${i + 1} quantity`),
  }));
}

function wholeNumber(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`${label} must be a whole number`, 400);
  return n;
}

function cleanAssets(list, actor) {
  const rows = cleanAttachments(list, actor);
  for (const a of rows) {
    if (!/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(a.url) && !/^https:\/\//i.test(a.url)) throw new AppError('Creative files must be uploaded files or https links', 400, [], 'BAD_ASSET_URL');
  }
  return rows;
}

function money(body, label) {
  if (body.costPaise !== undefined) return asPaise(body.costPaise, label);
  if (body.cost !== undefined) return toPaise(body.cost, label);
  return undefined;
}

async function linkedBill(billId) {
  if (!billId) return null;
  const id = assertObjectId(billId, 'billId');
  if (!(await Bill.exists({ _id: id }))) throw new AppError('That bill is not in this school\'s bills.', 404, [], 'BILL_NOT_FOUND');
  return id;
}

async function present(c) {
  const d = dto(c);
  return { ...d, channelLabel: CHANNEL_LABELS[c.channelType] ?? c.channelType, trackingPath: `/public/marketing/r/{school}/${c.code}` };
}

// ── offline campaigns ────────────────────────────────────────────────

export async function createOffline(actor, body = {}) {
  assertMarketingStaff(actor);
  const startsOn = parseDate(body.startsOn, 'startsOn', { required: true });
  const endsOn = parseDate(body.endsOn, 'endsOn', { required: true });
  if (endsOn < startsOn) throw new AppError('endsOn must be on or after startsOn', 400);
  const code = codeOf(body.code || body.name);
  if (code.length < 3 || code.length > 40) throw new AppError('Give a tracking code of 3 to 40 letters, numbers or dashes', 400, [], 'BAD_CODE');
  const c = new OfflineCampaign({
    name: requireText(body.name, 'name', { max: 160 }),
    code,
    channelType: oneOf(body.channelType, OFFLINE_CHANNELS, 'channelType'),
    campaignId: body.campaignId ? assertObjectId(body.campaignId, 'campaignId') : null,
    placements: cleanPlacements(body.placements),
    startsOn, endsOn,
    quantity: body.quantity === undefined || body.quantity === null || body.quantity === '' ? null : wholeNumber(body.quantity, 'quantity'),
    vendorName: optionalText(body.vendorName, { max: 160 }) || null,
    costPaise: money(body, 'cost') ?? 0,
    billId: await linkedBill(body.billId),
    assets: cleanAssets(body.assets, actor),
    trackingPhone: body.trackingPhone ? digits10(body.trackingPhone) || null : null,
    promoCode: body.promoCode ? codeOf(body.promoCode) || null : null,
    createdByProfileId: actor.profileId,
  });
  if (c.campaignId && !(await Campaign.exists({ _id: c.campaignId }))) throw new AppError('Campaign not found', 404);
  if (c.trackingPhone && c.trackingPhone.length !== 10) throw new AppError('The tracking phone number needs 10 digits', 400, [], 'BAD_PHONE');
  pushHistory(c, actor, 'CREATED');
  try { await c.save(); } catch (err) { if (err?.code === 11000) throw new AppError('Another campaign already uses that tracking code', 409, [], 'DUPLICATE_CODE'); throw err; }
  return present(c);
}

const EDITABLE = new Set(['DRAFT', 'REJECTED']);

export async function updateOffline(actor, id, body = {}) {
  assertMarketingStaff(actor);
  const c = await OfflineCampaign.findById(assertObjectId(id));
  if (!c) throw new AppError('Campaign not found', 404);
  const planFields = ['name', 'channelType', 'placements', 'startsOn', 'endsOn', 'quantity', 'vendorName', 'assets', 'trackingPhone', 'promoCode', 'campaignId'];
  const touchesPlan = planFields.some((f) => body[f] !== undefined);
  if (touchesPlan && !EDITABLE.has(c.status)) throw new AppError('An approved campaign\'s plan is fixed. Cancel it and create a new one, or record the actual cost and quantity.', 409, [], 'LOCKED');
  if (body.name !== undefined) c.name = requireText(body.name, 'name', { max: 160 });
  if (body.channelType !== undefined) c.channelType = oneOf(body.channelType, OFFLINE_CHANNELS, 'channelType');
  if (body.placements !== undefined) c.placements = cleanPlacements(body.placements);
  if (body.startsOn !== undefined) c.startsOn = parseDate(body.startsOn, 'startsOn', { required: true });
  if (body.endsOn !== undefined) c.endsOn = parseDate(body.endsOn, 'endsOn', { required: true });
  if (c.endsOn < c.startsOn) throw new AppError('endsOn must be on or after startsOn', 400);
  if (body.quantity !== undefined) c.quantity = body.quantity === null || body.quantity === '' ? null : wholeNumber(body.quantity, 'quantity');
  if (body.vendorName !== undefined) c.vendorName = optionalText(body.vendorName, { max: 160 }) || null;
  if (body.assets !== undefined) c.assets = cleanAssets(body.assets, actor);
  if (body.trackingPhone !== undefined) c.trackingPhone = body.trackingPhone ? digits10(body.trackingPhone) || null : null;
  if (body.promoCode !== undefined) c.promoCode = body.promoCode ? codeOf(body.promoCode) || null : null;
  if (body.campaignId !== undefined) c.campaignId = body.campaignId ? assertObjectId(body.campaignId, 'campaignId') : null;
  const cost = money(body, 'cost');
  if (cost !== undefined && cost !== c.costPaise) {
    const note = optionalText(body.note, { max: 500 });
    if (!EDITABLE.has(c.status) && !note) throw new AppError('Say why the cost changed after approval (e.g. the vendor\'s final invoice).', 400, [], 'REASON_REQUIRED');
    pushHistory(c, actor, 'COST_CHANGED', { from: String(c.costPaise), to: String(cost), note });
    c.costPaise = cost;
  }
  if (body.billId !== undefined) c.billId = await linkedBill(body.billId);
  pushHistory(c, actor, 'UPDATED', { note: optionalText(body.note, { max: 500 }) || null });
  await c.save();
  return present(c);
}

const MOVES = {
  SUBMIT: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_APPROVAL' },
  APPROVE: { from: ['PENDING_APPROVAL'], to: 'APPROVED' },
  REJECT: { from: ['PENDING_APPROVAL'], to: 'REJECTED' },
  GO_LIVE: { from: ['APPROVED'], to: 'LIVE' },
  COMPLETE: { from: ['LIVE', 'APPROVED'], to: 'COMPLETED' },
  CANCEL: { from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'LIVE'], to: 'CANCELLED' },
};

/** Who may approve: a second person holding marketing.manage, or the principal. */
function mayApprove(actor) {
  return Boolean(actor.permissions?.['marketing.manage']) || actor.roleKey === 'PRINCIPAL';
}

export async function moveOffline(actor, id, body = {}) {
  assertMarketingStaff(actor);
  const action = oneOf(body.action, Object.keys(MOVES), 'action');
  const c = await OfflineCampaign.findById(assertObjectId(id));
  if (!c) throw new AppError('Campaign not found', 404);
  const move = MOVES[action];
  if (!move.from.includes(c.status)) throw new AppError(`A ${c.status.toLowerCase().replace(/_/g, ' ')} campaign cannot be ${action.toLowerCase().replace(/_/g, ' ')}d.`, 409, [], 'INVALID_TRANSITION');
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (action === 'APPROVE' || action === 'REJECT') {
    if (!mayApprove(actor)) throw new AppError('Approving a campaign needs marketing.manage or the principal.', 403);
    if (String(c.createdByProfileId) === String(actor.profileId)) throw new AppError('Another person must approve this campaign.', 403, [], 'SELF_APPROVAL');
    if (action === 'REJECT' && !note) throw new AppError('Say what needs to change.', 400, [], 'REASON_REQUIRED');
    c.decision = { byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date(), note };
  }
  if (action === 'SUBMIT' && !c.placements.length && !['REFERRAL_DRIVE', 'RADIO_SPOT', 'LOCAL_TV_CABLE', 'NEWSPAPER_AD'].includes(c.channelType)) {
    throw new AppError('Add at least one placement (where it will appear) before sending it for approval.', 400, [], 'NO_PLACEMENT');
  }
  pushHistory(c, actor, action, { from: c.status, to: move.to, note });
  c.status = move.to;
  await c.save();
  return present(c);
}

export async function listOffline(actor, query = {}) {
  assertMarketingStaff(actor);
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, OFFLINE_STATUSES, 'status');
  if (query.channelType) filter.channelType = oneOf(query.channelType, OFFLINE_CHANNELS, 'channelType');
  const rows = await OfflineCampaign.find(filter).sort({ startsOn: -1 }).limit(500);
  const results = await resultsByOffline(rows.map((r) => r._id));
  return Promise.all(rows.map(async (r) => ({ ...(await present(r)), results: results.get(String(r._id)) ?? emptyResult() })));
}

export async function getOffline(actor, id) {
  assertMarketingStaff(actor);
  const c = await OfflineCampaign.findById(assertObjectId(id));
  if (!c) throw new AppError('Campaign not found', 404);
  const results = await resultsByOffline([c._id]);
  return { ...(await present(c)), results: results.get(String(c._id)) ?? emptyResult() };
}

// ── "how did you hear about us" ──────────────────────────────────────

export async function listHeardFrom({ activeOnly = false } = {}) {
  const rows = await HeardFromOption.find(activeOnly ? { active: true } : {}).sort({ order: 1, label: 1 }).lean();
  return rows.map((r) => ({ ...dto(r), channelLabel: CHANNEL_LABELS[r.channel] ?? r.channel }));
}

export async function saveHeardFrom(actor, body = {}) {
  assertMarketingStaff(actor);
  const fields = {
    label: requireText(body.label, 'label', { max: 80 }),
    channel: oneOf(body.channel, HEARD_FROM_CHANNELS, 'channel'),
    offlineCampaignId: body.offlineCampaignId ? assertObjectId(body.offlineCampaignId, 'offlineCampaignId') : null,
    active: body.active !== false,
    order: Number.isInteger(Number(body.order)) ? Number(body.order) : 0,
  };
  if (fields.offlineCampaignId && !(await OfflineCampaign.exists({ _id: fields.offlineCampaignId }))) throw new AppError('Campaign not found', 404);
  const row = body.id
    ? await HeardFromOption.findOneAndUpdate({ _id: assertObjectId(body.id) }, { $set: fields }, { new: true })
    : await HeardFromOption.create(fields);
  if (!row) throw new AppError('Option not found', 404);
  return dto(row);
}

// ── attribution: recording touches ───────────────────────────────────

/** Resolves anything a family or counsellor might give back to an offline campaign. */
export async function resolveOffline({ code, promoCode, trackingPhone } = {}) {
  if (code) {
    const c = await OfflineCampaign.findOne({ code: codeOf(code) }).lean();
    if (c) return { campaign: c, via: 'QR_OR_SHORT_LINK' };
  }
  if (promoCode) {
    const p = codeOf(promoCode);
    const c = p ? await OfflineCampaign.findOne({ $or: [{ promoCode: p }, { code: p }] }).lean() : null;
    if (c) return { campaign: c, via: 'PROMO_CODE' };
  }
  if (trackingPhone) {
    const d = digits10(trackingPhone);
    const c = d.length === 10 ? await OfflineCampaign.findOne({ trackingPhone: d }).lean() : null;
    if (c) return { campaign: c, via: 'TRACKING_PHONE' };
  }
  return null;
}

/** Writes one touch, unless the same lead already has an identical one. */
export async function addTouch(leadId, touch) {
  const doc = {
    leadId, via: oneOf(touch.via, TOUCH_VIA, 'via'), channel: String(touch.channel || 'UNATTRIBUTED').toUpperCase().slice(0, 40),
    offlineCampaignId: touch.offlineCampaignId ?? null, campaignId: touch.campaignId ?? null, platform: touch.platform ?? null,
    detail: touch.detail ? String(touch.detail).slice(0, 300) : null, utm: touch.utm ?? undefined, externalId: touch.externalId ?? null,
    at: touch.at ?? new Date(), recordedByProfileId: touch.recordedByProfileId ?? null,
  };
  const same = await LeadTouch.findOne({ leadId, via: doc.via, channel: doc.channel, offlineCampaignId: doc.offlineCampaignId, campaignId: doc.campaignId }).lean();
  if (same) return same;
  try { return (await LeadTouch.create(doc)).toObject(); } catch (err) {
    if (err?.code === 11000) return LeadTouch.findOne({ externalId: doc.externalId }).lean();
    throw err;
  }
}

const UTM_TEXT = (v) => (typeof v === 'string' ? v.trim().slice(0, 120) : undefined);

/**
 * Attribution sent with the public online form: utm_* from the link, `mc`
 * (the tracking code a short link or QR adds), a promo code and a "how did you
 * hear" answer. Unknown values are kept as text; nothing here can fail the
 * application itself.
 */
export async function recordFormAttribution(leadId, raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const utm = { source: UTM_TEXT(raw.utm_source ?? raw.source), medium: UTM_TEXT(raw.utm_medium ?? raw.medium), campaign: UTM_TEXT(raw.utm_campaign ?? raw.campaign), content: UTM_TEXT(raw.utm_content ?? raw.content), term: UTM_TEXT(raw.utm_term ?? raw.term) };
  const out = [];
  const offline = await resolveOffline({ code: UTM_TEXT(raw.mc) || utm.campaign, promoCode: UTM_TEXT(raw.promoCode) });
  if (offline) {
    out.push(await addTouch(leadId, { via: offline.via === 'PROMO_CODE' ? 'PROMO_CODE' : raw.mc ? 'QR_OR_SHORT_LINK' : 'UTM', channel: offline.campaign.channelType, offlineCampaignId: offline.campaign._id, campaignId: offline.campaign.campaignId ?? null, utm, detail: 'Online admission form' }));
  } else if (utm.campaign || utm.source) {
    const online = utm.campaign ? await Campaign.findOne({ code: codeOf(utm.campaign) }).select('_id').lean() : null;
    const channel = platformFromUtm(utm.source, utm.medium);
    out.push(await addTouch(leadId, { via: 'UTM', channel, campaignId: online?._id ?? null, utm, detail: 'Online admission form' }));
    if (online) await Lead.updateOne({ _id: leadId, campaignId: null }, { $set: { campaignId: online._id } });
  }
  if (raw.heardFromId && /^[a-f0-9]{24}$/i.test(String(raw.heardFromId))) {
    const opt = await HeardFromOption.findOne({ _id: raw.heardFromId, active: true }).lean();
    if (opt) out.push(await addTouch(leadId, { via: 'HEARD_FROM', channel: opt.channel, offlineCampaignId: opt.offlineCampaignId ?? null, detail: opt.label }));
  }
  return out;
}

export function platformFromUtm(source, medium) {
  const s = String(source ?? '').toLowerCase();
  const m = String(medium ?? '').toLowerCase();
  if (/facebook|instagram|^fb$|^ig$|meta/.test(s)) return 'META_ADS';
  if (/youtube/.test(s)) return 'YOUTUBE';
  if (/linkedin/.test(s)) return 'LINKEDIN';
  if (/google/.test(s)) return m === 'cpc' || m === 'ppc' || m === 'paid' ? 'GOOGLE_ADS' : 'ONLINE_SEARCH';
  if (/offline|print|qr/.test(s)) return 'OTHER_OFFLINE';
  if (m === 'social') return 'ONLINE_SOCIAL';
  return 'ONLINE_CAMPAIGN';
}

/** A counsellor records how an enquiry heard of the school, or a code/number it quoted. */
export async function attributeLead(actor, leadId, body = {}) {
  assertMarketingStaff(actor);
  const lead = await Lead.findById(assertObjectId(leadId, 'leadId')).select('_id').lean();
  if (!lead) throw new AppError('Lead not found', 404);
  const made = [];
  const offline = await resolveOffline({ code: body.code, promoCode: body.promoCode, trackingPhone: body.trackingPhone });
  if ((body.code || body.promoCode || body.trackingPhone) && !offline) throw new AppError('No campaign uses that code, promo code or phone number.', 404, [], 'NO_MATCH');
  if (offline) made.push(await addTouch(lead._id, { via: body.trackingPhone && offline.via === 'TRACKING_PHONE' ? 'TRACKING_PHONE' : offline.via, channel: offline.campaign.channelType, offlineCampaignId: offline.campaign._id, campaignId: offline.campaign.campaignId ?? null, recordedByProfileId: actor.profileId, detail: optionalText(body.note, { max: 300 }) || null }));
  if (body.heardFromId) {
    const opt = await HeardFromOption.findById(assertObjectId(body.heardFromId, 'heardFromId')).lean();
    if (!opt) throw new AppError('Option not found', 404);
    made.push(await addTouch(lead._id, { via: 'HEARD_FROM', channel: opt.channel, offlineCampaignId: opt.offlineCampaignId ?? null, detail: opt.label, recordedByProfileId: actor.profileId }));
  }
  if (body.campaignId) {
    const camp = await Campaign.findById(assertObjectId(body.campaignId, 'campaignId')).select('_id channels').lean();
    if (!camp) throw new AppError('Campaign not found', 404);
    made.push(await addTouch(lead._id, { via: 'MANUAL', channel: 'ONLINE_CAMPAIGN', campaignId: camp._id, recordedByProfileId: actor.profileId }));
    await Lead.updateOne({ _id: lead._id, campaignId: null }, { $set: { campaignId: camp._id } });
  }
  if (!made.length) throw new AppError('Give a tracking code, promo code, tracking phone number, a "how did you hear" answer or a campaign.', 400, [], 'NOTHING_TO_RECORD');
  await LeadInteraction.create({ leadId: lead._id, type: 'NOTE', body: `Source recorded: ${made.map((t) => CHANNEL_LABELS[t.channel] ?? t.channel).join(', ')}`, authorProfileId: actor.profileId });
  return leadAttribution(actor, lead._id);
}

export async function leadAttribution(actor, leadId) {
  assertMarketingStaff(actor);
  const touches = await LeadTouch.find({ leadId: assertObjectId(leadId, 'leadId') }).sort({ at: 1 }).lean();
  return {
    leadId: String(leadId),
    credited: touches[0] ? touchDto(touches[0]) : null,
    touches: touches.map(touchDto),
    rule: 'The earliest recorded touch is credited; later ones are kept as history.',
  };
}
const touchDto = (t) => ({ id: String(t._id), via: t.via, channel: t.channel, channelLabel: CHANNEL_LABELS[t.channel] ?? t.channel, offlineCampaignId: t.offlineCampaignId ? String(t.offlineCampaignId) : null, campaignId: t.campaignId ? String(t.campaignId) : null, detail: t.detail, at: t.at });

/** A short link or QR was opened: count it and return where to send the visitor. */
export async function scan(code) {
  const c = await OfflineCampaign.findOneAndUpdate(
    { code: codeOf(code), status: { $in: ['APPROVED', 'LIVE', 'COMPLETED'] } },
    { $inc: { scans: 1 }, $set: { lastScanAt: new Date() } },
    { new: true },
  ).lean();
  if (!c) return null;
  return { code: c.code, utm: { utm_source: 'offline', utm_medium: c.channelType.toLowerCase(), utm_campaign: c.code } };
}

// ── results ──────────────────────────────────────────────────────────

const emptyResult = () => ({ enquiries: 0, visits: 0, applications: 0, admissions: 0 });
const VISITED = new Set(['TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED']);
const APPLIED = new Set(['APPLICATION', 'ENROLLED']);

/** The credited (earliest) touch of each lead, for the leads given. */
async function creditedTouches(leadIds) {
  if (!leadIds.length) return new Map();
  const rows = await LeadTouch.aggregate([
    { $match: { leadId: { $in: leadIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $sort: { at: 1, _id: 1 } },
    { $group: { _id: '$leadId', touch: { $first: '$$ROOT' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.touch]));
}

/** Per lead: visited, applied, admitted — from the CRM and its appointments/applications. */
async function progressOf(leads) {
  const ids = leads.map((l) => l._id);
  const [tours, apps] = await Promise.all([
    CounsellingAppointment.find({ leadId: { $in: ids }, kind: 'CAMPUS_TOUR', status: { $in: ['SCHEDULED', 'DONE'] } }).select('leadId').lean(),
    OnlineApplication.find({ leadId: { $in: ids } }).select('leadId').lean(),
  ]);
  const toured = new Set(tours.map((t) => String(t.leadId)));
  const applied = new Set(apps.map((a) => String(a.leadId)));
  return new Map(leads.map((l) => {
    const id = String(l._id);
    const admitted = l.stage === 'ENROLLED';
    const app = admitted || APPLIED.has(l.stage) || applied.has(id);
    const visit = app || VISITED.has(l.stage) || toured.has(id);
    return [id, { visit, app, admitted }];
  }));
}

async function resultsByOffline(offlineIds) {
  const touches = await LeadTouch.find({ offlineCampaignId: { $in: offlineIds } }).select('leadId').lean();
  const leadIds = [...new Set(touches.map((t) => String(t.leadId)))];
  if (!leadIds.length) return new Map();
  const credited = await creditedTouches(leadIds);
  const leads = await Lead.find({ _id: { $in: leadIds } }).select('stage').lean();
  const prog = await progressOf(leads);
  const out = new Map();
  for (const l of leads) {
    const t = credited.get(String(l._id));
    if (!t?.offlineCampaignId) continue;
    const k = String(t.offlineCampaignId);
    const r = out.get(k) ?? emptyResult();
    const p = prog.get(String(l._id));
    r.enquiries += 1; if (p.visit) r.visits += 1; if (p.app) r.applications += 1; if (p.admitted) r.admissions += 1;
    out.set(k, r);
  }
  return out;
}

export async function getSettings() {
  const s = await MarketingSetting.findOne({ key: 'default' }).lean();
  return { admissionValuePaise: s?.admissionValuePaise ?? null };
}

export async function saveSettings(actor, body = {}) {
  assertMarketingStaff(actor);
  const value = body.admissionValuePaise === null || body.admissionValuePaise === '' ? null : body.admissionValue !== undefined ? toPaise(body.admissionValue, 'admissionValue') : asPaise(body.admissionValuePaise, 'admissionValuePaise');
  await MarketingSetting.findOneAndUpdate({ key: 'default' }, { $set: { admissionValuePaise: value, updatedByProfileId: actor.profileId } }, { upsert: true });
  return getSettings();
}

const ratio = (cost, n) => (n > 0 ? Math.round(cost / n) : null);
const roiPct = (cost, admissions, value) => (value === null || value === undefined || !cost ? null : Math.round(((admissions * value - cost) / cost) * 1000) / 10);

function overlaps(c, from, to) {
  if (from && c.endsOn < from) return false;
  if (to && c.startsOn >= to) return false;
  return true;
}

/**
 * The attribution report for enquiries created in [from, to): one row per
 * offline campaign, per online campaign and per channel, with cost, cost per
 * enquiry, cost per admission and ROI. Online spend comes from imported
 * platform rows (simulated rows are counted separately and labelled).
 */
export async function attributionReport(actor, query = {}) {
  assertMarketingStaff(actor);
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  const leadMatch = {};
  if (from || to) leadMatch.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const [leads, offline, online, settings] = await Promise.all([
    Lead.find(leadMatch).select('stage source campaignId createdAt').lean(),
    OfflineCampaign.find({ status: { $nin: ['DRAFT', 'REJECTED', 'CANCELLED'] } }).lean(),
    Campaign.find({}).select('name code channels spentPaise startsOn endsOn status').lean(),
    getSettings(),
  ]);
  const value = settings.admissionValuePaise;
  const credited = await creditedTouches(leads.map((l) => l._id));
  const prog = await progressOf(leads);

  const metricMatch = {};
  if (from || to) metricMatch.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const metrics = await AdMetric.find(metricMatch).select('platform campaignId spendPaise impressions clicks leads simulated').lean();

  const offlineRows = new Map(offline.filter((c) => overlaps(c, from, to)).map((c) => [String(c._id), {
    id: String(c._id), name: c.name, code: c.code, channel: c.channelType, channelLabel: CHANNEL_LABELS[c.channelType], status: c.status,
    costPaise: c.costPaise ?? 0, scans: c.scans ?? 0, ...emptyResult(),
  }]));
  const onlineRows = new Map(online.map((c) => [String(c._id), {
    id: String(c._id), name: c.name, code: c.code, channel: 'ONLINE_CAMPAIGN', channelLabel: CHANNEL_LABELS.ONLINE_CAMPAIGN, status: c.status,
    costPaise: 0, simulatedCostPaise: 0, recordedSpendPaise: c.spentPaise ?? 0, impressions: 0, clicks: 0, platformLeads: 0, platforms: new Set(), ...emptyResult(),
  }]));
  const channels = new Map();
  const chan = (key) => {
    if (!channels.has(key)) channels.set(key, { channel: key, channelLabel: CHANNEL_LABELS[key] ?? key, costPaise: 0, simulatedCostPaise: 0, ...emptyResult() });
    return channels.get(key);
  };

  // Spend: offline cost to its channel; platform rows to their campaign (if matched) and platform channel.
  for (const r of offlineRows.values()) chan(r.channel).costPaise += r.costPaise;
  let simulatedSpend = 0;
  for (const m of metrics) {
    const row = m.campaignId ? onlineRows.get(String(m.campaignId)) : null;
    if (m.simulated) simulatedSpend += m.spendPaise;
    if (row) {
      if (m.simulated) row.simulatedCostPaise += m.spendPaise; else row.costPaise += m.spendPaise;
      row.impressions += m.impressions; row.clicks += m.clicks; row.platformLeads += m.leads; row.platforms.add(m.platform);
    }
    const c = chan(m.platform);
    if (m.simulated) c.simulatedCostPaise += m.spendPaise; else c.costPaise += m.spendPaise;
  }
  // An online campaign with no imported rows keeps the spend recorded on it by hand.
  for (const r of onlineRows.values()) {
    if (!r.platforms.size && r.recordedSpendPaise) { r.costPaise = r.recordedSpendPaise; chan('ONLINE_CAMPAIGN').costPaise += r.recordedSpendPaise; }
  }

  // Outcomes: each enquiry once, to its credited touch (or the campaign recorded on it).
  for (const l of leads) {
    const t = credited.get(String(l._id));
    const p = prog.get(String(l._id));
    const bump = (r) => { r.enquiries += 1; if (p.visit) r.visits += 1; if (p.app) r.applications += 1; if (p.admitted) r.admissions += 1; };
    let channel = 'UNATTRIBUTED';
    if (t) {
      channel = t.channel;
      if (t.offlineCampaignId && offlineRows.has(String(t.offlineCampaignId))) bump(offlineRows.get(String(t.offlineCampaignId)));
      else if (t.campaignId && onlineRows.has(String(t.campaignId))) bump(onlineRows.get(String(t.campaignId)));
    } else if (l.campaignId && onlineRows.has(String(l.campaignId))) {
      channel = 'ONLINE_CAMPAIGN';
      bump(onlineRows.get(String(l.campaignId)));
    } else if (l.source === 'WALK_IN') channel = 'WALK_IN';
    else if (l.source === 'REFERRAL') channel = 'WORD_OF_MOUTH';
    bump(chan(channel));
  }

  const finish = (r) => {
    const cost = r.costPaise;
    return {
      ...r, ...(r.platforms ? { platforms: [...r.platforms] } : {}),
      costPerEnquiryPaise: ratio(cost, r.enquiries), costPerAdmissionPaise: ratio(cost, r.admissions),
      conversionPct: r.enquiries ? Math.round((r.admissions / r.enquiries) * 1000) / 10 : null,
      roiPct: roiPct(cost, r.admissions, value),
    };
  };
  const totals = [...channels.values()].reduce((t, c) => ({ costPaise: t.costPaise + c.costPaise, enquiries: t.enquiries + c.enquiries, visits: t.visits + c.visits, applications: t.applications + c.applications, admissions: t.admissions + c.admissions }), { costPaise: 0, ...emptyResult() });
  return {
    window: { from, to },
    admissionValuePaise: value,
    totals: finish({ ...totals }),
    offline: [...offlineRows.values()].map(finish).sort((a, b) => b.enquiries - a.enquiries || a.name.localeCompare(b.name)),
    online: [...onlineRows.values()].filter((r) => r.enquiries || r.costPaise || r.simulatedCostPaise || r.status === 'ACTIVE').map(finish).sort((a, b) => b.enquiries - a.enquiries),
    channels: [...channels.values()].map(finish).sort((a, b) => b.enquiries - a.enquiries || b.costPaise - a.costPaise),
    simulatedSpendPaise: simulatedSpend,
    definitions: {
      enquiries: 'Enquiries created in the period, each credited once to its earliest recorded touch (or the campaign recorded on it).',
      visits: 'Of those, enquiries with a campus tour booked or done, or that reached a later stage.',
      applications: 'Of those, enquiries that applied (online form or application stage) or were admitted.',
      admissions: 'Of those, enquiries now enrolled.',
      cost: 'Offline: the campaign\'s recorded cost. Online: spend imported from the ad platform for the period (simulated sample spend is shown apart and never counted).',
      roi: value === null ? 'Set "value of one admission" to see ROI.' : '(admissions × value of one admission − cost) ÷ cost.',
    },
  };
}

/** Neutralises spreadsheet formulas in a cell that will be opened in Excel or Sheets. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function attributionCsv(actor, query = {}) {
  const r = await attributionReport(actor, query);
  const rupees = (p) => (p === null || p === undefined ? '' : (p / 100).toFixed(2));
  const lines = [['Kind', 'Name', 'Channel', 'Cost (INR)', 'Enquiries', 'Visits', 'Applications', 'Admissions', 'Cost per enquiry (INR)', 'Cost per admission (INR)', 'ROI %'].map(csvCell).join(',')];
  const push = (kind, x) => lines.push([kind, x.name ?? x.channelLabel, x.channelLabel, rupees(x.costPaise), x.enquiries, x.visits, x.applications, x.admissions, rupees(x.costPerEnquiryPaise), rupees(x.costPerAdmissionPaise), x.roiPct ?? ''].map(csvCell).join(','));
  for (const x of r.offline) push('Offline campaign', x);
  for (const x of r.online) push('Online campaign', x);
  for (const x of r.channels) push('Channel', x);
  return lines.join('\r\n');
}

