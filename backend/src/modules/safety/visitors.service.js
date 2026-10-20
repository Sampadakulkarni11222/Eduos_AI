import mongoose from 'mongoose';
import { Visitor } from '../../models/safety.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  assertObjectId, assertTransition, dto, nextRef, oneOf, optionalText, parseDate, pushHistory, requireText,
} from '../ops/common.js';
import { getSettings, raiseAlert } from './shared.js';

/**
 * Visitors and contractors.
 *
 *   pre-registered → PENDING_HOST → host approves (APPROVED) or declines (REJECTED)
 *   APPROVED → CHECKED_IN (ID seen, badge issued with an expiry) → CHECKED_OUT
 *
 * A host who registers their own visitor approves it by doing so. The office
 * (visitors.manage) can record a host's approval given by phone, with a note.
 * A visitor still checked in after their badge expires raises one overstay
 * alert. We record that an ID was seen and its type and last four characters,
 * never the full number.
 */
const MACHINE = {
  PENDING_HOST: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [], REJECTED: [], CANCELLED: [],
};
const KINDS = ['VISITOR', 'CONTRACTOR', 'VENDOR', 'PARENT_VISIT', 'OFFICIAL'];

function present(v, now = new Date()) {
  const out = dto(v);
  out.overstaying = v.status === 'CHECKED_IN' && v.badge?.expiresAt && new Date(v.badge.expiresAt) < now;
  return out;
}

export async function list(query = {}) {
  const filter = {};
  if (query.status && query.status !== 'ALL') filter.status = String(query.status).toUpperCase();
  if (query.view === 'onsite') filter.status = 'CHECKED_IN';
  if (query.view === 'today') {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    filter.$or = [{ expectedAt: { $gte: new Date(start.getTime() - 330 * 60_000), $lt: new Date(start.getTime() + 86_400_000) } }, { status: 'CHECKED_IN' }];
  }
  const rows = await Visitor.find(filter).sort({ expectedAt: -1, createdAt: -1 }).limit(300).lean();
  return rows.map((r) => present(r));
}

/** Visitors waiting for this person's decision as host. */
export async function mineAsHost(actor) {
  const rows = await Visitor.find({ hostProfileId: actor.profileId, status: { $in: ['PENDING_HOST', 'APPROVED', 'CHECKED_IN'] } }).sort({ expectedAt: 1 }).limit(100).lean();
  return rows.map((r) => present(r));
}

export async function create(actor, body = {}) {
  const hostProfileId = body.hostProfileId ? assertObjectId(body.hostProfileId, 'hostProfileId') : actor.profileId;
  const host = await Profile.findOne({ _id: hostProfileId, deletedAt: null }).select('_id displayName').lean();
  if (!host) throw new AppError('The host is not a person in this school.', 404);
  const selfHosted = String(hostProfileId) === String(actor.profileId);
  const v = new Visitor({
    refNo: await nextRef('VIS'),
    kind: oneOf(body.kind, KINDS, 'kind', 'VISITOR'),
    name: requireText(body.name, 'name', { max: 120 }),
    phone: optionalText(body.phone, { max: 20 }) || null,
    organisation: optionalText(body.organisation, { max: 160 }) || null,
    purpose: requireText(body.purpose, 'purpose', { max: 300 }),
    location: optionalText(body.location, { max: 160 }) || null,
    facilityId: body.facilityId && mongoose.isValidObjectId(body.facilityId) ? body.facilityId : null,
    hostProfileId: host._id, hostName: host.displayName,
    expectedAt: parseDate(body.expectedAt, 'expectedAt') ?? new Date(),
    expectedHours: body.expectedHours ? Math.min(Math.max(Number(body.expectedHours) || 1, 0.25), 24) : null,
    contractorCheckNote: optionalText(body.contractorCheckNote, { max: 500 }) || null,
    status: selfHosted ? 'APPROVED' : 'PENDING_HOST',
  });
  if (v.kind === 'CONTRACTOR' && !v.contractorCheckNote) throw new AppError('For a contractor, record the work order or the check done (contractorCheckNote).', 400);
  if (selfHosted) v.hostDecision = { by: actor.profileId, at: new Date(), decision: 'APPROVED', note: 'Registered by the host' };
  pushHistory(v, actor, 'REGISTERED', { to: v.status });
  await v.save();
  if (!selfHosted) {
    await sendOperational({
      templateKey: 'VISITOR_UPDATE', recipientProfileIds: [String(host._id)], variables: { name: v.name, purpose: v.purpose, update: 'is asking to meet you; please approve or decline' },
      link: `/gate?tab=visitors&id=${v._id}`, idempotencyKey: `visitor:${v._id}:host`, relatedEntityType: 'Visitor', relatedEntityId: v._id,
    });
  }
  return present(v.toObject());
}

