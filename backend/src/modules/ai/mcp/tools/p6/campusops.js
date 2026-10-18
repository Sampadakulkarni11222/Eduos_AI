// Part-6 coverage tools: campusops. See ./_kit.js and ../p6Coverage.js.
//
// Laboratories (catalogue, batches, instruments, computers, software seats,
// practical sessions, incidents), vehicles and trips, ID cards and checkpoint
// suggestions, visitors' hosts, authorised pickup and the gate release log,
// hostel out-passes raised by the warden, teachers' class check-ins, safety
// settings, alerts and the device registry, and the remaining library and
// hostel reads. What platformOps.js, p4Librarian.js and p4Warden.js already
// do is not repeated here.
//
// Deliberately left on the screen (see the coverage result file): bulk CSV
// imports, label printing, registering a device or rotating its secret (the
// secret is shown once), decommissioning a computer (the e-waste certificate
// is an upload), camera devices and settings, custody restrictions on pickup
// (a court order is recorded and lifted by the office on the Gate screen),
// the hostel allergy list and medical lookup (health data), settling a
// library fine (money, at the desk), and the book-request and
// transport-request decisions.
import * as labs from '../../../../labs/labs.service.js';
import * as labAssets from '../../../../labs/labs.assets.js';
import * as labSessions from '../../../../labs/labs.sessions.js';
import { runLabsDue } from '../../../../labs/labs.due.js';
import * as vehicles from '../../../../fleet/vehicles.service.js';
import * as trips from '../../../../fleet/trips.service.js';
import * as telemetry from '../../../../fleet/telemetry.service.js';
import * as checkpoints from '../../../../safety/checkpoints.service.js';
import * as visitors from '../../../../safety/visitors.service.js';
import * as pickup from '../../../../safety/pickup.service.js';
import * as camera from '../../../../safety/camera.service.js';
import * as safetyDevices from '../../../../safety/devices.service.js';
import * as safety from '../../../../safety/shared.js';
import { alertDepartments } from '../../../../safety/access.js';
import * as outpass from '../../../../hostel/outpass.service.js';
import * as life from '../../../../hostel/life.service.js';
import * as hostel from '../../../../hostel/hostel.service.js';
import * as desk from '../../../../library/library.desk.js';
import * as library from '../../../../library/library.service.js';
import { profilesWithRoles, escapeRegex } from '../../../../ops/common.js';
import { STAFF_ROLES } from '../../../../staff/staffLeave.service.js';
import { Lab, LabItem, LabEquipment, LAB_TYPES, ITEM_KINDS, HAZARD_CLASSES, STORAGE_GROUPS } from '../../../../../models/lab.model.js';
import { Facility } from '../../../../../models/facility.model.js';
import { VEHICLE_TYPES, VEHICLE_STATUSES, VEHICLE_DOCUMENTS, TRIP_KINDS } from '../../../../../models/fleet.model.js';
import { TransportRoute } from '../../../../../models/transport.model.js';
import { Student } from '../../../../../models/student.model.js';
import { HostelRoom, HostelAllocation } from '../../../../../models/hostel.model.js';
import { getOwnStudentId } from '../../../../../utils/scope.js';
import { resolveStudentId, studentIdentitySchema, resolveSection } from '../_shared.js';
import {
  tool, closed, text, int, num, bool, oneOf, list, hm, dateStr, decisionArg, RISK,
  ask, notFound, forbidden, need, needAny, pick, listed, shown, did,
  rowsOf, lower, words, day, time, todayIst, istAt, stripTitle, excerpt,
} from './_kit.js';

/* ── shared helpers ─────────────────────────────────────── */

const STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const FLEET_READ_ALL = [['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate', 'ALL'], ['transport.read', 'ALL']];
const TRIP_READ = [['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate']];
const OPERATE = [['transport.fleet.manage'], ['transport.trips.operate']];
const SAFETY_MANAGE = [['transport.fleet.manage'], ['checkpoints.manage'], ['visitors.manage'], ['hostel.outpass.manage'], ['camera.devices.manage']];
const OUTPASS_READ = [['hostel.outpass.manage'], ['hostel.outpass.request']];

