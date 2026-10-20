import { Lab, LabItem, LabBatch, LabMovement, LabEquipment, LabDevice, LabSoftware, PracticalSession, LabIncident, LAB_TYPES, HAZARD_CLASSES, STORAGE_GROUPS, ITEM_KINDS } from '../../models/lab.model.js';
import { Facility } from '../../models/facility.model.js';
import { Vendor } from '../../models/finance.model.js';
import { AppError } from '../../utils/AppError.js';
import { nextSequence } from '../../utils/sequence.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { createRequestDraft } from '../finance-ops/procurement.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, pageArgs, profileNames, escapeRegex,
} from '../ops/common.js';
import { ownLabIds, labFilter, loadLab, isStaff, roleKeyOf } from './labs.access.js';
import { normaliseUnit, baseUnitOf, toBase, fromBase, formatQty } from './units.js';
import { syncBatchDue, syncReorderDue } from './labs.due.js';
import { logger } from '../../utils/logger.js';

/**
 * Labs, their stock catalogue and the stock ledger.
 *
 * Stock lives in batches. Every change to a batch's quantity is one
 * conditional update (`quantity >= n` in the filter, `$inc` in the update)
 * inside a transaction with the ledger row it explains, so two people issuing
 * from the same bottle at once can never take it below zero, and the ledger
 * always adds up to the shelf. Issue and consumption refuse expired or
 * quarantined batches; disposal needs a member of staff and evidence.
 */

const DAY = 86_400_000;

async function nextCode(prefix) {
  const n = await nextSequence(`labcode:${currentTenantId() ?? 'platform'}:${prefix}`);
  return `${prefix}-${String(n).padStart(6, '0')}`;
}
export { nextCode as nextLabCode };

const safely = (p, what) => p.catch((err) => logger.error(`Lab task sync (${what}) failed: ${err.message}`));

// ── Labs ──────────────────────────────────────────────────────────────────

function labFields(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 120 });
  if (!partial || body.type !== undefined) out.type = oneOf(body.type, LAB_TYPES, 'type');
  if (body.capacity !== undefined) out.capacity = body.capacity === null || body.capacity === '' ? null : Math.max(0, Math.min(Number.parseInt(body.capacity, 10) || 0, 500));
  if (body.inChargeProfileIds !== undefined) out.inChargeProfileIds = (Array.isArray(body.inChargeProfileIds) ? body.inChargeProfileIds : []).slice(0, 5).map((id) => assertObjectId(id, 'inChargeProfileIds'));
  if (body.assistantProfileId !== undefined) out.assistantProfileId = body.assistantProfileId ? assertObjectId(body.assistantProfileId, 'assistantProfileId') : null;
  if (body.safetyChecklist !== undefined) {
    out.safetyChecklist = (Array.isArray(body.safetyChecklist) ? body.safetyChecklist : []).slice(0, 40)
      .map((c) => (typeof c === 'string' ? { item: c } : c))
      .filter((c) => c && typeof c.item === 'string' && c.item.trim())
      .map((c) => ({ item: c.item.trim().slice(0, 200), required: c.required !== false }));
  }
  if (body.alertDays !== undefined) out.alertDays = Math.max(7, Math.min(Number.parseInt(body.alertDays, 10) || 60, 365));
  if (body.notes !== undefined) out.notes = optionalText(body.notes, { max: 2000 }) || null;
  if (body.status !== undefined) out.status = oneOf(body.status, ['ACTIVE', 'CLOSED'], 'status');
  return out;
}

export async function createLab(actor, body = {}) {
  requireProfile(actor);
  const facility = await Facility.findById(assertObjectId(body.facilityId, 'facilityId')).lean();
  if (!facility) throw new AppError('Facility not found', 404);
  if (await Lab.exists({ facilityId: facility._id })) throw new AppError(`${facility.name} already has a lab profile.`, 409, [], 'LAB_EXISTS');
  const lab = new Lab({ facilityId: facility._id, capacity: facility.capacity ?? null, ...labFields({ name: facility.name, ...body }) });
  if (!lab.inChargeProfileIds.length && facility.inChargeProfileId) lab.inChargeProfileIds = [facility.inChargeProfileId];
  pushHistory(lab, actor, 'CREATED');
  await lab.save();
  return presentLab(lab.toObject());
}

export async function updateLab(actor, scope, id, body = {}) {
  const lab = await loadLab(actor, scope, id);
  const fields = labFields(body, true);
  // A person who runs a lab at OWN scope cannot hand it to someone else or take themselves off it.
  if (scope !== 'ALL') { delete fields.inChargeProfileIds; delete fields.status; }
  Object.assign(lab, fields);
  pushHistory(lab, actor, 'UPDATED');
  await lab.save();
  return presentLab(lab.toObject());
}

