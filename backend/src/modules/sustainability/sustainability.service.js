import {
  SustainabilityZone, EcoTeam, Plant, WasteLog, CompostBatch, MeterReading, EcoActivity, SanitationDuty,
  ZONE_KINDS, TEAM_KINDS, PLANT_KINDS, PLANT_STATUSES, WASTE_STREAMS, METER_KINDS, METER_UNITS, ACTIVITY_CATEGORIES, LIFE_THEMES,
} from '../../models/sustainability.model.js';
import { Section } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { AppError } from '../../utils/AppError.js';
import { resolvePeriod, localDate } from '../../utils/periods.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, profileNames,
} from '../ops/common.js';
import { ownTeamIds, loadTeam, requireStaff, isStaff } from './sustainability.access.js';

/**
 * Greenery, waste, compost, water and energy, and eco points.
 * Sanitation duties live in sustainability.sanitation.js; evidence packs in
 * sustainability.packs.js. Functions take (actor, scope, ...) and enforce the
 * OWN scope here, never only in the route.
 */

const GRAMS = 1000;
export const DEFAULT_POINTS = { PLANTING: 10, CLEANUP: 8, WASTE_SEGREGATION: 8, COMPOSTING: 8, WATER_SAVING: 6, ENERGY_SAVING: 6, AWARENESS: 5, LIFE_ACTION: 6, OTHER: 3 };
const MAX_POINTS = 50;

const kgToGrams = (value, label = 'weightKg') => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`${label} must be a weight in kilograms, zero or more`, 400, [], 'BAD_WEIGHT');
  if (n > 1_000_000) throw new AppError(`${label} looks too large`, 400, [], 'BAD_WEIGHT');
  return Math.round(n * GRAMS);
};
const kg = (grams) => Math.round((grams ?? 0) / 10) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

async function zoneIdOrNull(id) {
  if (!id) return null;
  const z = await SustainabilityZone.findById(assertObjectId(id, 'zoneId')).select('_id').lean();
  if (!z) throw new AppError('Zone not found', 404);
  return z._id;
}

// ── zones ──────────────────────────────────────────────────────────────

export async function listZones(actor) {
  requireStaff(actor);
  return (await SustainabilityZone.find({}).sort({ name: 1 }).lean()).map(dto);
}

export async function createZone(actor, body = {}) {
  requireProfile(actor);
  try {
    const z = await SustainabilityZone.create({
      name: requireText(body.name, 'name', { max: 120 }), kind: oneOf(body.kind, ZONE_KINDS, 'kind', 'OTHER'),
      facilityId: body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : null, notes: optionalText(body.notes, { max: 1000 }) ?? null,
    });
    return dto(z);
  } catch (err) {
    if (err?.code === 11000) throw new AppError('A zone with that name already exists.', 409, [], 'DUPLICATE');
    throw err;
  }
}

export async function updateZone(actor, id, body = {}) {
  requireProfile(actor);
  const z = await SustainabilityZone.findById(assertObjectId(id));
  if (!z) throw new AppError('Zone not found', 404);
  if (body.name !== undefined) z.name = requireText(body.name, 'name', { max: 120 });
  if (body.kind !== undefined) z.kind = oneOf(body.kind, ZONE_KINDS, 'kind');
  if (body.notes !== undefined) z.notes = optionalText(body.notes, { max: 1000 }) ?? null;
  if (body.active !== undefined) z.active = body.active === true;
  await z.save();
  return dto(z);
}

// ── eco teams (classes, houses, clubs) ─────────────────────────────────

