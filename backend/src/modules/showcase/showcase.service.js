import { ShowcaseSetting, ShowcaseEdition, ShowcaseEntry, ENTRY_CATEGORIES } from '../../models/showcase.model.js';
import { MediaConsent } from '../../models/community.model.js';
import { CoCurricularActivity } from '../../models/coCurricular.model.js';
import { Fixture } from '../../models/club.model.js';
import { Student } from '../../models/student.model.js';
import { Section, Grade } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import {
  assertObjectId, requireProfile, requireText, optionalText, oneOf, pushHistory, profileNames,
} from '../ops/common.js';
import { studentContext, studentName, FAMILY_ROLES } from '../clubs/clubs.access.js';
import { examRanks, withinCutoff } from './ranking.js';

/**
 * The achievement and top-ranker showcase.
 *
 * Rules this module enforces, whoever calls it:
 *  - Only holders of showcase.publish draft, review, publish and withdraw, and
 *    never a student, parent or alumnus, whatever their role was granted.
 *  - Ranks come only from published exam results (ranking.js, which also
 *    states the tie rule), and only ranks 1..cut-off are ever drawn, stored,
 *    published or shown. There is no endpoint that returns a full class list.
 *  - A child appears only with recorded media consent (INTERNAL or PUBLIC:
 *    the showcase is shown to signed-in members of the school). Consent is
 *    checked when drafting (shown as a warning), again at the moment of
 *    publishing (an entry without it is EXCLUDED, not published), and again on
 *    every read, so a consent withdrawn later hides the entry at once.
 *  - An entry is reviewed by someone other than the person who drafted it.
 *  - Families read the published showcase only.
 */

const ALLOWS = ['INTERNAL', 'PUBLIC'];

export function assertPublisher(actor) {
  requireProfile(actor);
  if (FAMILY_ROLES.includes(actor.roleKey)) {
    throw new AppError('Students and families cannot publish to the showcase.', 403, [], 'FAMILY_CANNOT_PUBLISH');
  }
  if (!actor.permissions?.['showcase.publish']) throw new AppError('Missing permission: showcase.publish', 403);
}

/** Students whose latest, unwithdrawn media consent allows the signed-in showcase. */
export async function consentedIds(studentIds) {
  const ids = [...new Set(studentIds.map(String))];
  if (!ids.length) return new Set();
  const rows = await MediaConsent.find({ studentId: { $in: ids }, withdrawnAt: null }).sort({ at: -1, _id: -1 }).lean();
  const latest = new Map();
  for (const r of rows) if (!latest.has(String(r.studentId))) latest.set(String(r.studentId), r.level);
  return new Set([...latest.entries()].filter(([, level]) => ALLOWS.includes(level)).map(([id]) => id));
}

export async function getSettings() {
  const s = await ShowcaseSetting.findOne({}).lean();
  return { rankCutoff: s?.rankCutoff ?? 3 };
}

export async function updateSettings(actor, body = {}) {
  assertPublisher(actor);
  const cutoff = Number.parseInt(body.rankCutoff, 10);
  if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > 10) throw new AppError('The cut-off is a rank from 1 to 10.', 400, [], 'BAD_CUTOFF');
  await ShowcaseSetting.updateOne({}, { $set: { rankCutoff: cutoff, updatedByProfileId: actor.profileId } }, { upsert: true });
  await recordAudit({ actor, action: 'showcase.settings.updated', entityType: 'ShowcaseSetting', after: { rankCutoff: cutoff } });
  return getSettings();
}