async function presentLab(lab, extra = {}) {
  const names = await profileNames([...(lab.inChargeProfileIds ?? []), lab.assistantProfileId]);
  const facility = await Facility.findById(lab.facilityId).select('code name').lean();
  const out = dto(lab);
  delete out.history;
  return {
    ...out,
    facilityCode: facility?.code ?? null, facilityName: facility?.name ?? null,
    inChargeNames: (lab.inChargeProfileIds ?? []).map((p) => names.get(String(p))).filter(Boolean),
    assistantName: lab.assistantProfileId ? names.get(String(lab.assistantProfileId)) ?? null : null,
    ...extra,
  };
}

/** Every lab the actor may see, with the numbers that need attention. */
export async function listLabs(actor, scope) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = ids === null ? {} : { _id: { $in: ids } };
  const labs = await Lab.find(filter).sort({ name: 1 }).lean();
  const now = new Date();
  const labIds = labs.map((l) => l._id);
  const [batches, items, equipment, devices, sessions, incidents] = await Promise.all([
    LabBatch.find({ labId: { $in: labIds }, status: { $in: ['ACTIVE', 'QUARANTINED'] }, quantity: { $gt: 0 } }).select('labId itemId quantity expiresOn status').lean(),
    LabItem.find({ labId: { $in: labIds }, active: true }).select('labId minStock').lean(),
    LabEquipment.find({ labId: { $in: labIds }, status: 'ACTIVE' }).select('labId outOfService calibrationRequired calibrationDueOn').lean(),
    LabDevice.find({ labId: { $in: labIds }, status: { $ne: 'DECOMMISSIONED' } }).select('labId status').lean(),
    PracticalSession.find({ labId: { $in: labIds }, startsAt: { $gte: now, $lt: new Date(now.getTime() + 7 * DAY) }, status: { $nin: ['CANCELLED', 'COMPLETED'] } }).select('labId').lean(),
    LabIncident.find({ labId: { $in: labIds }, status: 'OPEN' }).select('labId').lean(),
  ]);
  const usable = new Map();
  for (const b of batches) if (b.status === 'ACTIVE' && (!b.expiresOn || new Date(b.expiresOn) > now)) usable.set(String(b.itemId), (usable.get(String(b.itemId)) ?? 0) + b.quantity);
  const count = (rows, lab, pred = () => true) => rows.filter((r) => String(r.labId) === String(lab._id) && pred(r)).length;
  const out = [];
  for (const lab of labs) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await presentLab(lab, {
      counts: {
        items: count(items, lab),
        lowStock: count(items, lab, (i) => i.minStock > 0 && (usable.get(String(i._id)) ?? 0) < i.minStock),
        expired: count(batches, lab, (b) => b.expiresOn && new Date(b.expiresOn) <= now),
        expiringSoon: count(batches, lab, (b) => b.expiresOn && new Date(b.expiresOn) > now && new Date(b.expiresOn) - now <= (lab.alertDays ?? 60) * DAY),
        quarantined: count(batches, lab, (b) => b.status === 'QUARANTINED'),
        equipment: count(equipment, lab),
        outOfService: count(equipment, lab, (e) => e.outOfService),
        calibrationOverdue: count(equipment, lab, (e) => e.calibrationRequired && e.calibrationDueOn && new Date(e.calibrationDueOn) < now),
        devices: count(devices, lab),
        devicesInRepair: count(devices, lab, (d) => d.status === 'IN_REPAIR'),
        sessionsThisWeek: count(sessions, lab),
        openIncidents: count(incidents, lab),
      },
    }));
  }
  return out;
}

export async function getLab(actor, scope, id) {
  const lab = await loadLab(actor, scope, id);
  return presentLab(lab.toObject());
}

// ── Catalogue ─────────────────────────────────────────────────────────────