async function teamDtos(rows) {
  const sections = await Section.find({ _id: { $in: rows.map((t) => t.sectionId).filter(Boolean) } }).populate('gradeId', 'name').lean();
  const label = new Map(sections.map((s) => [String(s._id), `${s.gradeId?.name ?? ''} ${s.name}`.trim()]));
  const leads = await profileNames(rows.flatMap((t) => t.leadProfileIds ?? []));
  return rows.map((t) => ({
    ...dto(t), sectionLabel: t.sectionId ? label.get(String(t.sectionId)) ?? null : null,
    leadNames: (t.leadProfileIds ?? []).map((p) => leads.get(String(p))).filter(Boolean),
  }));
}

export async function listTeams(actor, scope) {
  requireStaff(actor);
  const own = await ownTeamIds(actor, scope);
  const rows = await EcoTeam.find(own === null ? {} : { _id: { $in: own } }).sort({ kind: 1, name: 1 }).lean();
  return teamDtos(rows);
}

export async function createTeam(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, TEAM_KINDS, 'kind');
  let sectionId = null;
  if (kind === 'CLASS') {
    sectionId = assertObjectId(body.sectionId, 'sectionId');
    if (!(await Section.exists({ _id: sectionId }))) throw new AppError('That class section does not exist in this school', 404);
  }
  try {
    const t = await EcoTeam.create({
      kind, name: requireText(body.name, 'name', { max: 120 }), sectionId,
      houseValue: kind === 'HOUSE' ? optionalText(body.houseValue, { max: 60 }) || null : null,
      leadProfileIds: (Array.isArray(body.leadProfileIds) ? body.leadProfileIds : []).slice(0, 10).map((p) => assertObjectId(p, 'leadProfileIds')),
    });
    return (await teamDtos([t.toObject()]))[0];
  } catch (err) {
    if (err?.code === 11000) throw new AppError('A team of that kind and name already exists.', 409, [], 'DUPLICATE');
    throw err;
  }
}

export async function updateTeam(actor, id, body = {}) {
  requireProfile(actor);
  const t = await EcoTeam.findById(assertObjectId(id));
  if (!t) throw new AppError('Eco team not found', 404);
  if (body.name !== undefined) t.name = requireText(body.name, 'name', { max: 120 });
  if (body.leadProfileIds !== undefined) t.leadProfileIds = (Array.isArray(body.leadProfileIds) ? body.leadProfileIds : []).slice(0, 10).map((p) => assertObjectId(p, 'leadProfileIds'));
  if (body.active !== undefined) t.active = body.active === true;
  await t.save();
  return (await teamDtos([t.toObject()]))[0];
}

// ── trees and plants ───────────────────────────────────────────────────

function plantDto(p, zones = new Map(), teams = new Map()) {
  const out = dto(p);
  out.zoneName = p.zoneId ? zones.get(String(p.zoneId)) ?? null : null;
  out.plantedBy = p.plantedByTeamId ? teams.get(String(p.plantedByTeamId)) ?? p.plantedByLabel : p.plantedByLabel;
  out.lastCheck = p.checks?.length ? p.checks[p.checks.length - 1] : null;
  out.checkCount = p.checks?.length ?? 0;
  delete out.checks;
  return out;
}

async function lookups() {
  const [zones, teams] = await Promise.all([SustainabilityZone.find({}).select('name').lean(), EcoTeam.find({}).select('name').lean()]);
  return { zones: new Map(zones.map((z) => [String(z._id), z.name])), teams: new Map(teams.map((t) => [String(t._id), t.name])) };
}

export async function listPlants(actor, scope, query = {}) {
  requireStaff(actor);
  const filter = {};
  if (query.zoneId) filter.zoneId = assertObjectId(query.zoneId, 'zoneId');
  if (query.status) filter.status = oneOf(query.status, PLANT_STATUSES, 'status');
  const own = await ownTeamIds(actor, scope);
  if (own !== null && query.mine === 'true') filter.plantedByTeamId = { $in: own };
  const rows = await Plant.find(filter).sort({ plantedOn: -1 }).limit(500).lean();
  const { zones, teams } = await lookups();
  return rows.map((p) => plantDto(p, zones, teams));
}