async function load(id) {
  const v = await Visitor.findById(assertObjectId(id));
  if (!v) throw new AppError('Visitor not found', 404);
  return v;
}

/** The host decides; the office may record a host's decision given by phone (with a note). */
export async function hostDecision(actor, id, body = {}) {
  const v = await load(id);
  const isHost = String(v.hostProfileId) === String(actor.profileId);
  const isOffice = Boolean(actor.permissions?.['visitors.manage']);
  if (!isHost && !isOffice) throw new AppError('Visitor not found', 404);
  const decision = oneOf(body.decision, ['APPROVED', 'REJECTED'], 'decision');
  const note = isHost ? optionalText(body.note, { max: 500 }) || null : requireText(body.note, 'note (how the host gave their decision)', { max: 500 });
  assertTransition(MACHINE, v.status, decision, 'visit');
  pushHistory(v, actor, decision, { from: v.status, to: decision, note });
  v.status = decision;
  v.hostDecision = { by: actor.profileId, at: new Date(), decision, note: isHost ? note : `Recorded by office: ${note}` };
  await v.save();
  return present(v.toObject());
}

export async function checkIn(actor, id, body = {}) {
  const v = await load(id);
  assertTransition(MACHINE, v.status, 'CHECKED_IN', 'visit');
  if (body.idVerified !== true) throw new AppError('Check the visitor\'s photo ID before check-in (idVerified).', 400, [], 'ID_NOT_VERIFIED');
  const settings = await getSettings();
  const now = new Date();
  const hours = v.expectedHours ?? Math.min(Math.max(Number(body.badgeHours) || settings.visitors.defaultBadgeHours, 0.25), 24);
  const last4 = optionalText(body.idLast4, { max: 64 })?.replace(/[^A-Za-z0-9]/g, '');
  v.idVerified = true;
  v.idType = optionalText(body.idType, { max: 40 }) || null;
  v.idLast4 = last4 ? last4.slice(-4) : null;
  v.badge = { number: optionalText(body.badgeNumber, { max: 20 }) || v.refNo.split('/').pop(), issuedAt: now, expiresAt: new Date(now.getTime() + hours * 3_600_000) };
  v.checkedInAt = now;
  pushHistory(v, actor, 'CHECKED_IN', { from: v.status, to: 'CHECKED_IN' });
  v.status = 'CHECKED_IN';
  await v.save();
  if (v.hostProfileId && String(v.hostProfileId) !== String(actor.profileId)) {
    await sendOperational({
      templateKey: 'VISITOR_UPDATE', recipientProfileIds: [String(v.hostProfileId)], variables: { name: v.name, purpose: v.purpose, update: 'has arrived at reception' },
      link: `/gate?tab=visitors&id=${v._id}`, idempotencyKey: `visitor:${v._id}:arrived`, relatedEntityType: 'Visitor', relatedEntityId: v._id,
    });
  }
  return present(v.toObject());
}

export async function checkOut(actor, id, body = {}) {
  const v = await load(id);
  assertTransition(MACHINE, v.status, 'CHECKED_OUT', 'visit');
  pushHistory(v, actor, 'CHECKED_OUT', { from: v.status, to: 'CHECKED_OUT', note: body.note });
  v.status = 'CHECKED_OUT';
  v.checkedOutAt = new Date();
  await v.save();
  return present(v.toObject());
}

export async function cancel(actor, id, body = {}) {
  const v = await load(id);
  assertTransition(MACHINE, v.status, 'CANCELLED', 'visit');
  pushHistory(v, actor, 'CANCELLED', { from: v.status, to: 'CANCELLED', note: body.note });
  v.status = 'CANCELLED';
  await v.save();
  return present(v.toObject());
}

/** Overstay alerts (scheduled): one per visit. */
export async function alertOverstays({ now = new Date() } = {}) {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.visitors.overstayGraceMinutes * 60_000);
  const rows = await Visitor.find({ status: 'CHECKED_IN', 'badge.expiresAt': { $lt: cutoff }, overstayAlertedAt: null }).limit(200);
  let n = 0;
  for (const v of rows) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await Visitor.updateOne({ _id: v._id, overstayAlertedAt: null }, { $set: { overstayAlertedAt: now } });
    if (!claimed.modifiedCount) continue;
    n += 1;
    // eslint-disable-next-line no-await-in-loop
    await raiseAlert({
      kind: 'VISITOR_OVERSTAY', department: 'GATE', refType: 'Visitor', refId: v._id,
      message: `${v.name} (${v.refNo}) is still checked in after the badge expired`, dedupeKey: `visitor:${v._id}:overstay`,
      notifyPermission: 'visitors.manage', notifyProfileIds: v.hostProfileId ? [String(v.hostProfileId)] : [], link: `/gate?tab=visitors&id=${v._id}`, now,
    });
  }
  return { overstays: n };
}
