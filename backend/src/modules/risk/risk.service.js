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
 * Swap the body of scanEnrollment() for a real model call later — the
 * route contract (GET /risk/scan) stays the same.
 */
async function scanEnrollment(enrollment) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const predictions = [];

  const records = await AttendanceRecord.find({ enrollmentId: enrollment._id, date: { $gte: since }, periodNo: null });
  if (records.length > 0) {
    const presentPct = records.filter((r) => r.status === 'PRESENT').length / records.length;
    const probability = Math.max(0, 1 - presentPct / 0.75); // risk rises below 75% attendance
    predictions.push({
      type: 'ATTENDANCE',
      probability: Math.min(1, Math.round(probability * 100) / 100),
      topFeatures: [{ feature: 'attendance_pct_30d', value: Math.round(presentPct * 100), contribution: probability }],
    });
  }

  const marks = await Mark.find({ enrollmentId: enrollment._id, status: 'PUBLISHED' }).populate('examSubjectId');
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

  const overdueInvoices = await Invoice.countDocuments({
    enrollmentId: enrollment._id,
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
    dueOn: { $lt: new Date() },
  });
  if (overdueInvoices > 0) {
    const probability = Math.min(1, 0.3 + overdueInvoices * 0.2);
    predictions.push({
      type: 'FEE_DEFAULT',
      probability,
      topFeatures: [{ feature: 'overdue_invoice_count', value: overdueInvoices, contribution: probability }],
    });
  }

  const saved = [];
  for (const p of predictions) {
    const doc = await RiskPrediction.findOneAndUpdate(
      { enrollmentId: enrollment._id, type: p.type },
      { ...p, level: LEVEL(p.probability), computedAt: new Date() },
      { upsert: true, new: true }
    );
    saved.push(doc);
  }
  return saved;
}

export async function scan({ enrollmentId, tenantId } = {}) {
  const filter = { status: 'ACTIVE' };
  if (enrollmentId) filter._id = enrollmentId;
  if (tenantId) filter.tenantId = tenantId;

  const enrollments = await Enrollment.find(filter)
    .populate('studentId', 'firstName lastName')
    .populate('sectionId', 'name gradeName');

  const items = [];
  for (const enrollment of enrollments) {
    const student = enrollment.studentId;
    const section = enrollment.sectionId;
    const studentName = student
      ? `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown'
      : 'Unknown';
    const className = section
      ? `${section.gradeName || ''} ${section.name || ''}`.trim() || 'Unknown'
      : 'Unknown';

    const predictions = await scanEnrollment(enrollment);
    for (const doc of predictions) {
      items.push({
        enrollmentId: doc.enrollmentId?.toString(),
        studentName,
        class: className,
        type: doc.type,
        level: doc.level,
        probability: doc.probability,
        topFeatures: doc.topFeatures || [],
        summary: buildSummary(doc),
      });
    }
  }

  // Build counts by level
  const counts = {};
  for (const item of items) {
    counts[item.level] = (counts[item.level] ?? 0) + 1;
  }

  return { items, counts };
}

function buildSummary(doc) {
  if (doc.type === 'ATTENDANCE') return `Attendance below safe threshold (${doc.topFeatures?.[0]?.value ?? '?'}% in last 30d)`;
  if (doc.type === 'ACADEMIC_DECLINE') return `Academic average below threshold (${doc.topFeatures?.[0]?.value ?? '?'}% avg)`;
  if (doc.type === 'FEE_DEFAULT') return `${doc.topFeatures?.[0]?.value ?? '?'} overdue invoice(s) pending`;
  return 'Risk detected';
}
