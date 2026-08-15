import mongoose from 'mongoose';
import { RiskPrediction } from '../../models/growthRisk.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Mark } from '../../models/exam.model.js';
import { Invoice } from '../../models/fee.model.js';

const LEVEL = (p) => (p >= 0.7 ? 'HIGH' : p >= 0.4 ? 'MEDIUM' : 'LOW');

/**
 * STAND-IN implementation. core-api's risk module scores dropout/academic
 * risk with a trained model; here we use plain rule-based thresholds over
 * the last 30 days of attendance, published marks, and overdue invoices.
 * Swap the per-enrollment scoring logic below for a real model call later —
 * the route contract (GET /risk/scan) stays the same.
 *
 * Batched by design: the original version ran 3 queries + up to 3 upserts
 * per enrollment inside a sequential loop, which meant ~6 round-trips to
 * Atlas per student — for a school-wide scan (hundreds of students) that
 * serialized into minutes and made the Principal dashboard look hung. This
 * fetches attendance/marks/overdue-invoices for every enrollment in 3 bulk
 * queries, scores everything in memory, then persists with one bulkWrite.
 */
function scoreEnrollment({ records, marks, overdueCount }) {
  const predictions = [];

  if (records.length > 0) {
    const presentPct = records.filter((r) => r.status === 'PRESENT').length / records.length;
    const probability = Math.max(0, 1 - presentPct / 0.75); // risk rises below 75% attendance
    predictions.push({
      type: 'ATTENDANCE',
      probability: Math.min(1, Math.round(probability * 100) / 100),
      topFeatures: [{ feature: 'attendance_pct_30d', value: Math.round(presentPct * 100), contribution: probability }],
    });
  }

  const pcts = marks.filter((m) => m.marks != null && m.examSubjectId?.maxMarks).map((m) => m.marks / m.examSubjectId.maxMarks);
  if (pcts.length > 0) {
    const avgPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const probability = Math.max(0, 1 - avgPct / 0.4); // risk rises below 40% average
    predictions.push({
      type: 'ACADEMIC_DECLINE',
      probability: Math.min(1, Math.round(probability * 100) / 100),
      topFeatures: [{ feature: 'avg_marks_pct', value: Math.round(avgPct * 100), contribution: probability }],
    });
  }

  if (overdueCount > 0) {
    const probability = Math.min(1, 0.3 + overdueCount * 0.2);
    predictions.push({
      type: 'FEE_DEFAULT',
      probability,
      topFeatures: [{ feature: 'overdue_invoice_count', value: overdueCount, contribution: probability }],
    });
  }

  return predictions;
}

/** Escapes a user-supplied string so it is matched literally in a RegExp. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs the scan, then narrows what is returned to the caller.
 *
 * The scoring pass still covers every active enrollment (the persisted
 * RiskPrediction rows must stay complete), but the response carries only the
 * requested page. That matters because one prediction is produced per signal
 * per student — a school of 700 students yields well over a thousand rows,
 * most of them LOW at 0% probability, and shipping all of them to the browser
 * is what made the principal's risk table unusable.
 *
 * Filters: `level`, `type`, `sectionId`, `gradeName`, `search` (student or
 * class), `minProbability`. Paging: `page`, `pageSize`. Sorting: `sortBy`
 * (probability | student | class | category | level) and `sortDir`.
 *
 * Always returns `summary` computed over the *unpaged, unfiltered* result so
 * the dashboard's totals do not shift when a filter is applied.
 */
