import { CpdEntry, CPD_MODES, NPST_AREAS } from '../../models/teaching.model.js';
import { TrainingSession } from '../../models/compliance.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, parseDate, requireText, optionalText, requireProfile, profilesWithRoles, startOfDayUtc } from '../ops/common.js';

/**
 * Continuing professional development hours.
 *
 * CBSE asks every teacher for at least 50 hours a year: 25 through CBSE or
 * government institutes (EXTERNAL) and 25 in-house or in a school complex
 * (IN_HOUSE), spread over the NPST areas (core values and ethics 12, knowledge
 * and practice 24, professional growth 14). The hours here are what the
 * teacher logs plus the in-house trainings the school's register shows they
 * attended (counted automatically, never twice). HR or the principal checks a
 * logged entry against its certificate; the teacher cannot verify their own.
 *
 * The targets are the school's reference figures, shown as progress, not a
 * judgement; the school can read them as it applies the circular.
 */

export const TARGETS = { total: 50, EXTERNAL: 25, IN_HOUSE: 25, areas: { CORE_VALUES: 12, KNOWLEDGE_PRACTICE: 24, PROFESSIONAL_GROWTH: 14 } };
export const AREA_LABELS = { CORE_VALUES: 'Core values and ethics', KNOWLEDGE_PRACTICE: 'Knowledge and practice', PROFESSIONAL_GROWTH: 'Professional growth and development' };
const TOPIC_AREA = { ACADEMIC: 'KNOWLEDGE_PRACTICE', INDUCTION: 'PROFESSIONAL_GROWTH', DATA_PROTECTION: 'PROFESSIONAL_GROWTH' };
const STAFF_ROLES = ['TEACHER', 'PRINCIPAL'];

const seesAll = (actor) => actor.permissions?.['staffleave.manage'] === 'ALL';

/** The CPD year: the current academic year, else April to March around `at`. */
export async function yearWindow(at = new Date()) {
  const ay = await AcademicYear.findOne({ isCurrent: true }).select('name startsOn endsOn').lean();
  if (ay) return { name: ay.name, from: startOfDayUtc(ay.startsOn), to: startOfDayUtc(ay.endsOn) };
  const y = at.getUTCMonth() >= 3 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return { name: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 2, 31)) };
}

async function trainingsAttended(profileIds, win) {
  const rows = await TrainingSession.find({
    status: 'COMPLETED', scheduledAt: { $gte: win.from, $lte: new Date(win.to.getTime() + 86_400_000) },
    participants: { $elemMatch: { profileId: { $in: profileIds }, status: 'ATTENDED' } },
  }).select('refNo title topic scheduledAt durationMinutes participants').lean();
  const out = new Map();
  for (const t of rows) {
    for (const p of t.participants) {
      if (p.status !== 'ATTENDED' || !profileIds.some((id) => String(id) === String(p.profileId))) continue;
      const k = String(p.profileId);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({
        id: `training:${t._id}`, source: 'TRAINING', title: t.title, provider: 'School training', mode: 'IN_HOUSE',
        area: TOPIC_AREA[t.topic] ?? 'CORE_VALUES', hours: Math.round(((t.durationMinutes ?? 60) / 60) * 10) / 10,
        date: t.scheduledAt.toISOString().slice(0, 10), verified: true, ref: t.refNo,
      });
    }
  }
  return out;
}

function presentEntry(e) {
  return {
    id: String(e._id), source: 'LOGGED', title: e.title, provider: e.provider ?? null, mode: e.mode, area: e.area, hours: e.hours,
    date: e.date.toISOString().slice(0, 10), online: Boolean(e.online), evidenceUrl: e.evidenceUrl ?? null, note: e.note ?? null,
    verified: Boolean(e.verifiedAt), verifiedAt: e.verifiedAt ?? null,
  };
}

export function summarise(entries) {
  const sum = (pred) => Math.round(entries.filter(pred).reduce((n, e) => n + e.hours, 0) * 10) / 10;
  const total = sum(() => true);
  const byMode = Object.fromEntries(CPD_MODES.map((m) => [m, sum((e) => e.mode === m)]));
  const byArea = NPST_AREAS.map((a) => ({ area: a, label: AREA_LABELS[a], hours: sum((e) => e.area === a), target: TARGETS.areas[a] }));
  const online = sum((e) => e.online);
  const gaps = [];
  if (total < TARGETS.total) gaps.push(`${Math.round((TARGETS.total - total) * 10) / 10} more hours to reach ${TARGETS.total}.`);
  for (const m of CPD_MODES) if (byMode[m] < TARGETS[m]) gaps.push(`${Math.round((TARGETS[m] - byMode[m]) * 10) / 10} more ${m === 'EXTERNAL' ? 'external (CBSE / government institute)' : 'in-house'} hours.`);
  for (const a of byArea) if (a.hours < a.target) gaps.push(`${Math.round((a.target - a.hours) * 10) / 10} more hours in ${a.label.toLowerCase()}.`);
  if (total && online === total) gaps.push('Every hour so far was online; include some in-person training.');
  return { total, target: TARGETS.total, pct: Math.min(100, Math.round((total / TARGETS.total) * 100)), byMode, targets: { EXTERNAL: TARGETS.EXTERNAL, IN_HOUSE: TARGETS.IN_HOUSE }, byArea, unverifiedHours: sum((e) => e.source === 'LOGGED' && !e.verified), gaps, met: gaps.length === 0 };
}