const rupeesToPaise = (r) => (r === undefined || r === null ? undefined : Math.round(Number(r) * 100));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const changes = (o) => Object.entries(defined(o)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');

/** A record by its reference ("PRC/2026/0004", or just "0004") or its name. */
function refPick(rows, term, opts) {
  const pool = rowsOf(rows);
  const refOf = opts.refOf ?? ((r) => r.refNo);
  const t = lower(term);
  if (t) {
    const hit = pool.filter((r) => lower(refOf(r)) === t || (/^\d+$/.test(t) && lower(refOf(r)).endsWith(`/${t.padStart(4, '0')}`)));
    if (hit.length === 1) return hit[0];
  }
  return pick(pool, term, { ...opts, refOf });
}

/** A person named in words: an exact name, then whole words of it, never a substring of another name. */
function pickPerson(rows, term, { label, nameOf = (r) => r.name, describe = (r) => nameOf(r) } = {}) {
  const pool = rowsOf(rows);
  const t = lower(stripTitle(term)).replace(/\s+/g, ' ');
  if (!t) {
    if (pool.length === 1) return pool[0];
    throw ask(`Which ${label}? ${pool.slice(0, 8).map(describe).join('; ')}`);
  }
  const exact = pool.filter((r) => lower(nameOf(r)).replace(/\s+/g, ' ') === t);
  if (exact.length === 1) return exact[0];
  const whole = (exact.length ? exact : pool).filter((r) => ` ${lower(nameOf(r))} `.includes(` ${t} `));
  if (whole.length === 1) return whole[0];
  if (whole.length > 1) throw ask(`More than one ${label} matches "${String(term).trim()}": ${whole.slice(0, 8).map(describe).join('; ')}. Which one?`);
  throw notFound(`I could not find a ${label} called "${String(term).trim()}".`);
}

async function staffNamed(name, label = 'member of staff') {
  const rows = (await profilesWithRoles(STAFF_ROLES)).map((p) => ({ id: String(p._id), name: p.displayName }));
  return pickPerson(rows, name, { label });
}

/** A staff member by name, or the name as written for someone without a profile (a contracted driver or attendant). */
async function crewOf(name, phone) {
  if (!name) return undefined;
  try {
    const p = await staffNamed(name, 'member of staff');
    return { profileId: p.id, name: p.name, ...(phone && { phone }) };
  } catch (err) {
    if (err?.code !== 'NOT_FOUND') throw err;
    return { name: String(name).trim(), ...(phone && { phone }) };
  }
}

/** A student of this school, for school-wide office tools (gate, ID cards), by admission number or name. */
async function schoolStudent({ studentName, admissionNo }) {
  if (!studentName && !admissionNo) throw ask('Which student? Give their name or admission number.');
  const shape = (s) => ({ id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo ?? null });
  if (admissionNo) {
    const s = await Student.findOne({ admissionNo: new RegExp(`^${escapeRegex(String(admissionNo).trim())}$`, 'i'), deletedAt: null }).select('firstName lastName admissionNo').lean();
    if (!s) throw notFound(`No student with admission number "${admissionNo}".`);
    return shape(s);
  }
  const parts = stripTitle(studentName).split(/\s+/).filter(Boolean).map((p) => new RegExp(`^${escapeRegex(p)}$`, 'i'));
  const rows = (await Student.find({ deletedAt: null, $or: [{ firstName: { $in: parts } }, { lastName: { $in: parts } }] }).select('firstName lastName admissionNo').limit(60).lean()).map(shape);
  return pickPerson(rows, studentName, { label: 'student', describe: (r) => `${r.name} (${r.admissionNo})` });
}

const studentArgs = {
  studentName: text(80, 'The student as people name them, e.g. "Rahul Sharma"'),
  admissionNo: text(40, 'Admission number, e.g. "OAK-12"'),
};

/* ── Laboratories ────────────────────────────────────────── */

const LAB = { module: 'Labs', feature: 'labs' };

async function labsInView(ctx) {
  return labs.listLabs(ctx.actor, ctx.scope);
}

async function theLab(ctx, name) {
  return refPick(await labsInView(ctx), name, { label: 'lab of yours', nameOf: (l) => l.name, refOf: (l) => l.facilityCode, describe: (l) => l.name });
}

async function labIdOf(ctx, name) {
  return name ? (await theLab(ctx, name)).id : undefined;
}

async function theLabItem(ctx, { item, labName }) {
  const labId = await labIdOf(ctx, labName);
  const names = new Map((await labsInView(ctx)).map((l) => [l.id, l.name]));
  const rows = await labs.listItems(ctx.actor, ctx.scope, { ...(labId && { labId }), active: 'all' });
  const hit = pick(rows, item, { label: 'lab item', nameOf: (i) => i.name, refOf: (i) => i.casNo, describe: (i) => `${i.name} (${names.get(String(i.labId)) ?? 'lab'})` });
  return { ...hit, labName: names.get(String(hit.labId)) ?? null };
}

async function theInstrument(ctx, { instrument, labName }) {
  const labId = await labIdOf(ctx, labName);
  const rows = await labAssets.listEquipment(ctx.actor, ctx.scope, { ...(labId && { labId }) });
  return pick(rows, instrument, { label: 'instrument', nameOf: (e) => e.name, refOf: (e) => e.code, describe: (e) => `${e.name} (${e.code})` });
}

async function theDevice(ctx, { device, labName }, query = {}) {
  const labId = await labIdOf(ctx, labName);
  const rows = await labAssets.listDevices(ctx.actor, ctx.scope, { ...(labId && { labId }), ...query });
  return pick(rows, device, { label: 'computer or device', nameOf: (d) => d.workstationNo ?? d.tag, refOf: (d) => d.tag, describe: (d) => `${d.tag}${d.workstationNo ? ` (workstation ${d.workstationNo})` : ''}` });
}

async function theSoftware(ctx, { software, labName }) {
  const labId = await labIdOf(ctx, labName);
  const rows = await labAssets.listSoftware(ctx.actor, ctx.scope, { ...(labId && { labId }) });
  return pick(rows, software, { label: 'software', nameOf: (s) => s.name, refOf: () => null });
}

async function theBatch(ctx, code) {
  const r = await labs.resolveCode(ctx.actor, ctx.scope, code);
  if (r.type !== 'BATCH') throw notFound(`"${code}" is ${r.type === 'EQUIPMENT' ? 'an instrument' : 'a device'}, not a stock batch.`);
  return r;
}

const SESSION_STATUSES = { open: ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS'] };
async function theSession(ctx, term, statuses = null) {
  const page = await labSessions.listSessions(ctx.actor, ctx.scope, { pageSize: 200, order: 'desc', ...(statuses === SESSION_STATUSES.open && { status: 'open' }) });
  const rows = rowsOf(page).filter((s) => !statuses || statuses.includes(s.status));
  return refPick(rows, term, { label: 'practical', nameOf: (s) => s.title, describe: (s) => `${s.refNo} ${s.title}${s.className ? ` for ${s.className}` : ''} (${day(s.startsAt)} ${time(s.startsAt)}, ${words(s.status)})` });
}

const labItemArgs = {
  item: text(160, 'The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"'),
  labName: text(120, 'Which lab, when more than one holds it'),
};
const presentSession = (s) => ({
  ref: s.refNo, title: s.title, lab: s.labName, class: s.className, subject: s.subject, date: day(s.startsAt), time: time(s.startsAt), endsAt: time(s.endsAt),
  status: s.status, teacher: s.teacherName ?? null, devicesNeeded: s.devicesNeeded,
  items: (s.items ?? []).map((i) => `${i.name} ${i.quantityDisplay} ${i.displayUnit ?? ''}`.trim()),
  equipment: (s.equipment ?? []).map((e) => `${e.name} x${e.quantity}`),
  readiness: s.readiness?.checkedAt ? { ok: s.readiness.ok, problems: (s.readiness.problems ?? []).map((p) => p.message) } : null,
  safetyChecks: (s.safetyChecks ?? []).map((c) => `${c.item}${c.done ? ' (done)' : ''}`),
  present: s.presentCount ?? 0, onRoll: (s.attendance ?? []).length, outcomeNote: s.outcomeNote ?? null,
});
const presentDevice = (d) => ({ tag: d.tag, workstation: d.workstationNo ?? null, kind: d.kind, status: d.status, make: d.make ?? null, os: d.os ?? null, software: d.software ?? [], openRepairs: d.openRepairs ?? 0, warrantyUntil: day(d.warrantyUntil) });
const presentSoftware = (s) => ({ name: s.name, version: s.version ?? null, licence: s.licenceType ?? null, seatsTotal: s.seatsTotal ?? null, seatsUsed: s.seatsUsed, seatsFree: s.seatsFree, renewalOn: day(s.renewalOn), active: s.active !== false });

const labTools = {
  create_lab: tool({
    ...LAB, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For administration: set up a laboratory profile for a lab room in the facilities register (one that has none yet), with its type (chemistry, physics, biology, composite science or computer), capacity, alert window and safety checklist. Needs confirmation.',
    inputSchema: closed({
      room: text(120, 'The lab room by name or code, as in the facilities register'), type: oneOf(LAB_TYPES), name: text(120, 'Default: the room name'),
      capacity: int(0, 500), alertDays: int(7, 365, 'How many days ahead expiring stock is flagged (default 60)'), notes: text(2000),
      safetyChecklist: list(text(200), 40, 'Checks ticked before every practical, e.g. "Goggles on"'),
    }, ['room', 'type']),
    permission: 'labs.manage', minScope: 'ALL', service: 'labs.service.createLab()',
    async prepare() { return undefined; },
    summarise: (a, _x, p) => `Set up ${a.name ?? p?.room ?? a.room} as a ${words(a.type)} lab${a.capacity ? ` for ${a.capacity}` : ''}${a.safetyChecklist?.length ? ` with ${a.safetyChecklist.length} safety check(s)` : ''}`,
    async run(ctx, a) {
      const taken = (await Lab.find({}).select('facilityId').lean()).map((l) => l.facilityId);
      const rooms = (await Facility.find({ kind: 'LAB', _id: { $nin: taken } }).select('code name').lean()).map((f) => ({ id: String(f._id), code: f.code, name: f.name }));
      const room = pick(rooms, a.room, { label: 'lab room without a lab profile', refOf: (f) => f.code });
      const lab = await labs.createLab(ctx.actor, defined({ facilityId: room.id, type: a.type, name: a.name, capacity: a.capacity, alertDays: a.alertDays, notes: a.notes, safetyChecklist: a.safetyChecklist }));
      return did('lab_created', lab, `${lab.name} is set up as a ${words(lab.type)} lab.`);
    },
  }),

  list_lab_rooms_without_profile: tool({
    ...LAB, operation: 'GET',
    description: 'For administration: lab rooms in the facilities register that do not have a laboratory profile yet (code, name, capacity), to set one up. Read-only.',
    permission: 'labs.manage', minScope: 'ALL', service: 'Facility (kind LAB) without a Lab',
    async run() {
      const taken = (await Lab.find({}).select('facilityId').lean()).map((l) => l.facilityId);
      const rows = (await Facility.find({ kind: 'LAB', _id: { $nin: taken } }).select('code name capacity').sort({ code: 1 }).lean()).map((f) => ({ code: f.code, name: f.name, capacity: f.capacity ?? null }));
      return listed(rows, (f) => `${f.code} ${f.name}`, { noun: 'lab room' });
    },
  }),

  search_lab_code: tool({
    ...LAB, operation: 'GET',
    description: 'What a lab label names: a batch code, lot number, instrument code or serial, or computer tag typed in when the label will not scan, within the labs the caller may see. Read-only.',
    inputSchema: closed({ code: text(80, 'e.g. "LB-000012", "LE-000003" or a computer tag') }, ['code']),
    permission: 'labs.read', service: 'labs.service.resolveCode()',
    async run(ctx, a) {
      const r = await labs.resolveCode(ctx.actor, ctx.scope, a.code);
      if (r.type === 'BATCH') return shown({ type: r.type, code: r.code, item: r.item?.name, quantity: `${r.batch.quantityDisplay} ${r.batch.displayUnit}`, expiresOn: day(r.batch.expiresOn), status: r.batch.status, issuable: r.batch.issuable }, `${r.code} is a batch of ${r.item?.name}: ${r.batch.quantityDisplay} ${r.batch.displayUnit}, ${words(r.batch.status)}${r.batch.expiresOn ? `, expires ${day(r.batch.expiresOn)}` : ''}.`);
      if (r.type === 'EQUIPMENT') return shown({ type: r.type, code: r.code, name: r.equipment.name, outOfService: Boolean(r.equipment.outOfService), calibrationDueOn: day(r.equipment.calibrationDueOn) }, `${r.code} is the instrument ${r.equipment.name}${r.equipment.outOfService ? ' (out of service)' : ''}.`);
      return shown({ type: r.type, code: r.code, tag: r.device.tag, status: r.device.status, workstation: r.device.workstationNo ?? null }, `${r.code} is the ${words(r.device.kind ?? 'device')} ${r.device.tag} (${words(r.device.status)}).`);
    },
  }),

  sync_lab_due_items: tool({
    ...LAB, operation: 'ACTION', risk: RISK.MEDIUM,
    description: "For administration: bring every lab reminder in the tasks queue up to date now (batch expiries, calibrations, warranty and AMC ends, software renewals, items below minimum stock), as the daily job does. Needs confirmation.",
    permission: 'labs.manage', minScope: 'ALL', service: 'labs.due.runLabsDue()',
    summarise: () => 'Bring every lab reminder (expiry, calibration, warranty and AMC, software renewal, reorder) in the tasks queue up to date now',
    async run() {
      const c = await runLabsDue();
      return did('lab_due_items_synced', null, `Lab reminders brought up to date: ${c.batches} batch(es), ${c.items} item(s), ${c.equipment} instrument(s), ${c.software} software record(s) checked.`);
    },
  }),

  update_lab_item: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.LOW,
    description: "Change a lab stock item's details: its name, minimum stock and reorder quantity (in the item's unit), shelf location, storage group, hazard classes, locked-cupboard flag, CAS number, estimated unit price, or retire it. Needs confirmation.",
    inputSchema: closed({
      ...labItemArgs, rename: text(160), minStock: num(0, 1e7), reorderQty: num(0, 1e7), location: text(120), storageGroup: oneOf(STORAGE_GROUPS),
      hazardClasses: list(oneOf(HAZARD_CLASSES), 9), restricted: bool('Kept in the locked cupboard'), casNo: text(20), estUnitRupees: num(0, 1e7), active: bool('false retires the item'),
    }, ['item']),
    permission: 'labs.manage', service: 'labs.service.updateItem()',
    async prepare(ctx, a) { const it = await theLabItem(ctx, a); return { id: it.id, item: it.name, lab: it.labName, unit: it.displayUnit }; },
    summarise: (a, _x, p) => `Update ${p?.item ?? a.item}${p?.lab ? ` (${p.lab})` : ''}: ${changes({ name: a.rename, minimum: a.minStock !== undefined ? `${a.minStock} ${p?.unit ?? ''}` : undefined, reorder: a.reorderQty !== undefined ? `${a.reorderQty} ${p?.unit ?? ''}` : undefined, location: a.location, storage: a.storageGroup, hazards: a.hazardClasses, restricted: a.restricted, CAS: a.casNo, 'price per unit ₹': a.estUnitRupees, active: a.active })}`,
    async run(ctx, a, p) {
      const it = await labs.updateItem(ctx.actor, ctx.scope, p.id, defined({ name: a.rename, minStock: a.minStock, reorderQty: a.reorderQty, location: a.location, storageGroup: a.storageGroup, hazardClasses: a.hazardClasses, restricted: a.restricted, casNo: a.casNo, active: a.active, estUnitPaise: rupeesToPaise(a.estUnitRupees) }));
      return did('lab_item_updated', it, `${it.name} updated${it.lowStock ? '; it is below its minimum' : ''}.`);
    },
  }),

  return_lab_stock: tool({
    ...LAB, operation: 'ACTION', risk: RISK.LOW,
    description: 'Bring issued lab stock back to its batch (never more than is still out on that issue), e.g. "2 beakers came back from the 9A practical". Needs confirmation.',
    inputSchema: closed({ ...labItemArgs, quantity: num(0.001, 1e7), unit: text(10), issuedTo: text(120, 'Who or what it was issued to, when there are several issues out'), reason: text(500) }, ['item', 'quantity']),
    permission: 'labs.manage', service: 'labs.service.listMovements() + returnStock()',
    async prepare(ctx, a) {
      const it = await theLabItem(ctx, a);
      let out = rowsOf(await labs.listMovements(ctx.actor, ctx.scope, { itemId: it.id, type: 'ISSUE', pageSize: 200 })).filter((m) => m.outstanding > 0);
      if (a.issuedTo) out = out.filter((m) => lower(m.issuedToName).includes(lower(a.issuedTo)) || lower(m.reason).includes(lower(a.issuedTo)));
      if (!out.length) throw notFound(`No issue of ${it.name} is still out${a.issuedTo ? ` to ${a.issuedTo}` : ''}.`);
      if (out.length > 1) throw ask(`Which issue of ${it.name}? ${out.slice(0, 6).map((m) => `${day(m.at)} ${m.outstandingDisplay} ${m.displayUnit}${m.issuedToName ? ` to ${m.issuedToName}` : ''}`).join('; ')}`);
      const m = out[0];
      return { issueMovementId: m.id, item: it.name, unit: it.displayUnit, outstanding: m.outstandingDisplay, to: m.issuedToName ?? null, on: day(m.at) };
    },
    summarise: (a, _x, p) => `Return ${a.quantity} ${a.unit ?? p?.unit ?? ''} of ${p?.item ?? a.item} issued ${p?.on ?? ''}${p?.to ? ` to ${p.to}` : ''} (${p?.outstanding ?? '?'} still out)`,
    async run(ctx, a, p) {
      const r = await labs.returnStock(ctx.actor, ctx.scope, { issueMovementId: p.issueMovementId, quantity: a.quantity, unit: a.unit ?? p.unit, reason: a.reason });
      return did('lab_stock_returned', r.movement, `Returned. Batch ${r.batch.code} now holds ${r.batch.quantityDisplay} ${p.unit}.`);
    },
  }),

  set_lab_batch_status: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'Quarantine a lab stock batch (with the reason; it can then not be issued) or release it back to use (never an expired one), and/or record when it was opened or where it is kept. The batch is named by its code. Needs confirmation.',
    inputSchema: closed({ batch: text(40, 'Batch code, e.g. "LB-000012", or the lot number'), status: oneOf(['ACTIVE', 'QUARANTINED']), reason: text(300, 'Required to quarantine'), openedOn: dateStr('YYYY-MM-DD'), location: text(120) }, ['batch']),
    permission: 'labs.manage', service: 'labs.service.setBatchStatus()',
    async prepare(ctx, a) {
      if (a.status === 'QUARANTINED' && !a.reason) throw ask('Why is the batch being quarantined?');
      const r = await theBatch(ctx, a.batch);
      return { id: r.batch.id, code: r.code, item: r.item?.name, status: r.batch.status };
    },
    summarise: (a, _x, p) => `${a.status === 'QUARANTINED' ? 'Quarantine' : a.status === 'ACTIVE' ? 'Release from quarantine' : 'Update'} batch ${p?.code ?? a.batch}${p?.item ? ` of ${p.item}` : ''}${a.reason ? ` — ${a.reason}` : ''}${a.openedOn ? `; opened ${a.openedOn}` : ''}${a.location ? `; kept at ${a.location}` : ''}`,
    async run(ctx, a, p) {
      const b = await labs.setBatchStatus(ctx.actor, ctx.scope, p.id, defined({ status: a.status, reason: a.reason, openedOn: a.openedOn, location: a.location }));
      return did('lab_batch_updated', b, `Batch ${b.code} is ${words(b.status)}.`);
    },
  }),

  list_lab_stock_movements: tool({
    ...LAB, operation: 'GET',
    description: 'The lab stock ledger, newest first: receipts, issues (with what is still out), returns, consumption, damage, disposal and stocktake adjustments; optionally one lab, one item or one kind. Read-only.',
    inputSchema: closed({ labName: text(120), item: text(160), type: oneOf(['RECEIPT', 'ISSUE', 'RETURN', 'CONSUMED', 'DAMAGED', 'DISPOSED', 'ADJUSTMENT']), limit: int(1, 200) }),
    permission: 'labs.read', service: 'labs.service.listMovements()',
    async run(ctx, a) {
      const labId = await labIdOf(ctx, a.labName);
      const itemId = a.item ? (await theLabItem(ctx, a)).id : undefined;
      const rows = rowsOf(await labs.listMovements(ctx.actor, ctx.scope, defined({ labId, itemId, type: a.type, pageSize: a.limit ?? 50 }))).map((m) => ({
        ref: m.refNo, on: day(m.at), type: m.type, item: m.itemName, batch: m.batchCode, quantity: `${m.quantityDisplay} ${m.displayUnit ?? ''}`.trim(), balanceAfter: m.balanceDisplay, by: m.byName, to: m.issuedToName ?? null, reason: m.reason ?? null, stillOut: m.type === 'ISSUE' ? m.outstandingDisplay : undefined,
      }));
      return listed(rows, (m) => `${m.on} ${words(m.type)} ${m.quantity} ${m.item} (${m.batch})`, { noun: 'movement' });
    },
  }),

  update_lab_equipment: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "Change a lab instrument's record: name, serial, make, quantity, condition, calibration need and interval, calibration due date, warranty and AMC dates and vendor; take it out of service (with the reason) or put it back; or record it as disposed of (with the reason). Calibration certificates use record_lab_calibration. Needs confirmation.",
    inputSchema: closed({
      instrument: text(160, 'Name or code'), labName: text(120), rename: text(160), serialNo: text(120), make: text(120), quantity: int(0, 10000), condition: oneOf(['GOOD', 'FAIR', 'POOR']),
      calibrationRequired: bool(), calibrationIntervalMonths: int(1, 120), calibrationDueOn: dateStr(), warrantyUntil: dateStr(), amcUntil: dateStr(), amcVendorName: text(120),
      outOfService: bool(), outOfServiceReason: text(300), dispose: bool('Record it as disposed of'), disposeReason: text(500),
    }, ['instrument']),
    permission: 'labs.manage', service: 'labs.assets.updateEquipment()',
    async prepare(ctx, a) {
      if (a.outOfService === true && !a.outOfServiceReason) throw ask('Why is it out of service?');
      if (a.dispose === true && !a.disposeReason) throw ask('How and why is it being disposed of?');
      const e = await theInstrument(ctx, a);
      return { id: e.id, name: e.name, code: e.code };
    },
    summarise: (a, _x, p) => `Update ${p?.name ?? a.instrument} (${p?.code ?? ''}): ${changes({ name: a.rename, serial: a.serialNo, make: a.make, quantity: a.quantity, condition: a.condition, 'calibration needed': a.calibrationRequired, 'every (months)': a.calibrationIntervalMonths, 'calibration due': a.calibrationDueOn, warranty: a.warrantyUntil, AMC: a.amcUntil, 'AMC vendor': a.amcVendorName, 'out of service': a.outOfService === undefined ? undefined : `${a.outOfService}${a.outOfServiceReason ? ` (${a.outOfServiceReason})` : ''}`, disposed: a.dispose ? `yes (${a.disposeReason})` : undefined })}`,
    async run(ctx, a, p) {
      const e = await labAssets.updateEquipment(ctx.actor, ctx.scope, p.id, defined({ name: a.rename, serialNo: a.serialNo, make: a.make, quantity: a.quantity, condition: a.condition, calibrationRequired: a.calibrationRequired, calibrationIntervalMonths: a.calibrationIntervalMonths, calibrationDueOn: a.calibrationDueOn, warrantyUntil: a.warrantyUntil, amcUntil: a.amcUntil, amcVendorName: a.amcVendorName, outOfService: a.outOfService, outOfServiceReason: a.outOfServiceReason, dispose: a.dispose, disposeReason: a.disposeReason }));
      return did('lab_equipment_updated', e, `${e.name} updated${e.outOfService ? ' (out of service)' : ''}${e.status === 'DISPOSED' ? ' (disposed of)' : ''}.`);
    },
  }),

  record_lab_equipment_repair: tool({
    ...LAB, operation: 'ACTION', risk: RISK.LOW,
    description: 'Log a repair on a lab instrument (OPEN: what is wrong, the vendor, an estimate, optionally a maintenance work order; it goes out of service unless told otherwise) or close one (CLOSE: what was done, the cost; it is back in service once no repair is open). Needs confirmation.',
    inputSchema: closed({
      step: oneOf(['OPEN', 'CLOSE']), instrument: text(160, 'Name or code'), labName: text(120), issue: text(500, 'OPEN: what is wrong; CLOSE: which repair, when several are open'),
      action: text(500, 'What was or will be done'), vendorName: text(160), costRupees: num(0, 1e8), createWorkOrder: bool('OPEN: raise a maintenance work order too'),
      keepInService: bool('OPEN: it can still be used meanwhile'), stayOutOfService: bool('CLOSE: keep it out of service'),
    }, ['step', 'instrument']),
    permission: 'labs.manage', service: 'labs.assets.addEquipmentRepair() / closeEquipmentRepair()',
    async prepare(ctx, a) {
      if (a.step === 'OPEN' && !a.issue) throw ask('What is wrong with it?');
      const e = await theInstrument(ctx, a);
      if (a.step === 'OPEN') return { id: e.id, name: e.name, code: e.code };
      const open = (e.repairs ?? []).filter((r) => !r.closedAt);
      const r = open.length === 1 ? open[0] : pick(open.map((x) => ({ ...x, id: String(x._id ?? x.id), name: x.issue })), a.issue, { label: `open repair on ${e.name}`, refOf: () => null });
      return { id: e.id, name: e.name, code: e.code, repairId: String(r._id ?? r.id), issue: r.issue };
    },
    summarise: (a, _x, p) => (a.step === 'OPEN'
      ? `Log a repair on ${p?.name ?? a.instrument} (${p?.code ?? ''}): ${a.issue}${a.vendorName ? `, by ${a.vendorName}` : ''}${a.costRupees ? `, ₹${a.costRupees}` : ''}${a.createWorkOrder ? '; raise a work order' : ''}${a.keepInService ? '' : '; it goes out of service'}`
      : `Close the repair "${p?.issue ?? a.issue ?? ''}" on ${p?.name ?? a.instrument}${a.action ? `: ${a.action}` : ''}${a.costRupees !== undefined ? `, cost ₹${a.costRupees}` : ''}`),
    async run(ctx, a, p) {
      const e = a.step === 'OPEN'
        ? await labAssets.addEquipmentRepair(ctx.actor, ctx.scope, p.id, defined({ issue: a.issue, action: a.action, vendorName: a.vendorName, costPaise: rupeesToPaise(a.costRupees), createWorkOrder: a.createWorkOrder, outOfService: a.keepInService ? false : undefined }))
        : await labAssets.closeEquipmentRepair(ctx.actor, ctx.scope, p.id, p.repairId, defined({ action: a.action, costPaise: rupeesToPaise(a.costRupees), backInService: a.stayOutOfService ? false : undefined }));
      return did(a.step === 'OPEN' ? 'lab_equipment_repair_logged' : 'lab_equipment_repair_closed', e, `${e.name}: ${e.openRepairs} open repair(s)${e.outOfService ? ', out of service' : ', in service'}.`);
    },
  }),

  list_lab_devices: tool({
    ...LAB, operation: 'GET',
    description: 'Lab computers and other devices: tag, workstation, kind, status (in use, spare, in repair), the software with a seat on each, open repairs and warranty. Optionally one lab or one status. Read-only.',
    inputSchema: closed({ labName: text(120), status: oneOf(['IN_USE', 'SPARE', 'IN_REPAIR', 'DECOMMISSIONED']) }),
    permission: 'labs.read', service: 'labs.assets.listDevices()',
    async run(ctx, a) {
      const labId = await labIdOf(ctx, a.labName);
      const rows = (await labAssets.listDevices(ctx.actor, ctx.scope, defined({ labId, status: a.status }))).map(presentDevice);
      return listed(rows, (d) => `${d.tag}${d.workstation ? ` (${d.workstation})` : ''} ${words(d.status)}`, { noun: 'device' });
    },
  }),

  update_lab_device: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.LOW,
    description: "Change a lab computer's record: tag, workstation number, kind, make, operating system, serial, status (in use, spare, in repair), warranty and AMC dates, CPU, RAM and storage. No passwords or licence keys are stored. Needs confirmation.",
    inputSchema: closed({
      device: text(60, 'Tag or workstation number'), labName: text(120), newTag: text(40), workstationNo: text(40), kind: oneOf(['DESKTOP', 'LAPTOP', 'TABLET', 'PRINTER', 'PROJECTOR', 'NETWORK', 'PERIPHERAL', 'OTHER']),
      make: text(120), os: text(120), serialNo: text(120), status: oneOf(['IN_USE', 'SPARE', 'IN_REPAIR']), warrantyUntil: dateStr(), amcUntil: dateStr(), cpu: text(80), ramGb: num(0, 4096), storageGb: num(0, 1e6),
    }, ['device']),
    permission: 'labs.manage', service: 'labs.assets.updateDevice()',
    async prepare(ctx, a) { const d = await theDevice(ctx, a); return { id: d.id, tag: d.tag, hardware: d.hardware ?? {} }; },
    summarise: (a, _x, p) => `Update ${p?.tag ?? a.device}: ${changes({ tag: a.newTag, workstation: a.workstationNo, kind: a.kind, make: a.make, OS: a.os, serial: a.serialNo, status: a.status, warranty: a.warrantyUntil, AMC: a.amcUntil, CPU: a.cpu, 'RAM GB': a.ramGb, 'storage GB': a.storageGb })}`,
    async run(ctx, a, p) {
      const hw = a.cpu !== undefined || a.ramGb !== undefined || a.storageGb !== undefined ? { cpu: a.cpu ?? p.hardware.cpu, ramGb: a.ramGb ?? p.hardware.ramGb, storageGb: a.storageGb ?? p.hardware.storageGb, other: p.hardware.other } : undefined;
      const d = await labAssets.updateDevice(ctx.actor, ctx.scope, p.id, defined({ tag: a.newTag, workstationNo: a.workstationNo, kind: a.kind, make: a.make, os: a.os, serialNo: a.serialNo, status: a.status, warrantyUntil: a.warrantyUntil, amcUntil: a.amcUntil, hardware: hw }));
      return did('lab_device_updated', d, `${d.tag} updated (${words(d.status)}).`);
    },
  }),

  record_lab_device_repair: tool({
    ...LAB, operation: 'ACTION', risk: RISK.LOW,
    description: 'Log a repair on a lab computer or device (OPEN: what is wrong, vendor, estimate, optionally a work order; it is marked in repair) or close one (CLOSE: what was done, the cost, and whether it goes back in use or to spares). Needs confirmation.',
    inputSchema: closed({
      step: oneOf(['OPEN', 'CLOSE']), device: text(60, 'Tag or workstation number'), labName: text(120), issue: text(500, 'OPEN: what is wrong; CLOSE: which repair, when several are open'),
      action: text(500), vendorName: text(160), costRupees: num(0, 1e8), createWorkOrder: bool(), backTo: oneOf(['IN_USE', 'SPARE'], 'CLOSE: where it goes (default in use)'),
    }, ['step', 'device']),
    permission: 'labs.manage', service: 'labs.assets.addDeviceRepair() / closeDeviceRepair()',
    async prepare(ctx, a) {
      if (a.step === 'OPEN' && !a.issue) throw ask('What is wrong with it?');
      const d = await theDevice(ctx, a);
      if (a.step === 'OPEN') return { id: d.id, tag: d.tag };
      const open = (d.repairs ?? []).filter((r) => !r.closedAt);
      const r = open.length === 1 ? open[0] : pick(open.map((x) => ({ ...x, id: String(x._id ?? x.id), name: x.issue })), a.issue, { label: `open repair on ${d.tag}`, refOf: () => null });
      return { id: d.id, tag: d.tag, repairId: String(r._id ?? r.id), issue: r.issue };
    },
    summarise: (a, _x, p) => (a.step === 'OPEN'
      ? `Log a repair on ${p?.tag ?? a.device}: ${a.issue}${a.vendorName ? `, by ${a.vendorName}` : ''}${a.createWorkOrder ? '; raise a work order' : ''} (marked in repair)`
      : `Close the repair "${p?.issue ?? ''}" on ${p?.tag ?? a.device}${a.action ? `: ${a.action}` : ''}${a.costRupees !== undefined ? `, cost ₹${a.costRupees}` : ''}; back to ${words(a.backTo ?? 'IN_USE')}`),
    async run(ctx, a, p) {
      const d = a.step === 'OPEN'
        ? await labAssets.addDeviceRepair(ctx.actor, ctx.scope, p.id, defined({ issue: a.issue, action: a.action, vendorName: a.vendorName, costPaise: rupeesToPaise(a.costRupees), createWorkOrder: a.createWorkOrder }))
        : await labAssets.closeDeviceRepair(ctx.actor, ctx.scope, p.id, p.repairId, defined({ action: a.action, costPaise: rupeesToPaise(a.costRupees), status: a.backTo }));
      return did(a.step === 'OPEN' ? 'lab_device_repair_logged' : 'lab_device_repair_closed', d, `${d.tag} is ${words(d.status)}.`);
    },
  }),

  list_lab_software: tool({
    ...LAB, operation: 'GET',
    description: 'Lab software and licence seats: version, licence type, seats used and free, renewal date. Optionally one lab. No licence keys are kept. Read-only.',
    inputSchema: closed({ labName: text(120) }),
    permission: 'labs.read', service: 'labs.assets.listSoftware()',
    async run(ctx, a) {
      const labId = await labIdOf(ctx, a.labName);
      const rows = (await labAssets.listSoftware(ctx.actor, ctx.scope, defined({ labId }))).map(presentSoftware);
      return listed(rows, (s) => `${s.name}${s.seatsTotal ? ` (${s.seatsUsed}/${s.seatsTotal} seats)` : ''}${s.renewalOn ? `, renews ${s.renewalOn}` : ''}`, { noun: 'software title' });
    },
  }),

  add_lab_software: tool({
    ...LAB, operation: 'CREATE', risk: RISK.LOW,
    description: 'Add a software title to a lab (or, for administration, school-wide): publisher, version, licence type, number of seats, renewal date, cost and vendor. Never a licence key or password. Needs confirmation.',
    inputSchema: closed({
      name: text(160), labName: text(120, 'Required unless it is school-wide (administration only)'), publisher: text(120), version: text(120),
      licenceType: oneOf(['FREE', 'OPEN_SOURCE', 'PERPETUAL', 'SUBSCRIPTION', 'EDUCATION_GRANT']), seatsTotal: int(0, 100000), renewalOn: dateStr(), costRupees: num(0, 1e9), vendorName: text(120), notes: text(1000),
    }, ['name']),
    permission: 'labs.manage', service: 'labs.assets.createSoftware()',
    async prepare(ctx, a) { const lab = a.labName ? await theLab(ctx, a.labName) : null; return { labId: lab?.id ?? null, lab: lab?.name ?? null }; },
    summarise: (a, _x, p) => `Add ${a.name}${a.version ? ` ${a.version}` : ''} to ${p?.lab ?? a.labName ?? 'every lab'}${a.seatsTotal ? `, ${a.seatsTotal} seat(s)` : ''}${a.licenceType ? `, ${words(a.licenceType)}` : ''}${a.renewalOn ? `, renews ${a.renewalOn}` : ''}`,
    async run(ctx, a, p) {
      const s = await labAssets.createSoftware(ctx.actor, ctx.scope, defined({ name: a.name, labId: p.labId ?? undefined, publisher: a.publisher, version: a.version, licenceType: a.licenceType, seatsTotal: a.seatsTotal, renewalOn: a.renewalOn, costPaise: rupeesToPaise(a.costRupees), vendorName: a.vendorName, notes: a.notes }));
      return did('lab_software_added', s, `${s.name} added.`);
    },
  }),

  update_lab_software: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.LOW,
    description: 'Change a lab software record: name, publisher, version, licence type, seats (not below those in use), renewal date (a new date records a renewal), cost, vendor, notes, or retire it. Needs confirmation.',
    inputSchema: closed({
      software: text(160), labName: text(120), rename: text(160), publisher: text(120), version: text(120), licenceType: oneOf(['FREE', 'OPEN_SOURCE', 'PERPETUAL', 'SUBSCRIPTION', 'EDUCATION_GRANT']),
      seatsTotal: int(0, 100000), renewalOn: dateStr(), costRupees: num(0, 1e9), vendorName: text(120), notes: text(1000), active: bool(),
    }, ['software']),
    permission: 'labs.manage', service: 'labs.assets.updateSoftware()',
    async prepare(ctx, a) { const s = await theSoftware(ctx, a); return { id: s.id, name: s.name }; },
    summarise: (a, _x, p) => `Update ${p?.name ?? a.software}: ${changes({ name: a.rename, publisher: a.publisher, version: a.version, licence: a.licenceType, seats: a.seatsTotal, renewal: a.renewalOn, 'cost ₹': a.costRupees, vendor: a.vendorName, notes: a.notes, active: a.active })}`,
    async run(ctx, a, p) {
      const s = await labAssets.updateSoftware(ctx.actor, ctx.scope, p.id, defined({ name: a.rename, publisher: a.publisher, version: a.version, licenceType: a.licenceType, seatsTotal: a.seatsTotal, renewalOn: a.renewalOn, costPaise: rupeesToPaise(a.costRupees), vendorName: a.vendorName, notes: a.notes, active: a.active }));
      return did('lab_software_updated', s, `${s.name} updated.`);
    },
  }),

  set_lab_software_seat: tool({
    ...LAB, operation: 'ACTION', risk: RISK.LOW,
    description: 'Give a lab computer a seat of a software title (ASSIGN; refused when every seat is in use) or free its seat (RELEASE). Needs confirmation.',
    inputSchema: closed({ step: oneOf(['ASSIGN', 'RELEASE']), software: text(160), device: text(60, 'Tag or workstation number'), labName: text(120) }, ['step', 'software', 'device']),
    permission: 'labs.manage', service: 'labs.assets.assignSeat() / releaseSeat()',
    async prepare(ctx, a) {
      const s = await theSoftware(ctx, a);
      const d = await theDevice(ctx, a);
      return { softwareId: s.id, software: s.name, deviceId: d.id, tag: d.tag, used: s.seatsUsed, total: s.seatsTotal };
    },
    summarise: (a, _x, p) => `${a.step === 'ASSIGN' ? 'Give' : 'Take back'} a seat of ${p?.software ?? a.software} ${a.step === 'ASSIGN' ? 'to' : 'from'} ${p?.tag ?? a.device}${p?.total ? ` (${p.used}/${p.total} in use)` : ''}`,
    async run(ctx, a, p) {
      const s = a.step === 'ASSIGN'
        ? await labAssets.assignSeat(ctx.actor, ctx.scope, p.softwareId, { deviceId: p.deviceId })
        : await labAssets.releaseSeat(ctx.actor, ctx.scope, p.softwareId, { deviceId: p.deviceId });
      return did(a.step === 'ASSIGN' ? 'lab_seat_assigned' : 'lab_seat_released', s, `${s.name}: ${s.seatsUsed}${s.seatsTotal ? ` of ${s.seatsTotal}` : ''} seat(s) in use.`);
    },
  }),

  get_practical_session: tool({
    ...LAB, operation: 'GET',
    description: 'One practical session in full: lab, class, time, status, the stock and instruments it needs, the last readiness check and its problems, the safety checklist, attendance count and outcome. Read-only.',
    inputSchema: closed({ session: text(200, 'Reference (e.g. "PRC/2026/0004") or title') }, ['session']),
    permission: 'labs.read', service: 'labs.sessions.getSession()',
    async run(ctx, a) {
      const s = await theSession(ctx, a.session);
      const full = presentSession(await labSessions.getSession(ctx.actor, ctx.scope, s.id));
      return shown(full, `${full.ref} ${full.title} in ${full.lab} on ${full.date} at ${full.time}: ${words(full.status)}${full.readiness ? (full.readiness.ok ? ', ready' : `, ${full.readiness.problems.length} readiness note(s)`) : ''}.`);
    },
  }),

  update_practical_session: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.LOW,
    description: "Change a practical before it is prepared: its title, safety notes, computers needed, and the stock items and instruments it needs from the lab's own catalogue (each by name with a quantity). The readiness check is reset. Needs confirmation.",
    inputSchema: closed({
      session: text(200, 'Reference or title'), title: text(200), safetyNotes: text(4000), devicesNeeded: int(0, 500),
      items: list(closed({ item: text(160), quantity: num(0.001, 1e7), unit: text(10) }, ['item', 'quantity']), 60, 'Replaces the stock list'),
      equipment: list(closed({ instrument: text(160), quantity: int(1, 1000) }, ['instrument']), 60, 'Replaces the instrument list'),
    }, ['session']),
    permission: 'labs.manage', service: 'labs.sessions.updateSession()',
    async prepare(ctx, a) {
      const s = await theSession(ctx, a.session, ['PLANNED', 'PREP_REQUESTED']);
      const full = await labSessions.getSession(ctx.actor, ctx.scope, s.id);
      const out = { id: s.id, ref: s.refNo, title: s.title };
      if (a.items) {
        const pool = (await LabItem.find({ labId: full.labId, active: true }).select('name displayUnit').lean()).map((i) => ({ id: String(i._id), name: i.name, unit: i.displayUnit }));
        out.items = a.items.map((l) => { const i = pick(pool, l.item, { label: `item in ${full.labName}`, refOf: () => null }); return { itemId: i.id, name: i.name, quantity: l.quantity, unit: l.unit ?? i.unit }; });
      }
      if (a.equipment) {
        const pool = (await LabEquipment.find({ labId: full.labId, status: 'ACTIVE' }).select('name code').lean()).map((e) => ({ id: String(e._id), name: e.name, code: e.code }));
        out.equipment = a.equipment.map((l) => { const e = pick(pool, l.instrument, { label: `instrument in ${full.labName}`, refOf: (x) => x.code }); return { equipmentId: e.id, name: e.name, quantity: l.quantity ?? 1 }; });
      }
      return out;
    },
    summarise: (a, _x, p) => `Change ${p?.ref ?? ''} ${p?.title ?? a.session}: ${changes({ title: a.title, 'safety notes': a.safetyNotes ? excerpt(a.safetyNotes, 60) : undefined, computers: a.devicesNeeded, items: p?.items?.map((i) => `${i.name} ${i.quantity} ${i.unit}`), instruments: p?.equipment?.map((e) => `${e.name} x${e.quantity}`) })}`,
    async run(ctx, a, p) {
      const s = await labSessions.updateSession(ctx.actor, ctx.scope, p.id, defined({
        title: a.title, safetyNotes: a.safetyNotes, devicesNeeded: a.devicesNeeded,
        items: p.items?.map(({ itemId, quantity, unit }) => ({ itemId, quantity, unit })), equipment: p.equipment?.map(({ equipmentId, quantity }) => ({ equipmentId, quantity })),
      }));
      return did('practical_updated', s, `${s.refNo} updated; run the readiness check again.`);
    },
  }),

  move_practical_session: tool({
    ...LAB, operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Move a practical along: CHECK_READINESS (checks stock, instruments and computers as they are now), REQUEST_PREP (sends it to the lab assistant with a note), MARK_PREPARED (only when ready, or with acceptProblems and a note), START (only once the teacher says which safety checks are done; the class roll is loaded), COMPLETE (with an outcome note) or CANCEL (with the reason). Needs confirmation.",
    inputSchema: closed({
      session: text(200, 'Reference or title'), step: oneOf(['CHECK_READINESS', 'REQUEST_PREP', 'MARK_PREPARED', 'START', 'COMPLETE', 'CANCEL']),
      note: text(1000), acceptProblems: bool('MARK_PREPARED: go ahead despite readiness problems'),
      checksDone: list(text(200), 40, 'START: the safety checks the teacher says are done'), allChecksDone: bool('START: the teacher says every safety check is done'),
      outcomeNote: text(4000, 'COMPLETE: how it went'), reason: text(500, 'CANCEL: why'),
    }, ['session', 'step']),
    permission: 'labs.manage', service: 'labs.sessions.checkReadiness / requestPreparation / markPrepared / startSession / completeSession / cancelSession',
    async prepare(ctx, a) {
      const allowed = { CHECK_READINESS: SESSION_STATUSES.open, REQUEST_PREP: ['PLANNED', 'PREP_REQUESTED'], MARK_PREPARED: ['PLANNED', 'PREP_REQUESTED'], START: ['PLANNED', 'PREP_REQUESTED', 'READY'], COMPLETE: ['IN_PROGRESS'], CANCEL: SESSION_STATUSES.open }[a.step];
      if (a.step === 'CANCEL' && !a.reason) throw ask('Why is the practical cancelled?');
      if (a.step === 'MARK_PREPARED' && a.acceptProblems && !a.note) throw ask('What note goes with accepting the readiness problems?');
      const s = await theSession(ctx, a.session, allowed);
      let checks;
      if (a.step === 'START') {
        const lab = await Lab.findById(s.labId).select('safetyChecklist').lean();
        const list = (lab?.safetyChecklist ?? []).map((c) => c.item);
        const required = (lab?.safetyChecklist ?? []).filter((c) => c.required).map((c) => c.item);
        if (a.allChecksDone) checks = list;
        else {
          checks = (a.checksDone ?? []).map((c) => list.find((x) => lower(x) === lower(c)) ?? list.find((x) => lower(x).includes(lower(c))) ?? c);
          const missing = required.filter((r) => !checks.includes(r));
          if (missing.length) throw ask(`Before starting, are these safety checks done? ${missing.join('; ')}`);
        }
      }
      return { id: s.id, ref: s.refNo, title: s.title, when: `${day(s.startsAt)} ${time(s.startsAt)}`, checks };
    },
    summarise: (a, _x, p) => {
      const what = { CHECK_READINESS: 'Check readiness of', REQUEST_PREP: 'Send to the lab assistant for preparation:', MARK_PREPARED: 'Mark prepared:', START: 'Start', COMPLETE: 'Complete', CANCEL: 'Cancel' }[a.step];
      return `${what} ${p?.ref ?? ''} ${p?.title ?? a.session} (${p?.when ?? ''})${a.step === 'START' && p?.checks?.length ? `; safety checks done: ${p.checks.join(', ')}` : ''}${a.step === 'MARK_PREPARED' && a.acceptProblems ? ' despite readiness problems' : ''}${a.reason ? ` — ${a.reason}` : ''}${a.outcomeNote ? ` — ${excerpt(a.outcomeNote, 80)}` : ''}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`;
    },
    async run(ctx, a, p) {
      if (a.step === 'CHECK_READINESS') {
        const r = await labSessions.checkReadiness(ctx.actor, ctx.scope, p.id);
        return did('practical_readiness_checked', r, r.blocking.length ? `Not ready: ${r.blocking.map((x) => x.message).join(' ')}` : `${r.refNo} is ready.${r.notes.length ? ` Notes: ${r.notes.map((x) => x.message).join(' ')}` : ''}`);
      }
      const fn = {
        REQUEST_PREP: () => labSessions.requestPreparation(ctx.actor, ctx.scope, p.id, { note: a.note }),
        MARK_PREPARED: () => labSessions.markPrepared(ctx.actor, ctx.scope, p.id, { acceptProblems: a.acceptProblems === true, note: a.note }),
        START: () => labSessions.startSession(ctx.actor, ctx.scope, p.id, { checksDone: p.checks ?? [] }),
        COMPLETE: () => labSessions.completeSession(ctx.actor, ctx.scope, p.id, { outcomeNote: a.outcomeNote ?? a.note }),
        CANCEL: () => labSessions.cancelSession(ctx.actor, ctx.scope, p.id, { reason: a.reason }),
      }[a.step];
      const s = await fn();
      return did('practical_step_done', s, `${s.refNo} is ${words(s.status)}.`);
    },
  }),

  record_practical_attendance: tool({
    ...LAB, operation: 'ACTION', risk: RISK.LOW,
    description: 'Supervised attendance for a practical that has started: who was in the lab (allPresent, or name those present, or those absent), plus anyone not on the class roll. Recorded by the supervising teacher. Needs confirmation.',
    inputSchema: closed({
      session: text(200, 'Reference or title'), allPresent: bool(), present: list(text(80), 100, 'Names of those present'), absent: list(text(80), 100, 'With allPresent: those not there'),
      extra: list(text(120), 60, 'People in the lab who are not on the roll'),
    }, ['session']),
    permission: 'labs.manage', service: 'labs.sessions.recordAttendance()',
    async prepare(ctx, a) {
      if (!a.allPresent && !a.present?.length) throw ask('Who was present? Say "everyone" or name them.');
      const s = await theSession(ctx, a.session, ['IN_PROGRESS', 'COMPLETED']);
      const full = await labSessions.getSession(ctx.actor, ctx.scope, s.id);
      const roll = (full.attendance ?? []).filter((x) => x.enrollmentId).map((x) => ({ id: String(x.enrollmentId), name: x.name }));
      const named = (names) => (names ?? []).map((n) => pickPerson(roll, n, { label: 'student on this practical\'s roll' }));
      const absent = new Set(named(a.absent).map((x) => x.id));
      const present = a.allPresent ? roll.filter((x) => !absent.has(x.id)) : named(a.present);
      return { id: s.id, ref: s.refNo, title: s.title, presentIds: present.map((x) => x.id), presentNames: present.map((x) => x.name), roll: roll.length, absentNames: roll.filter((x) => !present.some((y) => y.id === x.id)).map((x) => x.name) };
    },
    summarise: (a, _x, p) => `Attendance for ${p?.ref ?? ''} ${p?.title ?? a.session}: ${p?.presentIds?.length ?? '?'} of ${p?.roll ?? '?'} present${p?.absentNames?.length ? `; absent: ${p.absentNames.slice(0, 10).join(', ')}` : ''}${a.extra?.length ? `; also in the lab: ${a.extra.join(', ')}` : ''}`,
    async run(ctx, a, p) {
      const s = await labSessions.recordAttendance(ctx.actor, ctx.scope, p.id, { presentEnrollmentIds: p.presentIds, extra: (a.extra ?? []).map((name) => ({ name })) });
      return did('practical_attendance_recorded', s, `Saved: ${s.presentCount} present.`);
    },
  }),

  close_lab_incident: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.LOW,
    description: 'Close an open lab incident with what was done about it. Needs confirmation.',
    inputSchema: closed({ incident: text(60, 'Reference, e.g. "LIN/2026/0002", or the lab name when it has one open incident'), closureNote: text(2000) }, ['incident', 'closureNote']),
    permission: 'labs.manage', service: 'labs.sessions.listIncidents() + closeIncident()',
    async prepare(ctx, a) {
      const rows = await labSessions.listIncidents(ctx.actor, ctx.scope, { status: 'OPEN' });
      const i = refPick(rows, a.incident, { label: 'open lab incident', nameOf: (x) => x.labName, describe: (x) => `${x.refNo} ${words(x.kind)} in ${x.labName}` });
      return { id: i.id, ref: i.refNo, kind: i.kind, lab: i.labName };
    },
    summarise: (a, _x, p) => `Close ${p?.ref ?? a.incident} (${words(p?.kind ?? '')} in ${p?.lab ?? 'the lab'}): ${a.closureNote}`,
    async run(ctx, a, p) {
      const i = await labSessions.closeIncident(ctx.actor, ctx.scope, p.id, { closureNote: a.closureNote });
      return did('lab_incident_closed', i, `${i.refNo} closed.`);
    },
  }),

  get_lab: tool({
    ...LAB, operation: 'GET',
    description: "One laboratory's profile: type, room, capacity, who is in charge, the lab assistant, the alert window, the safety checklist and notes. Read-only.",
    inputSchema: closed({ labName: text(120) }),
    permission: 'labs.read', service: 'labs.service.getLab()',
    async run(ctx, a) {
      const l = await labs.getLab(ctx.actor, ctx.scope, (await theLab(ctx, a.labName)).id);
      const out = { name: l.name, type: l.type, room: l.facilityName, code: l.facilityCode, capacity: l.capacity, inCharge: l.inChargeNames, assistant: l.assistantName, alertDays: l.alertDays, status: l.status, safetyChecklist: (l.safetyChecklist ?? []).map((c) => `${c.item}${c.required ? '' : ' (optional)'}`), notes: l.notes ?? null };
      return shown(out, `${out.name} (${words(out.type)}), in charge: ${out.inCharge.join(', ') || 'nobody'}${out.assistant ? `, assistant ${out.assistant}` : ''}; ${out.safetyChecklist.length} safety check(s).`);
    },
  }),

  update_lab: tool({
    ...LAB, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "Change a laboratory's profile: name, type, capacity, alert window, notes, safety checklist and lab assistant; administration can also change who is in charge and close or reopen it. Needs confirmation.",
    inputSchema: closed({
      labName: text(120), rename: text(120), type: oneOf(LAB_TYPES), capacity: int(0, 500), alertDays: int(7, 365), notes: text(2000),
      safetyChecklist: list(text(200), 40, 'Replaces the checklist'), assistantName: text(120), inChargeNames: list(text(120), 5, 'Administration only'), status: oneOf(['ACTIVE', 'CLOSED'], 'Administration only'),
    }, ['labName']),
    permission: 'labs.manage', service: 'labs.service.updateLab()',
    async prepare(ctx, a) {
      if ((a.inChargeNames || a.status) && ctx.scope !== 'ALL') throw forbidden('Only administration changes who runs a lab or closes it.');
      const l = await theLab(ctx, a.labName);
      const assistant = a.assistantName ? await staffNamed(a.assistantName, 'lab assistant') : null;
      const inCharge = a.inChargeNames ? await Promise.all(a.inChargeNames.map((n) => staffNamed(n, 'member of staff'))) : null;
      return { id: l.id, lab: l.name, assistant, inCharge };
    },
    summarise: (a, _x, p) => `Update ${p?.lab ?? a.labName}: ${changes({ name: a.rename, type: a.type, capacity: a.capacity, 'alert days': a.alertDays, notes: a.notes ? excerpt(a.notes, 60) : undefined, checklist: a.safetyChecklist, assistant: p?.assistant?.name, 'in charge': p?.inCharge?.map((x) => x.name), status: a.status })}`,
    async run(ctx, a, p) {
      const l = await labs.updateLab(ctx.actor, ctx.scope, p.id, defined({ name: a.rename, type: a.type, capacity: a.capacity, alertDays: a.alertDays, notes: a.notes, safetyChecklist: a.safetyChecklist, assistantProfileId: p.assistant?.id, inChargeProfileIds: p.inCharge?.map((x) => x.id), status: a.status }));
      return did('lab_updated', l, `${l.name} updated.`);
    },
  }),

  add_lab_item: tool({
    ...LAB, operation: 'CREATE', risk: RISK.LOW,
    description: "Add an item to a lab's stock catalogue (a chemical, consumable, glassware, specimen or component): its unit, CAS number, hazard classes, storage group, minimum stock, reorder quantity, location and locked-cupboard flag. Stock itself is then received with receive_lab_stock. Needs confirmation.",
    inputSchema: closed({
      labName: text(120), name: text(160), kind: oneOf(ITEM_KINDS), unit: text(10, 'g, kg, mg, mL, L or pcs'), casNo: text(20), hazardClasses: list(oneOf(HAZARD_CLASSES), 9),
      storageGroup: oneOf(STORAGE_GROUPS), minStock: num(0, 1e7), reorderQty: num(0, 1e7), location: text(120), restricted: bool(), estUnitRupees: num(0, 1e7),
    }, ['labName', 'name']),
    permission: 'labs.manage', service: 'labs.service.createItem()',
    async prepare(ctx, a) { const l = await theLab(ctx, a.labName); return { labId: l.id, lab: l.name }; },
    summarise: (a, _x, p) => `Add ${a.name} (${words(a.kind ?? 'CHEMICAL')}, in ${a.unit ?? 'pcs'}) to ${p?.lab ?? a.labName}${a.hazardClasses?.length ? `; hazards ${a.hazardClasses.join(', ').toLowerCase()}` : ''}${a.minStock ? `; minimum ${a.minStock}` : ''}`,
    async run(ctx, a, p) {
      const it = await labs.createItem(ctx.actor, ctx.scope, p.labId, defined({ name: a.name, kind: a.kind, unit: a.unit, casNo: a.casNo, hazardClasses: a.hazardClasses, storageGroup: a.storageGroup, minStock: a.minStock, reorderQty: a.reorderQty, location: a.location, restricted: a.restricted, estUnitPaise: rupeesToPaise(a.estUnitRupees) }));
      return did('lab_item_added', it, `${it.name} added to ${p.lab}.`);
    },
  }),

  record_lab_stocktake: tool({
    ...LAB, operation: 'ACTION', risk: RISK.MEDIUM,
    description: 'Record a lab stocktake: what was counted on the shelf, batch by batch (each by its code), with the reason. Each difference becomes an adjustment in the ledger; a batch that moved since it was counted is refused and must be recounted. Needs confirmation.',
    inputSchema: closed({
      labName: text(120), reason: text(500, 'e.g. "Term-end count"'),
      lines: list(closed({ batch: text(40, 'Batch code'), counted: num(0, 1e7), unit: text(10), note: text(300) }, ['batch', 'counted']), 200),
    }, ['labName', 'reason', 'lines']),
    permission: 'labs.manage', service: 'labs.service.stocktake()',
    async prepare(ctx, a) {
      if (!a.lines?.length) throw ask('Which batches were counted, and how much of each?');
      const l = await theLab(ctx, a.labName);
      const lines = [];
      for (const line of a.lines) {
        // eslint-disable-next-line no-await-in-loop
        const r = await theBatch(ctx, line.batch);
        lines.push({ batchId: r.batch.id, code: r.code, item: r.item?.name, onRecord: `${r.batch.quantityDisplay} ${r.batch.displayUnit}`, counted: line.counted, unit: line.unit ?? r.batch.displayUnit, note: line.note });
      }
      return { labId: l.id, lab: l.name, lines };
    },
    summarise: (a, _x, p) => `Stocktake of ${p?.lab ?? a.labName} (${a.reason}): ${(p?.lines ?? []).map((x) => `${x.code} ${x.item}: counted ${x.counted} ${x.unit} (record ${x.onRecord})`).join('; ')}`,
    async run(ctx, a, p) {
      const r = await labs.stocktake(ctx.actor, ctx.scope, p.labId, { reason: a.reason, lines: p.lines.map(({ batchId, counted, unit, note }) => ({ batchId, counted, unit, note })) });
      const refused = r.lines.filter((x) => x.error);
      return did('lab_stocktake_recorded', null, `${r.adjusted} batch(es) adjusted.${refused.length ? ` Recount: ${refused.map((x) => x.code).join(', ')}.` : ''}`);
    },
  }),

  add_lab_equipment: tool({
    ...LAB, operation: 'CREATE', risk: RISK.LOW,
    description: 'Add an instrument to a lab: name, serial, make, quantity, condition, whether it needs calibration and how often, the last calibration or the next due date, warranty and AMC. Needs confirmation.',
    inputSchema: closed({
      labName: text(120), name: text(160), serialNo: text(120), make: text(120), quantity: int(0, 10000), condition: oneOf(['GOOD', 'FAIR', 'POOR']),
      calibrationRequired: bool(), calibrationIntervalMonths: int(1, 120), lastCalibratedOn: dateStr(), calibrationDueOn: dateStr(), warrantyUntil: dateStr(), amcUntil: dateStr(), amcVendorName: text(120),
    }, ['labName', 'name']),
    permission: 'labs.manage', service: 'labs.assets.createEquipment()',
    async prepare(ctx, a) { const l = await theLab(ctx, a.labName); return { labId: l.id, lab: l.name }; },
    summarise: (a, _x, p) => `Add the instrument ${a.name}${a.quantity ? ` x${a.quantity}` : ''} to ${p?.lab ?? a.labName}${a.calibrationRequired ? `; calibration every ${a.calibrationIntervalMonths ?? 12} month(s)` : ''}${a.calibrationDueOn ? `, due ${a.calibrationDueOn}` : ''}`,
    async run(ctx, a, p) {
      const { labName: _l, ...body } = a;
      const e = await labAssets.createEquipment(ctx.actor, ctx.scope, p.labId, defined(body));
      return did('lab_equipment_added', e, `${e.name} added as ${e.code}.`);
    },
  }),

  add_lab_devices: tool({
    ...LAB, operation: 'CREATE', risk: RISK.LOW,
    description: 'Register computers or other devices in a lab, each by its asset tag, with workstation number, kind, make, operating system and serial. A tag already registered is refused. Needs confirmation.',
    inputSchema: closed({
      labName: text(120),
      devices: list(closed({ tag: text(40), workstationNo: text(40), kind: oneOf(['DESKTOP', 'LAPTOP', 'TABLET', 'PRINTER', 'PROJECTOR', 'NETWORK', 'PERIPHERAL', 'OTHER']), make: text(120), os: text(120), serialNo: text(120) }, ['tag']), 50),
    }, ['labName', 'devices']),
    permission: 'labs.manage', service: 'labs.assets.createDevices()',
    async prepare(ctx, a) {
      if (!a.devices?.length) throw ask('Which devices? Give each one\'s tag.');
      const l = await theLab(ctx, a.labName);
      return { labId: l.id, lab: l.name };
    },
    summarise: (a, _x, p) => `Register ${a.devices.length} device(s) in ${p?.lab ?? a.labName}: ${a.devices.map((d) => `${d.tag}${d.workstationNo ? ` (${d.workstationNo})` : ''}`).join(', ')}`,
    async run(ctx, a, p) {
      const out = await labAssets.createDevices(ctx.actor, ctx.scope, p.labId, { devices: a.devices });
      return did('lab_devices_added', null, `${out.length} device(s) registered in ${p.lab}.`);
    },
  }),

  get_lab_fefo_plan: tool({
    ...LAB, operation: 'GET',
    description: 'Which batches to take a quantity of a lab item from, first-expiry-first-out, and how much is short; expired and quarantined stock is never in the plan. Read-only.',
    inputSchema: closed({ ...labItemArgs, quantity: num(0.001, 1e7), unit: text(10), on: dateStr('For a practical on this date (default today)') }, ['item', 'quantity']),
    permission: 'labs.read', service: 'labs.service.suggestFefo()',
    async run(ctx, a) {
      const it = await theLabItem(ctx, a);
      const p = await labs.suggestFefo(ctx.actor, ctx.scope, it.id, defined({ quantity: a.quantity, unit: a.unit ?? it.displayUnit, at: a.on ? istAt(a.on, '09:00').toISOString() : undefined }));
      const plan = p.plan.map((l) => ({ batch: l.code, take: `${l.takeDisplay} ${p.displayUnit}`, expiresOn: day(l.expiresOn), opened: l.opened }));
      return shown({ item: p.itemName, wanted: `${p.wantedDisplay} ${p.displayUnit}`, plan, shortBy: p.shortBy > 0 ? `${p.shortByDisplay} ${p.displayUnit}` : null, hazardous: p.hazardous, restricted: p.restricted },
        `${p.itemName}: ${plan.length ? plan.map((l) => `${l.take} from ${l.batch}`).join(', ') : 'nothing usable'}${p.shortBy > 0 ? `; short by ${p.shortByDisplay} ${p.displayUnit}` : ''}.`);
    },
  }),
};