export async function getPlant(actor, id) {
  requireStaff(actor);
  const p = await Plant.findById(assertObjectId(id)).lean();
  if (!p) throw new AppError('Plant not found', 404);
  const { zones, teams } = await lookups();
  return { ...plantDto(p, zones, teams), checks: p.checks ?? [] };
}

export async function createPlant(actor, scope, body = {}) {
  requireProfile(actor);
  let teamId = null;
  if (body.plantedByTeamId) teamId = (await loadTeam(actor, scope, body.plantedByTeamId))._id;
  else if (scope !== 'ALL') throw new AppError('Choose the class, house or club that planted it.', 400, [], 'TEAM_REQUIRED');
  const count = Math.max(1, Math.min(Number.parseInt(body.count, 10) || 1, 5000));
  const p = await Plant.create({
    code: await nextRef('TRE'), species: requireText(body.species, 'species', { max: 120 }), commonName: optionalText(body.commonName, { max: 120 }) || null,
    kind: oneOf(body.kind, PLANT_KINDS, 'kind', 'TREE'), zoneId: await zoneIdOrNull(body.zoneId), locationNote: optionalText(body.locationNote, { max: 300 }) || null,
    plantedOn: parseDate(body.plantedOn, 'plantedOn', { required: true }), plantedByTeamId: teamId,
    plantedByLabel: optionalText(body.plantedByLabel, { max: 120 }) || null, count, recordedByProfileId: actor.profileId,
  });
  const { zones, teams } = await lookups();
  return plantDto(p.toObject(), zones, teams);
}

/** A survival check. Photo evidence is required: a check without it cannot support a submission. */
export async function recordPlantCheck(actor, scope, id, body = {}) {
  requireProfile(actor);
  const p = await Plant.findById(assertObjectId(id));
  if (!p) throw new AppError('Plant not found', 404);
  if (scope !== 'ALL') {
    const own = await ownTeamIds(actor, scope);
    if (!p.plantedByTeamId || !own.includes(String(p.plantedByTeamId))) throw new AppError('Plant not found', 404);
  }
  const status = oneOf(body.status, PLANT_STATUSES, 'status');
  const evidence = cleanAttachments(body.evidence, actor);
  if (!evidence.length) throw new AppError('Attach a photo of the plant for the survival check.', 400, [], 'EVIDENCE_REQUIRED');
  p.checks.push({ status, note: optionalText(body.note, { max: 1000 }) || null, evidence, byProfileId: actor.profileId, byName: actor.displayName ?? null });
  p.status = status;
  p.lastCheckedAt = new Date();
  await p.save();
  return getPlant(actor, String(p._id));
}

// ── waste ──────────────────────────────────────────────────────────────

/** Streams that must not leave the school without a receipt from whoever took them. */
const RECEIPT_STREAMS = ['E_WASTE', 'HAZARDOUS_LAB', 'SANITARY'];

export async function listWaste(actor, query = {}) {
  requireStaff(actor);
  const filter = {};
  if (query.stream) filter.stream = oneOf(query.stream, WASTE_STREAMS, 'stream');
  if (query.from || query.to) {
    const p = resolvePeriod({ preset: 'custom', from: query.from, to: query.to });
    filter.date = { $gte: p.start, $lt: p.end };
  }
  const rows = await WasteLog.find(filter).sort({ date: -1 }).limit(500).lean();
  const { zones } = await lookups();
  return rows.map((w) => ({ ...dto(w), weightKg: kg(w.weightGrams), zoneName: w.zoneId ? zones.get(String(w.zoneId)) ?? null : null }));
}

