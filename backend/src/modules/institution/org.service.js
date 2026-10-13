import { OrgUnit, Position, Appointment } from '../../models/institution.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, dto, oneOf, optionalText, parseDate, requireText } from '../ops/common.js';

/**
 * Organisation structure: units → positions → appointed people.
 *
 * The chart is computed from these records on every read, so it is never out
 * of date: appoint someone and they appear; end the appointment and the
 * position shows as vacant; deactivate the profile and the chart flags it.
 * Personnel data beyond name and role (salary, contact, documents) is never
 * part of the chart.
 */

const UNIT_KINDS = ['GOVERNING_BODY', 'LEADERSHIP', 'DEPARTMENT', 'TEAM', 'COMMITTEE'];
const STAFF_ROLES = ['PRINCIPAL', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'TRUSTEE'];

function activeAt(a, at = new Date()) {
  return (!a.effectiveFrom || new Date(a.effectiveFrom) <= at) && (!a.effectiveTo || new Date(a.effectiveTo) >= at);
}

async function assertNoUnitCycle(unitId, parentId) {
  let cursor = parentId ? String(parentId) : null;
  const seen = new Set([String(unitId)]);
  for (let i = 0; cursor && i < 100; i++) {
    if (seen.has(cursor)) throw new AppError('That parent would make the unit its own ancestor.', 400, [], 'ORG_CYCLE');
    seen.add(cursor);
    // eslint-disable-next-line no-await-in-loop
    const parent = await OrgUnit.findById(cursor).select('parentId').lean();
    if (!parent) throw new AppError('Parent unit not found', 404);
    cursor = parent.parentId ? String(parent.parentId) : null;
  }
}

async function assertNoReportingCycle(positionId, reportsTo) {
  let cursor = reportsTo ? String(reportsTo) : null;
  const seen = new Set([String(positionId)]);
  for (let i = 0; cursor && i < 200; i++) {
    if (seen.has(cursor)) throw new AppError('That reporting line would loop back to this position.', 400, [], 'ORG_CYCLE');
    seen.add(cursor);
    // eslint-disable-next-line no-await-in-loop
    const p = await Position.findById(cursor).select('reportsToPositionId').lean();
    if (!p) throw new AppError('Reporting position not found', 404);
    cursor = p.reportsToPositionId ? String(p.reportsToPositionId) : null;
  }
}

export async function createUnit(body = {}) {
  const unit = new OrgUnit({
    name: requireText(body.name, 'name', { max: 120 }),
    kind: oneOf(body.kind, UNIT_KINDS, 'kind'),
    code: optionalText(body.code, { max: 20 }) || null,
    campusCode: optionalText(body.campusCode, { max: 20 }) || null,
    description: optionalText(body.description, { max: 1000 }) || null,
    order: Number.isInteger(Number(body.order)) ? Number(body.order) : 0,
  });
  if (body.parentId) {
    unit.parentId = assertObjectId(body.parentId, 'parentId');
    await assertNoUnitCycle(unit._id, unit.parentId);
  }
  await unit.save();
  return dto(unit);
}

export async function updateUnit(id, body = {}) {
  const unit = await OrgUnit.findById(assertObjectId(id));
  if (!unit) throw new AppError('Unit not found', 404);
  if (body.name !== undefined) unit.name = requireText(body.name, 'name', { max: 120 });
  if (body.kind !== undefined) unit.kind = oneOf(body.kind, UNIT_KINDS, 'kind');
  if (body.description !== undefined) unit.description = optionalText(body.description, { max: 1000 }) || null;
  if (body.order !== undefined) unit.order = Number(body.order) || 0;
  if (body.parentId !== undefined) {
    const parentId = body.parentId ? assertObjectId(body.parentId, 'parentId') : null;
    if (parentId) await assertNoUnitCycle(unit._id, parentId);
    unit.parentId = parentId;
  }
  await unit.save();
  return dto(unit);
}

export async function deleteUnit(id) {
  const unitId = assertObjectId(id);
  const [children, positions] = await Promise.all([OrgUnit.countDocuments({ parentId: unitId }), Position.countDocuments({ orgUnitId: unitId })]);
  if (children || positions) throw new AppError('Move or remove this unit\'s sub-units and positions first.', 409, [], 'ORG_NOT_EMPTY');
  await OrgUnit.deleteOne({ _id: unitId });
  return { deleted: true };
}

