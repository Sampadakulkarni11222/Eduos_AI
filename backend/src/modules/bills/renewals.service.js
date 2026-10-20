import { Licence } from '../../models/compliance.model.js';
import { Contract } from '../../models/administration.model.js';
import { Asset } from '../../models/finance.model.js';
import { ServiceAccount } from '../../models/bill.model.js';
import { Lab, LabEquipment, LabDevice, LabSoftware } from '../../models/lab.model.js';
import { requireProfile, profileNames } from '../ops/common.js';
import { syncDue } from './due-sync.js';
import { DueItem } from '../../models/dueItem.model.js';
import { resolveSource } from '../tasks/tasks.service.js';
import { runLabsDue } from '../labs/labs.due.js';
import { featureEnabled } from '../../utils/features.js';

/**
 * One renewals view across the registers that each keep their own dates:
 * compliance licences and certificates, agreements (end date and the notice
 * deadline before an auto-renewal), asset warranties, service contracts and
 * AMCs, lab calibrations and warranties, and software licences. Each row says
 * what is due, when, by when a decision is needed, what it is expected to
 * cost, who owns it and what happens if nothing is done — so the principal can
 * see everything due next quarter without opening six registers.
 *
 * syncRenewals() puts the ones inside their lead window into the tasks queue.
 */
const DAY = 86_400_000;
const daysLeft = (d, now) => Math.ceil((new Date(d) - now) / DAY);