/* ── Fleet: vehicles and trips ───────────────────────────── */

const FLEET = { module: 'Transport', feature: 'fleet' };

async function theVehicle(reg) {
  const all = await vehicles.list({});
  const want = String(reg ?? '').toUpperCase().replace(/\s+/g, '');
  return all.find((v) => v.registrationNo === want) ?? pick(all, want, { label: 'vehicle', nameOf: (v) => v.registrationNo, refOf: (v) => v.registrationNo });
}

async function theTrip(ctx, scope, a, statuses = null) {
  const byRef = /^trip\//i.test(String(a.trip ?? ''));
  let rows = await trips.list(ctx.actor, scope, { date: a.date ?? (byRef ? 'ALL' : todayIst()) });
  if (statuses) rows = rows.filter((t) => statuses.includes(t.status));
  return refPick(rows, a.trip, { label: `trip${a.date ? ` on ${a.date}` : ' today'}`, nameOf: (t) => t.title, describe: (t) => `${t.refNo} ${t.title} (${words(t.status)})` });
}

const tripArgs = { trip: text(160, 'Reference (e.g. "TRIP/2026/0012") or the trip named in words, e.g. "Route 4 morning pickup"'), date: dateStr('The trip date (default today)') };
const docSchema = closed({ kind: oneOf(VEHICLE_DOCUMENTS), number: text(80), issuedOn: dateStr(), validTo: dateStr() }, ['kind', 'validTo']);
const vehicleArgs = {
  type: oneOf(VEHICLE_TYPES), makeModel: text(80), lawfulCapacity: int(1, 100, 'Seats as on the permit'), usableSeats: int(0, 100), ownership: oneOf(['OWNED', 'CONTRACTED']),
  ownerName: text(120), contractorName: text(120), contractorPhone: text(20), odometerKm: num(0, 1e7), documents: list(docSchema, 12, 'Permit, insurance, fitness, PUC, RC with their expiry dates'),
  fireExtinguisherDueOn: dateStr(), firstAidDueOn: dateStr(), serviceEveryKm: num(0, 1e6), serviceEveryDays: int(0, 3650), serviceNextDueOn: dateStr(), driverName: text(120), driverPhone: text(20),
};
function vehicleBody(a) {
  return defined({
    type: a.type, makeModel: a.makeModel, lawfulCapacity: a.lawfulCapacity, usableSeats: a.usableSeats, ownership: a.ownership, ownerName: a.ownerName, contractorName: a.contractorName, contractorPhone: a.contractorPhone, odometerKm: a.odometerKm,
    safety: a.fireExtinguisherDueOn || a.firstAidDueOn ? defined({ fireExtinguisherDueOn: a.fireExtinguisherDueOn, firstAidDueOn: a.firstAidDueOn }) : undefined,
    service: a.serviceEveryKm !== undefined || a.serviceEveryDays !== undefined || a.serviceNextDueOn ? defined({ everyKm: a.serviceEveryKm, everyDays: a.serviceEveryDays, nextDueOn: a.serviceNextDueOn }) : undefined,
    defaultDriver: a.driverName || a.driverPhone ? defined({ name: a.driverName, phone: a.driverPhone }) : undefined,
  });
}
const presentVehicle = (v) => ({
  vehicle: v.registrationNo, type: v.type, makeModel: v.makeModel ?? null, status: v.status, statusNote: v.statusNote ?? null, lawfulCapacity: v.lawfulCapacity, usableSeats: v.usableSeats, odometerKm: v.odometerKm ?? null,
  papers: (v.documents ?? []).map((d) => ({ kind: d.kind, number: d.number ?? null, validTo: day(d.validTo), state: d.state })), cannotRun: v.blockingDocuments ?? [],
  safety: v.safetyState ?? null, serviceDueOn: day(v.service?.nextDueOn), driver: v.defaultDriver?.name ?? null, location: v.positionStatus ?? null,
});

