import mongoose from 'mongoose';
import { AcademicYear } from '../../../models/academics.model.js';
import { Enrollment } from '../../../models/student.model.js';

/** Shared building blocks for metric definitions. */

export const DAY = 86_400_000;

/** A Mongo filter for a half-open period on one date field. */
export const within = (field, p) => ({ [field]: { $gte: p.start, $lt: p.end } });

/** The earliest value of a date field in a collection (null when it is empty). */
export async function earliest(Model, field, filter = {}) {
  const row = await Model.findOne({ ...filter, [field]: { $ne: null } }).sort({ [field]: 1 }).select(field).lean();
  return row?.[field] ? new Date(row[field]) : null;
}

export const oid = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

export const sum = (rows, fn) => rows.reduce((t, r) => t + (Number(fn(r)) || 0), 0);

/** Percentage to one decimal, or null when the denominator is zero. */
export const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** The instant just before the end of a half-open period: "as of" for point-in-time counts. */
export const asOf = (p) => new Date(p.end.getTime() - 1);

/** An academic year's exclusive end: the day after its last date. */
export const yearEnd = (ay) => new Date(new Date(ay.endsOn).getTime() + DAY);

/**
 * Who was on roll at an instant, from enrolment history rather than today's
 * status.
 *
 * Enrolment records carry no admission date, so a pupil counts from the start
 * of the enrolment's academic year. A pupil whose enrolment is no longer
 * ACTIVE counts until the enrolment last changed (the recorded withdrawal,
 * transfer or graduation) when that happened inside the year, and to the end
 * of the year otherwise; a graduated pupil therefore still counts in the year
 * they finished. Returns the enrolment rows on roll.
 */
export async function onRollAt(ctx, at, { sectionIds = null } = {}) {
  const years = await ctx.memo('academicYears', () => AcademicYear.find({}).select('name startsOn endsOn').lean());
  const year = years.find((y) => new Date(y.startsOn) <= at && at < yearEnd(y));
  if (!year) return { year: null, rows: [] };
  const all = await ctx.memo(`enrolments:${year._id}`, () => Enrollment.find({ academicYearId: year._id }).select('studentId sectionId status createdAt updatedAt').lean());
  const end = yearEnd(year);
  const rows = all.filter((e) => {
    if (sectionIds && !sectionIds.includes(String(e.sectionId))) return false;
    if (e.status === 'ACTIVE') return true;
    const changed = new Date(e.updatedAt);
    const leftAt = changed > new Date(year.startsOn) && changed < end ? changed : end;
    return at < leftAt;
  });
  return { year, rows };
}

/** The first instant for which enrolment history exists (start of the earliest year with enrolments). */
export async function enrolmentHistorySince(ctx) {
  return ctx.memo('enrolmentSince', async () => {
    const years = await ctx.memo('academicYears', () => AcademicYear.find({}).select('name startsOn endsOn').lean());
    const used = new Set((await Enrollment.distinct('academicYearId')).map(String));
    const starts = years.filter((y) => used.has(String(y._id))).map((y) => new Date(y.startsOn).getTime());
    return starts.length ? new Date(Math.min(...starts)) : null;
  });
}

/** Enrolment ids for a set of sections (teacher scope), memoised. */
export async function enrolmentIdsForSections(ctx, sectionIds) {
  if (!sectionIds) return null;
  return ctx.memo(`enrolIds:${sectionIds.join(',')}`, async () => (await Enrollment.find({ sectionId: { $in: sectionIds.map(oid) } }).select('_id').lean()).map((e) => e._id));
}

/** Groups rows into the period's buckets by a date accessor; returns one total per bucket. */
export function bucketSums(rows, bucketList, dateOf, valueOf = () => 1) {
  return bucketList.map((b) => sum(rows.filter((r) => { const d = dateOf(r); return d && d >= b.start && d < b.end; }), valueOf));
}