export async function collectRenewals({ withinDays = 90, now = new Date(), includeOverdueDays = 365 } = {}) {
  const until = new Date(now.getTime() + withinDays * DAY);
  const from = new Date(now.getTime() - includeOverdueDays * DAY);
  const range = { $gte: from, $lte: until };
  const rows = [];

  for (const l of await Licence.find({ expiresOn: range, renewalStatus: { $ne: 'RENEWED' } }).select('kind title issuer expiresOn renewalLeadDays renewalCostPaise ownerProfileId renewalStatus').lean()) {
    rows.push({ source: 'LICENCE', kind: l.kind, entityId: String(l._id), title: l.title, counterparty: l.issuer, dueOn: l.expiresOn,
      decideBy: new Date(new Date(l.expiresOn).getTime() - (l.renewalLeadDays ?? 60) * DAY), costPaise: l.renewalCostPaise || null, ownerProfileId: l.ownerProfileId,
      department: 'COMPLIANCE', category: 'LICENCE', status: l.renewalStatus ?? 'NOT_STARTED', link: '/compliance?tab=licences',
      consequence: l.kind === 'SOFTWARE_SUBSCRIPTION' ? 'Service stops at expiry.' : 'Operating without a valid licence or certificate; inspection and recognition risk.' });
  }
  for (const c of await Contract.find({ endsOn: range, status: { $in: ['APPROVED', 'EXECUTED', 'ACTIVE'] } }).select('title kind counterparty endsOn noticePeriodDays autoRenews valuePaise ownerProfileId status').lean()) {
    const noticeBy = new Date(new Date(c.endsOn).getTime() - (c.noticePeriodDays ?? 0) * DAY);
    rows.push({ source: 'CONTRACT', kind: c.kind, entityId: String(c._id), title: c.title, counterparty: c.counterparty, dueOn: c.endsOn, decideBy: noticeBy,
      costPaise: c.valuePaise || null, ownerProfileId: c.ownerProfileId, department: 'ADMINISTRATION', category: 'RENEWAL', status: c.status, link: '/contracts',
      consequence: c.autoRenews ? `Renews automatically unless notice is given by ${noticeBy.toISOString().slice(0, 10)}.` : 'The service ends on this date unless renewed.' });
  }
  for (const a of await Asset.find({ warrantyUntil: range, status: { $ne: 'DISPOSED' } }).select('tag description warrantyUntil costPaise custodianProfileId').lean()) {
    rows.push({ source: 'ASSET_WARRANTY', kind: 'WARRANTY', entityId: String(a._id), title: `Warranty: ${a.description} (${a.tag})`, dueOn: a.warrantyUntil, decideBy: a.warrantyUntil,
      costPaise: null, ownerProfileId: a.custodianProfileId, department: 'FACILITIES', category: 'RENEWAL', status: 'OPEN', link: '/procurement?tab=assets',
      consequence: 'Repairs after this date are paid for; consider an AMC for critical equipment.' });
  }
  for (const s of await ServiceAccount.find({ contractEndsOn: range, status: 'ACTIVE' }).lean()) {
    const noticeBy = new Date(new Date(s.contractEndsOn).getTime() - (s.noticeDays ?? 0) * DAY);
    rows.push({ source: 'SERVICE_CONTRACT', kind: s.category, entityId: String(s._id), title: `${s.name}${s.vendorName ? ` — ${s.vendorName}` : ''}`, counterparty: s.vendorName, dueOn: s.contractEndsOn, decideBy: noticeBy,
      costPaise: s.expectedAmountPaise ? s.expectedAmountPaise * (s.billingCycle === 'ANNUAL' ? 1 : s.billingCycle === 'MONTHLY' ? 12 : 4) : null,
      ownerProfileId: s.ownerProfileId, department: s.category === 'SOFTWARE' ? 'IT' : 'FACILITIES', category: 'RENEWAL', status: 'ACTIVE', link: `/bills?tab=accounts&id=${s._id}`,
      consequence: s.autoRenews ? `Renews automatically unless notice is given by ${noticeBy.toISOString().slice(0, 10)}.` : s.category === 'AMC' ? 'Maintenance visits and breakdown cover stop.' : 'The service ends unless renewed.' });
  }
  const labs = new Map((await Lab.find({}).select('name inChargeProfileIds').lean()).map((l) => [String(l._id), l]));
  const labOwner = (id) => labs.get(String(id))?.inChargeProfileIds?.[0] ?? null;
  for (const e of await LabEquipment.find({ status: 'ACTIVE', $or: [{ calibrationRequired: true, calibrationDueOn: range }, { amcUntil: range }, { warrantyUntil: range }] }).lean()) {
    const lab = labs.get(String(e.labId))?.name ?? 'Lab';
    if (e.calibrationRequired && e.calibrationDueOn >= from && e.calibrationDueOn <= until) rows.push({ source: 'LAB_CALIBRATION', kind: 'CALIBRATION', entityId: String(e._id), title: `Calibrate ${e.name} (${e.code}), ${lab}`, dueOn: e.calibrationDueOn, decideBy: e.calibrationDueOn, costPaise: null, ownerProfileId: labOwner(e.labId), department: 'LABS', category: 'CALIBRATION', status: e.outOfService ? 'OUT_OF_SERVICE' : 'OPEN', link: '/labs?tab=equipment', consequence: 'Readings cannot be relied on; practicals using it are flagged.' });
    for (const [f, label] of [['amcUntil', 'AMC'], ['warrantyUntil', 'Warranty']]) {
      if (e[f] && e[f] >= from && e[f] <= until) rows.push({ source: 'LAB_EQUIPMENT', kind: label.toUpperCase(), entityId: String(e._id), title: `${label}: ${e.name} (${e.code}), ${lab}`, dueOn: e[f], decideBy: e[f], costPaise: null, ownerProfileId: labOwner(e.labId), department: 'LABS', category: 'RENEWAL', status: 'OPEN', link: '/labs?tab=equipment', consequence: 'Repairs after this date are paid for.' });
    }
  }
  const devGroups = new Map();
  for (const d of await LabDevice.find({ status: { $ne: 'DECOMMISSIONED' }, $or: [{ warrantyUntil: range }, { amcUntil: range }] }).select('labId warrantyUntil amcUntil').lean()) {
    for (const [f, label] of [['warrantyUntil', 'Warranty'], ['amcUntil', 'AMC']]) {
      if (!d[f] || d[f] < from || d[f] > until) continue;
      const k = `${d.labId}:${f}:${new Date(d[f]).toISOString().slice(0, 10)}`;
      const g = devGroups.get(k) ?? { labId: d.labId, label, dueOn: d[f], count: 0 };
      g.count += 1;
      devGroups.set(k, g);
    }
  }
  for (const [k, g] of devGroups) rows.push({ source: 'LAB_DEVICES', kind: g.label.toUpperCase(), entityId: k, title: `${g.label} ends for ${g.count} computer(s), ${labs.get(String(g.labId))?.name ?? 'lab'}`, dueOn: g.dueOn, decideBy: g.dueOn, costPaise: null, ownerProfileId: labOwner(g.labId), department: 'LABS', category: 'RENEWAL', status: 'OPEN', link: '/labs?tab=devices', consequence: 'Repairs after this date are paid for.' });
  for (const s of await LabSoftware.find({ active: true, renewalOn: range, licenceType: { $in: ['SUBSCRIPTION', 'EDUCATION_GRANT'] } }).lean()) {
    rows.push({ source: 'SOFTWARE', kind: 'SOFTWARE', entityId: String(s._id), title: `${s.name} (${s.seatsTotal || 'unlimited'} seats, ${(s.deviceIds ?? []).length} in use)`, counterparty: s.vendorName, dueOn: s.renewalOn, decideBy: s.renewalOn, costPaise: s.costPaise || null, ownerProfileId: s.ownerProfileId ?? (s.labId ? labOwner(s.labId) : null), department: s.labId ? 'LABS' : 'IT', category: 'RENEWAL', status: 'OPEN', link: '/labs?tab=devices', consequence: 'The software stops working on the lab computers.' });
  }

  const names = await profileNames(rows.map((r) => r.ownerProfileId));
  return rows
    .map((r) => ({ ...r, ownerProfileId: r.ownerProfileId ? String(r.ownerProfileId) : null, ownerName: r.ownerProfileId ? names.get(String(r.ownerProfileId)) ?? null : null, daysLeft: daysLeft(r.dueOn, now), decideInDays: daysLeft(r.decideBy, now), overdue: new Date(r.dueOn) < now }))
    .sort((a, b) => new Date(a.decideBy) - new Date(b.decideBy));
}

