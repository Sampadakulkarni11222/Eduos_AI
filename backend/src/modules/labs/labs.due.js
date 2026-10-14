import { Lab, LabItem, LabBatch, LabEquipment, LabDevice, LabSoftware } from '../../models/lab.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { syncDue, syncDueSet } from '../bills/due-sync.js';
import { escapeRegex } from '../ops/common.js';
import { labOwner } from './labs.access.js';
import { formatQty } from './units.js';

/**
 * Lab due dates into the shared tasks queue (department LABS):
 *   - a batch that expires within the lab's alert window (LAB_EXPIRY);
 *   - an instrument whose calibration falls due (CALIBRATION);
 *   - warranty / AMC ends for instruments and devices (RENEWAL, grouped per date for devices);
 *   - a software licence renewal (RENEWAL, with its cost);
 *   - an item below its minimum stock (reorder).
 * Only dates inside the window become tasks; the daily job picks up the rest
 * as they come into range, and resolves tasks whose reason has gone (the batch
 * was used up or disposed, the instrument was calibrated).
 */
const DAY = 86_400_000;
const within = (date, days, now) => date && new Date(date).getTime() - now.getTime() <= days * DAY;
const link = (tab) => `/labs?tab=${tab}`;

async function stockOf(itemId, now = new Date()) {
  const rows = await LabBatch.find({ itemId, status: 'ACTIVE', quantity: { $gt: 0 } }).select('quantity expiresOn').lean();
  return rows.filter((b) => !b.expiresOn || new Date(b.expiresOn) > now).reduce((n, b) => n + b.quantity, 0);
}

export async function syncBatchDue(batch, { item, lab, now = new Date() } = {}) {
  const prefix = `lab:batch:${batch._id}:expiry`;
  const live = ['ACTIVE', 'QUARANTINED'].includes(batch.status) && batch.quantity > 0 && batch.expiresOn;
  const theLab = lab ?? await Lab.findById(batch.labId).lean();
  if (!live || !within(batch.expiresOn, theLab?.alertDays ?? 60, now)) return syncDue(prefix, null, { note: 'No longer in stock or not yet near expiry' });
  const theItem = item ?? await LabItem.findById(batch.itemId).lean();
  return syncDue(prefix, {
    title: `${theItem?.name ?? 'Lab item'} batch ${batch.code} ${new Date(batch.expiresOn) < now ? 'has expired' : 'expires'} (${formatQty(batch.quantity, theItem?.displayUnit ?? 'pcs')})`,
    department: 'LABS', category: 'LAB_EXPIRY', dueAt: batch.expiresOn, ownerProfileId: labOwner(theLab),
    severity: theItem?.hazardClasses?.length ? 'HIGH' : 'NORMAL', leadDays: [theLab?.alertDays ?? 60, 30, 7, 0],
    description: 'Use first, or quarantine and dispose with evidence. Expired stock cannot be issued.',
    source: { entityType: 'LabBatch', entityId: batch._id, link: link('stock') },
  });
}

export async function syncReorderDue(item, { lab, now = new Date() } = {}) {
  const prefix = `lab:item:${item._id}:reorder`;
  const onHand = await stockOf(item._id, now);
  if (!item.active || !item.minStock || onHand >= item.minStock) return syncDue(prefix, null, { note: 'Stock back above minimum' });
  // Keep the open reorder task as it is while the item stays low.
  const open = await DueItem.exists({ sourceKey: { $regex: `^${escapeRegex(prefix)}:` }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } });
  if (open) return null;
  const theLab = lab ?? await Lab.findById(item.labId).lean();
  return syncDue(prefix, {
    title: `Reorder ${item.name}: ${formatQty(onHand, item.displayUnit)} left, minimum ${formatQty(item.minStock, item.displayUnit)}`,
    department: 'LABS', category: 'OTHER', dueAt: new Date(now.getTime() + 7 * DAY), ownerProfileId: labOwner(theLab), leadDays: [7, 1, 0],
    description: 'Raise a purchase request from the lab stock screen (Reorder).',
    source: { entityType: 'LabItem', entityId: item._id, link: link('stock') },
  });
}