function itemFields(body, partial = false, existing = null) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 160 });
  if (body.kind !== undefined || !partial) out.kind = oneOf(body.kind, ITEM_KINDS, 'kind', 'CHEMICAL');
  if (!partial || body.unit !== undefined) {
    if (existing && body.unit !== undefined && baseUnitOf(body.unit) !== existing.baseUnit) throw new AppError('An item cannot change from mass to volume or pieces; add a new item.', 400, [], 'UNIT_MISMATCH');
    out.displayUnit = normaliseUnit(body.unit ?? 'pcs');
    out.baseUnit = baseUnitOf(out.displayUnit);
  }
  const unitBase = out.baseUnit ?? existing?.baseUnit;
  const unit = out.displayUnit ?? existing?.displayUnit;
  if (body.casNo !== undefined) {
    const cas = optionalText(body.casNo, { max: 20 }) || null;
    if (cas && !/^\d{2,7}-\d{2}-\d$/.test(cas)) throw new AppError('casNo looks wrong (expected digits-digits-digit, e.g. 7647-01-0)', 400);
    out.casNo = cas;
  }
  if (body.hazardClasses !== undefined) out.hazardClasses = [...new Set((Array.isArray(body.hazardClasses) ? body.hazardClasses : []).map((h) => oneOf(h, HAZARD_CLASSES, 'hazardClasses')))];
  if (body.storageGroup !== undefined) out.storageGroup = oneOf(body.storageGroup, STORAGE_GROUPS, 'storageGroup', 'GENERAL');
  if (body.minStock !== undefined) out.minStock = body.minStock === '' || body.minStock === null ? 0 : toBase(body.minStock, body.minStockUnit ?? unit, unitBase, { allowZero: true });
  if (body.reorderQty !== undefined) out.reorderQty = body.reorderQty === '' || body.reorderQty === null ? 0 : toBase(body.reorderQty, body.reorderUnit ?? unit, unitBase, { allowZero: true });
  if (body.estUnitPaise !== undefined) {
    const n = Number(body.estUnitPaise);
    if (!Number.isInteger(n) || n < 0) throw new AppError('estUnitPaise must be whole paise', 400);
    out.estUnitPaise = n;
  }
  if (body.sdsUrl !== undefined) out.sdsUrl = optionalText(body.sdsUrl, { max: 1000 }) || null;
  if (body.restricted !== undefined) out.restricted = body.restricted === true;
  if (body.location !== undefined) out.location = optionalText(body.location, { max: 120 }) || null;
  if (body.active !== undefined) out.active = body.active !== false;
  return out;
}

export async function createItem(actor, scope, labId, body = {}) {
  const lab = await loadLab(actor, scope, labId);
  const item = new LabItem({ labId: lab._id, ...itemFields(body) });
  if (Array.isArray(body.sds)) item.sds = cleanAttachments(body.sds, actor);
  // A hazardous item is in a storage group that says so, never "GENERAL" by default.
  if (item.hazardClasses.includes('FLAMMABLE') && item.storageGroup === 'GENERAL') item.storageGroup = 'FLAMMABLE';
  pushHistory(item, actor, 'CREATED');
  await item.save();
  return presentItem(item.toObject(), []);
}

export async function updateItem(actor, scope, id, body = {}) {
  const item = await LabItem.findById(assertObjectId(id));
  if (!item) throw new AppError('Item not found', 404);
  await loadLab(actor, scope, item.labId);
  Object.assign(item, itemFields(body, true, item));
  if (Array.isArray(body.sds)) item.sds.push(...cleanAttachments(body.sds, actor));
  pushHistory(item, actor, 'UPDATED');
  await item.save();
  await safely(syncReorderDue(item.toObject()), 'reorder');
  return presentItem(item.toObject(), await LabBatch.find({ itemId: item._id }).lean());
}

function presentBatch(b, item, now = new Date()) {
  const out = dto(b);
  const expired = Boolean(b.expiresOn && new Date(b.expiresOn) <= now);
  out.expired = expired;
  out.daysToExpiry = b.expiresOn ? Math.ceil((new Date(b.expiresOn) - now) / DAY) : null;
  out.issuable = b.status === 'ACTIVE' && !expired && b.quantity > 0;
  if (item) {
    out.displayUnit = item.displayUnit;
    out.quantityDisplay = fromBase(b.quantity, item.displayUnit);
    out.initialDisplay = fromBase(b.initialQuantity, item.displayUnit);
    out.itemName = item.name;
  }
  return out;
}

function presentItem(item, batches, now = new Date()) {
  const out = dto(item);
  delete out.history;
  const live = batches.filter((b) => ['ACTIVE', 'QUARANTINED'].includes(b.status) && b.quantity > 0);
  const usable = live.filter((b) => b.status === 'ACTIVE' && (!b.expiresOn || new Date(b.expiresOn) > now));
  out.onHand = usable.reduce((n, b) => n + b.quantity, 0);
  out.onHandDisplay = fromBase(out.onHand, item.displayUnit);
  out.expiredQuantity = live.filter((b) => b.expiresOn && new Date(b.expiresOn) <= now).reduce((n, b) => n + b.quantity, 0);
  out.quarantinedQuantity = live.filter((b) => b.status === 'QUARANTINED').reduce((n, b) => n + b.quantity, 0);
  out.minStockDisplay = fromBase(item.minStock ?? 0, item.displayUnit);
  out.lowStock = (item.minStock ?? 0) > 0 && out.onHand < item.minStock;
  out.hazardous = (item.hazardClasses ?? []).length > 0;
  const next = usable.filter((b) => b.expiresOn).sort((a, b) => new Date(a.expiresOn) - new Date(b.expiresOn))[0];
  out.nextExpiry = next?.expiresOn ?? null;
  out.batches = live.map((b) => presentBatch(b, item, now)).sort((a, b) => (a.expiresOn ? new Date(a.expiresOn).getTime() : Infinity) - (b.expiresOn ? new Date(b.expiresOn).getTime() : Infinity));
  return out;
}

