// Part-6 coverage tools: marketing. See ./_kit.js and ../p6Coverage.js.
import * as marketing from '../../../../marketing/marketing.service.js';
import * as growth from '../../../../marketing/growth.service.js';
import * as connectors from '../../../../marketing/connectors.service.js';
import * as online from '../../../../admissions/online.service.js';
import * as oauth from '../../../../integrations/oauth.service.js';
import * as engagement from '../../../../integrations/engagement.service.js';
import * as social from '../../../../social/social.service.js';
import { Lead } from '../../../../../models/lead.model.js';
import { ASSET_SIZES } from '../../../../../models/marketing.model.js';
import { OFFLINE_CHANNELS, OFFLINE_STATUSES, CONNECTOR_PLATFORMS } from '../../../../../models/marketingGrowth.model.js';
import { rupees } from '../_shared.js';
import { escapeRegex } from '../../../../ops/common.js';
import {
  tool, closed, text, int, num, bool, oneOf, list, dateStr, RISK,
  ask, forbidden, pick, listed, shown, did, lower, words, day, time, excerpt, paiseOf, needAny, decisionArg,
} from './_kit.js';

/**
 * Marketing and admissions-growth routes that had no assistant tool (part 6).
 *
 *   online forms    one online application in full.
 *   campaigns       change a campaign's status, budget or spend.
 *   creative        asset sizes, the asset library, a new asset, edits (copy,
 *                   claims and their evidence, a new version, review / archive /
 *                   marked as published), and the reviewer's own decision.
 *   enquiries       marketing details and contact consent on an enquiry,
 *                   likely duplicates, the enquiry's source (attribution).
 *   seats           intake capacity, the seat offers list, the family's reply
 *                   to an offer (accepted / declined), fee paid, enrolled.
 *   appointments    close a counselling appointment (done, no-show, cancelled).
 *   offline         offline campaigns (list, one, draft, change, submit / go
 *                   live / complete / cancel, and the approver's decision),
 *                   "how did you hear about us" options, settings, the
 *                   attribution report.
 *   connectors      the import log, simulated sample data on or off, the
 *                   integrations overview, a social post's engagement refresh.
 *
 * Left on screen: offering a seat and withdrawing an offer (admission
 * decisions), connector credentials, webhook secrets and the OAuth connect /
 * complete / choose-account / refresh / disconnect flow, CSV imports and the
 * CSV download, bulk enquiry import.
 */

const r = (paise) => (paise === null || paise === undefined ? '—' : rupees(paise));

async function enquiryNamed(childName) {
  if (!childName) throw ask("Which enquiry? Give the child's name.");
  const rows = await Lead.find({ childName: { $regex: escapeRegex(String(childName).trim()), $options: 'i' } }).select('childName guardianName stage').limit(20).lean();
  const l = pick(rows.map((x) => ({ ...x, id: String(x._id) })), childName, { label: 'admission enquiry', nameOf: (x) => x.childName, refOf: () => null, describe: (x) => `${x.childName} (${x.guardianName}, ${words(x.stage)})` });
  return l;
}

async function campaignNamed(term) {
  return pick(await marketing.listCampaigns(), term, { label: 'campaign', nameOf: (c) => c.name, refOf: (c) => c.code, describe: (c) => `${c.code} ${c.name}` });
}

async function assetNamed(term) {
  return pick(await marketing.listAssets({}), term, { label: 'creative asset', nameOf: (a) => a.title, refOf: () => null, describe: (a) => `"${a.title}" (${words(a.kind)}, ${words(a.status)})` });
}

async function offlineNamed(ctx, term, keep = () => true, label = 'offline campaign') {
  const rows = (await growth.listOffline(ctx.actor, {})).filter(keep);
  return pick(rows, term, { label, nameOf: (c) => c.name, refOf: (c) => c.code, describe: (c) => `${c.code} ${c.name} (${words(c.status)})` });
}

/** The route's own extra check for offline-campaign moves: marketing.manage, or the principal. */
const offlineMover = (ctx) => {
  if (!ctx.actor?.permissions?.['marketing.manage'] && ctx.actor?.roleKey !== 'PRINCIPAL') throw forbidden('Missing permission: marketing.manage');
};

/* ── Online applications, campaigns, creative assets ──────── */

const ASSET_KINDS = ['POSTER', 'BANNER', 'SOCIAL_POST', 'BROCHURE', 'VIDEO', 'LANDING_PAGE', 'OTHER'];
const claimSchema = closed({ text: text(300), verified: bool('Checked against evidence'), evidence: text(500, 'Where the claim is proven (link, document, result sheet)') }, ['text']);