export async function createPosition(body = {}) {
  const unitId = assertObjectId(body.orgUnitId, 'orgUnitId');
  if (!(await OrgUnit.exists({ _id: unitId }))) throw new AppError('Unit not found', 404);
  const pos = new Position({
    title: requireText(body.title, 'title', { max: 120 }),
    orgUnitId: unitId,
    roleKey: body.roleKey ? oneOf(body.roleKey, STAFF_ROLES, 'roleKey') : null,
    sanctioned: Math.max(0, Math.min(Number.parseInt(body.sanctioned, 10) || 1, 500)),
    isHead: body.isHead === true,
    order: Number(body.order) || 0,
  });
  if (body.reportsToPositionId) {
    pos.reportsToPositionId = assertObjectId(body.reportsToPositionId, 'reportsToPositionId');
    await assertNoReportingCycle(pos._id, pos.reportsToPositionId);
  }
  if (Array.isArray(body.dottedLineToPositionIds)) {
    pos.dottedLineToPositionIds = body.dottedLineToPositionIds.map((x) => assertObjectId(x, 'dottedLineToPositionIds')).filter((x) => x !== String(pos._id));
  }
  await pos.save();
  return dto(pos);
}

export async function updatePosition(id, body = {}) {
  const pos = await Position.findById(assertObjectId(id));
  if (!pos) throw new AppError('Position not found', 404);
  if (body.title !== undefined) pos.title = requireText(body.title, 'title', { max: 120 });
  if (body.sanctioned !== undefined) pos.sanctioned = Math.max(0, Math.min(Number.parseInt(body.sanctioned, 10) || 0, 500));
  if (body.isHead !== undefined) pos.isHead = body.isHead === true;
  if (body.roleKey !== undefined) pos.roleKey = body.roleKey ? oneOf(body.roleKey, STAFF_ROLES, 'roleKey') : null;
  if (body.orgUnitId !== undefined) {
    const unitId = assertObjectId(body.orgUnitId, 'orgUnitId');
    if (!(await OrgUnit.exists({ _id: unitId }))) throw new AppError('Unit not found', 404);
    pos.orgUnitId = unitId;
  }
  if (body.reportsToPositionId !== undefined) {
    const to = body.reportsToPositionId ? assertObjectId(body.reportsToPositionId, 'reportsToPositionId') : null;
    if (to) await assertNoReportingCycle(pos._id, to);
    pos.reportsToPositionId = to;
  }
  if (Array.isArray(body.dottedLineToPositionIds)) {
    pos.dottedLineToPositionIds = body.dottedLineToPositionIds.map((x) => assertObjectId(x)).filter((x) => x !== String(pos._id));
  }
  await pos.save();
  return dto(pos);
}

export async function deletePosition(id) {
  const posId = assertObjectId(id);
  const [reports, active] = await Promise.all([
    Position.countDocuments({ reportsToPositionId: posId }),
    Appointment.countDocuments({ positionId: posId, $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }] }),
  ]);
  if (reports || active) throw new AppError('Reassign the people and reporting lines of this position first.', 409, [], 'ORG_NOT_EMPTY');
  await Position.deleteOne({ _id: posId });
  return { deleted: true };
}

export async function appoint(body = {}) {
  const positionId = assertObjectId(body.positionId, 'positionId');
  const profileId = assertObjectId(body.profileId, 'profileId');
  const tenantId = currentTenantId();
  const [pos, person] = await Promise.all([
    Position.findById(positionId).lean(),
    Profile.findOne({ _id: profileId, deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('_id').lean(),
  ]);
  if (!pos) throw new AppError('Position not found', 404);
  if (!person) throw new AppError('Person not found in this school', 404);
  const dup = await Appointment.findOne({ positionId, profileId, $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }] }).lean();
  if (dup) throw new AppError('This person already holds this position.', 409);
  const a = await Appointment.create({
    positionId, profileId,
    kind: oneOf(body.kind, ['PRIMARY', 'ADDITIONAL', 'ACTING'], 'kind', 'PRIMARY'),
    effectiveFrom: parseDate(body.effectiveFrom, 'effectiveFrom') ?? new Date(),
    effectiveTo: parseDate(body.effectiveTo, 'effectiveTo'),
    note: optionalText(body.note, { max: 500 }) || null,
  });
  return dto(a);
}