const fleetTools = {
  add_vehicle: tool({
    ...FLEET, operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'For the transport office: register a school vehicle with its registration number, type, lawful capacity and usable seats, ownership or contractor, papers and their expiry dates, safety-check and service dates and the usual driver. Each due date goes into the tasks queue. Needs confirmation.',
    inputSchema: closed({ registrationNo: text(20), ...vehicleArgs }, ['registrationNo', 'lawfulCapacity']),
    permission: 'transport.fleet.manage', service: 'vehicles.service.create()',
    summarise: (a) => `Register ${String(a.registrationNo).toUpperCase()} (${words(a.type ?? 'BUS')}, ${a.lawfulCapacity} lawful seats${a.usableSeats !== undefined ? `, ${a.usableSeats} usable` : ''})${a.documents?.length ? `; papers: ${a.documents.map((d) => `${words(d.kind)} to ${d.validTo}`).join(', ')}` : ''}`,
    async run(ctx, a) {
      const v = await vehicles.create(ctx.actor, { registrationNo: a.registrationNo, ...vehicleBody(a), ...(a.documents && { documents: a.documents }) });
      return did('vehicle_added', v, `${v.registrationNo} registered${v.blockingDocuments?.length ? `; it cannot run until ${v.blockingDocuments.join(', ')} are recorded` : ''}.`);
    },
  }),

  get_vehicle: tool({
    ...FLEET, operation: 'GET',
    description: "One school vehicle in full: status, seats, papers and their expiry, safety checks, service due, the usual driver, its live-location state, open breakdowns and recent fuel, service and check entries. For the transport office and the principal. Read-only.",
    inputSchema: closed({ vehicle: text(20, 'Registration number, e.g. "KA01AB1234"') }, ['vehicle']),
    permission: 'transport.tracking.read', minScope: 'ALL', service: 'vehicles.service.get()',
    anyOf: FLEET_READ_ALL,
    guard: (ctx) => needAny(ctx, FLEET_READ_ALL),
    async run(_ctx, a) {
      const v = await vehicles.get((await theVehicle(a.vehicle)).id);
      const logs = (v.logs ?? []).slice(0, 10).map((l) => ({ on: day(l.at), kind: l.kind, note: l.note ?? null, litres: l.litres ?? null, odometerKm: l.odometerKm ?? null, resolved: l.kind === 'BREAKDOWN' ? Boolean(l.resolvedAt) : undefined }));
      const out = { ...presentVehicle(v), openBreakdowns: (v.logs ?? []).filter((l) => l.kind === 'BREAKDOWN' && !l.resolvedAt).map((l) => ({ on: day(l.at), note: l.note })), recent: logs };
      return shown(out, `${out.vehicle}: ${words(out.status)}, ${out.usableSeats} usable seats${out.cannotRun.length ? `; cannot run (${out.cannotRun.join(', ')})` : ''}${out.openBreakdowns.length ? `; ${out.openBreakdowns.length} open breakdown(s)` : ''}.`);
    },
  }),

  update_vehicle: tool({
    ...FLEET, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "Change a school vehicle's record: type, make, seats (never above the lawful capacity), ownership and contractor, odometer, safety-check and service dates, the usual driver, and add renewed papers (a renewed permit, insurance, fitness or PUC with its new expiry; older entries are kept). Needs confirmation.",
    inputSchema: closed({ vehicle: text(20, 'Registration number'), newRegistrationNo: text(20), ...vehicleArgs }, ['vehicle']),
    permission: 'transport.fleet.manage', service: 'vehicles.service.update()',
    async prepare(_ctx, a) {
      const v = await vehicles.get((await theVehicle(a.vehicle)).id);
      return { id: v.id, reg: v.registrationNo, documents: (v.documents ?? []).map((d) => defined({ kind: d.kind, number: d.number ?? undefined, issuedOn: d.issuedOn ?? undefined, validTo: d.validTo ?? undefined, attachments: d.attachments ?? [] })) };
    },
    summarise: (a, _x, p) => `Update ${p?.reg ?? a.vehicle}: ${changes({ registration: a.newRegistrationNo, type: a.type, make: a.makeModel, 'lawful seats': a.lawfulCapacity, 'usable seats': a.usableSeats, ownership: a.ownership, owner: a.ownerName, contractor: a.contractorName, odometer: a.odometerKm, 'fire extinguisher due': a.fireExtinguisherDueOn, 'first aid due': a.firstAidDueOn, 'service due': a.serviceNextDueOn, driver: a.driverName, papers: a.documents?.map((d) => `${words(d.kind)} to ${d.validTo}`) })}`,
    async run(ctx, a, p) {
      const v = await vehicles.update(ctx.actor, p.id, { ...vehicleBody(a), ...(a.newRegistrationNo && { registrationNo: a.newRegistrationNo }), ...(a.documents?.length && { documents: [...p.documents, ...a.documents] }) });
      return did('vehicle_updated', v, `${v.registrationNo} updated${v.blockingDocuments?.length ? `; still cannot run (${v.blockingDocuments.join(', ')})` : ''}.`);
    },
  }),

  set_vehicle_status: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.MEDIUM,
    description: 'Put a school vehicle in service (ACTIVE), send it for servicing (IN_SERVICE), mark it broken down (BREAKDOWN) or retire it (RETIRED, final), with a note. A vehicle that is not active cannot be put on a trip. Needs confirmation.',
    inputSchema: closed({ vehicle: text(20), status: oneOf(VEHICLE_STATUSES), note: text(500) }, ['vehicle', 'status']),
    permission: 'transport.fleet.manage', service: 'vehicles.service.setStatus()',
    async prepare(_ctx, a) { const v = await theVehicle(a.vehicle); return { id: v.id, reg: v.registrationNo, from: v.status }; },
    summarise: (a, _x, p) => `Change ${p?.reg ?? a.vehicle} from ${words(p?.from ?? '')} to ${words(a.status)}${a.status === 'RETIRED' ? ' (final)' : ''}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const v = await vehicles.setStatus(ctx.actor, p.id, { status: a.status, note: a.note });
      return did('vehicle_status_set', v, `${v.registrationNo} is ${words(v.status)}.`);
    },
  }),

  resolve_vehicle_breakdown: tool({
    ...FLEET, operation: 'UPDATE', risk: RISK.LOW,
    description: "Close a vehicle's open breakdown with what was done; a broken-down vehicle goes back to active. Needs confirmation.",
    inputSchema: closed({ vehicle: text(20), note: text(2000, 'What was done'), on: dateStr('The breakdown date, when there are several open') }, ['vehicle', 'note']),
    permission: 'transport.fleet.manage', service: 'vehicles.service.resolveBreakdown()',
    async prepare(_ctx, a) {
      const v = await vehicles.get((await theVehicle(a.vehicle)).id);
      let open = (v.logs ?? []).filter((l) => l.kind === 'BREAKDOWN' && !l.resolvedAt);
      if (a.on) open = open.filter((l) => day(l.at) === a.on);
      if (!open.length) throw notFound(`${v.registrationNo} has no open breakdown${a.on ? ` from ${a.on}` : ''}.`);
      if (open.length > 1) throw ask(`Which breakdown? ${open.map((l) => `${day(l.at)}${l.note ? ` (${excerpt(l.note, 40)})` : ''}`).join('; ')}`);
      return { id: v.id, reg: v.registrationNo, logId: open[0].id, on: day(open[0].at), what: open[0].note };
    },
    summarise: (a, _x, p) => `Close the ${p?.on ?? ''} breakdown of ${p?.reg ?? a.vehicle}${p?.what ? ` (${excerpt(p.what, 60)})` : ''}: ${a.note}`,
    async run(ctx, a, p) {
      const l = await vehicles.resolveBreakdown(ctx.actor, p.id, p.logId, { note: a.note });
      return did('vehicle_breakdown_resolved', l, `Breakdown closed; ${p.reg} is back in service if it was off the road.`);
    },
  }),

  set_vehicle_gps_device: tool({
    ...FLEET, operation: 'UPDATE', risk: RISK.LOW,
    description: 'Link a registered GPS tracker to a vehicle (one tracker per vehicle), or unlink it. The tracker itself is registered on the Safety devices screen. Needs confirmation.',
    inputSchema: closed({ vehicle: text(20), device: text(120, 'The tracker by its label'), unlink: bool('Remove the tracker from this vehicle') }, ['vehicle']),
    permission: 'transport.fleet.manage', service: 'vehicles.service.attachGpsDevice()',
    async prepare(ctx, a) {
      const v = await theVehicle(a.vehicle);
      if (a.unlink) return { id: v.id, reg: v.registrationNo, deviceId: null, device: null };
      if (!a.device) throw ask('Which GPS tracker? Give its label, or say unlink.');
      const d = pick(await safetyDevices.list(ctx.actor, { kind: 'GPS' }), a.device, { label: 'GPS tracker', nameOf: (x) => x.label, refOf: () => null });
      return { id: v.id, reg: v.registrationNo, deviceId: d.id, device: d.label };
    },
    summarise: (a, _x, p) => (p?.deviceId ? `Link the GPS tracker ${p.device} to ${p.reg}` : `Unlink the GPS tracker from ${p?.reg ?? a.vehicle}`),
    async run(ctx, _a, p) {
      const v = await vehicles.attachGpsDevice(ctx.actor, p.id, p.deviceId);
      return did('vehicle_gps_linked', v, p.deviceId ? `${p.device} now tracks ${v.registrationNo}.` : `${v.registrationNo} has no tracker now.`);
    },
  }),

  get_vehicle_track: tool({
    ...FLEET, operation: 'GET',
    description: "Where a school vehicle has been over the last minutes (default 120, up to a day) from its GPS tracker: how many fixes, the first and last, the last position and top speed. For the transport office and the principal; the map is on the Fleet screen. Read-only.",
    inputSchema: closed({ vehicle: text(20), minutes: int(5, 1440) }, ['vehicle']),
    permission: 'transport.tracking.read', minScope: 'ALL', service: 'telemetry.service.track()',
    anyOf: FLEET_READ_ALL,
    guard: (ctx) => needAny(ctx, FLEET_READ_ALL),
    async run(_ctx, a) {
      const v = await theVehicle(a.vehicle);
      const pts = await telemetry.track(v.id, { minutes: a.minutes ?? 120 });
      const last = pts.at(-1);
      const top = pts.reduce((m, x) => Math.max(m, x.speedKmh ?? 0), 0);
      return shown({ vehicle: v.registrationNo, fixes: pts.length, from: pts[0] ? `${day(pts[0].eventAt)} ${time(pts[0].eventAt)}` : null, lastAt: last ? `${day(last.eventAt)} ${time(last.eventAt)}` : null, last: last ? { lat: last.lat, lng: last.lng, speedKmh: last.speedKmh ?? null } : null, topSpeedKmh: top || null, points: pts },
        pts.length ? `${v.registrationNo}: ${pts.length} GPS fix(es), the last at ${time(last.eventAt)}${top ? `, top speed ${top} km/h` : ''}.` : `${v.registrationNo} has sent no GPS fixes in that time.`);
    },
  }),

  get_fleet_fuel_summary: tool({
    ...FLEET, operation: 'GET',
    description: 'Fuel used and spent per vehicle over a period (default the last 30 days): litres, rupees, entries and km per litre where two odometer readings allow it. Read-only.',
    inputSchema: closed({ from: dateStr(), to: dateStr() }),
    permission: 'transport.fleet.manage', service: 'vehicles.service.fuelSummary()',
    async run(_ctx, a) {
      const f = await vehicles.fuelSummary(defined({ from: a.from ? istAt(a.from).toISOString() : undefined, to: a.to ? istAt(a.to, '23:59').toISOString() : undefined }));
      const rows = f.rows.map((r) => ({ vehicle: r.registrationNo, litres: Math.round(r.litres * 10) / 10, rupees: Math.round(r.amountPaise / 100), entries: r.entries, kmPerLitre: r.kmPerLitre }));
      return listed(rows, (r) => `${r.vehicle}: ${r.litres} L, ₹${r.rupees}${r.kmPerLitre ? `, ${r.kmPerLitre} km/L` : ''}`, { noun: 'vehicle', extra: { from: day(f.from), to: day(f.to), note: f.note } });
    },
  }),

  plan_bus_trip: tool({
    ...FLEET, operation: 'CREATE', risk: RISK.MEDIUM,
    description: "For the transport office: plan one trip — a route's morning pickup or afternoon drop, or an event trip — on a date with a roadworthy vehicle, start time, driver and attendant (the crew's clearance is checked). Seats are then allocated. Needs confirmation.",
    inputSchema: closed({
      kind: oneOf(TRIP_KINDS), date: dateStr(), vehicle: text(20, 'Registration number'), route: text(120, 'The route by name (needed for pickup and drop)'), eventName: text(160, 'What the event trip is called (needed for an event trip)'),
      startTime: hm('HH:MM (default 07:00 pickup, 14:30 drop)'), driverName: text(120), driverPhone: text(20), attendantName: text(120), attendantPhone: text(20),
    }, ['kind', 'date', 'vehicle']),
    permission: 'transport.fleet.manage', service: 'trips.service.create()',
    async prepare(_ctx, a) {
      if (a.kind !== 'EVENT' && !a.route) throw ask('Which route is it for?');
      if (a.kind === 'EVENT' && !a.eventName) throw ask('What is the event trip called?');
      const v = await theVehicle(a.vehicle);
      const route = a.route ? pick((await TransportRoute.find({}).select('name status').lean()).map((r) => ({ id: String(r._id), name: r.name })), a.route, { label: 'route', refOf: () => null }) : null;
      return { vehicleId: v.id, reg: v.registrationNo, routeId: route?.id ?? null, route: route?.name ?? null, driver: await crewOf(a.driverName, a.driverPhone), attendant: await crewOf(a.attendantName, a.attendantPhone) };
    },
    summarise: (a, _x, p) => `Plan a ${words(a.kind)}${p?.route ? ` on ${p.route}` : ''}${a.eventName ? ` "${a.eventName}"` : ''} on ${a.date}${a.startTime ? ` at ${a.startTime}` : ''} with ${p?.reg ?? a.vehicle}${p?.driver ? `, driver ${p.driver.name}` : ''}${p?.attendant ? `, attendant ${p.attendant.name}` : ''}`,
    async run(ctx, a, p) {
      const t = await trips.create(ctx.actor, defined({ kind: a.kind, date: a.date, vehicleId: p.vehicleId, routeId: p.routeId ?? undefined, title: a.eventName, startTime: a.startTime, driver: p.driver, attendant: p.attendant }));
      return did('trip_planned', t, `Planned ${t.refNo} ${t.title}: ${t.usableSeats} seats.`);
    },
  }),

  plan_bus_trips_for_day: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the transport office: plan a day's morning pickup and afternoon drop for every active route that has a registered vehicle, and seat the students enrolled on each (existing trips are left alone; routes without a vehicle are listed). Confirmed on the website.",
    inputSchema: closed({ date: dateStr('Default today'), attendantName: text(120, 'An attendant for every trip, if one') }),
    permission: 'transport.fleet.manage', service: 'trips.service.planDay()',
    async prepare(_ctx, a) { return { attendant: await crewOf(a.attendantName) }; },
    summarise: (a, _x, p) => `Plan the pickup and drop trips for every active route on ${a.date ?? 'today'} and seat their enrolled students${p?.attendant ? `, attendant ${p.attendant.name}` : ''}`,
    async run(ctx, a, p) {
      const out = await trips.planDay(ctx.actor, defined({ date: a.date, attendant: p?.attendant }));
      const planned = out.filter((x) => x.tripId);
      const skipped = out.filter((x) => x.skipped);
      return did('trips_planned_for_day', null, `${planned.length} trip(s) planned, ${planned.reduce((n, x) => n + (x.allocated ?? 0), 0)} seat(s) allocated.${skipped.length ? ` Skipped: ${skipped.slice(0, 6).map((x) => `${x.route}${x.kind ? ` ${words(x.kind)}` : ''} (${x.skipped})`).join('; ')}.` : ''}`);
    },
  }),

  get_bus_trip: tool({
    ...FLEET, operation: 'GET',
    description: "One bus trip in full: vehicle and its live-location state, crew, planned stops and arrivals, the next stop and its estimated time, every seat (who boarded, got off, was handed over or did not show) and the trip's alerts. A teacher on bus duty sees only their own trips. Read-only.",
    inputSchema: closed({ ...tripArgs }, ['trip']),
    permission: 'transport.trips.operate', service: 'trips.service.get()',
    anyOf: TRIP_READ,
    guard: (ctx) => needAny(ctx, TRIP_READ),
    async run(ctx, a) {
      const scope = needAny(ctx, TRIP_READ);
      const t = await trips.get(ctx.actor, scope, (await theTrip(ctx, scope, a)).id);
      const out = {
        ref: t.refNo, title: t.title, kind: t.kindLabel, date: day(t.date), status: t.status, vehicle: t.vehicle?.registrationNo ?? null, location: t.vehicle?.positionStatus ?? null,
        driver: t.driver?.name ?? null, attendant: t.attendant?.name ?? null, seats: `${t.seatsAllocated ?? 0}/${t.usableSeats}`,
        stops: (t.plannedStops ?? []).map((s) => ({ stop: s.name, planned: time(s.plannedAt), arrived: time(s.arrivedAt), departed: time(s.departedAt) })),
        nextStop: t.nextStop ? { stop: t.nextStop.name, eta: t.nextStop.eta ? { minutes: t.nextStop.eta.minutes ?? null, label: 'estimate' } : null } : null,
        students: (t.allocations ?? []).filter((x) => x.status !== 'RELEASED').map((x) => ({ student: x.studentName, stop: x.stopName, status: x.status })),
        alerts: (t.alerts ?? []).filter((x) => x.status !== 'RESOLVED').map((x) => ({ kind: x.kind, message: x.message })),
      };
      return shown(out, `${out.ref} ${out.title}: ${words(out.status)}, ${out.seats} seats, ${out.students.filter((x) => x.status === 'BOARDED').length} on board${out.nextStop ? `; next ${out.nextStop.stop}` : ''}${out.alerts.length ? `; ${out.alerts.length} open alert(s)` : ''}.`);
    },
  }),

  set_trip_crew: tool({
    ...FLEET, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "For the transport office: put a driver and/or attendant on a trip (a member of staff by name, or a contracted person's name and phone). Uncleared crew are refused or flagged as the school's policy says. Needs confirmation.",
    inputSchema: closed({ ...tripArgs, driverName: text(120), driverPhone: text(20), attendantName: text(120), attendantPhone: text(20) }, ['trip']),
    permission: 'transport.fleet.manage', service: 'trips.service.assignCrew()',
    async prepare(ctx, a) {
      if (!a.driverName && !a.attendantName) throw ask('Who is the driver or attendant?');
      const t = await theTrip(ctx, 'ALL', a, ['PLANNED', 'IN_PROGRESS']);
      return { id: t.id, ref: t.refNo, title: t.title, driver: await crewOf(a.driverName, a.driverPhone), attendant: await crewOf(a.attendantName, a.attendantPhone) };
    },
    summarise: (a, _x, p) => `On ${p?.ref ?? a.trip} ${p?.title ?? ''}: ${[p?.driver && `driver ${p.driver.name}`, p?.attendant && `attendant ${p.attendant.name}`].filter(Boolean).join(', ')}`,
    async run(ctx, _a, p) {
      const t = await trips.assignCrew(ctx.actor, p.id, defined({ driver: p.driver, attendant: p.attendant }));
      const warn = ['driver', 'attendant'].filter((r) => t[r]?.name && t[r].cleared === false);
      return did('trip_crew_set', t, `Crew set on ${t.refNo}.${warn.length ? ` No current clearance for the ${warn.join(' and ')}; the transport office has been alerted.` : ''}`);
    },
  }),

  substitute_trip_vehicle: tool({
    ...FLEET, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'For the transport office: put a different roadworthy vehicle on a trip, with the reason; refused unless its usable seats cover everyone already allocated. Needs confirmation.',
    inputSchema: closed({ ...tripArgs, vehicle: text(20, 'The replacement, by registration number'), reason: text(500) }, ['trip', 'vehicle', 'reason']),
    permission: 'transport.fleet.manage', service: 'trips.service.substituteVehicle()',
    async prepare(ctx, a) {
      const t = await theTrip(ctx, 'ALL', a, ['PLANNED', 'IN_PROGRESS']);
      const v = await theVehicle(a.vehicle);
      return { id: t.id, ref: t.refNo, title: t.title, from: t.registrationNo, vehicleId: v.id, reg: v.registrationNo, seats: v.usableSeats, allocated: t.seatsAllocated ?? 0 };
    },
    summarise: (a, _x, p) => `Swap ${p?.from ?? 'the vehicle'} for ${p?.reg ?? a.vehicle} (${p?.seats ?? '?'} seats, ${p?.allocated ?? '?'} allocated) on ${p?.ref ?? a.trip} — ${a.reason}`,
    async run(ctx, a, p) {
      const t = await trips.substituteVehicle(ctx.actor, p.id, { vehicleId: p.vehicleId, reason: a.reason });
      return did('trip_vehicle_substituted', t, `${t.refNo} now runs with ${t.vehicle?.registrationNo ?? p.reg}.`);
    },
  }),

  cancel_bus_trip: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "For the transport office: cancel a planned or running trip with the reason. The families of every student with a seat are messaged. Confirmed on the website.",
    inputSchema: closed({ ...tripArgs, reason: text(500) }, ['trip', 'reason']),
    permission: 'transport.fleet.manage', service: 'trips.service.cancel()',
    async prepare(ctx, a) { const t = await theTrip(ctx, 'ALL', a, ['PLANNED', 'IN_PROGRESS']); return { id: t.id, ref: t.refNo, title: t.title, seats: t.counts?.ALLOCATED ?? 0 }; },
    summarise: (a, _x, p) => `Cancel ${p?.ref ?? a.trip} ${p?.title ?? ''} — ${a.reason}; the families of ${p?.seats ?? 'every'} allocated student(s) are messaged`,
    async run(ctx, a, p) {
      const t = await trips.cancel(ctx.actor, p.id, { reason: a.reason });
      return did('trip_cancelled', t, `${t.refNo} is cancelled; the families are told.`);
    },
  }),

  manage_trip_seat: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'Give a student a seat on a trip, optionally at a stop (ALLOCATE; refused when the trip is full), or free a seat that was not used (RELEASE). A teacher on bus duty acts only on their own trips. Confirmed on the website.',
    inputSchema: closed({ step: oneOf(['ALLOCATE', 'RELEASE']), ...tripArgs, ...studentIdentitySchema, stop: text(120, 'ALLOCATE: their stop'), reason: text(300) }, ['step', 'trip']),
    permission: 'transport.trips.operate', service: 'trips.service.allocate() / release()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) {
      const scope = needAny(ctx, OPERATE);
      const t = await trips.get(ctx.actor, scope, (await theTrip(ctx, scope, a, ['PLANNED', 'IN_PROGRESS'])).id);
      if (a.step === 'RELEASE') {
        const al = pickPerson(t.allocations.filter((x) => x.status === 'ALLOCATED'), a.studentName ?? a.admissionNo, { label: 'student with an unused seat on this trip', nameOf: (x) => x.studentName });
        return { id: t.id, ref: t.refNo, title: t.title, allocationId: al.id, student: al.studentName };
      }
      const studentId = await resolveStudentId(ctx, a);
      if (!studentId) throw ask('Which student? Give their name or admission number.');
      const st = await Student.findById(studentId).select('firstName lastName').lean();
      const stop = a.stop ? pick((t.plannedStops ?? []).map((s) => ({ id: String(s.stopId ?? s._id), name: s.name })), a.stop, { label: 'stop on this trip', refOf: () => null }) : null;
      return { id: t.id, ref: t.refNo, title: t.title, studentId, student: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim(), stopId: stop?.id ?? null, stop: stop?.name ?? null, free: t.seatsFree };
    },
    summarise: (a, _x, p) => (a.step === 'ALLOCATE'
      ? `Give ${p?.student ?? 'the student'} a seat on ${p?.ref ?? a.trip} ${p?.title ?? ''}${p?.stop ? ` at ${p.stop}` : ''} (${p?.free ?? '?'} free)`
      : `Free ${p?.student ?? 'the student'}'s unused seat on ${p?.ref ?? a.trip}${a.reason ? ` — ${a.reason}` : ''}`),
    async run(ctx, a, p) {
      const scope = needAny(ctx, OPERATE);
      const al = a.step === 'ALLOCATE'
        ? await trips.allocate(ctx.actor, scope, p.id, defined({ studentId: p.studentId, stopId: p.stopId ?? undefined, note: a.reason }))
        : await trips.release(ctx.actor, scope, p.id, p.allocationId, { reason: a.reason });
      return did(a.step === 'ALLOCATE' ? 'trip_seat_allocated' : 'trip_seat_released', al, `${al.studentName} ${a.step === 'ALLOCATE' ? 'has a seat' : 'no longer has a seat'} on ${p.ref}.`);
    },
  }),

  allocate_enrolled_to_trip: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "Seat every student enrolled on a trip's route for its direction, until the trip is full (those left over are listed). Confirmed on the website.",
    inputSchema: closed({ ...tripArgs }, ['trip']),
    permission: 'transport.trips.operate', service: 'trips.service.allocateEnrolled()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) { const t = await theTrip(ctx, needAny(ctx, OPERATE), a, ['PLANNED', 'IN_PROGRESS']); return { id: t.id, ref: t.refNo, title: t.title, free: t.seatsFree }; },
    summarise: (a, _x, p) => `Seat every student enrolled on the route of ${p?.ref ?? a.trip} ${p?.title ?? ''} (${p?.free ?? '?'} seats free)`,
    async run(ctx, _a, p) {
      const r = await trips.allocateEnrolled(ctx.actor, needAny(ctx, OPERATE), p.id);
      return did('trip_enrolled_allocated', null, `${r.allocated} seated, ${r.alreadyAllocated} already had a seat.${r.overflow.length ? ` No seat for: ${r.overflow.map((x) => x.name).join(', ')}.` : ''}`);
    },
  }),

  move_bus_trip: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "Move a bus trip along: START (the vehicle is checked as roadworthy again), RECONCILE (enrolled vs allocated vs boarded vs got off vs handed over; anyone not accounted for raises an alert) or COMPLETE (reconciles first; with anyone unaccounted for a note of what was done is required). A teacher on bus duty acts only on their own trips. Confirmed on the website.",
    inputSchema: closed({ step: oneOf(['START', 'RECONCILE', 'COMPLETE']), ...tripArgs, note: text(1000, 'COMPLETE: what was done about anyone unaccounted for') }, ['step', 'trip']),
    permission: 'transport.trips.operate', service: 'trips.service.start() / reconcile() / complete()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) {
      const statuses = { START: ['PLANNED'], RECONCILE: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'], COMPLETE: ['IN_PROGRESS'] }[a.step];
      const t = await theTrip(ctx, needAny(ctx, OPERATE), a, statuses);
      return { id: t.id, ref: t.refNo, title: t.title };
    },
    summarise: (a, _x, p) => `${{ START: 'Start', RECONCILE: 'Reconcile', COMPLETE: 'Complete' }[a.step]} ${p?.ref ?? a.trip} ${p?.title ?? ''}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const scope = needAny(ctx, OPERATE);
      if (a.step === 'RECONCILE') {
        const r = await trips.reconcile(ctx.actor, scope, p.id);
        return did('trip_reconciled', null, `${p.ref}: ${r.allocated} seated, ${r.boarded} boarded, ${r.handedOver} handed over, ${r.noShow} no-show.${r.unmatched.length ? ` Not accounted for: ${r.unmatched.map((u) => `${u.studentName} (${u.issue})`).join('; ')}.` : ' Everyone accounted for.'}`);
      }
      const t = a.step === 'START' ? await trips.start(ctx.actor, scope, p.id) : await trips.complete(ctx.actor, scope, p.id, { note: a.note });
      return did(a.step === 'START' ? 'trip_started' : 'trip_completed', t, `${t.refNo} is ${words(t.status)}.`);
    },
  }),

  mark_trip_stop: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.LOW,
    description: 'Record that the bus arrived at or left a stop on a trip the caller runs (for when the GPS does not). Needs confirmation.',
    inputSchema: closed({ ...tripArgs, stop: text(120), event: oneOf(['ARRIVED', 'DEPARTED']) }, ['trip', 'stop', 'event']),
    permission: 'transport.trips.operate', service: 'trips.service.markStop()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) {
      const scope = needAny(ctx, OPERATE);
      const t = await trips.get(ctx.actor, scope, (await theTrip(ctx, scope, a, ['PLANNED', 'IN_PROGRESS'])).id);
      const s = pick((t.plannedStops ?? []).map((x) => ({ id: String(x._id), name: x.name })), a.stop, { label: 'stop on this trip', refOf: () => null });
      return { id: t.id, ref: t.refNo, stopId: s.id, stop: s.name };
    },
    summarise: (a, _x, p) => `Record the bus ${a.event === 'ARRIVED' ? 'arriving at' : 'leaving'} ${p?.stop ?? a.stop} on ${p?.ref ?? a.trip}`,
    async run(ctx, a, p) {
      const t = await trips.markStop(ctx.actor, needAny(ctx, OPERATE), p.id, p.stopId, { event: a.event });
      return did('trip_stop_marked', t, `Recorded at ${p.stop}.`);
    },
  }),

  record_trip_handover: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "At a drop stop: hand a student over to an authorised adult (a guardian with pickup authority or an in-date delegate on the child's list, named, with how they were verified), or, when nobody authorised is there, record that the child is going back to school with the bus (guardians are told and the transport office alerted). Never to anyone else. Confirmed on the website.",
    inputSchema: closed({
      ...tripArgs, studentName: text(80), receiverName: text(120, 'Who is collecting the child'), returnToSchool: bool('Nobody authorised is at the stop'),
      verification: oneOf(['ID_CHECKED', 'OTP', 'KNOWN_TO_STAFF', 'PHOTO_MATCHED']), note: text(500),
    }, ['trip', 'studentName']),
    permission: 'transport.trips.operate', service: 'trips.service.handover()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) {
      if (!a.returnToSchool && !a.receiverName) throw ask('Who is collecting the child? Or is nobody authorised there (return to school)?');
      const scope = needAny(ctx, OPERATE);
      const t = await trips.get(ctx.actor, scope, (await theTrip(ctx, scope, a, ['IN_PROGRESS', 'PLANNED'])).id);
      const al = pickPerson(t.allocations.filter((x) => ['BOARDED', 'ALIGHTED'].includes(x.status)), a.studentName, { label: 'student on board this trip', nameOf: (x) => x.studentName });
      const base = { id: t.id, ref: t.refNo, studentId: String(al.studentId), student: al.studentName };
      if (a.returnToSchool) return base;
      return { ...base, receiver: await authorisedReceiver(String(al.studentId), al.studentName, a.receiverName, 'BUS_DROP') };
    },
    summarise: (a, _x, p) => (a.returnToSchool
      ? `${p?.student ?? a.studentName} goes back to school with the bus on ${p?.ref ?? a.trip}: nobody authorised at the stop (guardians are told)`
      : `Hand ${p?.student ?? a.studentName} over to ${p?.receiver?.name ?? a.receiverName} (${words(p?.receiver?.kind ?? '')}) on ${p?.ref ?? a.trip}, ${words(a.verification ?? 'ID_CHECKED')}`),
    async run(ctx, a, p) {
      const al = await trips.handover(ctx.actor, needAny(ctx, OPERATE), p.id, defined({ studentId: p.studentId, returnToSchool: a.returnToSchool === true, receiver: p.receiver?.receiver, verification: a.verification, note: a.note }));
      return did('trip_handover_recorded', al, a.returnToSchool ? `${p.student} is with the school; the guardians are told.` : `${p.student} handed over to ${al.handover?.receivedByName ?? p.receiver.name}.`);
    },
  }),

  suppress_trip_alerts: tool({
    ...FLEET, operation: 'ACTION', risk: RISK.LOW,
    description: 'Pause the delay and GPS alerts of a trip for some minutes (5 to 240, default 30), with the reason, e.g. a known road closure. Needs confirmation.',
    inputSchema: closed({ ...tripArgs, minutes: int(5, 240), reason: text(300) }, ['trip', 'reason']),
    permission: 'transport.trips.operate', service: 'trips.service.suppressAlerts()',
    anyOf: OPERATE,
    guard: (ctx) => needAny(ctx, OPERATE),
    async prepare(ctx, a) { const t = await theTrip(ctx, needAny(ctx, OPERATE), a, ['PLANNED', 'IN_PROGRESS']); return { id: t.id, ref: t.refNo }; },
    summarise: (a, _x, p) => `Pause the alerts of ${p?.ref ?? a.trip} for ${a.minutes ?? 30} minutes — ${a.reason}`,
    async run(ctx, a, p) {
      const r = await trips.suppressAlerts(ctx.actor, needAny(ctx, OPERATE), p.id, { minutes: a.minutes ?? 30, reason: a.reason });
      return did('trip_alerts_suppressed', null, `Alerts paused until ${time(r.suppressUntil)}.`);
    },
  }),
};

/**
 * The adult collecting a child, from the child's own pickup list: a guardian
 * with pickup authority or an active, in-date authorised adult or delegate.
 * Anyone else is refused before a draft is shown; a name that matches a
 * custody restriction raises the same alert the gate screen raises.
 */
async function authorisedReceiver(studentId, studentLabel, receiverName, context) {
  const list = await pickup.adultsForStudent(studentId);
  const pool = [
    ...list.guardians.filter((g) => g.pickupAuthorized && !g.restricted).map((g) => ({ name: g.name, kind: 'GUARDIAN', receiver: { guardianProfileId: g.guardianProfileId } })),
    ...list.adults.filter((x) => x.kind !== 'RESTRICTED' && x.validNow).map((x) => ({ name: x.name, kind: x.kind, receiver: { pickupAdultId: x.id } })),
  ];
  try {
    return pickPerson(pool, receiverName, { label: `adult authorised to collect ${studentLabel}` });
  } catch (err) {
    if (err?.code !== 'NOT_FOUND') throw err;
    const check = await pickup.checkReceiver(studentId, { name: receiverName });
    if (check.restricted) {
      const s = await Student.findById(studentId).select('firstName lastName').lean();
      await pickup.flagRestriction({ _id: studentId, ...s }, check, context);
      throw forbidden(`${check.reason} Do not release the child; the office has been alerted.`);
    }
    throw notFound(`${String(receiverName).trim()} is not on ${studentLabel}'s pickup list. Keep the child with the school and call the guardian.`);
  }
}