const campaignTools = {
  get_online_application: tool({
    module: 'Admissions', operation: 'GET', feature: 'onlineAdmission',
    description: 'One application received through the online admission form in full: child, date of birth, class and year applied for, previous school, guardian and contact, message, consent to be contacted, documents attached and the enquiry\'s stage. Name it by reference or the child\'s name. Read-only.',
    inputSchema: closed({ refNo: text(40), childName: text(80) }),
    permission: 'admissions.read',
    service: 'online.service.listApplications() + getApplication()',
    async run(_ctx, args) {
      const rows = (await online.listApplications({ pageSize: 200 })).items;
      const pool = args.childName ? rows.filter((a) => lower(a.childName).includes(lower(args.childName))) : rows;
      const a = pick(pool, args.refNo, { label: 'online application', nameOf: (x) => x.childName, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.childName}` });
      const d = await online.getApplication(a.id);
      return shown(d, `${d.refNo} ${d.childName}${d.gradeApplying ? ` for ${d.gradeApplying}` : ''}${d.academicYear ? ` (${d.academicYear})` : ''}: guardian ${d.guardianName}, ${d.documents.length} document(s), stage ${words(d.stage ?? 'NEW')}.`);
    },
  }),

  update_marketing_campaign: tool({
    module: 'Marketing', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'Change a marketing campaign: its status (planned, active, paused, completed, cancelled), its budget, or the spend so far in rupees (spend above budget needs a note). Name it by code or name. Money, so it is confirmed on the website.',
    inputSchema: closed({
      campaign: text(160, 'Code or name'), status: oneOf(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']),
      budgetRupees: num(0, 1e9), spentRupees: num(0, 1e9), note: text(500),
    }, ['campaign']),
    permission: 'marketing.manage',
    service: 'marketing.service.updateCampaign()',
    async prepare(_ctx, args) {
      if (![args.status, args.budgetRupees, args.spentRupees].some((v) => v !== undefined)) throw ask('What should change: status, budget or spend?');
      const c = await campaignNamed(args.campaign);
      return { id: c.id, code: c.code, name: c.name, budgetPaise: c.budgetPaise, spentPaise: c.spentPaise };
    },
    summarise: (a, _actor, p) => `Update campaign ${p?.code ?? a.campaign} "${p?.name ?? ''}": ${[a.status && `status ${words(a.status)}`, a.budgetRupees !== undefined && `budget ${r(p?.budgetPaise)} → ₹${a.budgetRupees.toLocaleString('en-IN')}`, a.spentRupees !== undefined && `spend ${r(p?.spentPaise)} → ₹${a.spentRupees.toLocaleString('en-IN')}`, a.note && `note: ${a.note}`].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const c = await marketing.updateCampaign(ctx.actor, p.id, {
        status: args.status, note: args.note,
        ...(args.budgetRupees !== undefined && { budgetPaise: Math.round(args.budgetRupees * 100) }),
        ...(args.spentRupees !== undefined && { spentPaise: Math.round(args.spentRupees * 100) }),
      });
      return did('campaign_updated', c, `${c.code} is ${words(c.status)}: ${r(c.spentPaise)} spent of ${r(c.budgetPaise)}.`);
    },
  }),

  list_marketing_asset_sizes: tool({
    module: 'Marketing', operation: 'GET',
    description: 'The standard sizes for creative assets (Instagram post and story, Facebook cover, A4 poster, banner ...) with their dimensions. Read-only.',
    permission: 'marketing.read',
    service: 'marketing.service.assetSizes()',
    async run() {
      const sizes = marketing.assetSizes();
      const rows = Object.entries(sizes).map(([key, d]) => ({ key, ...d }));
      return listed(rows, (s) => `${words(s.key)}${s.w && s.h ? ` ${s.w}×${s.h}${s.unit ? ` ${s.unit}` : ''}` : ''}`, { noun: 'size' });
    },
  }),

  list_marketing_assets: tool({
    module: 'Marketing', operation: 'GET',
    description: 'The creative asset library: posters, banners, social posts, brochures, videos and landing pages, with headline, size, status (draft, in review, approved, published, archived) and whether every factual claim is verified. Filter by campaign or status. Read-only.',
    inputSchema: closed({ campaign: text(160, 'Code or name'), status: oneOf(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']) }),
    permission: 'marketing.read',
    service: 'marketing.service.listAssets()',
    async run(_ctx, args) {
      const campaignId = args.campaign ? (await campaignNamed(args.campaign)).id : undefined;
      const rows = await marketing.listAssets({ campaignId, status: args.status });
      return listed(rows, (a) => `"${a.title}" (${words(a.kind)}, ${words(a.status)}${(a.claims ?? []).some((c) => !c.verified) ? ', claims unverified' : ''})`, { noun: 'asset' });
    },
  }),

  create_marketing_asset: tool({
    module: 'Marketing', operation: 'CREATE',
    description: 'Draft a creative asset: kind, title, size, headline, copy, call to action, alt text, the factual claims it makes (each must be verified before it can be approved), the campaign it belongs to and a link to the file. It starts as a draft. Needs confirmation.',
    inputSchema: closed({
      kind: oneOf(ASSET_KINDS), title: text(160), size: oneOf(Object.keys(ASSET_SIZES)), headline: text(200), copy: text(5000),
      callToAction: text(120), altText: text(500), claims: list(text(300), 20, 'Factual claims, e.g. "100% board results 2025"'),
      campaign: text(160, 'Code or name'), fileLink: text(1000, 'https link to the file'), aiAssisted: bool('Drafted with AI help'),
    }, ['kind', 'title']),
    permission: 'marketing.manage',
    service: 'marketing.service.createAsset()',
    async prepare(_ctx, args) {
      const c = args.campaign ? await campaignNamed(args.campaign) : null;
      return { campaignId: c?.id ?? null, campaign: c ? `${c.code} ${c.name}` : null };
    },
    summarise: (a, _actor, p) => `Draft the ${words(a.kind)} "${a.title}"${a.size ? ` (${words(a.size)})` : ''}${p?.campaign ? ` for ${p.campaign}` : ''}${a.headline ? `, headline "${a.headline}"` : ''}${a.claims?.length ? `, ${a.claims.length} claim(s) to verify` : ''}`,
    async run(ctx, args, p) {
      const { campaign: _c, fileLink, ...rest } = args;
      const a = await marketing.createAsset(ctx.actor, { ...rest, ...(fileLink && { url: fileLink }), campaignId: p.campaignId });
      return did('marketing_asset_created', a, `Drafted "${a.title}".`);
    },
  }),

  update_marketing_asset: tool({
    module: 'Marketing', operation: 'UPDATE', affectsOthers: true,
    description: 'Work on a creative asset: change its headline, copy, call to action or alt text, set its claims with the evidence behind each, add a new version (a link to the file), send it for review, put it back to draft, archive it, or record where an approved asset was published. Approving it is the reviewer\'s own decision (record_marketing_asset_decision). For marketing managers or the principal. Confirmed on the website.',
    inputSchema: closed({
      asset: text(160, 'Its title'), headline: text(200), copy: text(5000), callToAction: text(120), altText: text(500),
      claims: list(claimSchema, 20, 'Replaces the claims'), fileLink: text(1000, 'https link to a new version'), versionNote: text(300),
      status: oneOf(['DRAFT', 'IN_REVIEW', 'ARCHIVED', 'PUBLISHED']), channel: text(40, 'Where it was published, for PUBLISHED'), publishedUrl: text(1000),
    }, ['asset']),
    permission: 'marketing.read',
    guard: (ctx) => needAny(ctx, [['marketing.manage', null], ['community.moderate', null]]),
    service: 'marketing.service.updateAsset()',
    async prepare(_ctx, args) {
      if (args.status === 'PUBLISHED' && !args.channel) throw ask('Where was it published (e.g. Instagram, newspaper)?');
      const a = await assetNamed(args.asset);
      return { id: a.id, title: a.title, from: a.status };
    },
    summarise: (a, _actor, p) => `Update "${p?.title ?? a.asset}": ${[a.headline && `headline "${a.headline}"`, a.copy && 'new copy', a.callToAction && `call to action "${a.callToAction}"`, a.altText && 'alt text', a.claims && `${a.claims.length} claim(s), ${a.claims.filter((c) => c.verified && c.evidence).length} verified`, a.fileLink && 'a new version', a.status && `${words(p?.from ?? '')} → ${words(a.status)}${a.channel ? ` on ${a.channel}` : ''}`].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const { asset: _a, fileLink, ...rest } = args;
      const a = await marketing.updateAsset(ctx.actor, p.id, { ...rest, ...(fileLink && { url: fileLink }) });
      return did('marketing_asset_updated', a, `"${a.title}" is ${words(a.status)}.`);
    },
  }),

  record_marketing_asset_decision: tool({
    module: 'Marketing', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, approverDecision: true,
    description: "Record the reviewer's own decision on a creative asset in review: APPROVE (every claim must be verified with evidence, alt text present, featured children with public media consent; never the asset's last editor) or SEND_BACK to draft. Recorded only when the reviewer states the decision in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({ asset: text(160, 'Its title'), decision: decisionArg(['APPROVE', 'SEND_BACK'], 'the reviewer') }, ['asset', 'decision']),
    permission: 'marketing.read',
    guard: (ctx) => needAny(ctx, [['marketing.manage', null], ['community.moderate', null]]),
    service: 'marketing.service.updateAsset() status APPROVED / DRAFT',
    async prepare(_ctx, args) { const a = await assetNamed(args.asset); return { id: a.id, title: a.title, from: a.status }; },
    summarise: (a, _actor, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Send back to draft'} the creative asset "${p?.title ?? a.asset}"`,
    async run(ctx, args, p) {
      const a = await marketing.updateAsset(ctx.actor, p.id, { status: args.decision === 'APPROVE' ? 'APPROVED' : 'DRAFT' });
      return did('marketing_asset_decided', a, `Recorded: "${a.title}" is ${words(a.status)}.`);
    },
  }),
};

/* ── Enquiries, capacity, offers, appointments ────────────── */

const OFFER_STEPS = ['ACCEPTED', 'DECLINED', 'FEE_PAID', 'ENROLLED'];

const admissionTools = {
  update_enquiry_marketing_details: tool({
    module: 'Admissions', operation: 'UPDATE', affectsOthers: true,
    description: "Record the marketing details of an admission enquiry: the campaign it came from, the source in words, the year and programme, why it was lost, that the family was responded to, or the family's consent to be contacted (given, with channels, or withdrawn). Name the child. Confirmed on the website.",
    inputSchema: closed({
      childName: text(80), campaign: text(160, 'Code or name'), sourceDetail: text(200), academicYear: text(9), programme: text(120), lostReason: text(500),
      contactConsent: oneOf(['GIVEN', 'WITHDRAWN']), consentChannels: list(oneOf(['PHONE', 'WHATSAPP', 'EMAIL', 'SMS']), 4), responded: bool('The family has been responded to'),
    }, ['childName']),
    permission: 'admissions.manage',
    service: 'marketing.service.updateLeadMarketing()',
    async prepare(_ctx, args) {
      const l = await enquiryNamed(args.childName);
      const c = args.campaign ? await campaignNamed(args.campaign) : null;
      const body = {};
      for (const k of ['sourceDetail', 'academicYear', 'programme', 'lostReason']) if (args[k] !== undefined) body[k] = args[k];
      if (c) body.campaignId = c.id;
      if (args.contactConsent === 'WITHDRAWN') body.contactConsent = false;
      if (args.contactConsent === 'GIVEN') body.contactConsent = { channels: args.consentChannels ?? ['PHONE'] };
      if (args.responded) body.responded = true;
      if (!Object.keys(body).length) throw ask('What should be recorded on the enquiry?');
      return { id: l.id, childName: l.childName, guardianName: l.guardianName, campaign: c ? c.code : null, body };
    },
    summarise: (a, _actor, p) => `On ${p?.childName ?? a.childName}'s enquiry (${p?.guardianName ?? ''}): ${[p?.campaign && `campaign ${p.campaign}`, a.sourceDetail && `source "${a.sourceDetail}"`, a.academicYear && `year ${a.academicYear}`, a.programme && `programme ${a.programme}`, a.lostReason && `lost: ${a.lostReason}`, a.contactConsent === 'GIVEN' && `consent to contact given (${(a.consentChannels ?? ['PHONE']).join(', ').toLowerCase()})`, a.contactConsent === 'WITHDRAWN' && 'consent to contact withdrawn', a.responded && 'responded'].filter(Boolean).join(', ')}`,
    async run(ctx, _args, p) {
      const l = await marketing.updateLeadMarketing(ctx.actor, p.id, p.body);
      return did('enquiry_marketing_updated', l, `Recorded on ${p.childName}'s enquiry.`);
    },
  }),

  list_duplicate_enquiries: tool({
    module: 'Admissions', operation: 'GET',
    description: 'Admission enquiries that share a phone number (likely duplicates to merge by hand), grouped, with the child, guardian, stage and date of each. Read-only.',
    permission: 'admissions.read',
    service: 'marketing.service.duplicateLeads()',
    async run() {
      const groups = await marketing.duplicateLeads();
      return listed(groups, (g) => g.map((x) => `${x.childName} (${words(x.stage)})`).join(' / '), { noun: 'duplicate group' });
    },
  }),

  set_admission_capacity: tool({
    module: 'Admissions', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'Set the intake capacity of a class or programme for an academic year, with seats reserved by category (RTE, EWS, SC, ST ...). It cannot drop below seats already offered or accepted. Seat offers are made against it. Confirmed on the website.',
    inputSchema: closed({
      academicYear: text(9, 'e.g. "2027-28"'), gradeOrProgramme: text(80, 'e.g. "Class 1"'), capacity: int(0, 5000),
      reserved: list(closed({ category: text(40), seats: int(0, 5000), note: text(300) }, ['category', 'seats']), 10),
    }, ['academicYear', 'gradeOrProgramme', 'capacity']),
    permission: 'admissions.manage',
    service: 'marketing.service.setCapacity()',
    summarise: (a) => `Set ${a.gradeOrProgramme} ${a.academicYear} intake to ${a.capacity} seat(s)${a.reserved?.length ? `, reserving ${a.reserved.map((x) => `${x.seats} ${String(x.category).toUpperCase()}`).join(', ')}` : ''}`,
    async run(ctx, args) {
      const c = await marketing.setCapacity(ctx.actor, args);
      return did('admission_capacity_set', c, `${c.gradeOrProgramme} ${c.academicYear}: ${c.capacity} seats, ${c.available} available.`);
    },
  }),

  list_admission_offers: tool({
    module: 'Admissions', operation: 'GET',
    description: 'Seat offers and the waitlist for the intake: child, guardian, class and year, category, status (waitlisted, offered, accepted, fee paid, enrolled, declined, expired, withdrawn), offer expiry and waitlist position. Read-only.',
    inputSchema: closed({ academicYear: text(9), status: oneOf(['WAITLISTED', 'OFFERED', 'ACCEPTED', 'FEE_PAID', 'ENROLLED', 'DECLINED', 'EXPIRED', 'WITHDRAWN']) }),
    permission: 'admissions.read',
    service: 'marketing.service.listOffers()',
    async run(_ctx, args) {
      const rows = await marketing.listOffers(args);
      return listed(rows, (o) => `${o.childName} ${o.gradeOrProgramme} ${o.academicYear}: ${words(o.status)}${o.waitlistPosition ? ` #${o.waitlistPosition}` : ''}${o.offerExpiresOn ? ` until ${day(o.offerExpiresOn)}` : ''}`, { noun: 'seat offer' });
    },
  }),

  update_seat_offer: tool({
    module: 'Admissions', operation: 'UPDATE', affectsOthers: true,
    description: "Record what happened to a seat offer: the family ACCEPTED or DECLINED it, the admission fee was paid (FEE_PAID, with the paid invoice number from the fees module) or the child is ENROLLED (with the admission number). Offering a seat and withdrawing an offer are admission decisions made on the Admissions page. Confirmed on the website.",
    inputSchema: closed({
      childName: text(80), academicYear: text(9), to: oneOf(OFFER_STEPS),
      invoiceNo: text(60, 'FEE_PAID: the paid invoice'), admissionNo: text(60, 'ENROLLED: the student\'s admission number'), note: text(500),
    }, ['childName', 'to']),
    permission: 'admissions.manage',
    service: 'marketing.service.moveOffer()',
    async prepare(_ctx, args) {
      if (args.to === 'FEE_PAID' && !args.invoiceNo) throw ask('Which paid invoice is the admission fee on?');
      const from = { ACCEPTED: ['OFFERED'], DECLINED: ['OFFERED'], FEE_PAID: ['ACCEPTED'], ENROLLED: ['FEE_PAID'] }[args.to];
      const rows = (await marketing.listOffers({ academicYear: args.academicYear })).filter((o) => from.includes(o.status));
      const o = pick(rows, args.childName, { label: 'seat offer', nameOf: (x) => x.childName, refOf: () => null, describe: (x) => `${x.childName} ${x.gradeOrProgramme} ${x.academicYear} (${words(x.status)})` });
      return { id: o.id, childName: o.childName, gradeOrProgramme: o.gradeOrProgramme, academicYear: o.academicYear, from: o.status };
    },
    summarise: (a, _actor, p) => `${p?.childName ?? a.childName}'s seat offer for ${p?.gradeOrProgramme ?? ''} ${p?.academicYear ?? ''}: ${words(p?.from ?? '')} → ${words(a.to)}${a.invoiceNo ? ` (invoice ${a.invoiceNo})` : ''}${a.admissionNo ? ` (admission no. ${a.admissionNo})` : ''}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, args, p) {
      const o = await marketing.moveOffer(ctx.actor, p.id, { to: args.to, invoiceNo: args.invoiceNo, admissionNo: args.admissionNo, note: args.note });
      return did('seat_offer_updated', o, `${p.childName}'s offer is now ${words(o.status)}.`);
    },
  }),

  update_counselling_appointment: tool({
    module: 'Admissions', operation: 'UPDATE',
    description: 'Close or change a counselling appointment, campus tour, interview or test: mark it done, no-show or cancelled (or back to scheduled) with the outcome. Name the child and, if they have several, the date. Needs confirmation.',
    inputSchema: closed({ childName: text(80), date: dateStr('The appointment day, YYYY-MM-DD'), status: oneOf(['SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED']), outcome: text(1000) }, ['childName', 'status']),
    permission: 'admissions.manage',
    service: 'marketing.service.listAppointments() + updateAppointment()',
    async prepare(ctx, args) {
      let rows = (await marketing.listAppointments(ctx.actor, {})).filter((a) => lower(a.childName).includes(lower(args.childName)));
      if (args.date) rows = rows.filter((a) => day(a.at) === args.date);
      else if (rows.some((a) => a.status === 'SCHEDULED')) rows = rows.filter((a) => a.status === 'SCHEDULED');
      const a = pick(rows, null, { label: `appointment for ${args.childName}`, describe: (x) => `${words(x.kind)} on ${day(x.at)} ${time(x.at)} (${words(x.status)})` });
      return { id: a.id, childName: a.childName, kind: a.kind, when: `${day(a.at)} ${time(a.at)}` };
    },
    summarise: (a, _actor, p) => `Mark ${p?.childName ?? a.childName}'s ${words(p?.kind ?? 'appointment')} on ${p?.when ?? a.date ?? ''} as ${words(a.status)}${a.outcome ? `: ${a.outcome}` : ''}`,
    async run(ctx, args, p) {
      const a = await marketing.updateAppointment(ctx.actor, p.id, { status: args.status, outcome: args.outcome });
      return did('appointment_updated', a, `${p.childName}'s ${words(p.kind)} is ${words(a.status)}.`);
    },
  }),
};

/* ── Offline campaigns, heard-from, attribution, settings ─── */

const placementSchema = closed({ location: text(200), detail: text(300), quantity: int(0, 1e7) }, ['location']);
const offlineFields = {
  channelType: oneOf(OFFLINE_CHANNELS), onlineCampaign: text(160, 'The online campaign it belongs to, by code or name'),
  placements: list(placementSchema, 50, 'Where it will appear'), startsOn: dateStr(), endsOn: dateStr(), quantity: int(0, 1e7),
  vendorName: text(160), costRupees: num(0, 1e9), trackingPhone: text(20, 'A 10-digit number printed only on this campaign'), promoCode: text(40),
};

async function offlineBody(args) {
  const body = {};
  for (const k of ['name', 'code', 'channelType', 'placements', 'startsOn', 'endsOn', 'quantity', 'vendorName', 'trackingPhone', 'promoCode', 'note']) if (args[k] !== undefined) body[k] = args[k];
  if (args.costRupees !== undefined) body.costPaise = Math.round(args.costRupees * 100);
  let campaign = null;
  if (args.onlineCampaign) { const c = await campaignNamed(args.onlineCampaign); body.campaignId = c.id; campaign = c.code; }
  return { body, campaign };
}

const describeOffline = (a, campaign) => [a.channelType && words(a.channelType), a.startsOn && `${a.startsOn} to ${a.endsOn ?? '?'}`, a.placements?.length && `${a.placements.length} placement(s)`, a.quantity !== undefined && `quantity ${a.quantity}`, a.vendorName && `vendor ${a.vendorName}`, a.costRupees !== undefined && `cost ₹${a.costRupees.toLocaleString('en-IN')}`, campaign && `campaign ${campaign}`, a.trackingPhone && `tracking phone ${a.trackingPhone}`, a.promoCode && `promo ${String(a.promoCode).toUpperCase()}`].filter(Boolean).join(', ');

const OFFLINE_STEPS = { SUBMIT: ['DRAFT', 'REJECTED'], GO_LIVE: ['APPROVED'], COMPLETE: ['LIVE', 'APPROVED'], CANCEL: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'LIVE'] };

const growthTools = {
  list_offline_campaigns: tool({
    module: 'Marketing', operation: 'GET',
    description: 'Offline marketing (banners, pamphlets, posters, newspaper ads, radio, open houses, referral drives ...): tracking code, channel, dates, cost, status, QR scans and the enquiries, visits, applications and admissions traced to each. Read-only.',
    inputSchema: closed({ status: oneOf(OFFLINE_STATUSES), channelType: oneOf(OFFLINE_CHANNELS) }),
    permission: 'marketing.read',
    service: 'growth.service.listOffline()',
    async run(ctx, args) {
      const rows = await growth.listOffline(ctx.actor, args);
      return listed(rows, (c) => `${c.code} ${c.name} (${c.channelLabel}, ${words(c.status)}, ${r(c.costPaise)}, ${c.results?.enquiries ?? 0} enquiries)`, { noun: 'offline campaign' });
    },
  }),

  get_offline_campaign: tool({
    module: 'Marketing', operation: 'GET',
    description: 'One offline campaign in full: placements, dates, quantity, vendor and cost, tracking code, phone and promo code, the approval decision, scans and the results traced to it. Name it by code or name. Read-only.',
    inputSchema: closed({ campaign: text(160, 'Tracking code or name') }, ['campaign']),
    permission: 'marketing.read',
    service: 'growth.service.getOffline()',
    async run(ctx, args) {
      const c = await offlineNamed(ctx, args.campaign);
      const d = await growth.getOffline(ctx.actor, c.id);
      const res = d.results ?? {};
      return shown(d, `${d.code} ${d.name}: ${d.channelLabel}, ${words(d.status)}, ${r(d.costPaise)}; ${d.scans ?? 0} scan(s), ${res.enquiries ?? 0} enquiries, ${res.admissions ?? 0} admission(s).`);
    },
  }),

  create_offline_campaign: tool({
    module: 'Marketing', operation: 'CREATE',
    description: 'Draft an offline campaign: name, tracking code (used on its QR / short link), channel, placements, dates, quantity, vendor and cost in rupees, a tracking phone number or promo code, and the online campaign it belongs to. It stays a draft until sent for a second person\'s approval. Needs confirmation.',
    inputSchema: closed({ name: text(160), code: { type: 'string', pattern: '^[A-Za-z0-9_-]{3,40}$' }, ...offlineFields }, ['name', 'channelType', 'startsOn', 'endsOn']),
    permission: 'marketing.manage',
    service: 'growth.service.createOffline()',
    async prepare(_ctx, args) { return offlineBody(args); },
    summarise: (a, _actor, p) => `Draft the offline campaign "${a.name}"${a.code ? ` (${String(a.code).toUpperCase()})` : ''}: ${describeOffline(a, p?.campaign)}`,
    async run(ctx, _args, p) {
      const c = await growth.createOffline(ctx.actor, p.body);
      return did('offline_campaign_created', c, `Drafted ${c.code} "${c.name}". Send it for approval when ready.`);
    },
  }),

  update_offline_campaign: tool({
    module: 'Marketing', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Change an offline campaign: while a draft (or rejected) its plan — name, channel, placements, dates, quantity, vendor, tracking phone, promo code, campaign; at any time its actual cost (after approval a cost change needs a note, e.g. the vendor's final invoice). Money, so it is confirmed on the website.",
    inputSchema: closed({ campaign: text(160, 'Tracking code or name'), name: text(160), ...offlineFields, note: text(500) }, ['campaign']),
    permission: 'marketing.manage',
    service: 'growth.service.updateOffline()',
    async prepare(ctx, args) {
      const c = await offlineNamed(ctx, args.campaign);
      const { body, campaign } = await offlineBody({ ...args, code: undefined });
      if (!Object.keys(body).filter((k) => k !== 'note').length) throw ask('What should change on the campaign?');
      return { id: c.id, code: c.code, name: c.name, status: c.status, costPaise: c.costPaise, body, campaign };
    },
    summarise: (a, _actor, p) => `Update ${p?.code ?? a.campaign} "${p?.name ?? ''}" (${words(p?.status ?? '')}): ${[a.name && `rename to "${a.name}"`, describeOffline(a, p?.campaign), a.costRupees !== undefined && p && `(cost was ${r(p.costPaise)})`, a.note && `note: ${a.note}`].filter(Boolean).join(', ')}`,
    async run(ctx, _args, p) {
      const c = await growth.updateOffline(ctx.actor, p.id, p.body);
      return did('offline_campaign_updated', c, `${c.code} updated.`);
    },
  }),

  transition_offline_campaign: tool({
    module: 'Marketing', operation: 'ACTION', affectsOthers: true,
    description: 'Move an offline campaign along: SUBMIT it for a second person\'s approval (it needs a placement first), GO_LIVE once approved, COMPLETE it, or CANCEL it, with a note. Approving or rejecting is the approver\'s own decision (record_offline_campaign_decision). Confirmed on the website.',
    inputSchema: closed({ campaign: text(160, 'Tracking code or name'), step: oneOf(Object.keys(OFFLINE_STEPS)), note: text(1000) }, ['campaign', 'step']),
    permission: 'marketing.read',
    guard: offlineMover,
    service: 'growth.service.moveOffline()',
    async prepare(ctx, args) {
      const c = await offlineNamed(ctx, args.campaign, (x) => OFFLINE_STEPS[args.step].includes(x.status), `offline campaign that can ${words(args.step)}`);
      return { id: c.id, code: c.code, name: c.name, from: c.status };
    },
    summarise: (a, _actor, p) => `${{ SUBMIT: 'Send for approval', GO_LIVE: 'Mark live', COMPLETE: 'Mark completed', CANCEL: 'Cancel' }[a.step]}: ${p?.code ?? a.campaign} "${p?.name ?? ''}"${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, args, p) {
      const c = await growth.moveOffline(ctx.actor, p.id, { action: args.step, note: args.note });
      return did(`offline_campaign_${args.step.toLowerCase()}`, c, `${c.code} is now ${words(c.status)}.`);
    },
  }),

  record_offline_campaign_decision: tool({
    module: 'Marketing', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, approverDecision: true,
    description: "Record the approver's own decision on an offline campaign waiting for approval: APPROVE or REJECT (with what needs to change). For a marketing manager or the principal, never the campaign's creator. Recorded only when the approver states the decision in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({ campaign: text(160, 'Tracking code or name'), decision: decisionArg(['APPROVE', 'REJECT']), note: text(1000, 'Required to reject') }, ['campaign', 'decision']),
    permission: 'marketing.read',
    guard: offlineMover,
    service: 'growth.service.moveOffline() APPROVE / REJECT',
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.note) throw ask('Say what needs to change, so the creator knows.');
      const c = await offlineNamed(ctx, args.campaign, (x) => x.status === 'PENDING_APPROVAL', 'offline campaign waiting for approval');
      return { id: c.id, code: c.code, name: c.name, costPaise: c.costPaise };
    },
    summarise: (a, _actor, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Reject'} the offline campaign ${p?.code ?? a.campaign} "${p?.name ?? ''}" (${r(p?.costPaise)})${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, args, p) {
      const c = await growth.moveOffline(ctx.actor, p.id, { action: args.decision, note: args.note });
      return did('offline_campaign_decided', c, `Recorded: ${c.code} is ${words(c.status)}.`);
    },
  }),

  list_heard_from_options: tool({
    module: 'Marketing', operation: 'GET',
    description: 'The "how did you hear about us?" answers offered on the admission form and to counsellors, with the channel and offline campaign each traces to and whether it is shown. Read-only.',
    permission: 'marketing.read',
    service: 'growth.service.listHeardFrom()',
    async run() {
      const rows = await growth.listHeardFrom();
      return listed(rows, (o) => `${o.label} (${o.channelLabel}${o.active ? '' : ', hidden'})`, { noun: 'option' });
    },
  }),

  save_heard_from_option: tool({
    module: 'Marketing', operation: 'UPDATE', affectsOthers: true,
    description: 'Add or change a "how did you hear about us?" answer on the admission form: its label, the channel it counts towards, the offline campaign it traces to, its order, and whether it is shown. Families see it on the public form. Confirmed on the website.',
    inputSchema: closed({
      existing: text(80, 'The label of the option to change; leave out to add one'), label: text(80),
      channel: oneOf(growth.HEARD_FROM_CHANNELS), offlineCampaign: text(160, 'Tracking code or name'), order: int(0, 1000), active: bool(),
    }, ['label', 'channel']),
    permission: 'marketing.manage',
    service: 'growth.service.saveHeardFrom()',
    async prepare(ctx, args) {
      const row = args.existing ? pick(await growth.listHeardFrom(), args.existing, { label: 'option', nameOf: (o) => o.label, refOf: () => null }) : null;
      const c = args.offlineCampaign ? await offlineNamed(ctx, args.offlineCampaign) : null;
      return { id: row?.id ?? null, before: row?.label ?? null, offlineCampaignId: c?.id ?? null, campaign: c?.code ?? null };
    },
    summarise: (a, _actor, p) => `${p?.id ? `Change "${p.before}" to` : 'Add'} the option "${a.label}" (${words(a.channel)}${p?.campaign ? `, traced to ${p.campaign}` : ''}${a.active === false ? ', hidden' : ''})`,
    async run(ctx, args, p) {
      const o = await growth.saveHeardFrom(ctx.actor, { id: p.id ?? undefined, label: args.label, channel: args.channel, offlineCampaignId: p.offlineCampaignId, order: args.order, active: args.active });
      return did('heard_from_saved', o, `Saved "${o.label}".`);
    },
  }),

  get_enquiry_attribution: tool({
    module: 'Admissions', operation: 'GET',
    description: 'Where an admission enquiry came from: every recorded touch (QR or short link, UTM link, tracking phone, promo code, "how did you hear", lead form, manual) with the one credited (the earliest). Name the child. Read-only.',
    inputSchema: closed({ childName: text(80) }, ['childName']),
    permission: 'admissions.read',
    service: 'growth.service.leadAttribution()',
    async run(ctx, args) {
      const l = await enquiryNamed(args.childName);
      const a = await growth.leadAttribution(ctx.actor, l.id);
      return shown({ childName: l.childName, ...a }, a.credited ? `${l.childName}: credited to ${a.credited.channelLabel}${a.credited.detail ? ` (${a.credited.detail})` : ''}; ${a.touches.length} touch(es) recorded.` : `${l.childName}: no source recorded yet.`);
    },
  }),

  record_enquiry_source: tool({
    module: 'Admissions', operation: 'UPDATE',
    description: "Record how an admission enquiry heard of the school: a tracking code, promo code or tracking phone number they quoted, a \"how did you hear\" answer, or the campaign. The earliest source is the one credited. Name the child. Needs confirmation.",
    inputSchema: closed({
      childName: text(80), code: text(40, 'Tracking code'), promoCode: text(40), trackingPhone: text(20), heardFrom: text(80, 'The answer, as labelled'), campaign: text(160, 'Code or name'), note: text(300),
    }, ['childName']),
    permission: 'admissions.manage',
    service: 'growth.service.attributeLead()',
    async prepare(_ctx, args) {
      const l = await enquiryNamed(args.childName);
      const opt = args.heardFrom ? pick(await growth.listHeardFrom(), args.heardFrom, { label: 'answer', nameOf: (o) => o.label, refOf: () => null }) : null;
      const c = args.campaign ? await campaignNamed(args.campaign) : null;
      if (!args.code && !args.promoCode && !args.trackingPhone && !opt && !c) throw ask('What did the family quote: a code, promo code, phone number, an answer, or a campaign?');
      return { id: l.id, childName: l.childName, heardFromId: opt?.id ?? null, heardFrom: opt?.label ?? null, campaignId: c?.id ?? null, campaign: c?.code ?? null };
    },
    summarise: (a, _actor, p) => `Record the source of ${p?.childName ?? a.childName}'s enquiry: ${[a.code && `code ${a.code}`, a.promoCode && `promo ${a.promoCode}`, a.trackingPhone && `phone ${a.trackingPhone}`, p?.heardFrom && `"${p.heardFrom}"`, p?.campaign && `campaign ${p.campaign}`].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const a = await growth.attributeLead(ctx.actor, p.id, { code: args.code, promoCode: args.promoCode, trackingPhone: args.trackingPhone, heardFromId: p.heardFromId ?? undefined, campaignId: p.campaignId ?? undefined, note: args.note });
      return did('enquiry_source_recorded', { id: p.id, ...a }, `Recorded. ${p.childName} is credited to ${a.credited?.channelLabel ?? 'the source given'}.`);
    },
  }),

  get_marketing_settings: tool({
    module: 'Marketing', operation: 'GET',
    description: 'Marketing settings: the value of one admission used to work out return on spend (none set means no ROI is shown). Read-only.',
    permission: 'marketing.read',
    service: 'growth.service.getSettings()',
    async run() {
      const s = await growth.getSettings();
      return shown(s, s.admissionValuePaise ? `One admission is valued at ${r(s.admissionValuePaise)} for ROI.` : 'No admission value is set, so ROI is not shown.');
    },
  }),

  save_marketing_settings: tool({
    module: 'Marketing', operation: 'UPDATE',
    description: 'Set the value of one admission in rupees (used only to work out return on marketing spend), or clear it. Needs confirmation.',
    inputSchema: closed({ admissionValueRupees: num(0, 1e8, 'Leave out with clear=true to remove') , clear: bool('Remove the value') }),
    permission: 'marketing.manage',
    service: 'growth.service.saveSettings()',
    async prepare(_ctx, args) {
      if (!args.clear && !args.admissionValueRupees) throw ask('What is one admission worth, in rupees?');
      return undefined;
    },
    summarise: (a) => (a.clear ? 'Clear the admission value (no ROI shown)' : `Value one admission at ₹${Number(a.admissionValueRupees).toLocaleString('en-IN')} for ROI`),
    async run(ctx, args) {
      const s = await growth.saveSettings(ctx.actor, args.clear ? { admissionValuePaise: null } : { admissionValuePaise: paiseOf(args.admissionValueRupees, 'admissionValueRupees') });
      return did('marketing_settings_saved', null, s.admissionValuePaise ? `One admission is now valued at ${r(s.admissionValuePaise)}.` : 'Admission value cleared.');
    },
  }),

  get_marketing_attribution: tool({
    module: 'Marketing', operation: 'GET',
    description: 'The attribution report for enquiries in a period: per offline campaign, online campaign and channel — cost, enquiries, visits, applications, admissions, cost per enquiry and per admission, and ROI (simulated sample data is labelled). The CSV is downloaded on the Marketing page. Read-only.',
    inputSchema: closed({ from: dateStr('YYYY-MM-DD'), to: dateStr('YYYY-MM-DD') }),
    permission: 'marketing.read',
    service: 'growth.service.attributionReport()',
    async run(ctx, args) {
      const d = await growth.attributionReport(ctx.actor, args);
      const t = d.totals ?? {};
      return shown(d, `Enquiries ${t.enquiries ?? '—'}, admissions ${t.admissions ?? '—'}${t.costPaise !== undefined ? `, cost ${r(t.costPaise)}` : ''}.`);
    },
  }),
};

/* ── Connectors and integrations ──────────────────────────── */

const connectorTools = {
  list_ad_imports: tool({
    module: 'Marketing', operation: 'GET',
    description: 'The last ad-platform imports (performance and lead files): platform, file, rows accepted and rejected with the first problems, leads created and duplicates, and whether it was simulated sample data. Read-only.',
    inputSchema: closed({ platform: oneOf(CONNECTOR_PLATFORMS) }),
    permission: 'marketing.read',
    service: 'connectors.service.listImports()',
    async run(ctx, args) {
      const rows = await connectors.listImports(ctx.actor, args);
      return listed(rows, (i) => `${day(i.at)} ${words(i.platform)} ${words(i.kind)}: ${i.accepted} accepted, ${i.rejected} rejected${i.simulated ? ' (sample)' : ''}`, { noun: 'import' });
    },
  }),

  set_ad_sample_data: tool({
    module: 'Marketing', operation: 'ACTION',
    description: 'Load (on) or remove (off) clearly labelled, fictional sample figures for an ad platform, to try the reports before real data is imported. Real imports are untouched. Needs confirmation.',
    inputSchema: closed({ platform: oneOf(CONNECTOR_PLATFORMS), on: bool('true to load, false to remove') }, ['platform', 'on']),
    permission: 'marketing.manage',
    service: 'connectors.service.setSample()',
    summarise: (a) => `${a.on ? 'Load' : 'Remove'} simulated sample figures for ${words(a.platform)}`,
    async run(ctx, args) {
      const s = await connectors.setSample(ctx.actor, args.platform, args.on === true);
      return did('ad_sample_data_set', null, `${words(s.platform)}: ${s.simulatedRows} sample row(s) now loaded.`);
    },
  }),

  get_integration_connections: tool({
    module: 'Marketing', operation: 'GET',
    description: "The school's ad and social account connections (Meta, Google, LinkedIn ...): whether the provider app is set up, whether connected (live) or simulated, the chosen page / ad account, what the caller may connect, and the last error. Never a token. Connecting is done on the Integrations page. Read-only.",
    permission: 'marketing.read',
    service: 'oauth.service.overview()',
    async run(ctx) {
      const o = await oauth.overview(ctx.actor);
      const rows = o.providers.map(({ missingEnv: _m, scopes: _s, ...p }) => p);
      return listed(rows, (p) => `${p.label}: ${p.appConfigured ? words(p.connection?.status ?? 'not connected') : 'app not set up'} (${words(p.mode)})`, { noun: 'connection' });
    },
  }),

  sync_social_post_engagement: tool({
    module: 'Social', operation: 'ACTION', risk: RISK.LOW, feature: 'socialPublishing',
    description: 'Read the latest likes, comments and shares of a social post that was really sent, from each network it went to. Name the post by a few words of its text. Simulated posts have no engagement. Needs confirmation.',
    inputSchema: closed({ post: text(200, 'A few words from the post') }, ['post']),
    permission: 'social.publish',
    service: 'social.service.listPosts() + engagement.service.refreshPost()',
    async prepare(ctx, args) {
      const rows = (await social.listPosts(ctx.actor)).filter((p) => lower(p.text).includes(lower(args.post)));
      const p = pick(rows, null, { label: `post matching "${args.post}"`, describe: (x) => `"${excerpt(x.text, 50)}" (${day(x.createdAt)})` });
      return { id: p.id, text: excerpt(p.text, 80) };
    },
    summarise: (a, _actor, p) => `Read the latest engagement of the post "${p?.text ?? a.post}" from the networks`,
    async run(ctx, _args, p) {
      const out = await engagement.refreshPost(ctx.actor, p.id);
      return did('social_engagement_refreshed', { id: p.id, ...out }, `Updated ${out.updated} network(s): ${out.networks.map((n) => `${words(n.network)} ${n.engagement ? Object.entries(n.engagement).filter(([k, v]) => k !== 'at' && typeof v === 'number').map(([k, v]) => `${v} ${k}`).join(', ') : words(n.status)}`).join('; ')}.`);
    },
  }),
};

export const tools = {
  ...campaignTools,
  ...admissionTools,
  ...growthTools,
  ...connectorTools,
};