export async function syncEquipmentDue(eq, { lab, now = new Date() } = {}) {
  const theLab = lab ?? await Lab.findById(eq.labId).lean();
  const owner = labOwner(theLab);
  const active = eq.status === 'ACTIVE';
  const window = Math.max(theLab?.alertDays ?? 60, 30);
  const cal = active && eq.calibrationRequired && eq.calibrationDueOn && within(eq.calibrationDueOn, window, now);
  await syncDue(`lab:equipment:${eq._id}:calibration`, cal ? {
    title: `Calibrate ${eq.name} (${eq.code})`, department: 'LABS', category: 'CALIBRATION', dueAt: eq.calibrationDueOn, ownerProfileId: owner,
    severity: 'HIGH', requiresEvidence: true, leadDays: [window, 14, 7, 0],
    description: 'Record the calibration with its certificate; an overdue instrument is flagged on every practical that needs it.',
    source: { entityType: 'LabEquipment', entityId: eq._id, link: link('equipment') },
  } : null, { note: 'Calibrated or no longer due' });
  for (const [field, label] of [['warrantyUntil', 'Warranty'], ['amcUntil', 'AMC']]) {
    const on = active && eq[field] && within(eq[field], 90, now) && new Date(eq[field]) > new Date(now.getTime() - 30 * DAY);
    // eslint-disable-next-line no-await-in-loop
    await syncDue(`lab:equipment:${eq._id}:${field === 'warrantyUntil' ? 'warranty' : 'amc'}`, on ? {
      title: `${label} ends: ${eq.name} (${eq.code})`, department: 'LABS', category: 'RENEWAL', dueAt: eq[field], ownerProfileId: owner, leadDays: [90, 30, 7, 0],
      source: { entityType: 'LabEquipment', entityId: eq._id, link: link('equipment') },
    } : null);
  }
}

/** Devices share warranty/AMC dates when bought together, so one task per lab and date. */
export async function syncDeviceDue(labId, { now = new Date() } = {}) {
  const lab = await Lab.findById(labId).lean();
  if (!lab) return;
  const devices = await LabDevice.find({ labId, status: { $ne: 'DECOMMISSIONED' } }).select('warrantyUntil amcUntil').lean();
  for (const [field, label, key] of [['warrantyUntil', 'Warranty', 'warranty'], ['amcUntil', 'AMC', 'amc']]) {
    const byDate = new Map();
    for (const d of devices) {
      if (!d[field] || !within(d[field], 90, now) || new Date(d[field]) < new Date(now.getTime() - 30 * DAY)) continue;
      const k = new Date(d[field]).toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? 0) + 1);
    }
    // eslint-disable-next-line no-await-in-loop
    await syncDueSet(`lab:${labId}:devices:${key}`, [...byDate.entries()].map(([date, count]) => ({
      title: `${label} ends for ${count} device${count === 1 ? '' : 's'} in ${lab.name}`, department: 'LABS', category: 'RENEWAL', dueAt: new Date(`${date}T00:00:00.000Z`),
      ownerProfileId: labOwner(lab), leadDays: [90, 30, 7, 0], source: { entityType: 'Lab', entityId: lab._id, link: link('devices') },
    })));
  }
}

export async function syncSoftwareDue(sw, { now = new Date() } = {}) {
  const lab = sw.labId ? await Lab.findById(sw.labId).lean() : null;
  const on = sw.active && sw.renewalOn && ['SUBSCRIPTION', 'EDUCATION_GRANT'].includes(sw.licenceType) && within(sw.renewalOn, 90, now);
  return syncDue(`lab:software:${sw._id}:renewal`, on ? {
    title: `Renew ${sw.name} licence (${sw.seatsTotal || 'unlimited'} seats)`, department: 'LABS', category: 'RENEWAL', dueAt: sw.renewalOn,
    ownerProfileId: sw.ownerProfileId ? String(sw.ownerProfileId) : labOwner(lab), amountPaise: sw.costPaise || null, leadDays: [90, 30, 7, 0],
    source: { entityType: 'LabSoftware', entityId: sw._id, link: link('devices') },
  } : null, { note: 'Renewed or no longer due' });
}

/** The daily job: every lab obligation in this school, brought up to date. Idempotent. */
export async function runLabsDue({ now = new Date() } = {}) {
  const labs = await Lab.find({ status: 'ACTIVE' }).lean();
  const byId = new Map(labs.map((l) => [String(l._id), l]));
  const counts = { batches: 0, items: 0, equipment: 0, devices: 0, software: 0 };
  const items = await LabItem.find({ labId: { $in: labs.map((l) => l._id) } }).lean();
  const itemById = new Map(items.map((i) => [String(i._id), i]));
  for (const b of await LabBatch.find({ labId: { $in: labs.map((l) => l._id) }, status: { $in: ['ACTIVE', 'QUARANTINED'] } }).lean()) {
    // eslint-disable-next-line no-await-in-loop
    await syncBatchDue(b, { item: itemById.get(String(b.itemId)), lab: byId.get(String(b.labId)), now });
    counts.batches += 1;
  }
  for (const i of items) {
    // eslint-disable-next-line no-await-in-loop
    await syncReorderDue(i, { lab: byId.get(String(i.labId)), now });
    counts.items += 1;
  }
  for (const e of await LabEquipment.find({ labId: { $in: labs.map((l) => l._id) } }).lean()) {
    // eslint-disable-next-line no-await-in-loop
    await syncEquipmentDue(e, { lab: byId.get(String(e.labId)), now });
    counts.equipment += 1;
  }
  for (const l of labs) {
    // eslint-disable-next-line no-await-in-loop
    await syncDeviceDue(l._id, { now });
    counts.devices += 1;
  }
  for (const s of await LabSoftware.find({}).lean()) {
    // eslint-disable-next-line no-await-in-loop
    await syncSoftwareDue(s, { now });
    counts.software += 1;
  }
  return counts;
}