export async function renewals(actor, query = {}) {
  requireProfile(actor);
  const withinDays = Math.max(7, Math.min(Number.parseInt(query.withinDays, 10) || 90, 730));
  const items = await collectRenewals({ withinDays });
  const bySource = {};
  for (const r of items) {
    const s = (bySource[r.source] ??= { count: 0, costPaise: 0, overdue: 0 });
    s.count += 1; s.costPaise += r.costPaise ?? 0; if (r.overdue) s.overdue += 1;
  }
  return {
    withinDays, items, bySource,
    total: { count: items.length, costPaise: items.reduce((n, r) => n + (r.costPaise ?? 0), 0), overdue: items.filter((r) => r.overdue).length, unowned: items.filter((r) => !r.ownerProfileId).length },
    definition: 'Due within the window or already past due (up to a year). Cost is the recorded renewal cost or contract value, where one was recorded; rows without a cost are not counted in the total.',
  };
}

/**
 * Puts renewals inside their window into the tasks queue (lab items are the
 * labs job's; this calls it when labs are switched on so one sync covers all).
 */
export async function syncRenewals({ now = new Date() } = {}) {
  const rows = await collectRenewals({ withinDays: 90, now, includeOverdueDays: 60 });
  let synced = 0;
  const live = new Set();
  for (const r of rows.filter((x) => ['LICENCE', 'CONTRACT', 'ASSET_WARRANTY', 'SERVICE_CONTRACT'].includes(x.source))) {
    const prefix = `renewal:${r.source.toLowerCase()}:${r.entityId}`;
    live.add(prefix);
    // eslint-disable-next-line no-await-in-loop
    await syncDue(prefix, {
      title: r.source === 'CONTRACT' || r.source === 'SERVICE_CONTRACT' ? `Renew or give notice: ${r.title}` : `Renew: ${r.title}`,
      department: r.department, category: r.category, dueAt: r.decideBy < r.dueOn ? r.decideBy : r.dueOn, ownerProfileId: r.ownerProfileId,
      amountPaise: r.costPaise, severity: r.source === 'LICENCE' ? 'HIGH' : 'NORMAL', leadDays: [60, 30, 7, 0],
      description: `${r.consequence} Ends ${new Date(r.dueOn).toISOString().slice(0, 10)}.`,
      source: { entityType: r.source, entityId: /^[0-9a-f]{24}$/.test(r.entityId) ? r.entityId : null, link: r.link },
    });
    synced += 1;
  }
  // Renewed, ended or moved out of the window: its open task closes.
  const open = await DueItem.find({ sourceKey: /^renewal:/, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }).select('sourceKey').lean();
  for (const o of open) {
    // eslint-disable-next-line no-await-in-loop
    if (!live.has(o.sourceKey.replace(/:\d{4}-\d{2}-\d{2}$/, ''))) await resolveSource(o.sourceKey, { note: 'Renewed or no longer due' });
  }
  const labs = (await featureEnabled('labs')) ? await runLabsDue({ now }) : null;
  return { synced, labs };
}