export async function listItems(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = { ...labFilter(ids) };
  if (query.labId) {
    const id = assertObjectId(query.labId, 'labId');
    if (ids !== null && !ids.includes(id)) throw new AppError('Lab not found', 404);
    filter.labId = id;
  }
  if (query.q) filter.$or = [{ name: { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: 'i' } }, { casNo: String(query.q).slice(0, 20) }];
  if (query.active !== 'all') filter.active = true;
  const items = await LabItem.find(filter).sort({ name: 1 }).limit(2000).lean();
  const batches = await LabBatch.find({ itemId: { $in: items.map((i) => i._id) }, status: { $in: ['ACTIVE', 'QUARANTINED'] } }).lean();
  const byItem = new Map();
  for (const b of batches) byItem.set(String(b.itemId), [...(byItem.get(String(b.itemId)) ?? []), b]);
  let rows = items.map((i) => presentItem(i, byItem.get(String(i._id)) ?? []));
  if (query.filter === 'low') rows = rows.filter((r) => r.lowStock);
  if (query.filter === 'expiring') rows = rows.filter((r) => r.batches.some((b) => b.daysToExpiry !== null && b.daysToExpiry <= 60));
  if (query.filter === 'hazardous') rows = rows.filter((r) => r.hazardous);
  return rows;
}

// ── Stock: receive, issue, return, consume, damage, dispose, stocktake ──

async function loadBatch(actor, scope, { batchId, code }) {
  let batch;
  if (batchId) batch = await LabBatch.findById(assertObjectId(batchId, 'batchId')).lean();
  else if (code) batch = await LabBatch.findOne({ code: String(code).trim().toUpperCase().slice(0, 40) }).lean();
  else throw new AppError('Scan a batch code or choose a batch.', 400);
  if (!batch) throw new AppError('Batch not found', 404);
  const lab = await loadLab(actor, scope, batch.labId);
  const item = await LabItem.findById(batch.itemId).lean();
  return { batch, lab, item };
}

async function writeMovement(actor, { lab, item, batch, type, quantity, balanceAfter, body = {}, extra = {} }) {
  const [m] = await LabMovement.create([{
    refNo: await nextRef('LSM'),
    labId: lab._id, itemId: item._id, batchId: batch._id, type, quantity, balanceAfter,
    reason: optionalText(body.reason, { max: 1000 }) || null,
    sessionId: body.sessionId ? assertObjectId(body.sessionId, 'sessionId') : null,
    evidence: cleanAttachments(body.evidence, actor),
    scannedCode: body.code ? String(body.code).slice(0, 40) : null,
    byProfileId: actor.profileId ?? null, byName: actor.displayName ?? null,
    ...extra,
  }]);
  return m;
}

function presentMovement(m, item) {
  const out = dto(m);
  if (item) { out.displayUnit = item.displayUnit; out.quantityDisplay = fromBase(m.quantity, item.displayUnit); out.balanceDisplay = fromBase(m.balanceAfter, item.displayUnit); out.itemName = item.name; }
  return out;
}

export async function receive(actor, scope, itemId, body = {}) {
  requireProfile(actor);
  const item = await LabItem.findById(assertObjectId(itemId, 'itemId')).lean();
  if (!item) throw new AppError('Item not found', 404);
  const lab = await loadLab(actor, scope, item.labId);
  const quantity = toBase(body.quantity, body.unit ?? item.displayUnit, item.baseUnit);
  const expiresOn = parseDate(body.expiresOn, 'expiresOn');
  if (item.kind === 'CHEMICAL' && !expiresOn && body.noExpiry !== true) throw new AppError('Record the expiry date printed on the container (or tick "no expiry").', 400, [], 'EXPIRY_REQUIRED');
  let vendorName = optionalText(body.supplierName, { max: 160 }) || null;
  if (body.vendorId) {
    const v = await Vendor.findById(assertObjectId(body.vendorId, 'vendorId')).select('name').lean();
    if (!v) throw new AppError('Vendor not found', 404);
    vendorName = vendorName ?? v.name;
  }
  const code = await nextCode('LB');
  const out = await runInAmbientTransaction(async () => {
    const [batch] = await LabBatch.create([{
      labId: lab._id, itemId: item._id, code, lotNo: optionalText(body.lotNo, { max: 60 }) || null,
      vendorId: body.vendorId || null, supplierName: vendorName, purchaseRequestId: body.purchaseRequestId ? assertObjectId(body.purchaseRequestId, 'purchaseRequestId') : null,
      receivedOn: parseDate(body.receivedOn, 'receivedOn') ?? new Date(), openedOn: parseDate(body.openedOn, 'openedOn'), expiresOn,
      initialQuantity: quantity, quantity, location: optionalText(body.location, { max: 120 }) || item.location || null,
      status: expiresOn && expiresOn <= new Date() ? 'QUARANTINED' : 'ACTIVE',
      quarantineReason: expiresOn && expiresOn <= new Date() ? 'Received already expired' : null,
    }]);
    const movement = await writeMovement(actor, { lab, item, batch, type: 'RECEIPT', quantity, balanceAfter: quantity, body: { ...body, reason: body.reason ?? (vendorName ? `From ${vendorName}` : null) } });
    return { batch: batch.toObject(), movement: movement.toObject() };
  });
  await safely(syncBatchDue(out.batch, { item, lab: lab.toObject() }), 'batch');
  await safely(syncReorderDue(item, { lab: lab.toObject() }), 'reorder');
  return { batch: presentBatch(out.batch, item), movement: presentMovement(out.movement, item) };
}