export async function endAppointment(id, body = {}) {
  const a = await Appointment.findById(assertObjectId(id));
  if (!a) throw new AppError('Appointment not found', 404);
  a.effectiveTo = parseDate(body.effectiveTo, 'effectiveTo') ?? new Date();
  await a.save();
  return dto(a);
}

/**
 * The chart. Units nested by parent; each with its positions, each with its
 * current holders, vacancies and reporting lines; plus the staff who hold a
 * role but no position ("unplaced"), so the chart's gaps are visible.
 */
export async function chart() {
  const tenantId = currentTenantId();
  const [units, positions, appointments, roles] = await Promise.all([
    OrgUnit.find({}).sort({ order: 1, name: 1 }).lean(),
    Position.find({}).sort({ order: 1, title: 1 }).lean(),
    Appointment.find({}).lean(),
    Role.find({ key: { $in: STAFF_ROLES } }).select('_id key name').lean(),
  ]);
  const roleById = new Map(roles.map((r) => [String(r._id), r]));
  const staff = await Profile.find({ roleId: { $in: roles.map((r) => r._id) }, deletedAt: null, ...(tenantId ? { tenantId } : {}) })
    .select('_id displayName roleId status').lean();
  const personById = new Map(staff.map((p) => [String(p._id), p]));
  const current = appointments.filter((a) => activeAt(a));
  const placed = new Set(current.map((a) => String(a.profileId)));

  const posDtos = positions.map((p) => {
    const holders = current.filter((a) => String(a.positionId) === String(p._id)).map((a) => {
      const person = personById.get(String(a.profileId));
      return {
        appointmentId: String(a._id),
        profileId: String(a.profileId),
        name: person?.displayName ?? 'Former staff member',
        roleKey: person ? roleById.get(String(person.roleId))?.key ?? null : null,
        kind: a.kind,
        since: a.effectiveFrom,
        until: a.effectiveTo,
        // A person who left but whose appointment was not ended is a data problem worth showing.
        flagged: !person || person.status !== 'ACTIVE',
      };
    });
    return {
      id: String(p._id), title: p.title, orgUnitId: String(p.orgUnitId), roleKey: p.roleKey, isHead: p.isHead,
      reportsToPositionId: p.reportsToPositionId ? String(p.reportsToPositionId) : null,
      dottedLineToPositionIds: (p.dottedLineToPositionIds ?? []).map(String),
      sanctioned: p.sanctioned, holders, vacancies: Math.max(0, p.sanctioned - holders.length),
    };
  });

  const byParent = new Map();
  for (const u of units) {
    const key = u.parentId ? String(u.parentId) : 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(u);
  }
  const build = (u, depth = 0) => ({
    id: String(u._id), name: u.name, kind: u.kind, code: u.code, description: u.description, campusCode: u.campusCode,
    positions: posDtos.filter((p) => p.orgUnitId === String(u._id)),
    children: depth > 20 ? [] : (byParent.get(String(u._id)) ?? []).map((c) => build(c, depth + 1)),
  });
  const tree = (byParent.get('root') ?? []).map((u) => build(u));

  const unplaced = staff.filter((p) => p.status === 'ACTIVE' && !placed.has(String(p._id)))
    .map((p) => ({ profileId: String(p._id), name: p.displayName, roleKey: roleById.get(String(p.roleId))?.key ?? null }));

  return {
    tree,
    positions: posDtos,
    stats: {
      units: units.length,
      positions: positions.length,
      sanctioned: posDtos.reduce((n, p) => n + p.sanctioned, 0),
      filled: posDtos.reduce((n, p) => n + p.holders.length, 0),
      vacancies: posDtos.reduce((n, p) => n + p.vacancies, 0),
      unplaced: unplaced.length,
      flagged: posDtos.reduce((n, p) => n + p.holders.filter((h) => h.flagged).length, 0),
    },
    unplaced,
  };
}

/**
 * Starts a chart from the records the school already has: the standard
 * governance, leadership and department units, a position per staff role, and
 * every current role holder appointed to it. Only runs on an empty structure;
 * afterwards the chart is edited, not regenerated.
 */