export async function createWaste(actor, body = {}) {
  requireProfile(actor);
  const stream = oneOf(body.stream, WASTE_STREAMS, 'stream');
  const destination = oneOf(body.destination, ['VENDOR', 'COMPOST', 'MUNICIPAL', 'STORED', 'OTHER'], 'destination', stream === 'WET' ? 'COMPOST' : 'VENDOR');
  const receipts = cleanAttachments(body.receipts, actor);
  const receiptNo = optionalText(body.receiptNo, { max: 80 }) || null;
  const vendorName = optionalText(body.vendorName, { max: 160 }) || null;
  if (destination === 'VENDOR' && RECEIPT_STREAMS.includes(stream) && (!vendorName || (!receiptNo && !receipts.length))) {
    throw new AppError('E-waste, sanitary and hazardous lab waste handed to a vendor needs the vendor name and their receipt (number or a copy).', 400, [], 'RECEIPT_REQUIRED');
  }
  const w = await WasteLog.create({
    refNo: await nextRef('WST'), date: parseDate(body.date, 'date', { required: true }), stream, weightGrams: kgToGrams(body.weightKg),
    segregated: body.segregated !== false, zoneId: await zoneIdOrNull(body.zoneId), destination, vendorName, receiptNo,
    handedOverAt: destination === 'VENDOR' ? parseDate(body.handedOverAt, 'handedOverAt') ?? new Date() : null,
    receipts, notes: optionalText(body.notes, { max: 1000 }) || null, recordedByProfileId: actor.profileId,
  });
  return { ...dto(w), weightKg: kg(w.weightGrams) };
}

// ── compost ────────────────────────────────────────────────────────────

export async function listCompost(actor) {
  requireStaff(actor);
  return (await CompostBatch.find({}).sort({ startedOn: -1 }).limit(200).lean()).map((c) => ({ ...dto(c), inputKg: kg(c.inputGrams), outputKg: c.outputGrams === null ? null : kg(c.outputGrams) }));
}

export async function createCompost(actor, body = {}) {
  requireProfile(actor);
  const c = new CompostBatch({
    code: await nextRef('CMP'), zoneId: await zoneIdOrNull(body.zoneId), startedOn: parseDate(body.startedOn, 'startedOn', { required: true }),
    inputGrams: kgToGrams(body.inputKg ?? 0, 'inputKg'), notes: optionalText(body.notes, { max: 1000 }) || null,
  });
  pushHistory(c, actor, 'STARTED');
  await c.save();
  return { ...dto(c), inputKg: kg(c.inputGrams) };
}

export async function updateCompost(actor, id, body = {}) {
  requireProfile(actor);
  const c = await CompostBatch.findById(assertObjectId(id));
  if (!c) throw new AppError('Compost batch not found', 404);
  if (body.addKg !== undefined) { c.inputGrams += kgToGrams(body.addKg, 'addKg'); pushHistory(c, actor, 'INPUT_ADDED', { note: `${body.addKg} kg` }); }
  if (body.status !== undefined) {
    const to = oneOf(body.status, ['ACTIVE', 'MATURED', 'USED'], 'status');
    const order = ['ACTIVE', 'MATURED', 'USED'];
    if (order.indexOf(to) < order.indexOf(c.status)) throw new AppError(`A compost batch cannot go back from ${c.status} to ${to}.`, 409, [], 'INVALID_TRANSITION');
    if (to === 'MATURED' && c.status !== 'MATURED') { c.maturedOn = parseDate(body.maturedOn, 'maturedOn') ?? new Date(); if (body.outputKg !== undefined) c.outputGrams = kgToGrams(body.outputKg, 'outputKg'); }
    pushHistory(c, actor, 'STATUS', { from: c.status, to });
    c.status = to;
  }
  await c.save();
  return { ...dto(c), inputKg: kg(c.inputGrams), outputKg: c.outputGrams === null ? null : kg(c.outputGrams) };
}

// ── meter readings ─────────────────────────────────────────────────────

export async function listMeters(actor, query = {}) {
  requireStaff(actor);
  const filter = {};
  if (query.kind) filter.kind = oneOf(query.kind, METER_KINDS, 'kind');
  return (await MeterReading.find(filter).sort({ period: -1, kind: 1 }).limit(500).lean()).map(dto);
}