async function scopeLabel({ sectionId, gradeId }) {
  if (sectionId) {
    const s = await Section.findById(sectionId).populate('gradeId', 'name').lean();
    return s ? `${s.gradeId?.name ?? ''} ${s.name}`.trim() : 'Class';
  }
  const g = await Grade.findById(gradeId).select('name').lean();
  return g?.name ?? 'Grade';
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th'}`;

/**
 * The top ranks for an exam in a class or grade, for the person drafting:
 * ranks 1..cut-off only, with each child's consent shown.
 */
export async function rankPreview(actor, query = {}) {
  assertPublisher(actor);
  const { rankCutoff } = await getSettings();
  const { exam, scope, ranked, unranked } = await examRanks({ examId: query.examId, sectionId: query.sectionId || null, gradeId: query.sectionId ? null : (query.gradeId || null) });
  const top = withinCutoff(ranked, rankCutoff);
  const students = new Map((await Student.find({ _id: { $in: top.map((t) => t.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentName(s)]));
  const consent = await consentedIds(top.map((t) => t.studentId));
  const label = await scopeLabel({ sectionId: query.sectionId, gradeId: query.gradeId });
  return {
    exam: { id: String(exam._id), name: exam.name }, scope, label, rankCutoff,
    rows: top.map((t) => ({ studentId: t.studentId, name: students.get(t.studentId) ?? null, rank: t.rank, consent: consent.has(t.studentId) })),
    unranked,
    tieRule: 'Equal percentages (to two decimals) share a rank; the next rank skips (1, 1, 3). Only ranks up to the cut-off are shown.',
  };
}

// ── editions ───────────────────────────────────────────────────────────

async function loadEdition(id) {
  const e = await ShowcaseEdition.findById(assertObjectId(id, 'editionId'));
  if (!e) throw new AppError('Showcase not found', 404);
  return e;
}

export async function listEditions(actor) {
  assertPublisher(actor);
  const rows = await ShowcaseEdition.find({}).sort({ createdAt: -1 }).limit(100).lean();
  const counts = await ShowcaseEntry.aggregate([{ $match: { editionId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: { e: '$editionId', s: '$status' }, n: { $sum: 1 } } }]);
  const by = new Map(counts.map((c) => [`${c._id.e}:${c._id.s}`, c.n]));
  return rows.map((r) => ({
    id: String(r._id), title: r.title, periodLabel: r.periodLabel ?? null, description: r.description ?? '', status: r.status,
    publishedAt: r.publishedAt ?? null, withdrawnAt: r.withdrawnAt ?? null,
    counts: Object.fromEntries(['DRAFT', 'REVIEWED', 'PUBLISHED', 'EXCLUDED', 'WITHDRAWN'].map((s) => [s, by.get(`${r._id}:${s}`) ?? 0])),
  }));
}

export async function createEdition(actor, body = {}) {
  assertPublisher(actor);
  const e = new ShowcaseEdition({
    title: requireText(body.title, 'title', { max: 140 }), periodLabel: optionalText(body.periodLabel, { max: 60 }) || null,
    description: optionalText(body.description, { max: 1000 }) ?? '', createdByProfileId: actor.profileId,
  });
  pushHistory(e, actor, 'CREATED');
  await e.save();
  return (await listEditions(actor)).find((x) => x.id === String(e._id));
}

async function entryDtos(rows, { live = true } = {}) {
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName deletedAt anonymisedAt').lean()).map((s) => [String(s._id), s]));
  const consent = live ? await consentedIds(rows.map((r) => r.studentId)) : new Set();
  const names = await profileNames(rows.flatMap((r) => [r.createdByProfileId, r.reviewedByProfileId]));
  return rows.map((r) => ({
    id: String(r._id), editionId: String(r.editionId), kind: r.kind, category: r.category, studentId: String(r.studentId),
    studentName: studentName(students.get(String(r.studentId))), title: r.title, detail: r.detail ?? null, level: r.level ?? null,
    rank: r.rank ?? null, rankScope: r.rankScope ?? null, status: r.status, excludedReason: r.excludedReason ?? null,
    withdrawReason: r.withdrawReason ?? null, consent: consent.has(String(r.studentId)),
    draftedBy: names.get(String(r.createdByProfileId)) ?? null, reviewedBy: names.get(String(r.reviewedByProfileId)) ?? null,
    reviewedAt: r.reviewedAt ?? null, publishedAt: r.publishedAt ?? null, history: r.history ?? [],
    source: r.source?.type ?? 'MANUAL',
  }));
}

export async function getEdition(actor, id) {
  assertPublisher(actor);
  const e = await loadEdition(id);
  const entries = await ShowcaseEntry.find({ editionId: e._id }).sort({ kind: -1, rank: 1, createdAt: 1 }).lean();
  return { ...(await listEditions(actor)).find((x) => x.id === String(e._id)), history: e.history, entries: await entryDtos(entries), settings: await getSettings() };
}

/** Drafts the top ranks of an exam in a class or grade as entries. */
export async function addRankEntries(actor, editionId, body = {}) {
  assertPublisher(actor);
  const e = await loadEdition(editionId);
  if (e.status === 'WITHDRAWN') throw new AppError('This showcase was withdrawn.', 409);
  const { rankCutoff } = await getSettings();
  const sectionId = body.sectionId ? assertObjectId(body.sectionId, 'sectionId') : null;
  const gradeId = sectionId ? null : (body.gradeId ? assertObjectId(body.gradeId, 'gradeId') : null);
  const { exam, scope, ranked } = await examRanks({ examId: body.examId, sectionId, gradeId });
  const top = withinCutoff(ranked, rankCutoff);
  const label = await scopeLabel({ sectionId, gradeId });
  let created = 0;
  for (const t of top) {
    // eslint-disable-next-line no-await-in-loop
    const dup = await ShowcaseEntry.exists({ editionId: e._id, studentId: t.studentId, examId: exam._id, rankScope: scope, status: { $ne: 'WITHDRAWN' } });
    if (dup) continue;
    const entry = new ShowcaseEntry({
      editionId: e._id, kind: 'RANK', category: 'ACADEMIC', studentId: t.studentId,
      title: `${ordinal(t.rank)} in ${label}`, detail: exam.name, level: scope === 'GRADE' ? 'GRADE' : 'CLASS',
      rank: t.rank, rankScope: scope, examId: exam._id, sectionId: scope === 'SECTION' ? sectionId : t.sectionId, gradeId,
      percentage: Math.round(t.percentage * 100) / 100, source: { type: 'EXAM', id: exam._id }, createdByProfileId: actor.profileId,
    });
    pushHistory(entry, actor, 'DRAFTED');
    // eslint-disable-next-line no-await-in-loop
    await entry.save();
    created += 1;
  }
  await recordAudit({ actor, action: 'showcase.ranks.drafted', entityType: 'ShowcaseEdition', entityId: e._id, after: { examId: String(exam._id), scope, created } });
  return { created, ...(await getEdition(actor, String(e._id))) };
}

/**
 * Achievements worth showing: approved co-curricular records with an
 * achievement, and awards in fixture results a second teacher approved.
 */
export async function candidates(actor, query = {}) {
  assertPublisher(actor);
  const since = new Date(Date.now() - Math.min(Number(query.days) || 365, 730) * 86_400_000);
  const records = await CoCurricularActivity.find({ status: 'APPROVED', achievement: { $nin: [null, ''] }, activityDate: { $gte: since } }).sort({ activityDate: -1 }).limit(200).lean();
  const fixtures = await Fixture.find({ 'result.status': 'APPROVED', 'result.awards.0': { $exists: true }, startsAt: { $gte: since } }).sort({ startsAt: -1 }).limit(200).lean();
  const out = [
    ...records.map((r) => ({ source: 'COCURRICULAR', sourceId: String(r._id), studentId: String(r.studentId), category: mapCategory(r.category), title: r.achievement, detail: r.name, level: r.level, on: r.activityDate })),
    ...fixtures.flatMap((f) => (f.result.awards ?? []).map((a) => ({ source: 'FIXTURE', sourceId: String(f._id), studentId: String(a.studentId), category: f.category === 'ARTS' ? 'ARTS' : 'SPORTS', title: a.title, detail: f.title, level: f.level, on: f.startsAt }))),
  ];
  const students = new Map((await Student.find({ _id: { $in: out.map((o) => o.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentName(s)]));
  const consent = await consentedIds(out.map((o) => o.studentId));
  return out.map((o) => ({ ...o, studentName: students.get(o.studentId) ?? null, consent: consent.has(o.studentId) }));
}

function mapCategory(c) {
  if (c === 'SPORTS') return 'SPORTS';
  if (['ARTS', 'MUSIC', 'DANCE', 'DRAMA', 'LITERARY'].includes(c)) return 'ARTS';
  if (c === 'SCIENCE') return 'OLYMPIAD';
  if (c === 'SOCIAL_SERVICE') return 'SERVICE';
  return 'OTHER';
}

/** Drafts an achievement entry, from an approved record or result, or written by hand (an olympiad certificate). */
export async function addEntry(actor, editionId, body = {}) {
  assertPublisher(actor);
  const e = await loadEdition(editionId);
  if (e.status === 'WITHDRAWN') throw new AppError('This showcase was withdrawn.', 409);
  if (String(body.kind ?? 'ACHIEVEMENT').toUpperCase() === 'RANK') throw new AppError('Ranks are drawn from published results, not typed in.', 400, [], 'RANKS_FROM_RESULTS');
  const studentId = assertObjectId(body.studentId, 'studentId');
  await studentContext(studentId);
  const source = { type: oneOf(body.source ?? 'MANUAL', ['COCURRICULAR', 'FIXTURE', 'MANUAL'], 'source'), id: null };
  if (source.type === 'COCURRICULAR') {
    const r = await CoCurricularActivity.findOne({ _id: assertObjectId(body.sourceId, 'sourceId'), studentId, status: 'APPROVED' }).lean();
    if (!r) throw new AppError('That record is not an approved co-curricular record of this student.', 409, [], 'SOURCE_NOT_APPROVED');
    source.id = r._id;
  } else if (source.type === 'FIXTURE') {
    const f = await Fixture.findOne({ _id: assertObjectId(body.sourceId, 'sourceId'), 'result.status': 'APPROVED', 'result.awards.studentId': studentId }).lean();
    if (!f) throw new AppError('That result is not approved, or names no award for this student.', 409, [], 'SOURCE_NOT_APPROVED');
    source.id = f._id;
  }
  const entry = new ShowcaseEntry({
    editionId: e._id, kind: 'ACHIEVEMENT', category: oneOf(body.category, ENTRY_CATEGORIES, 'category'), studentId,
    title: requireText(body.title, 'title', { max: 160 }), detail: optionalText(body.detail, { max: 300 }) || null,
    level: optionalText(body.level, { max: 40 }) || null, source, createdByProfileId: actor.profileId,
  });
  pushHistory(entry, actor, 'DRAFTED');
  await entry.save();
  return (await entryDtos([entry.toObject()]))[0];
}

/** A second person reviews a draft: approve it for publishing, or send it back. */
export async function reviewEntry(actor, id, body = {}) {
  assertPublisher(actor);
  const entry = await ShowcaseEntry.findById(assertObjectId(id));
  if (!entry) throw new AppError('Entry not found', 404);
  const decision = oneOf(body.decision ?? 'APPROVE', ['APPROVE', 'RETURN'], 'decision');
  if (entry.status !== 'DRAFT' && !(decision === 'RETURN' && entry.status === 'REVIEWED')) throw new AppError(`This entry is ${entry.status.toLowerCase()}.`, 409, [], 'INVALID_TRANSITION');
  if (String(entry.createdByProfileId) === String(actor.profileId)) {
    throw new AppError('Someone other than the person who drafted an entry reviews it.', 409, [], 'SECOND_PERSON_REQUIRED');
  }
  const from = entry.status;
  if (decision === 'APPROVE') {
    entry.status = 'REVIEWED';
    entry.reviewedByProfileId = actor.profileId;
    entry.reviewedAt = new Date();
  } else {
    entry.status = 'DRAFT';
    entry.reviewedByProfileId = null;
    entry.reviewedAt = null;
  }
  pushHistory(entry, actor, decision === 'APPROVE' ? 'REVIEWED' : 'RETURNED', { from, to: entry.status, note: optionalText(body.note, { max: 300 }) || null });
  await entry.save();
  return (await entryDtos([entry.toObject()]))[0];
}

export async function removeEntry(actor, id) {
  assertPublisher(actor);
  const entry = await ShowcaseEntry.findById(assertObjectId(id));
  if (!entry) throw new AppError('Entry not found', 404);
  if (['PUBLISHED', 'WITHDRAWN'].includes(entry.status)) throw new AppError('A published entry is withdrawn, not deleted.', 409);
  await entry.deleteOne();
  return { removed: true };
}

/** Why an entry may not be published right now, or null. */
async function blockerFor(entry, { consent, cutoff, rankCache }) {
  const student = await Student.findById(entry.studentId).select('deletedAt anonymisedAt').lean();
  if (!student || student.deletedAt || student.anonymisedAt) return 'The student is no longer on the school roll.';
  if (!consent.has(String(entry.studentId))) return 'No media consent recorded for this child (or it was withdrawn).';
  if (entry.kind === 'RANK') {
    if (!entry.rank || entry.rank > cutoff) return `Rank ${entry.rank} is below the school's cut-off (top ${cutoff}).`;
    const key = `${entry.examId}:${entry.rankScope}:${entry.rankScope === 'SECTION' ? entry.sectionId : entry.gradeId}`;
    if (!rankCache.has(key)) {
      try {
        rankCache.set(key, await examRanks({ examId: entry.examId, sectionId: entry.rankScope === 'SECTION' ? entry.sectionId : null, gradeId: entry.rankScope === 'GRADE' ? entry.gradeId : null }));
      } catch (err) {
        rankCache.set(key, { error: err.code === 'RESULTS_NOT_PUBLISHED' ? 'The exam results are no longer published (reopened for correction).' : err.message });
      }
    }
    const r = rankCache.get(key);
    if (r.error) return r.error;
    const now = r.ranked.find((x) => x.studentId === String(entry.studentId));
    if (!now || now.rank !== entry.rank) return 'The rank has changed since it was drafted; draw the ranks again.';
  }
  return null;
}

/**
 * Publishes an edition's reviewed entries. Each is checked again now: the
 * child's consent, the cut-off and (for ranks) the published results. An
 * entry that fails is EXCLUDED with the reason and is not shown. Drafts that
 * were not reviewed stay drafts. Publishing again later publishes entries
 * reviewed since.
 */
export async function publishEdition(actor, id) {
  assertPublisher(actor);
  const e = await loadEdition(id);
  if (e.status === 'WITHDRAWN') throw new AppError('This showcase was withdrawn; create a new one.', 409);
  const reviewed = await ShowcaseEntry.find({ editionId: e._id, status: 'REVIEWED' });
  if (!reviewed.length && e.status !== 'PUBLISHED') throw new AppError('Nothing has been reviewed yet.', 409, [], 'NOTHING_REVIEWED');
  const { rankCutoff } = await getSettings();
  const consent = await consentedIds(reviewed.map((r) => r.studentId));
  const rankCache = new Map();
  const published = [];
  const excluded = [];
  const now = new Date();
  for (const entry of reviewed) {
    // eslint-disable-next-line no-await-in-loop
    const reason = await blockerFor(entry, { consent, cutoff: rankCutoff, rankCache });
    if (reason) {
      entry.status = 'EXCLUDED';
      entry.excludedReason = reason;
      pushHistory(entry, actor, 'EXCLUDED_AT_PUBLISH', { from: 'REVIEWED', to: 'EXCLUDED', note: reason });
      excluded.push({ entryId: String(entry._id), studentId: String(entry.studentId), reason });
    } else {
      entry.status = 'PUBLISHED';
      entry.publishedAt = now;
      pushHistory(entry, actor, 'PUBLISHED', { from: 'REVIEWED', to: 'PUBLISHED' });
      published.push(String(entry._id));
    }
    // eslint-disable-next-line no-await-in-loop
    await entry.save();
  }
  if (e.status !== 'PUBLISHED') {
    e.status = 'PUBLISHED';
    e.publishedAt = now;
    e.publishedByProfileId = actor.profileId;
  }
  pushHistory(e, actor, 'PUBLISHED', { note: `${published.length} published, ${excluded.length} left out` });
  await e.save();
  await recordAudit({ actor, action: 'showcase.published', entityType: 'ShowcaseEdition', entityId: e._id, after: { published: published.length, excluded: excluded.length } });
  return { published: published.length, excluded, edition: await getEdition(actor, String(e._id)) };
}

/** A published entry can be taken down (a consent withdrawn, a mistake). */
export async function withdrawEntry(actor, id, body = {}) {
  assertPublisher(actor);
  const entry = await ShowcaseEntry.findById(assertObjectId(id));
  if (!entry) throw new AppError('Entry not found', 404);
  if (entry.status !== 'PUBLISHED') throw new AppError('Only a published entry can be withdrawn.', 409);
  entry.status = 'WITHDRAWN';
  entry.withdrawnAt = new Date();
  entry.withdrawReason = requireText(body.reason, 'reason', { max: 300 });
  pushHistory(entry, actor, 'WITHDRAWN', { from: 'PUBLISHED', to: 'WITHDRAWN', note: entry.withdrawReason });
  await entry.save();
  await recordAudit({ actor, action: 'showcase.entry.withdrawn', entityType: 'ShowcaseEntry', entityId: entry._id, after: { reason: entry.withdrawReason } });
  return (await entryDtos([entry.toObject()]))[0];
}

export async function withdrawEdition(actor, id, body = {}) {
  assertPublisher(actor);
  const e = await loadEdition(id);
  if (e.status !== 'PUBLISHED') throw new AppError('Only a published showcase can be withdrawn.', 409);
  const reason = requireText(body.reason, 'reason', { max: 300 });
  e.status = 'WITHDRAWN';
  e.withdrawnAt = new Date();
  e.withdrawReason = reason;
  pushHistory(e, actor, 'WITHDRAWN', { note: reason });
  await e.save();
  await ShowcaseEntry.updateMany({ editionId: e._id, status: 'PUBLISHED' }, { $set: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawReason: reason } });
  await recordAudit({ actor, action: 'showcase.withdrawn', entityType: 'ShowcaseEdition', entityId: e._id, after: { reason } });
  return getEdition(actor, String(e._id));
}

/**
 * The published showcase, for everyone in the school. Published editions and
 * entries only; consent, the cut-off and the roll are checked again here, so
 * nothing outside today's rules is ever returned. No percentages, no drafts.
 */
export async function published(actor, query = {}) {
  requireProfile(actor);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 200, 1), 300);
  const editions = await ShowcaseEdition.find({ status: 'PUBLISHED' }).sort({ publishedAt: -1 }).limit(query.editionId ? 1 : 12)
    .where(query.editionId ? { _id: assertObjectId(query.editionId, 'editionId') } : {}).lean();
  if (!editions.length) return { editions: [], highlights: [], rankCutoff: (await getSettings()).rankCutoff };
  const { rankCutoff } = await getSettings();
  const entries = await ShowcaseEntry.find({ editionId: { $in: editions.map((e) => e._id) }, status: 'PUBLISHED' }).sort({ publishedAt: -1, rank: 1 }).limit(1000).lean();
  const consent = await consentedIds(entries.map((e) => e.studentId));
  const students = new Map((await Student.find({ _id: { $in: entries.map((e) => e.studentId) } }).select('firstName lastName deletedAt anonymisedAt').lean()).map((s) => [String(s._id), s]));
  const visible = entries.filter((e) => {
    const s = students.get(String(e.studentId));
    if (!s || s.deletedAt || s.anonymisedAt) return false;
    if (!consent.has(String(e.studentId))) return false;
    if (e.kind === 'RANK' && (!e.rank || e.rank > rankCutoff)) return false;
    return true;
  });
  const shape = (e) => ({
    id: String(e._id), editionId: String(e.editionId), kind: e.kind, category: e.category, studentName: studentName(students.get(String(e.studentId))),
    title: e.title, detail: e.detail ?? null, level: e.level ?? null, rank: e.kind === 'RANK' ? e.rank : null, publishedAt: e.publishedAt,
  });
  return {
    rankCutoff,
    editions: editions.map((ed) => ({
      id: String(ed._id), title: ed.title, periodLabel: ed.periodLabel ?? null, description: ed.description ?? '', publishedAt: ed.publishedAt,
      entries: visible.filter((v) => String(v.editionId) === String(ed._id)).map(shape),
    })).filter((ed) => ed.entries.length),
    highlights: visible.slice(0, limit).map(shape),
  };
}

/** Pickers for drafting: exams with published marks, classes and grades. */
export async function options(actor) {
  assertPublisher(actor);
  const { Exam, ExamSubject, Mark } = await import('../../models/exam.model.js');
  const paperIds = await Mark.distinct('examSubjectId', { status: 'PUBLISHED' });
  const examIds = await ExamSubject.distinct('examId', { _id: { $in: paperIds } });
  const exams = await Exam.find({ _id: { $in: examIds } }).sort({ startsOn: -1 }).select('name startsOn').lean();
  const sections = await Section.find({}).populate('gradeId', 'name level').lean();
  sections.sort((a, b) => (a.gradeId?.level ?? 0) - (b.gradeId?.level ?? 0) || a.name.localeCompare(b.name));
  const grades = await Grade.find({}).sort({ level: 1, name: 1 }).select('name').lean();
  return {
    exams: exams.map((e) => ({ id: String(e._id), name: e.name, startsOn: e.startsOn })),
    sections: sections.map((s) => ({ id: String(s._id), label: `${s.gradeId?.name ?? ''} ${s.name}`.trim() })),
    grades: grades.map((g) => ({ id: String(g._id), name: g.name })),
    settings: await getSettings(),
  };
}