export async function bootstrap(institutionType = 'SCHOOL') {
  if (await OrgUnit.exists({})) throw new AppError('The structure already exists; edit it instead.', 409, [], 'ORG_EXISTS');
  const college = institutionType === 'COLLEGE';
  const mk = (name, kind, parentId = null, order = 0) => OrgUnit.create({ name, kind, parentId, order });
  const gov = await mk(college ? 'Governing Body' : 'Board of Trustees / School Management Committee', 'GOVERNING_BODY');
  const lead = await mk('Institution Leadership', 'LEADERSHIP', gov._id, 1);
  const depts = {
    ADMIN: await mk('Administration', 'DEPARTMENT', lead._id, 1),
    FINANCE: await mk('Finance & Accounts', 'DEPARTMENT', lead._id, 2),
    HR: await mk('Human Resources', 'DEPARTMENT', lead._id, 3),
    MARKETING: await mk('Marketing & Admissions', 'DEPARTMENT', lead._id, 4),
    COMPLIANCE: await mk('Compliance & Safeguarding', 'DEPARTMENT', lead._id, 5),
    TEACHER: await mk(college ? 'Academic Departments' : 'Academics', 'DEPARTMENT', lead._id, 6),
    LIBRARIAN: await mk('Library', 'DEPARTMENT', lead._id, 7),
    WARDEN: await mk('Hostel', 'DEPARTMENT', lead._id, 8),
  };
  const trusteePos = await Position.create({ title: college ? 'Governing Body Member' : 'Trustee', orgUnitId: gov._id, roleKey: 'TRUSTEE', sanctioned: 5 });
  const headPos = await Position.create({ title: college ? 'Principal / Director' : 'Principal', orgUnitId: lead._id, roleKey: 'PRINCIPAL', isHead: true, sanctioned: 1, reportsToPositionId: trusteePos._id });
  const titles = { ADMIN: 'Administrative Officer', FINANCE: 'Accounts Officer', HR: 'HR Manager', MARKETING: 'Admissions Manager', COMPLIANCE: 'Compliance & Safeguarding Officer', TEACHER: college ? 'Faculty' : 'Teacher', LIBRARIAN: 'Librarian', WARDEN: 'Hostel Warden' };

  const roles = await Role.find({ key: { $in: STAFF_ROLES } }).select('_id key').lean();
  const tenantId = currentTenantId();
  const people = await Profile.find({ roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('_id roleId').lean();
  const keyOf = new Map(roles.map((r) => [String(r._id), r.key]));
  const holdersOf = (key) => people.filter((p) => keyOf.get(String(p.roleId)) === key);

  const positionFor = { TRUSTEE: trusteePos, PRINCIPAL: headPos };
  for (const [key, unit] of Object.entries(depts)) {
    // eslint-disable-next-line no-await-in-loop
    positionFor[key] = await Position.create({
      title: titles[key], orgUnitId: unit._id, roleKey: key, reportsToPositionId: headPos._id, isHead: key !== 'TEACHER',
      sanctioned: Math.max(1, holdersOf(key).length),
    });
  }
  // Sanction for trustees reflects the people actually on record, if more than the default.
  if (holdersOf('TRUSTEE').length > trusteePos.sanctioned) {
    await Position.updateOne({ _id: trusteePos._id }, { $set: { sanctioned: holdersOf('TRUSTEE').length } });
  }
  const appts = [];
  for (const [key, pos] of Object.entries(positionFor)) {
    for (const p of holdersOf(key)) appts.push({ positionId: pos._id, profileId: p._id, kind: 'PRIMARY' });
  }
  if (appts.length) await Appointment.insertMany(appts);
  return chart();
}

/** Staff who can be appointed (for pickers): name and role only. */
export async function appointableStaff() {
  const tenantId = currentTenantId();
  const roles = await Role.find({ key: { $in: STAFF_ROLES } }).select('_id key').lean();
  const keyOf = new Map(roles.map((r) => [String(r._id), r.key]));
  const rows = await Profile.find({ roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) })
    .select('_id displayName roleId').sort({ displayName: 1 }).limit(2000).lean();
  return rows.map((p) => ({ profileId: String(p._id), name: p.displayName, roleKey: keyOf.get(String(p.roleId)) ?? null }));
}