export async function mine(actor, query = {}) {
  requireProfile(actor);
  const profileId = query.profileId && seesAll(actor) ? assertObjectId(query.profileId, 'profileId') : String(actor.profileId);
  const win = await yearWindow();
  const [logged, trained] = await Promise.all([
    CpdEntry.find({ profileId, deletedAt: null, date: { $gte: win.from, $lte: win.to } }).sort({ date: -1 }).lean(),
    trainingsAttended([profileId], win),
  ]);
  const entries = [...logged.map(presentEntry), ...(trained.get(profileId) ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return { year: win.name, from: win.from.toISOString().slice(0, 10), to: win.to.toISOString().slice(0, 10), entries, summary: summarise(entries), areas: AREA_LABELS };
}

export async function add(actor, body = {}) {
  requireProfile(actor);
  const date = parseDate(body.date, 'date', { required: true });
  if (startOfDayUtc(date).getTime() > startOfDayUtc(new Date()).getTime()) throw new AppError('Log hours after the training, not before.', 400, [], 'FUTURE_CPD');
  const win = await yearWindow();
  if (date < win.from) throw new AppError(`Only hours from this CPD year (${win.name}, from ${win.from.toISOString().slice(0, 10)}) can be logged.`, 400, [], 'CPD_OLD_YEAR');
  const mode = String(body.mode ?? '').toUpperCase();
  if (!CPD_MODES.includes(mode)) throw new AppError(`mode must be one of ${CPD_MODES.join(', ')}`, 400);
  const area = String(body.area ?? '').toUpperCase();
  if (!NPST_AREAS.includes(area)) throw new AppError(`area must be one of ${NPST_AREAS.join(', ')}`, 400);
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours < 0.5 || hours > 100 || Math.round(hours * 2) !== hours * 2) throw new AppError('hours must be 0.5 to 100, in half hours.', 400, [], 'BAD_HOURS');
  const evidenceUrl = optionalText(body.evidenceUrl, { max: 500 }) || null;
  if (evidenceUrl && !/^https:\/\//i.test(evidenceUrl) && !evidenceUrl.startsWith('/uploads/')) throw new AppError('The certificate link must be an https:// address or an uploaded file.', 400, [], 'BAD_EVIDENCE');
  const e = await CpdEntry.create({
    profileId: actor.profileId, title: requireText(body.title, 'title', { max: 200 }), provider: optionalText(body.provider, { max: 200 }) || null,
    mode, area, hours, date: startOfDayUtc(date), online: body.online === true, evidenceUrl, note: optionalText(body.note, { max: 1000 }) || null,
  });
  return presentEntry(e.toObject());
}

export async function remove(actor, id) {
  requireProfile(actor);
  const e = await CpdEntry.findById(assertObjectId(id));
  if (!e || e.deletedAt || String(e.profileId) !== String(actor.profileId)) throw new AppError('Entry not found', 404);
  if (e.verifiedAt) throw new AppError('A verified entry stays on record; ask HR to correct it.', 409, [], 'CPD_VERIFIED');
  e.deletedAt = new Date();
  await e.save();
  return { removed: true };
}

export async function verify(actor, id) {
  requireProfile(actor);
  if (!seesAll(actor)) throw new AppError('Verifying CPD hours is for HR or the principal.', 403);
  const e = await CpdEntry.findById(assertObjectId(id));
  if (!e || e.deletedAt) throw new AppError('Entry not found', 404);
  if (String(e.profileId) === String(actor.profileId)) throw new AppError('Someone else verifies your own hours.', 403, [], 'SELF_VERIFY');
  e.verifiedAt = new Date(); e.verifiedByProfileId = actor.profileId;
  await e.save();
  return presentEntry(e.toObject());
}

/** HR / principal: every teacher's hours this year, those furthest behind first. */
export async function overview(actor) {
  requireProfile(actor);
  if (!seesAll(actor)) throw new AppError('The staff CPD overview is for HR or the principal.', 403);
  const win = await yearWindow();
  const staff = await profilesWithRoles(STAFF_ROLES);
  const ids = staff.map((p) => String(p._id));
  const [logged, trained] = await Promise.all([
    CpdEntry.find({ profileId: { $in: ids }, deletedAt: null, date: { $gte: win.from, $lte: win.to } }).lean(),
    trainingsAttended(ids, win),
  ]);
  const by = new Map(ids.map((id) => [id, []]));
  for (const e of logged) by.get(String(e.profileId))?.push(presentEntry(e));
  for (const [k, list] of trained) by.get(k)?.push(...list);
  const rows = staff.map((p) => {
    const s = summarise(by.get(String(p._id)) ?? []);
    return { profileId: String(p._id), name: p.displayName, role: p.roleId?.key ?? null, total: s.total, external: s.byMode.EXTERNAL, inHouse: s.byMode.IN_HOUSE, unverifiedHours: s.unverifiedHours, met: s.met, pct: s.pct };
  }).sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  const pending = logged.filter((e) => !e.verifiedAt).map((e) => ({ ...presentEntry(e), name: staff.find((p) => String(p._id) === String(e.profileId))?.displayName ?? null })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  return { year: win.name, rows, pendingVerification: pending, totals: { staff: rows.length, met: rows.filter((r) => r.met).length, under25: rows.filter((r) => r.total < 25).length }, targets: TARGETS };
}
