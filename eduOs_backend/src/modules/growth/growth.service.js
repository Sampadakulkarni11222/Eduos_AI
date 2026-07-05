import { GrowthScore } from '../../models/growthRisk.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Mark } from '../../models/exam.model.js';

/**
 * STAND-IN implementation. core-api's growth module computes this from an
 * ML model trained on engagement signals; we have no model or training data
 * here, so this is a transparent heuristic: 60% published-marks average +
 * 40% attendance rate for the period. Swap computeScore() for a real model
 * call when one is available — the route contract stays the same.
 */
async function computeScore(enrollmentId, period) {
  const [year, month] = period.split('-').map(Number);
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);

  const attendanceRecords = await AttendanceRecord.find({
    enrollmentId,
    date: { $gte: from, $lte: to },
    periodNo: null,
  });
  const presentCount = attendanceRecords.filter((r) => r.status === 'PRESENT').length;
  const attendancePct = attendanceRecords.length ? (presentCount / attendanceRecords.length) * 100 : 0;

  const marks = await Mark.find({ enrollmentId, status: 'PUBLISHED' }).populate('examSubjectId');
  const percentages = marks
    .filter((m) => m.marks != null && m.examSubjectId?.maxMarks)
    .map((m) => (m.marks / m.examSubjectId.maxMarks) * 100);
  const marksPct = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0;

  const score = Math.round(marksPct * 0.6 + attendancePct * 0.4);
  const breakdown = [
    { component: 'marks', raw: marksPct, weight: 0.6, points: Math.round(marksPct * 0.6) },
    { component: 'attendance', raw: attendancePct, weight: 0.4, points: Math.round(attendancePct * 0.4) },
  ];

  return { score, breakdown };
}

export async function getScore(enrollmentId, period) {
  const { score, breakdown } = await computeScore(enrollmentId, period);
  return GrowthScore.findOneAndUpdate(
    { enrollmentId, period },
    { score, breakdown, computedAt: new Date() },
    { upsert: true, new: true }
  );
}