const OUT_TYPES = ['ISSUE', 'CONSUMED', 'DAMAGED', 'DISPOSED'];

/**
 * Takes stock out of one batch. The batch filter carries every rule (status,
 * not expired, enough left), so the rule and the decrement are one atomic
 * operation; when it matches nothing, the batch is re-read only to say why.
 */
export async function moveOut(actor, scope, type, body = {}) {
  requireProfile(actor);
  const kind = oneOf(type, OUT_TYPES, 'type');
  const { batch, lab, item } = await loadBatch(actor, scope, body);
  const quantity = toBase(body.quantity, body.unit ?? item.displayUnit, item.baseUnit);
  const hazardous = (item.hazardClasses ?? []).length > 0;

  if (kind === 'DISPOSED') {
    if (!isStaff(actor)) throw new AppError('Disposal is done by staff.', 403, [], 'STAFF_ONLY');
    requireText(body.reason, 'reason (how it was disposed of)', { max: 1000 });
    if (!cleanAttachments(body.evidence, actor).length) throw new AppError('Attach evidence of disposal (photo, disposal note or contractor receipt).', 400, [], 'EVIDENCE_REQUIRED');
  }
  if (kind === 'DAMAGED') requireText(body.reason, 'reason', { max: 1000 });
  let issuedTo = null;
  if (kind === 'ISSUE') {
    if (body.issuedToProfileId) {
      issuedTo = assertObjectId(body.issuedToProfileId, 'issuedToProfileId');
      const role = await roleKeyOf(issuedTo);
      if (!role) throw new AppError('That person is not in this school.', 404);
      // Students do not handle hazardous material: it is issued to the supervising teacher.
      if (hazardous && ['STUDENT', 'PARENT', 'ALUMNUS'].includes(role)) throw new AppError(`${item.name} is hazardous and is issued to the supervising teacher, not to a student.`, 403, [], 'HAZARD_STUDENT');
    }
    if (hazardous && !isStaff(actor)) throw new AppError('Hazardous items are issued by staff.', 403, [], 'STAFF_ONLY');
  }

  const now = new Date();
  const filter = { _id: batch._id, quantity: { $gte: quantity } };
  if (kind === 'ISSUE' || kind === 'CONSUMED') {
    filter.status = 'ACTIVE';
    filter.$or = [{ expiresOn: null }, { expiresOn: { $gt: now } }];
  } else {
    filter.status = { $in: ['ACTIVE', 'QUARANTINED', 'EXHAUSTED'] };
  }

  const out = await runInAmbientTransaction(async () => {
    const updated = await LabBatch.findOneAndUpdate(filter, { $inc: { quantity: -quantity } }, { new: true });
    if (!updated) {
      const current = await LabBatch.findById(batch._id).lean();
      if ((kind === 'ISSUE' || kind === 'CONSUMED') && current.expiresOn && new Date(current.expiresOn) <= now) {
        throw new AppError(`Batch ${current.code} expired on ${new Date(current.expiresOn).toISOString().slice(0, 10)} and cannot be issued. Quarantine and dispose of it.`, 409, [], 'BATCH_EXPIRED');
      }
      if ((kind === 'ISSUE' || kind === 'CONSUMED') && current.status === 'QUARANTINED') {
        throw new AppError(`Batch ${current.code} is quarantined${current.quarantineReason ? ` (${current.quarantineReason})` : ''} and cannot be issued.`, 409, [], 'BATCH_QUARANTINED');
      }
      if (current.status === 'DISPOSED') throw new AppError(`Batch ${current.code} has been disposed of.`, 409, [], 'BATCH_DISPOSED');
      throw new AppError(`Only ${formatQty(current.quantity, item.displayUnit)} left in batch ${current.code}.`, 409, [], 'INSUFFICIENT_STOCK');
    }
    if (updated.quantity === 0) {
      updated.status = kind === 'DISPOSED' ? 'DISPOSED' : 'EXHAUSTED';
      await updated.save();
    }
    const movement = await writeMovement(actor, {
      lab, item, batch: updated, type: kind, quantity: -quantity, balanceAfter: updated.quantity, body,
      extra: { issuedToProfileId: issuedTo, issuedToName: optionalText(body.issuedToName, { max: 120 }) || null },
    });
    return { batch: updated.toObject(), movement: movement.toObject() };
  });
  await safely(syncBatchDue(out.batch, { item, lab: lab.toObject() }), 'batch');
  await safely(syncReorderDue(item, { lab: lab.toObject() }), 'reorder');
  return { batch: presentBatch(out.batch, item), movement: presentMovement(out.movement, item) };
}

