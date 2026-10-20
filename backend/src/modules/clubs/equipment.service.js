import { Club, ClubMembership, ClubEquipment, EquipmentIssue } from '../../models/club.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { assertObjectId, requireProfile, requireText, optionalText, oneOf, parseDate } from '../ops/common.js';
import { isCoach, managedClubIds, studentName } from './clubs.access.js';

/**
 * Sports and arts kit lent to students: bats, balls, costumes, instruments.
 * Stock moves with one conditional update (availableQty >= qty), so two
 * issues at once can never lend the same last item twice. An issue with a
 * return date is a task for the teacher who lent it until it comes back.
 */

function toQty(v, label = 'qty', max = 1000) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new AppError(`${label} must be a whole number from 1 to ${max}`, 400);
  return n;
}

async function assertKitAccess(actor, scope, item) {
  if (scope === 'ALL') return;
  if (!item.clubId) throw new AppError('Only administration manages shared kit.', 403, [], 'NOT_CLUB_COACH');
  const club = await Club.findById(item.clubId).select('coachProfileIds').lean();
  if (!isCoach(club, actor)) throw new AppError('You are not in charge of this club.', 403, [], 'NOT_CLUB_COACH');
}

export async function listEquipment(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await managedClubIds(actor, scope);
  const filter = ids === null ? {} : { clubId: { $in: ids } };
  if (query.clubId) filter.clubId = assertObjectId(query.clubId, 'clubId');
  const rows = await ClubEquipment.find(filter).sort({ name: 1 }).limit(500).lean();
  const clubs = new Map((await Club.find({ _id: { $in: rows.map((r) => r.clubId).filter(Boolean) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
  return rows.map((r) => ({ id: String(r._id), code: r.code, name: r.name, clubId: r.clubId ? String(r.clubId) : null, clubName: clubs.get(String(r.clubId)) ?? null, totalQty: r.totalQty, availableQty: r.availableQty, issuedQty: r.totalQty - r.availableQty, notes: r.notes ?? null }));
}

export async function addEquipment(actor, scope, body = {}) {
  requireProfile(actor);
  const clubId = body.clubId ? assertObjectId(body.clubId, 'clubId') : null;
  await assertKitAccess(actor, scope, { clubId });
  const qty = toQty(body.totalQty, 'totalQty', 10_000);
  const name = requireText(body.name, 'name', { max: 120 });
  const item = await ClubEquipment.create({
    code: (optionalText(body.code, { max: 30 }) || `${name.slice(0, 10)}-${Date.now().toString(36).slice(-4)}`).toUpperCase().replace(/[^A-Z0-9-]+/g, '-'),
    name, clubId, totalQty: qty, availableQty: qty, notes: optionalText(body.notes, { max: 300 }) || null,
  }).catch((err) => { if (err?.code === 11000) throw new AppError('That code is in use.', 409, [], 'DUPLICATE_CODE'); throw err; });
  return (await listEquipment(actor, 'ALL', { clubId: clubId ?? undefined })).find((x) => x.id === String(item._id));
}

/** Lends kit to a student. Club kit goes to the club's current members. */
export async function issue(actor, scope, body = {}) {
  requireProfile(actor);
  const item = await ClubEquipment.findById(assertObjectId(body.equipmentId, 'equipmentId'));
  if (!item) throw new AppError('Equipment not found', 404);
  await assertKitAccess(actor, scope, item);
  const studentId = assertObjectId(body.studentId, 'studentId');
  const student = await Student.findOne({ _id: studentId, deletedAt: null }).select('firstName lastName').lean();
  if (!student) throw new AppError('Student not found', 404);
  if (item.clubId && !(await ClubMembership.exists({ clubId: item.clubId, studentId, status: 'ACTIVE' }))) {
    throw new AppError('Club kit is lent to members of the club.', 409, [], 'NOT_A_MEMBER');
  }
  const qty = toQty(body.qty ?? 1);
  const dueAt = parseDate(body.dueAt, 'dueAt');
  if (dueAt && dueAt <= new Date()) throw new AppError('The return date must be in the future.', 400);
  const taken = await ClubEquipment.findOneAndUpdate({ _id: item._id, availableQty: { $gte: qty } }, { $inc: { availableQty: -qty } }, { new: true });
  if (!taken) throw new AppError(`Only ${item.availableQty} of ${item.name} available.`, 409, [], 'NOT_ENOUGH_STOCK');
  const row = await EquipmentIssue.create({ equipmentId: item._id, studentId, clubId: item.clubId, qty, dueAt, issuedByProfileId: actor.profileId });
  if (dueAt) {
    await upsertFromSource({
      sourceKey: `clubs:kit:${row._id}:return`, title: `Kit to come back: ${qty} × ${item.name} from ${studentName(student)}`,
      department: 'ENGAGEMENT', category: 'OTHER', dueAt, ownerProfileId: actor.profileId,
      source: { entityType: 'EquipmentIssue', entityId: row._id, link: '/clubs' }, leadDays: [0],
    });
  }
  await recordAudit({ actor, action: 'clubs.kit.issued', entityType: 'EquipmentIssue', entityId: row._id, after: { qty, equipment: item.name } });
  return issueDto(row.toObject(), new Map([[String(item._id), item]]), new Map([[String(studentId), student]]));
}

/** Back in (good or damaged), or written off as lost. Lost kit does not return to stock. */
export async function returnIssue(actor, scope, id, body = {}) {
  requireProfile(actor);
  const row = await EquipmentIssue.findById(assertObjectId(id));
  if (!row) throw new AppError('Issue not found', 404);
  const item = await ClubEquipment.findById(row.equipmentId);
  await assertKitAccess(actor, scope, item ?? { clubId: row.clubId });
  const outcome = oneOf(body.outcome ?? 'RETURNED', ['RETURNED', 'LOST'], 'outcome');
  const closed = await EquipmentIssue.findOneAndUpdate(
    { _id: row._id, status: 'ISSUED' },
    { $set: {
      status: outcome, returnedAt: new Date(), receivedByProfileId: actor.profileId,
      returnCondition: outcome === 'RETURNED' ? oneOf(body.condition ?? 'GOOD', ['GOOD', 'DAMAGED'], 'condition') : null,
      returnNote: optionalText(body.note, { max: 300 }) || null,
    } },
    { new: true },
  );
  if (!closed) throw new AppError('This kit is already back.', 409, [], 'ALREADY_RETURNED');
  if (outcome === 'RETURNED') await ClubEquipment.updateOne({ _id: row.equipmentId }, { $inc: { availableQty: row.qty } });
  else await ClubEquipment.updateOne({ _id: row.equipmentId, totalQty: { $gte: row.qty } }, { $inc: { totalQty: -row.qty } });
  await resolveSource(`clubs:kit:${row._id}:return`, { note: outcome === 'RETURNED' ? 'Returned' : 'Written off as lost' });
  await recordAudit({ actor, action: `clubs.kit.${outcome.toLowerCase()}`, entityType: 'EquipmentIssue', entityId: row._id, after: { status: outcome } });
  return issueDto(closed.toObject(), new Map([[String(row.equipmentId), item]]), new Map());
}

function issueDto(r, items, students) {
  const s = students.get(String(r.studentId));
  const now = Date.now();
  return {
    id: String(r._id), equipmentId: String(r.equipmentId), equipmentName: items.get(String(r.equipmentId))?.name ?? null,
    studentId: String(r.studentId), studentName: s ? studentName(s) : null, qty: r.qty, issuedAt: r.issuedAt, dueAt: r.dueAt ?? null,
    status: r.status, overdue: r.status === 'ISSUED' && r.dueAt ? new Date(r.dueAt).getTime() < now : false,
    returnedAt: r.returnedAt ?? null, returnCondition: r.returnCondition ?? null, returnNote: r.returnNote ?? null,
  };
}

export async function listIssues(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await managedClubIds(actor, scope);
  const filter = ids === null ? {} : { clubId: { $in: ids } };
  if (query.status) filter.status = oneOf(query.status, ['ISSUED', 'RETURNED', 'LOST'], 'status');
  if (query.equipmentId) filter.equipmentId = assertObjectId(query.equipmentId, 'equipmentId');
  const rows = await EquipmentIssue.find(filter).sort({ status: 1, issuedAt: -1 }).limit(500).lean();
  const items = new Map((await ClubEquipment.find({ _id: { $in: rows.map((r) => r.equipmentId) } }).select('name').lean()).map((i) => [String(i._id), i]));
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), s]));
  return rows.map((r) => issueDto(r, items, students));
}