/* ── ID cards and checkpoint suggestions ─────────────────── */

const CHECK = { module: 'Safety', feature: 'idCheckpoints' };
const presentCard = (c) => ({ holder: c.holderName, holderType: c.holderType, code: c.code, codeType: c.codeType, status: c.status, reason: c.statusReason ?? null, updated: day(c.updatedAt) });

async function theCard(args, statuses) {
  const term = stripTitle(args.holderName ?? args.code ?? '');
  if (!term) throw ask('Whose card? Give the holder\'s name or the card code.');
  const rows = (await checkpoints.listCards({ q: term })).filter((c) => !statuses || statuses.includes(c.status));
  return pick(rows, term, { label: `${statuses ? statuses.map((s) => s.toLowerCase()).join('/') : ''} ID card`, nameOf: (c) => c.holderName, refOf: (c) => c.code, describe: (c) => `${c.holderName} (${c.code}, ${c.status.toLowerCase()})` });
}

const checkpointTools = {
  get_checkpoint_attendance_suggestions: tool({
    ...CHECK, operation: 'GET',
    description: "Where today's (or a day's) gate and bus scans disagree with the class register: scanned in but not marked, marked absent but scanned in, or marked present with no scan; optionally one class. Suggestions only: the register is the record and is never changed from scans. Read-only.",
    inputSchema: closed({ date: dateStr(), className: text(60, 'e.g. "Class 6 A"') }),
    permission: 'checkpoints.read', minScope: 'ALL', service: 'checkpoints.service.attendanceSuggestions()',
    anyOf: [['checkpoints.read', 'ALL'], ['attendance.mark', 'ALL'], ['attendance.read', 'ALL']],
    guard: (ctx) => needAny(ctx, [['checkpoints.read', 'ALL'], ['attendance.mark', 'ALL'], ['attendance.read', 'ALL']]),
    async run(ctx, a) {
      const section = a.className ? await resolveSection({ ...ctx, scope: 'ALL' }, { className: a.className }) : null;
      const r = await checkpoints.attendanceSuggestions(defined({ date: a.date, sectionId: section?.sectionId }));
      const rows = r.rows.map((x) => ({ student: x.name, rollNo: x.rollNo, firstScan: time(x.firstScanAt), register: x.registerMark, suggestion: x.suggestion }));
      return listed(rows, (x) => `${x.student}: ${words(x.suggestion)}`, { noun: 'suggestion', extra: { note: r.note } });
    },
  }),

  list_id_cards: tool({
    ...CHECK, operation: 'GET',
    description: 'Student and staff ID cards: holder, code, QR or RFID, and status (active, lost, revoked, replaced); optionally by status or a holder\'s name. Read-only.',
    inputSchema: closed({ status: oneOf(['ACTIVE', 'LOST', 'REVOKED', 'REPLACED']), holderName: text(120) }),
    permission: 'checkpoints.read', minScope: 'ALL', service: 'checkpoints.service.listCards()',
    async run(_ctx, a) {
      const rows = (await checkpoints.listCards(defined({ status: a.status, q: a.holderName ? stripTitle(a.holderName) : undefined }))).map(presentCard);
      return listed(rows, (c) => `${c.holder} ${c.code} (${c.status.toLowerCase()})`, { noun: 'card' });
    },
  }),

  issue_id_card: tool({
    ...CHECK, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'Issue an ID card (QR or RFID) to a student or a member of staff who has no active card; a code is generated unless the printed one is given. Confirmed on the website.',
    inputSchema: closed({ holderType: oneOf(['STUDENT', 'STAFF']), ...studentArgs, staffName: text(120), codeType: oneOf(['QR', 'RFID']), code: text(64, 'The code on a pre-printed card, if any') }, ['holderType']),
    permission: 'checkpoints.manage', service: 'checkpoints.service.issueCard()',
    async prepare(_ctx, a) {
      if (a.holderType === 'STUDENT') { const s = await schoolStudent(a); return { studentId: s.id, holder: s.name }; }
      if (!a.staffName) throw ask('Which member of staff?');
      const p = await staffNamed(a.staffName);
      return { profileId: p.id, holder: p.name };
    },
    summarise: (a, _x, p) => `Issue a ${a.codeType ?? 'QR'} ID card to ${p?.holder ?? a.studentName ?? a.staffName}${a.code ? ` with code ${a.code}` : ''}`,
    async run(ctx, a, p) {
      const c = await checkpoints.issueCard(ctx.actor, defined({ holderType: a.holderType, studentId: p.studentId, profileId: p.profileId, codeType: a.codeType, code: a.code }));
      return did('id_card_issued', c, `Card ${c.code} issued to ${c.holderName}.`);
    },
  }),

  get_id_card_log: tool({
    ...CHECK, operation: 'GET',
    description: "An ID card's history: the chain of cards it replaced and its last 100 checkpoint scans (where and when it was presented; not proof of where the holder is). Read-only.",
    inputSchema: closed({ holderName: text(120), code: text(64) }),
    permission: 'checkpoints.read', minScope: 'ALL', service: 'checkpoints.service.cardHistory()',
    async run(_ctx, a) {
      const c = await theCard(a, null);
      const h = await checkpoints.cardHistory(c.id);
      const scans = h.events.map((e) => ({ point: e.point, at: `${day(e.scannedAt)} ${time(e.scannedAt)}`, result: e.result }));
      return shown({ cards: h.cards.map(presentCard), scans, disclaimer: checkpoints.CHECKPOINT_DISCLAIMER }, `${c.holderName}: ${h.cards.length} card(s) in the chain, ${scans.length} scan(s)${scans[0] ? `, the last ${words(scans[0].point)} at ${scans[0].at}` : ''}. ${checkpoints.CHECKPOINT_DISCLAIMER}`);
    },
  }),

  issue_replacement_id_card: tool({
    ...CHECK, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "Replace a student's or staff member's ID card (lost, damaged, revoked) with a new one, with the reason; the old card stops working. Confirmed on the website.",
    inputSchema: closed({ holderName: text(120), code: text(64, 'The old card\'s code'), reason: text(300), codeType: oneOf(['QR', 'RFID']), newCode: text(64, 'The code on a pre-printed replacement, if any') }, ['reason']),
    permission: 'checkpoints.manage', service: 'checkpoints.service.replaceCard()',
    async prepare(_ctx, a) { const c = await theCard(a, ['ACTIVE', 'LOST', 'REVOKED']); return { id: c.id, holder: c.holderName, code: c.code }; },
    summarise: (a, _x, p) => `Replace ${p?.holder ?? a.holderName}'s card ${p?.code ?? ''} with a new ${a.codeType ?? ''} card — ${a.reason}`,
    async run(ctx, a, p) {
      const r = await checkpoints.replaceCard(ctx.actor, p.id, defined({ reason: a.reason, codeType: a.codeType, code: a.newCode }));
      return did('id_card_replaced', r.card, `${r.card.holderName} has the new card ${r.card.code}; ${r.old.code} no longer works.`);
    },
  }),
};