/** Brings issued stock back to its batch, never more than was issued on that issue. */
export async function returnStock(actor, scope, body = {}) {
  requireProfile(actor);
  const issue = await LabMovement.findById(assertObjectId(body.issueMovementId, 'issueMovementId')).lean();
  if (!issue || issue.type !== 'ISSUE') throw new AppError('Issue not found', 404);
  const { batch, lab, item } = await loadBatch(actor, scope, { batchId: issue.batchId });
  const quantity = toBase(body.quantity, body.unit ?? item.displayUnit, item.baseUnit);
  const out = await runInAmbientTransaction(async () => {
    const [{ returned = 0 } = {}] = await LabMovement.aggregate([{ $match: { againstMovementId: issue._id, type: 'RETURN' } }, { $group: { _id: null, returned: { $sum: '$quantity' } } }]);
    const outstanding = -issue.quantity - returned;
    if (quantity > outstanding) throw new AppError(`Only ${formatQty(outstanding, item.displayUnit)} of that issue is still out.`, 409, [], 'RETURN_EXCEEDS_ISSUE');
    const updated = await LabBatch.findOneAndUpdate({ _id: batch._id, status: { $ne: 'DISPOSED' } }, { $inc: { quantity } }, { new: true });
    if (!updated) throw new AppError('That batch has been disposed of; record the returned stock as a new receipt.', 409, [], 'BATCH_DISPOSED');
    if (updated.status === 'EXHAUSTED') { updated.status = 'ACTIVE'; await updated.save(); }
    const movement = await writeMovement(actor, { lab, item, batch: updated, type: 'RETURN', quantity, balanceAfter: updated.quantity, body, extra: { againstMovementId: issue._id } });
    return { batch: updated.toObject(), movement: movement.toObject() };
  });
  await safely(syncReorderDue(item, { lab: lab.toObject() }), 'reorder');
  return { batch: presentBatch(out.batch, item), movement: presentMovement(out.movement, item) };
}

/**
 * A stocktake: what was counted on the shelf, batch by batch. Each difference
 * becomes an ADJUSTMENT with the stated reason, applied only if the batch has
 * not moved since it was counted against (otherwise the line is refused and
 * the count is redone for that batch).
 */
export async function stocktake(actor, scope, labId, body = {}) {
  requireProfile(actor);
  const lab = await loadLab(actor, scope, labId);
  const reason = requireText(body.reason, 'reason', { max: 500 });
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 500);
  if (!lines.length) throw new AppError('Add at least one counted batch.', 400);
  const results = [];
  for (const line of lines) {
    // eslint-disable-next-line no-await-in-loop
    const { batch, item } = await loadBatch(actor, scope, line);
    if (String(batch.labId) !== String(lab._id)) throw new AppError(`Batch ${batch.code} belongs to another lab.`, 400);
    const counted = toBase(line.counted, line.unit ?? item.displayUnit, item.baseUnit, { allowZero: true });
    const expected = line.expected !== undefined && line.expected !== null && line.expected !== '' ? toBase(line.expected, line.unit ?? item.displayUnit, item.baseUnit, { allowZero: true }) : batch.quantity;
    const delta = counted - expected;
    if (delta === 0) { results.push({ batchId: String(batch._id), code: batch.code, itemName: item.name, delta: 0, applied: false }); continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      const movement = await runInAmbientTransaction(async () => {
        const updated = await LabBatch.findOneAndUpdate(
          { _id: batch._id, quantity: expected, status: { $ne: 'DISPOSED' } },
          { $set: { quantity: counted, ...(counted === 0 ? { status: 'EXHAUSTED' } : batch.status === 'EXHAUSTED' ? { status: 'ACTIVE' } : {}) } },
          { new: true },
        );
        if (!updated) throw new AppError(`Batch ${batch.code} changed since it was counted; count it again.`, 409, [], 'STOCK_CHANGED');
        return writeMovement(actor, { lab, item, batch: updated, type: 'ADJUSTMENT', quantity: delta, balanceAfter: counted, body: { ...line, reason: `Stocktake: ${reason}${line.note ? ` — ${String(line.note).slice(0, 300)}` : ''}` } });
      });
      results.push({ batchId: String(batch._id), code: batch.code, itemName: item.name, delta, deltaDisplay: fromBase(delta, item.displayUnit), displayUnit: item.displayUnit, applied: true, movementId: String(movement._id) });
    } catch (err) {
      if (err?.code !== 'STOCK_CHANGED') throw err;
      results.push({ batchId: String(batch._id), code: batch.code, itemName: item.name, delta, applied: false, error: err.message });
    }
    // eslint-disable-next-line no-await-in-loop
    await safely(syncReorderDue(item, { lab: lab.toObject() }), 'reorder');
  }
  return { reason, lines: results, adjusted: results.filter((r) => r.applied).length };
}

