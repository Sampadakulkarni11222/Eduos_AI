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

export async function scan({ enrollmentId, tenantId } = {}) {
  const filter = { status: 'ACTIVE' };
  if (enrollmentId) filter._id = enrollmentId;
  if (tenantId) filter.tenantId = tenantId;

  const enrollments = await Enrollment.find(filter)
    .populate('studentId', 'firstName lastName')
    .populate('sectionId', 'name gradeName')
    .lean();

  if (enrollments.length === 0) return { items: [], counts: {} };

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
    const className = section
      ? `${section.gradeName || ''} ${section.name || ''}`.trim() || 'Unknown'
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
        studentName,
        class: className,
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

  return { items, counts };
}

function buildSummary(doc) {
  if (doc.type === 'ATTENDANCE') return `Attendance below safe threshold (${doc.topFeatures?.[0]?.value ?? '?'}% in last 30d)`;
  if (doc.type === 'ACADEMIC_DECLINE') return `Academic average below threshold (${doc.topFeatures?.[0]?.value ?? '?'}% avg)`;
  if (doc.type === 'FEE_DEFAULT') return `${doc.topFeatures?.[0]?.value ?? '?'} overdue invoice(s) pending`;
  return 'Risk detected';
}