export async function scan({
  enrollmentId, tenantId,
  level, type, sectionId, gradeName, search, minProbability,
  page, pageSize, sortBy, sortDir,
} = {}) {
  const filter = { status: 'ACTIVE' };
  if (enrollmentId) filter._id = enrollmentId;
  if (tenantId) filter.tenantId = tenantId;

  const enrollments = await Enrollment.find(filter)
    .populate('studentId', 'firstName lastName')
    // Section carries `gradeId`, not a denormalised `gradeName` — populating
    // only 'name gradeName' left every class label as a bare "A"/"B", which is
    // also what made a grade filter impossible.
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } })
    .lean();

  if (enrollments.length === 0) return { items: [], counts: {}, summary: emptySummary(), total: 0, page: 1, pageSize: 0, totalPages: 1 };

  const enrollmentIds = enrollments.map((e) => e._id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [attendanceRecords, marks, overdueAgg] = await Promise.all([
    AttendanceRecord.find({ enrollmentId: { $in: enrollmentIds }, date: { $gte: since }, periodNo: null })
      .select('enrollmentId status')
      .lean(),
    Mark.find({ enrollmentId: { $in: enrollmentIds }, status: 'PUBLISHED' })
      .populate('examSubjectId', 'maxMarks')
      .select('enrollmentId marks examSubjectId')
      .lean(),
    Invoice.aggregate([
      { $match: { enrollmentId: { $in: enrollmentIds }, status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, dueOn: { $lt: now } } },
      { $group: { _id: '$enrollmentId', count: { $sum: 1 } } },
    ]),
  ]);

  const recordsByEnrollment = new Map();
  for (const r of attendanceRecords) {
    const key = r.enrollmentId.toString();
    (recordsByEnrollment.get(key) ?? recordsByEnrollment.set(key, []).get(key)).push(r);
  }
  const marksByEnrollment = new Map();
  for (const m of marks) {
    const key = m.enrollmentId.toString();
    (marksByEnrollment.get(key) ?? marksByEnrollment.set(key, []).get(key)).push(m);
  }
  const overdueByEnrollment = new Map(overdueAgg.map((o) => [o._id.toString(), o.count]));

  const items = [];
  const bulkOps = [];
  const counts = {};

  for (const enrollment of enrollments) {
    const key = enrollment._id.toString();
    const student = enrollment.studentId;
    const section = enrollment.sectionId;
    const studentName = student
      ? `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown'
      : 'Unknown';
    const gradeName = section?.gradeId?.name || section?.gradeName || '';
    const className = section
      ? `${gradeName} ${section.name || ''}`.trim() || 'Unknown'
      : 'Unknown';

    const predictions = scoreEnrollment({
      records: recordsByEnrollment.get(key) ?? [],
      marks: marksByEnrollment.get(key) ?? [],
      overdueCount: overdueByEnrollment.get(key) ?? 0,
    });

    for (const p of predictions) {
      const level = LEVEL(p.probability);
      const computedAt = new Date();
      bulkOps.push({
        updateOne: {
          filter: { enrollmentId: enrollment._id, type: p.type },
          update: { $set: { ...p, level, computedAt } },
          upsert: true,
        },
      });
      items.push({
        enrollmentId: key,
        // The drill-down needs the student, not just their enrollment, to load
        // the overview / guardians / class teacher behind a risk row.
        studentId: student?._id?.toString() ?? null,
        studentName,
        class: className,
        sectionId: section?._id?.toString() ?? null,
        sectionName: section?.name ?? null,
        gradeName: gradeName || null,
        type: p.type,
        level,
        probability: p.probability,
        topFeatures: p.topFeatures,
        summary: buildSummary(p),
      });
      counts[level] = (counts[level] ?? 0) + 1;
    }
  }

  if (bulkOps.length > 0) await RiskPrediction.bulkWrite(bulkOps);

  // Summary describes the whole scan and is deliberately computed before any
  // filter is applied, so the headline figures stay stable while browsing.
  const summary = summarise(items, enrollments.length);

  let filtered = items;
  if (level) filtered = filtered.filter((i) => i.level === String(level).toUpperCase());
  if (type) filtered = filtered.filter((i) => i.type === String(type).toUpperCase());
  if (sectionId) filtered = filtered.filter((i) => i.sectionId === String(sectionId));
  if (gradeName) filtered = filtered.filter((i) => i.gradeName === gradeName);
  if (minProbability != null && minProbability !== '') {
    const min = Number(minProbability);
    if (Number.isFinite(min)) filtered = filtered.filter((i) => i.probability >= min);
  }
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filtered = filtered.filter((i) => rx.test(i.studentName) || rx.test(i.class));
  }

  const LEVEL_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const dir = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;
  const comparators = {
    probability: (a, b) => (a.probability - b.probability) * dir,
    level: (a, b) => ((LEVEL_RANK[a.level] ?? 0) - (LEVEL_RANK[b.level] ?? 0)) * dir,
    student: (a, b) => a.studentName.localeCompare(b.studentName) * dir,
    class: (a, b) => a.class.localeCompare(b.class) * dir,
    category: (a, b) => a.type.localeCompare(b.type) * dir,
  };
  // Default ordering puts the most urgent work first; probability breaks ties
  // within a level so a 95% HIGH outranks a 71% HIGH.
  const comparator = comparators[sortBy]
    ?? ((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || b.probability - a.probability);
  filtered = [...filtered].sort(comparator);

  const total = filtered.length;
  const requestedSize = parseInt(pageSize, 10);
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 200) : 0;
  if (size === 0) {
    // No paging requested — unchanged contract for any existing caller.
    return { items: filtered, counts, summary, total, page: 1, pageSize: total, totalPages: 1 };
  }
  const totalPages = Math.max(Math.ceil(total / size), 1);
  const pageNo = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);
  return {
    items: filtered.slice((pageNo - 1) * size, pageNo * size),
    counts,
    summary,
    total,
    page: pageNo,
    pageSize: size,
    totalPages,
  };
}

/**
 * How long a persisted scan is considered good enough to serve reads from.
 * Risk inputs (attendance, published marks, overdue invoices) move on the
 * order of a school day, so a few minutes of staleness is not meaningful —
 * whereas rescoring 1400+ predictions on every filter click costs ~5s.
 */
const FRESH_FOR_MS = 10 * 60 * 1000;

/** Newest computedAt across the persisted predictions, or null if there are none. */
async function lastComputedAt() {
  const newest = await RiskPrediction.findOne().sort({ computedAt: -1 }).select('computedAt').lean();
  return newest?.computedAt ?? null;
}

/**
 * Reads the *persisted* predictions with filtering, sorting and paging done by
 * MongoDB, joining the student/section/grade context the table displays.
 *
 * This is the read path for the Performance & Risk table. It never rescores
 * anything: `scan()` remains the only writer, and `query()` is what a filter,
 * sort or page change now goes through.
 */
export async function query({
  level, type, sectionId, gradeName, search, minProbability,
  page, pageSize, sortBy, sortDir,
} = {}) {
  const match = {};
  if (level) match.level = String(level).toUpperCase();
  if (type) match.type = String(type).toUpperCase();
  if (minProbability != null && minProbability !== '') {
    const min = Number(minProbability);
    if (Number.isFinite(min)) match.probability = { $gte: min };
  }

  // Join enrollment -> student / section -> grade so the table's own columns
  // (student, class) can be filtered and sorted in the database.
  const context = [
    { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'enr' } },
    { $unwind: { path: '$enr', preserveNullAndEmptyArrays: true } },
    { $match: { 'enr.status': 'ACTIVE' } },
    { $lookup: { from: 'students', localField: 'enr.studentId', foreignField: '_id', as: 'stu' } },
    { $unwind: { path: '$stu', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'sections', localField: 'enr.sectionId', foreignField: '_id', as: 'sec' } },
    { $unwind: { path: '$sec', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'grades', localField: 'sec.gradeId', foreignField: '_id', as: 'grd' } },
    { $unwind: { path: '$grd', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        studentName: { $trim: { input: { $concat: [{ $ifNull: ['$stu.firstName', ''] }, ' ', { $ifNull: ['$stu.lastName', ''] }] } } },
        gradeNameJoined: { $ifNull: ['$grd.name', ''] },
        className: { $trim: { input: { $concat: [{ $ifNull: ['$grd.name', ''] }, ' ', { $ifNull: ['$sec.name', ''] }] } } },
      },
    },
  ];

  const post = [];
  if (sectionId) post.push({ $match: { 'enr.sectionId': toObjectId(sectionId) } });
  if (gradeName) post.push({ $match: { gradeNameJoined: String(gradeName) } });
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    post.push({ $match: { $or: [{ studentName: rx }, { className: rx }] } });
  }

  const LEVEL_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const dir = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;
  const sortStage = {
    probability: { probability: dir },
    level: { levelRank: dir, probability: -1 },
    student: { studentName: dir },
    class: { className: dir },
    category: { type: dir },
  }[sortBy] ?? { levelRank: -1, probability: -1 };

  const requestedSize = parseInt(pageSize, 10);
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 200) : 0;

  const pipeline = [
    { $match: match },
    ...context,
    ...post,
    { $addFields: { levelRank: { $switch: { branches: [
      { case: { $eq: ['$level', 'HIGH'] }, then: 3 },
      { case: { $eq: ['$level', 'MEDIUM'] }, then: 2 },
    ], default: 1 } } } },
    { $sort: sortStage },
  ];

  // Count first (no documents materialised), so the page number can be clamped
  // before the page itself is fetched. The sort is skipped here — it cannot
  // change a count and sorting 1400+ joined docs just to discard them is the
  // difference between ~0.7s and ~2.9s on the broad filters.
  const countPipeline = pipeline.filter((stage) => !('$sort' in stage) && !('$addFields' in stage && stage.$addFields.levelRank));
  const [{ total = 0 } = {}] = await RiskPrediction.aggregate([
    ...countPipeline,
    { $count: 'total' },
  ]).allowDiskUse(true);
  const totalPages = size > 0 ? Math.max(Math.ceil(total / size), 1) : 1;
  // Clamp out-of-range pages so a stale page number returns the last page of
  // real rows instead of an empty table (matches /users and /students).
  const pageNo = size > 0 ? Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages) : 1;

  const paged = await RiskPrediction.aggregate(
    size > 0 ? [...pipeline, { $skip: (pageNo - 1) * size }, { $limit: size }] : pipeline,
  ).allowDiskUse(true);

  const items = paged.map((r) => ({
    enrollmentId: r.enrollmentId?.toString() ?? null,
    studentId: r.stu?._id?.toString() ?? null,
    studentName: r.studentName || 'Unknown',
    class: r.className || 'Unknown',
    sectionId: r.enr?.sectionId?.toString() ?? null,
    sectionName: r.sec?.name ?? null,
    gradeName: r.gradeNameJoined || null,
    type: r.type,
    level: r.level,
    probability: r.probability,
    topFeatures: r.topFeatures ?? [],
    summary: buildSummary(r),
  }));

  const summary = await summariseFromDb();

  return {
    items,
    counts: summary.byLevel,
    summary,
    total,
    page: pageNo,
    pageSize: size > 0 ? size : total,
    totalPages,
    computedAt: await lastComputedAt(),
  };
}

function toObjectId(id) {
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
}

/** Headline figures aggregated straight from the persisted predictions. */
async function summariseFromDb() {
  const rows = await RiskPrediction.aggregate([
    { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'enr' } },
    { $unwind: { path: '$enr', preserveNullAndEmptyArrays: true } },
    { $match: { 'enr.status': 'ACTIVE' } },
    { $group: { _id: { level: '$level', type: '$type' }, n: { $sum: 1 }, enrollments: { $addToSet: '$enrollmentId' } } },
  ]);

  const byLevel = {};
  const byCategory = {};
  const flaggedEnrollments = new Set();
  const highEnrollments = new Set();
  const mediumEnrollments = new Set();
  let signalsEvaluated = 0;

  for (const r of rows) {
    const { level, type } = r._id;
    byLevel[level] = (byLevel[level] ?? 0) + r.n;
    signalsEvaluated += r.n;
    if (level !== 'LOW') {
      byCategory[type] = (byCategory[type] ?? 0) + r.n;
      r.enrollments.forEach((e) => flaggedEnrollments.add(String(e)));
      if (level === 'HIGH') r.enrollments.forEach((e) => highEnrollments.add(String(e)));
      if (level === 'MEDIUM') r.enrollments.forEach((e) => mediumEnrollments.add(String(e)));
    }
  }

  const activeEnrollments = await Enrollment.countDocuments({ status: 'ACTIVE' });
  const flaggedSignals = Object.entries(byLevel)
    .filter(([lvl]) => lvl !== 'LOW')
    .reduce((sum, [, n]) => sum + n, 0);

  return {
    activeEnrollments,
    signalsEvaluated,
    flaggedSignals,
    flaggedStudents: flaggedEnrollments.size,
    studentsAtHighRisk: highEnrollments.size,
    studentsAtMediumRisk: mediumEnrollments.size,
    clearStudents: Math.max(activeEnrollments - flaggedEnrollments.size, 0),
    byLevel,
    byCategory,
  };
}

/**
 * Entry point for GET /risk/scan.
 *
 * Rescores only when the persisted predictions are missing or stale, or when
 * the caller explicitly asks (the Rescan button). Every other interaction —
 * filter, sort, page — is served by query() straight from the database.
 */
export async function read(params = {}) {
  const force = String(params.refresh ?? '') === 'true' || params.refresh === true;
  const last = await lastComputedAt();
  const stale = !last || Date.now() - new Date(last).getTime() > FRESH_FOR_MS;
  if (force || stale) await scan({});
  return query(params);
}

function emptySummary() {
  return {
    activeEnrollments: 0, signalsEvaluated: 0,
    flaggedSignals: 0, flaggedStudents: 0,
    studentsAtHighRisk: 0, studentsAtMediumRisk: 0,
    byLevel: {}, byCategory: {}, clearStudents: 0,
  };
}

/**
 * Aggregates what the scan actually produced.
 *
 * The distinction the old labels missed: every active enrollment is *scored*
 * for every signal that has data, so a row at 0% probability means "checked,
 * nothing wrong" — not "flagged". Anything above LOW is a real flag, and a
 * student with both an attendance and an academic flag is one student, two
 * flags.
 */
function summarise(items, activeEnrollments) {
  const flagged = items.filter((i) => i.level !== 'LOW');
  const byLevel = {};
  const byCategory = {};
  for (const i of items) {
    byLevel[i.level] = (byLevel[i.level] ?? 0) + 1;
    if (i.level !== 'LOW') byCategory[i.type] = (byCategory[i.type] ?? 0) + 1;
  }
  const studentsWithLevel = (lvl) =>
    new Set(items.filter((i) => i.level === lvl).map((i) => i.enrollmentId)).size;
  const flaggedStudents = new Set(flagged.map((i) => i.enrollmentId)).size;

  return {
    activeEnrollments,
    signalsEvaluated: items.length,
    flaggedSignals: flagged.length,
    flaggedStudents,
    studentsAtHighRisk: studentsWithLevel('HIGH'),
    studentsAtMediumRisk: studentsWithLevel('MEDIUM'),
    clearStudents: Math.max(activeEnrollments - flaggedStudents, 0),
    byLevel,
    byCategory,
  };
}

function buildSummary(doc) {
  if (doc.type === 'ATTENDANCE') return `Attendance below safe threshold (${doc.topFeatures?.[0]?.value ?? '?'}% in last 30d)`;
  if (doc.type === 'ACADEMIC_DECLINE') return `Academic average below threshold (${doc.topFeatures?.[0]?.value ?? '?'}% avg)`;
  if (doc.type === 'FEE_DEFAULT') return `${doc.topFeatures?.[0]?.value ?? '?'} overdue invoice(s) pending`;
  return 'Risk detected';
}
