import { AttendanceDraft } from '../../models/attendanceDraft.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertMarkAccess, parseDateToMidnight } from './attendance.service.js';

/**
 * Server-side drafts for attendance flashcards.
 *
 * A draft belongs to one teacher for one register (section, date, period). It
 * is checked against the same slot authorization as marking itself, so a
 * draft cannot be used to stage a register the teacher could not submit.
 *
 * Saves are optimistic: the client sends the version it last saw, and a save
 * based on an older version (the same register open on two devices) is
 * refused, instead of one tab silently overwriting the other.
 */

const DRAFT_STATUSES = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

function key(actor, { sectionId, date, periodNo } = {}) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  if (!sectionId) throw new AppError('sectionId is required', 400);
  const day = parseDateToMidnight(date);
  if (!day) throw new AppError('A valid date is required', 400);
  const period = periodNo === null || periodNo === undefined || periodNo === '' ? null : Number(periodNo);
  if (period !== null && !Number.isInteger(period)) throw new AppError('periodNo must be a whole number', 400);
  return { sectionId: String(sectionId), date: day, periodNo: period, ownerProfileId: actor.profileId };
}

async function rosterIds(sectionId) {
  const rows = await Enrollment.find({ sectionId, status: 'ACTIVE' }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

function present(draft, currentRoster) {
  const started = new Set((draft.rosterEnrollmentIds ?? []).map(String));
  const now = new Set(currentRoster);
  const entries = (draft.entries ?? [])
    // A student who has left the section since the draft began is dropped:
    // marking them would be refused at submit anyway.
    .filter((e) => now.has(String(e.enrollmentId)))
    .map((e) => ({ enrollmentId: String(e.enrollmentId), status: e.status ?? null, passed: Boolean(e.passed), updatedAt: e.updatedAt }));
  return {
    id: String(draft._id),
    sectionId: String(draft.sectionId),
    date: draft.date.toISOString().slice(0, 10),
    periodNo: draft.periodNo,
    cursor: draft.cursor ?? 0,
    version: draft.version,
    updatedAt: draft.updatedAt,
    entries,
    rosterChanges: {
      added: currentRoster.filter((id) => !started.has(id)),
      removed: [...started].filter((id) => !now.has(id)),
    },
  };
}

export async function getDraft(actor, scope, query) {
  const k = key(actor, query);
  await assertMarkAccess(actor, scope, k.sectionId, k.periodNo, k.date);
  const draft = await AttendanceDraft.findOne(k).lean();
  if (!draft) return null;
  return present(draft, await rosterIds(k.sectionId));
}

export async function saveDraft(actor, scope, body = {}) {
  const k = key(actor, body);
  await assertMarkAccess(actor, scope, k.sectionId, k.periodNo, k.date);

  const roster = await rosterIds(k.sectionId);
  const inRoster = new Set(roster);
  const entries = [];
  const seen = new Set();
  for (const e of Array.isArray(body.entries) ? body.entries : []) {
    const id = String(e?.enrollmentId ?? '');
    if (!inRoster.has(id)) throw new AppError('One or more students do not belong to this section', 403);
    if (seen.has(id)) throw new AppError('The same student appears twice in the draft', 400);
    seen.add(id);
    const raw = e.status === null || e.status === undefined || e.status === '' ? null : String(e.status).toUpperCase();
    if (raw !== null && !DRAFT_STATUSES.has(raw)) throw new AppError(`Invalid status "${e.status}"`, 400);
    // A card is either decided or passed, never both: passing clears a status.
    const passed = Boolean(e.passed) && raw === null;
    entries.push({ enrollmentId: id, status: raw, passed, updatedAt: new Date() });
  }
  const cursor = Math.max(0, Math.min(Number.parseInt(body.cursor, 10) || 0, Math.max(roster.length - 1, 0)));
  const baseVersion = Number.parseInt(body.version, 10) || 0;

  const existing = await AttendanceDraft.findOne(k).lean();
  if (!existing) {
    if (baseVersion > 0) throw new AppError('This draft was submitted or discarded elsewhere.', 409, [], 'DRAFT_GONE');
    try {
      const created = await AttendanceDraft.create({ ...k, entries, cursor, rosterEnrollmentIds: roster, version: 1 });
      return present(created.toObject(), roster);
    } catch (err) {
      if (err?.code === 11000) throw new AppError('This register was just started on another device. Reload to continue.', 409, [], 'DRAFT_CONFLICT');
      throw err;
    }
  }
  if (baseVersion !== existing.version) {
    throw new AppError('This register was changed on another device. Reload to see the latest marks.', 409, [], 'DRAFT_CONFLICT');
  }
  const updated = await AttendanceDraft.findOneAndUpdate(
    { ...k, version: existing.version },
    { $set: { entries, cursor }, $inc: { version: 1 } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError('This register was changed on another device. Reload to see the latest marks.', 409, [], 'DRAFT_CONFLICT');
  return present(updated, roster);
}

export async function discardDraft(actor, scope, query) {
  const k = key(actor, query);
  await assertMarkAccess(actor, scope, k.sectionId, k.periodNo, k.date);
  const out = await AttendanceDraft.deleteOne(k);
  return { deleted: out.deletedCount };
}