/* ── Visitors' hosts, pickup and the release log ─────────── */

const VIS = { module: 'Safety', feature: 'visitors' };
const presentVisitor = (v) => ({ ref: v.refNo, name: v.name, kind: v.kind, organisation: v.organisation ?? null, purpose: v.purpose, status: v.status, expected: v.expectedAt ? `${day(v.expectedAt)} ${time(v.expectedAt)}` : null, checkedInAt: time(v.checkedInAt) });

const visitorTools = {
  list_my_hosted_visitors: tool({
    ...VIS, operation: 'GET',
    description: "For any member of staff: the visitors coming to see them — waiting for their approval, approved and expected, or on site now. Read-only.",
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'visitors.service.mineAsHost()',
    async run(ctx) {
      const rows = (await visitors.mineAsHost(ctx.actor)).map(presentVisitor);
      const waiting = rows.filter((v) => v.status === 'PENDING_HOST').length;
      return listed(rows, (v) => `${v.name}${v.organisation ? ` (${v.organisation})` : ''} ${words(v.status)}${v.expected ? ` ${v.expected}` : ''}`, { noun: 'visitor', speak: rows.length ? `${rows.length} visitor(s) for you${waiting ? `, ${waiting} waiting for your approval` : ''}: ${rows.map((v) => `${v.name} (${words(v.status)})`).slice(0, 10).join(', ')}.` : 'No visitors are coming to see you.' });
    },
  }),

  record_visitor_host_decision: tool({
    ...VIS, operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For the member of staff a visitor is coming to see (or the front office recording what the host said): record the host's own decision — APPROVED or REJECTED — on a visit waiting for them. Recorded only when the host states it in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({ visitor: text(120, 'Name or reference'), decision: decisionArg(['APPROVED', 'REJECTED'], 'the host'), note: text(500, 'The front office must say how the host gave the decision') }, ['decision']),
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'visitors.service.hostDecision()',
    async prepare(ctx, a) {
      const office = Boolean(ctx.actor?.permissions?.['visitors.manage']);
      const mine = (await visitors.mineAsHost(ctx.actor)).filter((v) => v.status === 'PENDING_HOST');
      const pool = mine.length || !office ? mine : await visitors.list({ status: 'PENDING_HOST' });
      const v = refPick(pool, a.visitor, { label: 'visitor waiting for a decision', nameOf: (x) => x.name, describe: (x) => `${x.name} (${x.refNo})` });
      const isHost = String(v.hostProfileId) === String(ctx.actor.profileId);
      if (!isHost && !a.note) throw ask(`How did ${v.hostName ?? 'the host'} give their decision?`);
      return { id: v.id, ref: v.refNo, name: v.name, purpose: v.purpose, host: v.hostName ?? null, isHost };
    },
    summarise: (a, _x, p) => `${a.decision === 'APPROVED' ? 'Approve' : 'Reject'} the visit of ${p?.name ?? a.visitor} (${p?.ref ?? ''}) for "${p?.purpose ?? ''}"${p && !p.isHost ? ` on behalf of ${p.host ?? 'the host'}` : ''}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const v = await visitors.hostDecision(ctx.actor, p.id, defined({ decision: a.decision, note: a.note }));
      return did('visitor_host_decision_recorded', v, `${v.name}'s visit is ${words(v.status)}.`);
    },
  }),

  list_student_pickup_adults: tool({
    ...VIS, operation: 'GET',
    description: "For the front office: who may collect a student — the guardians (and whether each may collect), standing authorised adults and in-date delegates — and whether a custody restriction is on file (its details are on the Gate screen). Read-only.",
    inputSchema: closed({ ...studentArgs }),
    permission: 'visitors.manage', service: 'pickup.service.listForStudentStaff()',
    async run(_ctx, a) {
      const s = await schoolStudent(a);
      const r = await pickup.listForStudentStaff(s.id);
      const guardians = r.guardians.map((g) => ({ name: g.name, relation: g.relation, mayCollect: g.pickupAuthorized }));
      const adults = r.adults.filter((x) => x.kind !== 'RESTRICTED').map((x) => ({ name: x.name, relationship: x.relationship ?? null, kind: x.kind, validFrom: day(x.validFrom), validTo: day(x.validTo), status: x.status, validNow: x.validNow }));
      const restricted = r.adults.some((x) => x.kind === 'RESTRICTED' && x.status === 'ACTIVE') || r.guardians.some((g) => g.restricted);
      return shown({ student: r.student.name, guardians, adults, custodyRestrictionOnFile: restricted }, `${r.student.name}: may be collected by ${[...guardians.filter((g) => g.mayCollect).map((g) => g.name), ...adults.filter((x) => x.validNow).map((x) => `${x.name} (${words(x.kind)})`)].join(', ') || 'nobody on file'}.${restricted ? ' A custody restriction is on file: check the Gate screen before any release.' : ''}`);
    },
  }),

  add_student_pickup_adult: tool({
    ...VIS, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the front office: add an adult who may collect a student — a standing AUTHORISED adult, or a DELEGATE for a limited time (an end date is required, within the school's maximum). Custody restrictions are recorded on the Gate screen, not here. Confirmed on the website.",
    inputSchema: closed({ ...studentArgs, kind: oneOf(['AUTHORISED', 'DELEGATE']), name: text(120), relationship: text(60), phone: text(20), fromDate: dateStr(), toDate: dateStr('Required for a delegate') }, ['kind', 'name']),
    permission: 'visitors.manage', service: 'pickup.service.staffCreate()',
    async prepare(_ctx, a) {
      if (a.kind === 'DELEGATE' && !a.toDate) throw ask('Until when may they collect the child?');
      const s = await schoolStudent(a);
      return { studentId: s.id, student: s.name };
    },
    summarise: (a, _x, p) => `Allow ${a.name}${a.relationship ? ` (${a.relationship})` : ''} to collect ${p?.student ?? a.studentName} as ${a.kind === 'DELEGATE' ? `a delegate from ${a.fromDate ?? 'now'} to ${a.toDate}` : 'a standing authorised adult'}`,
    async run(ctx, a, p) {
      const x = await pickup.staffCreate(ctx.actor, defined({ studentId: p.studentId, kind: a.kind, name: a.name, relationship: a.relationship, phone: a.phone, validFrom: a.fromDate ? istAt(a.fromDate).toISOString() : undefined, validTo: a.toDate ? istAt(a.toDate, '23:59').toISOString() : undefined }));
      return did('pickup_adult_added', x, `${x.name} may collect ${p.student}${x.validTo ? ` until ${day(x.validTo)}` : ''}.`);
    },
  }),

  revoke_pickup_adult: tool({
    ...VIS, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the front office: end an authorised adult's or delegate's permission to collect a student. Lifting a custody restriction is done on the Gate screen. Confirmed on the website.",
    inputSchema: closed({ ...studentArgs, adultName: text(120), note: text(300) }, ['adultName']),
    permission: 'visitors.manage', service: 'pickup.service.revoke()',
    async prepare(_ctx, a) {
      const s = await schoolStudent(a);
      const r = await pickup.listForStudentStaff(s.id);
      const x = pickPerson(r.adults.filter((y) => y.kind !== 'RESTRICTED' && ['ACTIVE', 'PENDING_OTP'].includes(y.status)), a.adultName, { label: `adult on ${s.name}'s pickup list` });
      return { id: x.id, name: x.name, student: s.name, kind: x.kind };
    },
    summarise: (a, _x, p) => `Stop ${p?.name ?? a.adultName} (${words(p?.kind ?? '')}) collecting ${p?.student ?? a.studentName}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const x = await pickup.revoke(ctx.actor, p.id, { note: a.note });
      return did('pickup_adult_revoked', x, `${x.name} can no longer collect ${p.student}.`);
    },
  }),

  record_pickup_release: tool({
    ...VIS, operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "At the gate (or the hostel): record a student being released to an adult on their pickup list — a guardian with pickup authority or an in-date authorised adult or delegate — and how they were verified. Anyone else is refused; a custody-restricted adult is stopped and the office alerted. Confirmed on the website.",
    inputSchema: closed({ ...studentArgs, receiverName: text(120), verification: oneOf(['ID_CHECKED', 'OTP', 'KNOWN_TO_STAFF', 'PHOTO_MATCHED']), context: oneOf(['GATE', 'HOSTEL']), note: text(1000) }, ['receiverName']),
    permission: 'visitors.manage', service: 'pickup.service.release()',
    async prepare(_ctx, a) {
      const s = await schoolStudent(a);
      return { studentId: s.id, student: s.name, receiver: await authorisedReceiver(s.id, s.name, a.receiverName, a.context ?? 'GATE') };
    },
    summarise: (a, _x, p) => `Release ${p?.student ?? a.studentName} at the ${(a.context ?? 'GATE').toLowerCase()} to ${p?.receiver?.name ?? a.receiverName} (${words(p?.receiver?.kind ?? '')}), ${words(a.verification ?? 'ID_CHECKED')}`,
    async run(ctx, a, p) {
      const log = await pickup.release(ctx.actor, defined({ studentId: p.studentId, receiver: p.receiver.receiver, verification: a.verification, context: a.context, note: a.note }));
      return did('pickup_release_recorded', log, `${p.student} released to ${log.receivedByName}.`);
    },
  }),

  list_gate_releases: tool({
    ...VIS, operation: 'GET',
    description: 'The gate and bus release log: which student went with whom, when, where (gate, hostel, bus drop) and how the adult was verified; for a day and/or one student. Read-only.',
    inputSchema: closed({ date: dateStr(), ...studentArgs }),
    permission: 'visitors.manage', service: 'pickup.service.releaseLog()',
    async run(_ctx, a) {
      const studentId = a.studentName || a.admissionNo ? (await schoolStudent(a)).id : undefined;
      const rows = (await pickup.releaseLog(defined({ date: a.date, studentId }))).map((r) => ({ student: r.studentName, at: `${day(r.at)} ${time(r.at)}`, where: r.context, to: r.receivedByName, as: r.receivedByKind, verified: r.verification }));
      return listed(rows, (r) => `${r.student} to ${r.to} at ${r.at} (${words(r.where)})`, { noun: 'release' });
    },
  }),
};

/* ── Hostel out-passes raised or cancelled by the warden ─── */

const PASS = { module: 'Hostel', feature: 'hostelOutpass' };
const presentPass = (p) => ({ ref: p.refNo, student: p.studentName, leaves: `${day(p.fromAt)} ${time(p.fromAt)}`, returns: `${day(p.toAt)} ${time(p.toAt)}`, destination: p.destination, reason: p.reason, status: p.status, escort: p.escort?.name ?? null, overdue: Boolean(p.overdue) });

async function thePassAll(ctx, a, statuses = null) {
  const rows = (await outpass.list(ctx.actor, 'ALL', { status: 'ALL' })).filter((p) => !statuses || statuses.includes(p.status));
  return refPick(rows, a.ref ?? a.studentName, { label: 'out-pass', nameOf: (p) => p.studentName, describe: (p) => `${p.refNo} ${p.studentName} ${day(p.fromAt)} (${words(p.status)})` });
}

const outpassTools = {
  get_outpass_record: tool({
    ...PASS, operation: 'GET', resultShape: 'DETAIL',
    description: "For the warden and the principal: one hostel out-pass in full — the resident, leaving and return times, destination, reason, escort, the guardian's and the warden's decisions, gate exit and return, and whether it is overdue. Families see theirs with list_my_outpasses. Read-only.",
    inputSchema: closed({ ref: text(40), studentName: text(80) }),
    permission: 'hostel.outpass.manage', service: 'outpass.service.get()',
    anyOf: OUTPASS_READ,
    guard: (ctx) => needAny(ctx, OUTPASS_READ),
    async run(ctx, a) {
      const p = await outpass.get(ctx.actor, needAny(ctx, OUTPASS_READ), (await thePassAll(ctx, a)).id);
      const out = { ...presentPass(p), guardian: p.parentDecision?.decision ?? null, warden: p.wardenDecision?.decision ?? null, wardenNote: p.wardenDecision?.note ?? null, exitAt: p.exitAt ? `${day(p.exitAt)} ${time(p.exitAt)}` : null, returnAt: p.returnAt ? `${day(p.returnAt)} ${time(p.returnAt)}` : null, late: Boolean(p.late) };
      return shown(out, `${out.ref} ${out.student}: ${out.leaves} to ${out.returns}, to ${out.destination}; ${words(out.status)}${out.overdue ? ' (overdue back)' : ''}.`);
    },
  }),

  request_outpass_for_resident: tool({
    ...PASS, operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the warden: raise an out-pass on a resident's behalf (e.g. a guardian asked by phone): leaving and return date and time, destination, reason, escort. It goes to the warden queue for a decision. Confirmed on the website.",
    inputSchema: closed({
      studentName: text(80, 'The resident'), fromDate: dateStr(), fromTime: hm('HH:MM, leaving'), toDate: dateStr(), toTime: hm('HH:MM, back'),
      reason: text(1000), destination: text(300), escortName: text(120), escortRelationship: text(60), escortPhone: text(20),
    }, ['studentName', 'fromDate', 'fromTime', 'toDate', 'toTime', 'reason', 'destination']),
    permission: 'hostel.outpass.manage', service: 'outpass.service.request()',
    async prepare(_ctx, a) {
      const r = pickPerson(await life.residents(), a.studentName, { label: 'hostel resident', describe: (x) => `${x.name} (room ${x.roomNo ?? '—'})` });
      return { studentId: r.studentId, student: r.name };
    },
    summarise: (a, _x, p) => `Raise an out-pass for ${p?.student ?? a.studentName} from ${a.fromDate} ${a.fromTime} to ${a.toDate} ${a.toTime}, to ${a.destination} — ${a.reason}${a.escortName ? `, escorted by ${a.escortName}` : ''}`,
    async run(ctx, a, p) {
      const pass = await outpass.request(ctx.actor, 'ALL', { studentId: p.studentId, fromAt: istAt(a.fromDate, a.fromTime).toISOString(), toAt: istAt(a.toDate, a.toTime).toISOString(), reason: a.reason, destination: a.destination, escort: { name: a.escortName, relationship: a.escortRelationship, phone: a.escortPhone } });
      return did('outpass_raised', pass, `Out-pass ${pass.refNo} raised for ${pass.studentName}; it is ${words(pass.status)}.`);
    },
  }),

  cancel_resident_outpass: tool({
    ...PASS, operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the warden: cancel a resident's out-pass that has not been used yet, with a note. Confirmed on the website.",
    inputSchema: closed({ ref: text(40), studentName: text(80), note: text(300) }),
    permission: 'hostel.outpass.manage', service: 'outpass.service.cancel()',
    async prepare(ctx, a) { const p = await thePassAll(ctx, a, ['PENDING_PARENT', 'PENDING_WARDEN', 'APPROVED']); return { id: p.id, ref: p.refNo, student: p.studentName, leaves: `${day(p.fromAt)} ${time(p.fromAt)}` }; },
    summarise: (a, _x, p) => `Cancel out-pass ${p?.ref ?? a.ref ?? ''} for ${p?.student ?? a.studentName ?? ''} (leaving ${p?.leaves ?? ''})${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const pass = await outpass.cancel(ctx.actor, 'ALL', p.id, { note: a.note });
      return did('outpass_cancelled', pass, `${pass.refNo} is cancelled.`);
    },
  }),
};