export async function setBatchStatus(actor, scope, batchId, body = {}) {
  const { batch, lab, item } = await loadBatch(actor, scope, { batchId });
  const doc = await LabBatch.findById(batch._id);
  if (body.status !== undefined) {
    const to = oneOf(body.status, ['ACTIVE', 'QUARANTINED'], 'status');
    if (['DISPOSED', 'EXHAUSTED'].includes(doc.status)) throw new AppError(`Batch ${doc.code} is ${doc.status.toLowerCase()}.`, 409);
    if (to === 'ACTIVE' && doc.expiresOn && new Date(doc.expiresOn) <= new Date()) throw new AppError('An expired batch cannot be released from quarantine.', 409, [], 'BATCH_EXPIRED');
    doc.status = to;
    doc.quarantineReason = to === 'QUARANTINED' ? requireText(body.reason, 'reason', { max: 300 }) : null;
  }
  if (body.openedOn !== undefined) doc.openedOn = parseDate(body.openedOn, 'openedOn');
  if (body.location !== undefined) doc.location = optionalText(body.location, { max: 120 }) || null;
  await doc.save();
  await safely(syncBatchDue(doc.toObject(), { item, lab: lab.toObject() }), 'batch');
  return presentBatch(doc.toObject(), item);
}

/** First-expiry-first-out: which batches to take a quantity from, and how much is short. */
export async function suggestFefo(actor, scope, itemId, query = {}) {
  const item = await LabItem.findById(assertObjectId(itemId, 'itemId')).lean();
  if (!item) throw new AppError('Item not found', 404);
  await loadLab(actor, scope, item.labId);
  const wanted = toBase(query.quantity, query.unit ?? item.displayUnit, item.baseUnit);
  const at = parseDate(query.at, 'at') ?? new Date();
  const batches = (await LabBatch.find({ itemId: item._id, status: 'ACTIVE', quantity: { $gt: 0 } }).lean())
    .filter((b) => !b.expiresOn || new Date(b.expiresOn) > at)
    .sort((a, b) => (a.expiresOn ? new Date(a.expiresOn).getTime() : Infinity) - (b.expiresOn ? new Date(b.expiresOn).getTime() : Infinity) || new Date(a.receivedOn) - new Date(b.receivedOn));
  let left = wanted;
  const plan = [];
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, b.quantity);
    plan.push({ batchId: String(b._id), code: b.code, expiresOn: b.expiresOn, take, takeDisplay: fromBase(take, item.displayUnit), opened: Boolean(b.openedOn) });
    left -= take;
  }
  return { itemId: String(item._id), itemName: item.name, displayUnit: item.displayUnit, wanted, wantedDisplay: fromBase(wanted, item.displayUnit), plan, shortBy: left, shortByDisplay: fromBase(left, item.displayUnit), hazardous: (item.hazardClasses ?? []).length > 0, restricted: item.restricted };
}

export async function listMovements(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = { ...labFilter(ids) };
  if (query.labId) filter.labId = assertObjectId(query.labId, 'labId');
  if (ids !== null && query.labId && !ids.includes(String(query.labId))) throw new AppError('Lab not found', 404);
  if (query.itemId) filter.itemId = assertObjectId(query.itemId, 'itemId');
  if (query.batchId) filter.batchId = assertObjectId(query.batchId, 'batchId');
  if (query.type) filter.type = oneOf(query.type, ['RECEIPT', 'ISSUE', 'RETURN', 'CONSUMED', 'DAMAGED', 'DISPOSED', 'ADJUSTMENT'], 'type');
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([LabMovement.find(filter).sort({ at: -1, _id: -1 }).skip(skip).limit(pageSize).lean(), LabMovement.countDocuments(filter)]);
  const items = new Map((await LabItem.find({ _id: { $in: rows.map((r) => r.itemId) } }).select('name displayUnit').lean()).map((i) => [String(i._id), i]));
  const batches = new Map((await LabBatch.find({ _id: { $in: rows.map((r) => r.batchId) } }).select('code').lean()).map((b) => [String(b._id), b.code]));
  // Outstanding on each issue, so the screen can offer a return.
  const issueIds = rows.filter((r) => r.type === 'ISSUE').map((r) => r._id);
  const returned = new Map((await LabMovement.aggregate([{ $match: { againstMovementId: { $in: issueIds } } }, { $group: { _id: '$againstMovementId', q: { $sum: '$quantity' } } }])).map((r) => [String(r._id), r.q]));
  return {
    items: rows.map((r) => {
      const item = items.get(String(r.itemId));
      const out = presentMovement(r, item);
      out.batchCode = batches.get(String(r.batchId)) ?? null;
      if (r.type === 'ISSUE') { out.outstanding = -r.quantity - (returned.get(String(r._id)) ?? 0); out.outstandingDisplay = item ? fromBase(out.outstanding, item.displayUnit) : out.outstanding; }
      return out;
    }),
    total, page, pageSize,
  };
}