/** One figure per meter per month; recording the same month again corrects it. */
export async function recordMeter(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, METER_KINDS, 'kind');
  const period = String(body.period ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError('period must be a month like 2026-07', 400, [], 'BAD_PERIOD');
  const start = body.startReading === undefined || body.startReading === null || body.startReading === '' ? null : Number(body.startReading);
  const end = body.endReading === undefined || body.endReading === null || body.endReading === '' ? null : Number(body.endReading);
  let quantity = body.quantity === undefined || body.quantity === '' ? null : Number(body.quantity);
  if (start !== null && end !== null) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new AppError('The closing reading must be at or above the opening reading.', 400, [], 'BAD_READING');
    quantity = Math.round((end - start) * 100) / 100;
  }
  if (quantity === null || !Number.isFinite(quantity) || quantity < 0) throw new AppError('Give the month\'s quantity, or the opening and closing readings.', 400, [], 'BAD_READING');
  const meterLabel = optionalText(body.meterLabel, { max: 60 }) || 'Main';
  const row = await MeterReading.findOneAndUpdate(
    { kind, meterLabel, period },
    { $set: { startReading: start, endReading: end, quantity, unit: METER_UNITS[kind], notes: optionalText(body.notes, { max: 500 }) || null, recordedByProfileId: actor.profileId, evidence: cleanAttachments(body.evidence, actor) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return dto(row);
}

// ── eco activities and points ──────────────────────────────────────────

async function activityDtos(rows) {
  const teams = new Map((await EcoTeam.find({ _id: { $in: rows.map((r) => r.teamId) } }).select('name kind').lean()).map((t) => [String(t._id), t]));
  return rows.map((a) => ({ ...dto(a), teamName: teams.get(String(a.teamId))?.name ?? null, teamKind: teams.get(String(a.teamId))?.kind ?? null }));
}

export async function listActivities(actor, scope, query = {}) {
  requireStaff(actor);
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, ['SUBMITTED', 'VERIFIED', 'REJECTED'], 'status');
  if (query.teamId) filter.teamId = assertObjectId(query.teamId, 'teamId');
  const own = await ownTeamIds(actor, scope);
  if (own !== null) filter.teamId = filter.teamId ? (own.includes(String(filter.teamId)) ? filter.teamId : null) : { $in: own };
  const rows = await EcoActivity.find(filter).sort({ date: -1 }).limit(300).lean();
  return activityDtos(rows);
}

export async function logActivity(actor, scope, body = {}) {
  requireProfile(actor);
  const team = await loadTeam(actor, scope, body.teamId);
  const category = oneOf(body.category, ACTIVITY_CATEGORIES, 'category', 'OTHER');
  const lifeTheme = body.lifeTheme ? oneOf(body.lifeTheme, LIFE_THEMES, 'lifeTheme') : null;
  const a = new EcoActivity({
    refNo: await nextRef('ECO'), teamId: team._id, title: requireText(body.title, 'title', { max: 160 }), category, lifeTheme,
    date: parseDate(body.date, 'date', { required: true }), participants: Math.max(0, Math.min(Number.parseInt(body.participants, 10) || 0, 10000)),
    description: optionalText(body.description, { max: 3000 }) || null, evidence: cleanAttachments(body.evidence, actor),
    loggedByProfileId: actor.profileId, loggedByName: actor.displayName ?? null,
  });
  pushHistory(a, actor, 'SUBMITTED');
  await a.save();
  return (await activityDtos([a.toObject()]))[0];
}

/**
 * Verifies or rejects an activity. Points exist only after this, and the
 * person who logged the activity can never be the one who verifies it.
 */
export async function decideActivity(actor, scope, id, body = {}) {
  requireProfile(actor);
  const a = await EcoActivity.findById(assertObjectId(id));
  if (!a) throw new AppError('Activity not found', 404);
  await loadTeam(actor, scope, a.teamId);
  if (a.status !== 'SUBMITTED') throw new AppError(`This activity is already ${a.status.toLowerCase()}.`, 409, [], 'ALREADY_DECIDED');
  if (String(a.loggedByProfileId) === String(actor.profileId)) throw new AppError('Someone other than the person who logged it must verify this activity.', 403, [], 'SELF_VERIFY');
  const decision = oneOf(body.decision, ['VERIFY', 'REJECT'], 'decision');
  if (decision === 'VERIFY') {
    if (!a.evidence.length && !body.evidenceSeen) throw new AppError('Add evidence (photos, a sign-in sheet) before verifying, or confirm you saw it in person.', 400, [], 'EVIDENCE_REQUIRED');
    const pts = body.points === undefined || body.points === '' ? DEFAULT_POINTS[a.category] ?? 3 : Number.parseInt(body.points, 10);
    if (!Number.isInteger(pts) || pts < 0 || pts > MAX_POINTS) throw new AppError(`points must be a whole number from 0 to ${MAX_POINTS}`, 400);
    a.status = 'VERIFIED'; a.points = pts;
  } else {
    a.status = 'REJECTED'; a.points = 0;
    a.decisionNote = requireText(body.note, 'note (the reason)', { max: 1000 });
  }
  if (decision === 'VERIFY' && body.note) a.decisionNote = optionalText(body.note, { max: 1000 });
  a.verifiedByProfileId = actor.profileId; a.verifiedByName = actor.displayName ?? null; a.verifiedAt = new Date();
  pushHistory(a, actor, decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED', { note: a.decisionNote });
  await a.save();
  return (await activityDtos([a.toObject()]))[0];
}

/** The class a student (or a parent's children) belongs to, for highlighting on the board. */
async function familySectionIds(actor) {
  let studentIds = [];
  if (actor?.roleKey === 'STUDENT') { const id = await getOwnStudentId(actor.profileId); if (id) studentIds = [id]; }
  else if (actor?.roleKey === 'PARENT') studentIds = await getGuardianStudentIds(actor.profileId);
  if (!studentIds.length) return [];
  const rows = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId').lean();
  return rows.map((r) => String(r.sectionId));
}

/**
 * The eco-points board: verified points per team and the school's total.
 * Readable by students and parents. It carries team names and point totals
 * only — no individual pupils, no evidence files.
 */
export async function ecoPoints(actor) {
  const teams = await EcoTeam.find({ active: true }).lean();
  const verified = await EcoActivity.find({ status: 'VERIFIED' }).select('teamId points category date title').lean();
  const byTeam = new Map();
  for (const a of verified) {
    const k = String(a.teamId);
    const t = byTeam.get(k) ?? { points: 0, activities: 0 };
    t.points += a.points; t.activities += 1; byTeam.set(k, t);
  }
  const mine = new Set(await familySectionIds(actor));
  const dtos = await teamDtos(teams);
  const rows = dtos.map((t) => ({
    id: t.id, kind: t.kind, name: t.name, sectionLabel: t.sectionLabel,
    points: byTeam.get(t.id)?.points ?? 0, activities: byTeam.get(t.id)?.activities ?? 0,
    mine: Boolean(t.sectionId && mine.has(String(t.sectionId))),
  })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const recent = (await activityDtos(verified.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10)))
    .map((a) => ({ id: a.id, title: a.title, teamName: a.teamName, category: a.category, points: a.points, date: a.date }));
  return {
    schoolPoints: rows.reduce((s, r) => s + r.points, 0),
    verifiedActivities: verified.length,
    teams: rows,
    recent,
    note: 'Points count only activities a staff member has verified.',
  };
}

// ── figures (shared with the overview, analytics and the evidence packs) ─

export async function onRollCount() {
  return Enrollment.countDocuments({ status: 'ACTIVE' });
}

/** Months (`YYYY-MM`) whose first day lies in [start, end). */
function monthsIn(period) {
  const out = [];
  const a = localDate(period.start); const b = localDate(new Date(period.end.getTime() - 1));
  let y = a.y; let m = a.m;
  if (a.d !== 1) { m += 1; if (m > 12) { m = 1; y += 1; } }
  while (y < b.y || (y === b.y && m <= b.m)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}

export async function figures(period) {
  const [waste, plants, meters, students] = await Promise.all([
    WasteLog.find({ date: { $gte: period.start, $lt: period.end } }).select('stream weightGrams segregated destination').lean(),
    Plant.find({ plantedOn: { $lt: period.end } }).select('count status plantedOn').lean(),
    MeterReading.find({ period: { $in: monthsIn(period) } }).select('kind quantity unit period').lean(),
    onRollCount(),
  ]);
  const byStream = Object.fromEntries(WASTE_STREAMS.map((s) => [s, 0]));
  let total = 0; let segregated = 0; let composted = 0;
  for (const w of waste) { byStream[w.stream] += w.weightGrams; total += w.weightGrams; if (w.segregated) segregated += w.weightGrams; if (w.destination === 'COMPOST') composted += w.weightGrams; }
  const planted = plants.reduce((s, p) => s + (p.count ?? 1), 0);
  const alive = plants.filter((p) => p.status === 'ALIVE' || p.status === 'NEEDS_CARE').reduce((s, p) => s + (p.count ?? 1), 0);
  const meterTotals = Object.fromEntries(METER_KINDS.map((k) => [k, 0]));
  const meterMonths = Object.fromEntries(METER_KINDS.map((k) => [k, new Set()]));
  for (const r of meters) { meterTotals[r.kind] += r.quantity; meterMonths[r.kind].add(r.period); }
  const per = (v) => (students > 0 ? Math.round((v / students) * 1000) / 1000 : null);
  return {
    period: { from: period.from, to: period.to, label: period.label },
    students,
    waste: {
      totalKg: kg(total), byStreamKg: Object.fromEntries(Object.entries(byStream).map(([k, v]) => [k, kg(v)])), records: waste.length,
      segregationPct: pct(segregated, total), compostedKg: kg(composted), perStudentKg: total ? per(total / GRAMS) : null,
    },
    trees: { planted, alive, survivalPct: pct(alive, planted), records: plants.length },
    water: { kL: meterTotals.WATER, months: meterMonths.WATER.size, perStudentKL: meterMonths.WATER.size ? per(meterTotals.WATER) : null, rainwaterHarvestedKL: meterTotals.RAINWATER_HARVESTED },
    energy: { kWh: meterTotals.ELECTRICITY, months: meterMonths.ELECTRICITY.size, perStudentKWh: meterMonths.ELECTRICITY.size ? per(meterTotals.ELECTRICITY) : null, solarKWh: meterTotals.SOLAR_GENERATED },
  };
}

export function periodFrom(query = {}) {
  return resolvePeriod({ preset: query.preset ?? (query.from && query.to ? 'custom' : 'academicYear'), from: query.from, to: query.to });
}

export async function overview(actor, scope, query = {}) {
  requireStaff(actor);
  const period = periodFrom(query);
  const own = await ownTeamIds(actor, scope);
  const [f, pendingVerification, duties, openSanitation] = await Promise.all([
    figures(period),
    EcoActivity.countDocuments({ status: 'SUBMITTED', ...(own === null ? {} : { teamId: { $in: own } }) }),
    SanitationDuty.countDocuments({ active: true }),
    DueItem.countDocuments({ sourceKey: { $regex: '^sanitation:' }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }),
  ]);
  return { ...f, pendingVerification, sanitation: { duties, openTasks: openSanitation }, canManageAll: scope === 'ALL', staff: isStaff(actor) };
}