/* ── Teachers' class check-ins ───────────────────────────── */

const COVER = { module: 'Cover' };

const checkInTools = {
  list_my_class_check_ins: tool({
    ...COVER, operation: 'GET',
    description: "For a teacher: the classes they checked in to on a day (default today), by period, room and whether it was cover. Read-only.",
    inputSchema: closed({ date: dateStr() }),
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'camera.service.myCheckIns()',
    async run(ctx, a) {
      const rows = (await camera.myCheckIns(ctx.actor, defined({ date: a.date }))).map((c) => ({ period: c.periodNo, room: c.room ?? null, at: time(c.checkedInAt ?? c.createdAt), covering: Boolean(c.coveringForProfileId), note: c.note ?? null }));
      return listed(rows, (c) => `period ${c.period}${c.room ? ` in ${c.room}` : ''} at ${c.at}${c.covering ? ' (cover)' : ''}`, { noun: 'check-in' });
    },
  }),

  get_class_presence_board: tool({
    ...COVER, operation: 'GET',
    description: "For the principal and administration: teacher presence by period on a day (default today), from the timetable and teachers' class check-ins: present, present on cover, not checked in yet, upcoming. \"Not checked in\" means no record yet, not that a class was unattended. Read-only.",
    inputSchema: closed({ date: dateStr(), show: oneOf(['not_checked_in', 'all'], 'Default not_checked_in') }),
    permission: 'cover.manage', minScope: 'ALL', service: 'camera.service.presenceBoard()',
    anyOf: [['cover.manage', 'ALL'], ['camera.events.review']],
    guard: (ctx) => needAny(ctx, [['cover.manage', 'ALL'], ['camera.events.review']]),
    async run(_ctx, a) {
      const b = await camera.presenceBoard(defined({ date: a.date }));
      let rows = b.rows.map((r) => ({ period: r.periodNo, time: r.time, class: r.className, subject: r.subject, teacher: r.teacherName, room: r.room, status: r.status }));
      if ((a.show ?? 'not_checked_in') === 'not_checked_in') rows = rows.filter((r) => r.status === 'NOT_CHECKED_IN');
      return listed(rows, (r) => `P${r.period} ${r.class} ${r.subject ?? ''} (${r.teacher ?? 'no teacher'}): ${words(r.status)}`, { noun: 'lesson', extra: { counts: b.counts, note: b.note }, speak: `${b.counts.present} of ${b.counts.lessons} lesson(s) checked in, ${b.counts.notCheckedIn} not checked in yet${rows.length && (a.show ?? 'not_checked_in') === 'not_checked_in' ? `: ${rows.slice(0, 10).map((r) => `P${r.period} ${r.class} (${r.teacher ?? '—'})`).join(', ')}` : ''}. ${b.note}` });
    },
  }),

  check_in_to_class: tool({
    ...COVER, operation: 'CREATE', risk: RISK.LOW,
    description: "For a teacher: check in to the class they are timetabled for (or covering) in a period today. Needs confirmation.",
    inputSchema: closed({ periodNo: int(0, 15), className: text(60, 'When more than one class meets in that period'), coveringFor: text(120, 'The absent teacher, when covering'), note: text(300) }, ['periodNo']),
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'camera.service.checkIn()',
    async prepare(ctx, a) {
      const section = a.className ? await resolveSection({ ...ctx, scope: 'ALL' }, { className: a.className }) : null;
      const covering = a.coveringFor ? await staffNamed(a.coveringFor, 'teacher') : null;
      return { sectionId: section?.sectionId ?? null, className: section?.label ?? null, coveringId: covering?.id ?? null, covering: covering?.name ?? null };
    },
    summarise: (a, _x, p) => `Check in to period ${a.periodNo} today${p?.className ? ` with ${p.className}` : ''}${p?.covering ? `, covering for ${p.covering}` : ''}`,
    async run(ctx, a, p) {
      const c = await camera.checkIn(ctx.actor, defined({ periodNo: a.periodNo, sectionId: p.sectionId ?? undefined, coveringForProfileId: p.coveringId ?? undefined, note: a.note }));
      return did('class_checked_in', c, `Checked in to period ${c.periodNo}${c.room ? ` in ${c.room}` : ''}.`);
    },
  }),
};