/** Low stock → a draft purchase request, for the lab to complete and submit through procurement. */
export async function reorder(actor, scope, itemId, body = {}) {
  const item = await LabItem.findById(assertObjectId(itemId, 'itemId')).lean();
  if (!item) throw new AppError('Item not found', 404);
  const lab = await loadLab(actor, scope, item.labId);
  const batches = await LabBatch.find({ itemId: item._id, status: 'ACTIVE' }).lean();
  const onHand = presentItem(item, batches).onHand;
  const wanted = body.quantity !== undefined ? toBase(body.quantity, body.unit ?? item.displayUnit, item.baseUnit) : Math.max(item.reorderQty || 0, (item.minStock || 0) * 2 - onHand, 0);
  if (!wanted) throw new AppError('Say how much to order (no reorder quantity is set for this item).', 400);
  const qty = fromBase(wanted, item.displayUnit);
  const pr = await createRequestDraft(actor, {
    title: `Lab reorder: ${item.name} (${lab.name})`,
    department: 'LABS',
    items: [{ description: `${item.name}${item.casNo ? ` (CAS ${item.casNo})` : ''}`, qty, unit: item.displayUnit, estUnitPaise: item.estUnitPaise || 0 }],
    justification: `On hand ${formatQty(onHand, item.displayUnit)}, minimum ${formatQty(item.minStock || 0, item.displayUnit)}. Raised from the lab stock register.`,
  });
  const doc = await LabItem.findById(item._id);
  pushHistory(doc, actor, 'REORDER_DRAFTED', { note: pr.refNo });
  await doc.save();
  return { purchaseRequest: pr };
}

// ── Scanning ──────────────────────────────────────────────────────────────

/**
 * A scanned label (or a typed code, tag, serial or lot number when the label
 * will not scan) resolved to the record it names, within the labs the actor
 * may see.
 */
export async function resolveCode(actor, scope, raw) {
  requireProfile(actor);
  const code = String(raw ?? '').trim().slice(0, 80);
  if (!code) throw new AppError('Scan or type a code.', 400);
  const ids = await ownLabIds(actor, scope);
  const inLabs = labFilter(ids);
  const upper = code.toUpperCase();
  const batch = await LabBatch.findOne({ ...inLabs, $or: [{ code: upper }, { lotNo: code }] }).lean();
  if (batch) {
    const item = await LabItem.findById(batch.itemId).lean();
    return { type: 'BATCH', code: batch.code, labId: String(batch.labId), batch: presentBatch(batch, item), item: item ? { id: String(item._id), name: item.name, displayUnit: item.displayUnit, hazardClasses: item.hazardClasses, restricted: item.restricted, sdsUrl: item.sdsUrl } : null };
  }
  const eq = await LabEquipment.findOne({ ...inLabs, $or: [{ code: upper }, { serialNo: code }] }).lean();
  if (eq) return { type: 'EQUIPMENT', code: eq.code, labId: String(eq.labId), equipment: dto(eq) };
  const dev = await LabDevice.findOne({ ...inLabs, $or: [{ code: upper }, { tag: upper }, { serialNo: code }] }).lean();
  if (dev) return { type: 'DEVICE', code: dev.code, labId: String(dev.labId), device: dto(dev) };
  throw new AppError(`No batch, instrument or device with code "${code}" in your labs.`, 404, [], 'CODE_NOT_FOUND');
}

// ── Overview for the dashboard and the campus panel ──────────────────────

export async function overview(actor, scope) {
  const labs = await listLabs(actor, scope);
  const total = labs.reduce((t, l) => {
    for (const [k, v] of Object.entries(l.counts)) t[k] = (t[k] ?? 0) + v;
    return t;
  }, {});
  const ids = labs.map((l) => l.id);
  const seats = await LabSoftware.find({ active: true, $or: [{ labId: { $in: ids } }, ...(scope === 'ALL' ? [{ labId: null }] : [])] }).select('name seatsTotal deviceIds renewalOn').lean();
  return {
    labs: labs.map((l) => ({ id: l.id, name: l.name, type: l.type, facilityCode: l.facilityCode, counts: l.counts })),
    total,
    software: seats.map((s) => ({ id: String(s._id), name: s.name, seatsTotal: s.seatsTotal, seatsUsed: (s.deviceIds ?? []).length, renewalOn: s.renewalOn })),
    asOf: new Date().toISOString(),
    definitions: {
      lowStock: 'Usable stock (active, unexpired batches) below the item minimum.',
      expiringSoon: "A batch with stock whose expiry falls within the lab's alert window.",
      calibrationOverdue: 'An instrument that needs calibration and is past its due date.',
    },
  };
}