/* ── Safety settings, alerts and the device registry ─────── */

const SAFE = { module: 'Safety' };
const SECTION_KEYS = { fleet: 'transport.fleet.manage', checkpoints: 'checkpoints.manage', visitors: 'visitors.manage', outpass: 'hostel.outpass.manage' };
const alertGuard = (ctx) => { if (!alertDepartments(ctx.actor).length) throw forbidden('Missing permission to see safety alerts'); };
const presentAlert = (x) => ({ kind: x.kind, department: x.department, severity: x.severity, message: x.message, status: x.status, count: x.count, lastSeen: `${day(x.lastSeenAt)} ${time(x.lastSeenAt)}` });

const safetyTools = {
  get_safety_settings: tool({
    ...SAFE, operation: 'GET',
    description: "The school's safety thresholds the caller manages: bus delay, arrival radius, GPS stale and offline minutes, alert repeat, uncleared-crew policy; checkpoint duplicate window and unauthorised-departure flag; visitor badge hours, overstay grace and delegate maximum days; out-pass late grace. Read-only.",
    permission: 'visitors.manage', service: 'safety.shared.getSettings()',
    anyOf: SAFETY_MANAGE,
    guard: (ctx) => needAny(ctx, SAFETY_MANAGE),
    async run(ctx) {
      const s = await safety.getSettings();
      const out = Object.fromEntries(Object.entries(SECTION_KEYS).filter(([, k]) => ctx.actor?.permissions?.[k]).map(([sec]) => [sec, s[sec] ?? {}]));
      return shown(out, Object.entries(out).map(([sec, v]) => `${sec}: ${Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ')}`).join('; ') || 'No settings you manage.');
    },
  }),

  update_safety_settings: tool({
    ...SAFE, operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Change the school's safety thresholds, section by section (each needs its own manage permission): fleet (delay, arrival radius, off-route, GPS stale/offline minutes, alert repeat, default speed, uncleared-crew policy WARN or BLOCK), checkpoints (duplicate window, flag unauthorised departure), visitors (badge hours, overstay grace, delegate maximum days), out-pass (late grace minutes). Confirmed on the website.",
    inputSchema: closed({
      fleet: closed({ delayMinutes: int(1, 240), arrivalRadiusMeters: int(10, 5000), offRouteMeters: int(50, 20000), staleMinutes: int(1, 240), offlineMinutes: int(1, 1440), alertRepeatMinutes: int(1, 240), defaultSpeedKmh: int(5, 120), unverifiedCrewPolicy: oneOf(['WARN', 'BLOCK']) }),
      checkpoints: closed({ duplicateWindowSeconds: int(0, 3600), flagUnauthorisedDeparture: bool() }),
      visitors: closed({ defaultBadgeHours: num(0.25, 24), overstayGraceMinutes: int(0, 600), delegateMaxDays: int(1, 365) }),
      outpass: closed({ lateGraceMinutes: int(0, 600) }),
    }),
    permission: 'visitors.manage', anyOf: SAFETY_MANAGE, service: 'safety.shared.updateSettings()',
    guard: (ctx, a) => {
      needAny(ctx, SAFETY_MANAGE);
      for (const sec of Object.keys(SECTION_KEYS)) if (a[sec] && Object.keys(a[sec]).length) need(ctx, SECTION_KEYS[sec]);
    },
    async prepare(_ctx, a) {
      if (!Object.keys(SECTION_KEYS).some((sec) => a[sec] && Object.keys(a[sec]).length)) throw ask('Which setting, and to what?');
      return undefined;
    },
    summarise: (a) => `Change safety settings: ${Object.keys(SECTION_KEYS).filter((sec) => a[sec]).map((sec) => `${sec} (${changes(a[sec])})`).join('; ')}`,
    async run(ctx, a) {
      const s = await safety.updateSettings(ctx.actor, defined({ fleet: a.fleet, checkpoints: a.checkpoints, visitors: a.visitors, outpass: a.outpass }));
      return did('safety_settings_updated', s, 'Safety settings saved.');
    },
  }),

  list_safety_alerts: tool({
    ...SAFE, operation: 'GET',
    description: "Open (or acknowledged, resolved, all) safety alerts in the departments the caller looks after — transport (delays, GPS, wrong vehicle, unaccounted students, capacity, uncleared crew), gate and safety (custody stops, overstays), hostel (late returns): kind, severity, message, how often and when last seen. Read-only.",
    inputSchema: closed({ status: oneOf(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL']), department: oneOf(['TRANSPORT', 'GATE', 'SAFETY', 'HOSTEL']), kind: text(40) }),
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'safety.shared.listAlerts()',
    guard: alertGuard,
    async run(ctx, a) {
      const mine = alertDepartments(ctx.actor);
      const departments = a.department ? mine.filter((d) => d === a.department) : mine;
      const rows = (await safety.listAlerts(defined({ status: a.status, kind: a.kind }), { departments })).map(presentAlert);
      return listed(rows, (x) => `${x.severity.toLowerCase()} ${words(x.kind)}: ${excerpt(x.message, 90)}`, { noun: 'alert' });
    },
  }),

  update_safety_alert: tool({
    ...SAFE, operation: 'UPDATE', risk: RISK.LOW,
    description: 'Acknowledge a safety alert (someone is on it) or resolve it with a note of what was done. The alert is named by words of its message or its kind. Needs confirmation.',
    inputSchema: closed({ alert: text(200, 'Words from the alert, e.g. "Route 4 delay" or "wrong vehicle Rahul"'), status: oneOf(['ACKNOWLEDGED', 'RESOLVED']), note: text(1000) }, ['alert', 'status']),
    permission: 'ai.copilot.use', forRoles: STAFF, service: 'safety.shared.closeAlert()',
    guard: alertGuard,
    async prepare(ctx, a) {
      const rows = await safety.listAlerts({}, { departments: alertDepartments(ctx.actor) });
      const terms = lower(a.alert).split(/\s+/).filter(Boolean);
      const hits = rows.filter((x) => terms.every((t) => lower(`${x.message} ${words(x.kind)}`).includes(t)));
      if (!hits.length) throw notFound(`No open alert matches "${a.alert}".`);
      if (hits.length > 1) throw ask(`Which alert? ${hits.slice(0, 6).map((x) => excerpt(x.message, 70)).join('; ')}`);
      return { id: hits[0].id, message: hits[0].message };
    },
    summarise: (a, _x, p) => `${a.status === 'RESOLVED' ? 'Resolve' : 'Acknowledge'} the alert "${excerpt(p?.message ?? a.alert, 100)}"${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const x = await safety.closeAlert(ctx.actor, p.id, { status: a.status, note: a.note }, { departments: alertDepartments(ctx.actor) });
      return did('safety_alert_updated', x, `Alert ${words(x.status)}.`);
    },
  }),

  list_safety_devices: tool({
    ...SAFE, operation: 'GET',
    description: 'Registered GPS trackers and card readers the caller manages: label, kind, status, the vehicle or checkpoint each serves, last seen and when its secret was last rotated (never the secret). Camera devices are on the Camera screen. Read-only.',
    inputSchema: closed({ kind: oneOf(['GPS', 'CHECKPOINT']) }),
    permission: 'visitors.manage', service: 'devices.service.list()',
    anyOf: SAFETY_MANAGE,
    guard: (ctx) => needAny(ctx, SAFETY_MANAGE),
    async run(ctx, a) {
      const rows = (await safetyDevices.list(ctx.actor, defined({ kind: a.kind }))).filter((d) => d.kind !== 'CAMERA')
        .map((d) => ({ label: d.label, kind: d.kind, status: d.status, point: d.checkpoint?.point ?? null, location: d.checkpoint?.locationLabel ?? null, lastSeen: d.lastSeenAt ? `${day(d.lastSeenAt)} ${time(d.lastSeenAt)}` : null, secretRotated: day(d.secretRotatedAt) }));
      return listed(rows, (d) => `${d.label} (${words(d.kind)}, ${d.status.toLowerCase()})`, { noun: 'device' });
    },
  }),

  set_safety_device_status: tool({
    ...SAFE, operation: 'ACTION', risk: RISK.MEDIUM,
    description: 'Disable a GPS tracker or card reader (its readings are then refused, e.g. when lost) or enable it again, with a note. Camera devices are managed on the Camera screen. Needs confirmation.',
    inputSchema: closed({ device: text(120, 'The device by its label'), status: oneOf(['ACTIVE', 'DISABLED']), note: text(300) }, ['device', 'status']),
    permission: 'visitors.manage', service: 'devices.service.setStatus()',
    anyOf: SAFETY_MANAGE,
    guard: (ctx) => needAny(ctx, SAFETY_MANAGE),
    async prepare(ctx, a) {
      const d = pick((await safetyDevices.list(ctx.actor, {})).filter((x) => x.kind !== 'CAMERA'), a.device, { label: 'device', nameOf: (x) => x.label, refOf: () => null });
      return { id: d.id, label: d.label, kind: d.kind };
    },
    summarise: (a, _x, p) => `${a.status === 'DISABLED' ? 'Disable' : 'Enable'} the ${words(p?.kind ?? '')} ${p?.label ?? a.device}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, a, p) {
      const d = await safetyDevices.setStatus(ctx.actor, p.id, { status: a.status, note: a.note });
      return did('safety_device_status_set', d, `${d.label} is ${d.status.toLowerCase()}.`);
    },
  }),
};

/* ── Library and hostel reads not yet covered ────────────── */

const libraryTools = {
  get_library_rules: tool({
    module: 'Library', operation: 'GET',
    description: 'The library desk rules: how many days a renewal adds, how many renewals a loan may have, how long a reserved book waits on the hold shelf, and the fine per day late. Read-only.',
    permission: 'library.read', service: 'library.desk.DESK_RULES',
    async run() {
      const r = desk.DESK_RULES;
      return shown({ ...r }, `A renewal adds ${r.renewDays} days, at most ${r.maxRenewals} renewals; a reserved book waits ${r.holdShelfDays} days on the hold shelf; the fine is ₹${r.finePerDayRupees} a day late.`);
    },
  }),

  list_library_shelf_categories: tool({
    module: 'Library', operation: 'GET',
    description: 'What the library catalogue can be filtered by: its categories, authors, resource types, languages and exam types. Read-only.',
    permission: 'library.read', service: 'library.service.listBookFacets()',
    async run() {
      const f = await library.listBookFacets();
      return shown(f, `${f.categories.length} categor${f.categories.length === 1 ? 'y' : 'ies'}${f.categories.length ? ` (${f.categories.slice(0, 12).join(', ')})` : ''}, ${f.authors.length} author(s), resource types ${f.resourceTypes.join(', ')}.`);
    },
  }),

  list_my_reading_challenges: tool({
    module: 'Library', operation: 'GET',
    description: "For a student: the reading challenges they are taking part in, with how many books they have read towards each and whether they have completed it. Read-only.",
    permission: 'library.request', service: 'library.desk.myChallenges()',
    async run(ctx) {
      const studentId = await getOwnStudentId(ctx.actor?.profileId);
      if (!studentId) throw forbidden('Reading challenges are for students.');
      const rows = (await desk.myChallenges(studentId)).map((c) => ({ title: c.title, target: c.targetBooks, read: c.read, completed: c.completed, ends: day(c.endsOn), titles: c.titles }));
      return listed(rows, (c) => `${c.title}: ${c.read} of ${c.target}${c.completed ? ' (completed)' : ''}`, { noun: 'reading challenge' });
    },
  }),

  close_reading_challenge: tool({
    module: 'Library', operation: 'ACTION', risk: RISK.LOW,
    description: 'For the librarian: close an active reading challenge (it stops counting books). Needs confirmation.',
    inputSchema: closed({ challenge: text(120, 'The challenge by its title') }, ['challenge']),
    permission: 'library.manage', service: 'library.desk.closeChallenge()',
    async prepare(_ctx, a) { const c = pick(await desk.listChallenges({ status: 'ACTIVE' }), a.challenge, { label: 'active reading challenge', nameOf: (x) => x.title, refOf: () => null }); return { id: c.id, title: c.title }; },
    summarise: (a, _x, p) => `Close the reading challenge "${p?.title ?? a.challenge}"`,
    async run(ctx, _a, p) {
      const c = await desk.closeChallenge(ctx.actor, p.id);
      return did('reading_challenge_closed', c, `"${c.title}" is closed.`);
    },
  }),
};

const hostelTools = {
  get_hostel_incident: tool({
    module: 'Hostel', operation: 'GET',
    description: 'One hostel incident in full: residents involved, category, severity, when and where, what happened and what was done, each contact with the family, and how it was resolved. Read-only.',
    inputSchema: closed({ incident: text(80, 'Reference (e.g. "HIN/2026/0003") or a resident\'s name') }, ['incident']),
    permission: 'hostel.read', minScope: 'ALL', service: 'hostel.life.getIncident()',
    async run(_ctx, a) {
      const rows = await life.listIncidents({ status: 'ALL', limit: 300 });
      const hit = refPick(rows, a.incident, { label: 'hostel incident', nameOf: (i) => i.students.map((s) => s.name).join(', '), describe: (i) => `${i.refNo} ${words(i.category)} (${i.students.map((s) => s.name).join(', ')})` });
      const { history: _h, ...i } = await life.getIncident(hit.id);
      const out = { ...i, students: i.students.map((s) => s.name), occurredOn: day(i.occurredAt), contacts: i.parentContacts.map((c) => ({ on: day(c.at), with: c.guardianName, channel: c.channel, summary: c.summary })) };
      delete out.parentContacts;
      return shown(out, `${i.refNo}: ${words(i.severity)} ${words(i.category)} on ${out.occurredOn} (${out.students.join(', ')}), ${words(i.status)}; ${out.contacts.length} family contact(s).`);
    },
  }),

  get_hostel_room: tool({
    module: 'Hostel', operation: 'GET',
    description: 'One hostel room: block, floor, type, capacity, status, amenities and who lives there now. Read-only.',
    inputSchema: closed({ roomNo: text(20) }, ['roomNo']),
    permission: 'hostel.read', service: 'hostel.service.getRoomById()',
    async run(_ctx, a) {
      const rooms = (await HostelRoom.find({}).select('roomNo block').lean()).map((r) => ({ id: String(r._id), name: r.roomNo, block: r.block }));
      const hit = pick(rooms, a.roomNo, { label: 'room', refOf: (r) => r.name, describe: (r) => `${r.name} (${r.block})` });
      const room = await hostel.getRoomById(hit.id);
      const occupants = (await HostelAllocation.find({ roomId: hit.id, status: 'ACTIVE' }).populate('studentId', 'firstName lastName').lean()).map((x) => `${x.studentId?.firstName ?? ''} ${x.studentId?.lastName ?? ''}`.trim());
      const out = { roomNo: room.roomNo, block: room.block, floor: room.floor, type: room.type, capacity: room.capacity, status: room.status, amenities: room.amenities ?? [], occupants, free: Math.max(0, room.capacity - occupants.length) };
      return shown(out, `Room ${out.roomNo} (${out.block}): ${occupants.length} of ${out.capacity} beds taken${occupants.length ? ` — ${occupants.join(', ')}` : ''}; ${words(out.status)}.`);
    },
  }),
};

export const tools = {
  ...labTools, ...fleetTools, ...checkpointTools, ...visitorTools, ...outpassTools, ...checkInTools, ...safetyTools, ...libraryTools, ...hostelTools,
};
