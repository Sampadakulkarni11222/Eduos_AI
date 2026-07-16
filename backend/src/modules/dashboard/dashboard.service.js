import mongoose from 'mongoose';

import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Lead } from '../../models/lead.model.js';
import { Invoice, Payment } from '../../models/fee.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { Announcement } from '../../models/announcement.model.js';
import { AcademicYear, Section, SubjectOffering } from '../../models/academics.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Book, BookIssue } from '../../models/library.model.js';
import { HostelRoom, HostelAllocation, HostelInquiry } from '../../models/hostel.model.js';
import {
  getTeacherSectionIds,
  getGuardianStudentIds,
  getOwnStudentId,
} from '../../utils/scope.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe division — returns 0 if denominator is 0 */
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);

/** Convert paise → rupees, never NaN */
const toRs = (paise) => Math.round((paise ?? 0)) / 100;

/** Today's day-of-week as 1=Mon…7=Sun (matches TimetableSlot.dayOfWeek) */
function todayDow() {
  const d = new Date().getDay(); // 0=Sun
  return d === 0 ? 7 : d;
}

/** Get recent N announcements (for everyone) */
async function recentAnnouncements(limit = 5) {
  return Announcement.find({ deletedAt: null })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .select('title content publishedAt')
    .lean();
}

// ─── Owner Dashboard ──────────────────────────────────────────────────────────

export async function getOwnerDashboard() {
  const [
    totalStudents,
    activeCRMLeads,
    feeAgg,
    unpaidCount,
    recentTickets,
    announcementsArr,
    admissionsByStage,
  ] = await Promise.all([
    Student.countDocuments({ status: 'ACTIVE', deletedAt: null }),
    Lead.countDocuments({ stage: { $nin: ['ENROLLED', 'LOST'] } }),

    // Sum collected vs total invoices
    Invoice.aggregate([
      {
        $group: {
          _id: null,
          totalPaise: { $sum: '$totalPaise' },
          paidPaise: { $sum: '$paidPaise' },
        },
      },
    ]),

    Invoice.countDocuments({ status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }),

    Ticket.find({ status: { $in: ['NEW', 'OPEN', 'WAITING'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('subject status priority createdAt routedToRoleKey')
      .lean(),

    recentAnnouncements(5),

    Lead.aggregate([
      { $group: { _id: '$stage', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const totalPaise = feeAgg[0]?.totalPaise ?? 0;
  const paidPaise = feeAgg[0]?.paidPaise ?? 0;
  const pendingPaise = totalPaise - paidPaise;

  return {
    totalStudents,
    activeCRMLeads,
    feesCollected: toRs(paidPaise),
    feesCollectedPaise: paidPaise,
    pendingFees: toRs(pendingPaise),
    pendingFeesPaise: pendingPaise,
    unpaidInvoices: unpaidCount,
    admissionsSummary: admissionsByStage.map((s) => ({
      stage: s._id,
      count: s.count,
    })),
    recentAuditLogs: recentTickets, // using tickets as proxy for recent activity
    recentAnnouncements: announcementsArr,
  };
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

export async function getAdminDashboard() {
  const [
    totalStudents,
    openTickets,
    announcementsCount,
    recentStudents,
    announcementsArr,
    ticketsArr,
    admissionsByStage,
  ] = await Promise.all([
    Student.countDocuments({ status: 'ACTIVE', deletedAt: null }),
    Ticket.countDocuments({ status: { $in: ['NEW', 'OPEN', 'WAITING'] } }),
    Announcement.countDocuments({ deletedAt: null }),

    Student.find({ status: 'ACTIVE', deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('firstName lastName admissionNo gender createdAt')
      .lean(),

    recentAnnouncements(5),

    Ticket.find({ status: { $in: ['NEW', 'OPEN', 'WAITING'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('raisedByProfileId', 'displayName')
      .select('subject status priority routedToRoleKey createdAt')
      .lean(),

    Lead.aggregate([
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    totalStudents,
    openTickets,
    announcementsCount,
    admissionsPipeline: admissionsByStage.map((s) => ({
      stage: s._id,
      count: s.count,
    })),
    recentStudents,
    recentAnnouncements: announcementsArr,
    recentTickets: ticketsArr,
  };
}

// ─── Finance Dashboard ────────────────────────────────────────────────────────

export async function getFinanceDashboard() {
  const [feeAgg, invoiceCount, recentInvoices] = await Promise.all([
    Invoice.aggregate([
      {
        $group: {
          _id: null,
          totalPaise: { $sum: '$totalPaise' },
          paidPaise: { $sum: '$paidPaise' },
        },
      },
    ]),

    Invoice.countDocuments({}),

    Invoice.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: 'enrollmentId',
        populate: { path: 'studentId', select: 'firstName lastName admissionNo' },
      })
      .select('invoiceNo status totalPaise paidPaise dueOn createdAt')
      .lean(),
  ]);

  const totalPaise = feeAgg[0]?.totalPaise ?? 0;
  const paidPaise = feeAgg[0]?.paidPaise ?? 0;
  const pendingPaise = totalPaise - paidPaise;

  const pendingInvoices = await Invoice.find({ status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] } })
    .sort({ dueOn: 1 })
    .limit(10)
    .populate({
      path: 'enrollmentId',
      populate: { path: 'studentId', select: 'firstName lastName admissionNo' },
    })
    .select('invoiceNo status totalPaise paidPaise dueOn')
    .lean();

  return {
    pendingAmount: toRs(pendingPaise),
    pendingAmountPaise: pendingPaise,
    collectedAmount: toRs(paidPaise),
    collectedAmountPaise: paidPaise,
    totalBilled: toRs(totalPaise),
    collectionRate: pct(paidPaise, totalPaise),
    invoiceCount,
    recentInvoices: recentInvoices.map(_formatInvoice),
    pendingInvoices: pendingInvoices.map(_formatInvoice),
  };
}

function _formatInvoice(inv) {
  const student = inv.enrollmentId?.studentId;
  return {
    _id: inv._id,
    invoiceNo: inv.invoiceNo,
    status: inv.status,
    totalAmount: toRs(inv.totalPaise),
    paidAmount: toRs(inv.paidPaise),
    dueAmount: toRs((inv.totalPaise ?? 0) - (inv.paidPaise ?? 0)),
    dueOn: inv.dueOn,
    createdAt: inv.createdAt,
    studentName: student
      ? `${student.firstName} ${student.lastName ?? ''}`.trim()
      : inv.enrollmentId?.toString() ?? '--',
    admissionNo: student?.admissionNo ?? '--',
  };
}

// ─── Teacher Dashboard ────────────────────────────────────────────────────────

export async function getTeacherDashboard(profileId) {
  // 1. Sections this teacher is responsible for
  const sectionIds = await getTeacherSectionIds(profileId);
  const sectionObjectIds = sectionIds.map((id) => new mongoose.Types.ObjectId(id));

  // 2. Assigned classes (sections with their grade)
  const assignedClassesRaw = await Section.find({ _id: { $in: sectionObjectIds } })
    .populate('gradeId', 'name level')
    .select('name gradeId classTeacherId')
    .lean();

  // 3. Total students in those sections (active enrollments)
  const totalStudents =
    sectionObjectIds.length > 0
      ? await Enrollment.countDocuments({
          sectionId: { $in: sectionObjectIds },
          status: 'ACTIVE',
        })
      : 0;

  // 4. Today's timetable for this teacher
  const dow = todayDow();
  const teacherOfferings = await SubjectOffering.find({ teacherId: profileId }).select('_id').lean();
  const teacherOfferingIds = teacherOfferings.map((o) => o._id);

  const todaySlots = await TimetableSlot.find({
    subjectOfferingId: { $in: teacherOfferingIds },
    dayOfWeek: dow,
  })
    .populate({
      path: 'subjectOfferingId',
      populate: [
        { path: 'subjectId', select: 'name code' },
        {
          path: 'sectionId',
          select: 'name gradeId',
          populate: { path: 'gradeId', select: 'name' }
        },
      ],
    })
    .sort({ periodNo: 1 })
    .lean();

  // 5. Attendance summary — today for these sections
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const enrollmentIds = await Enrollment.find({
    sectionId: { $in: sectionObjectIds },
    status: 'ACTIVE',
  })
    .select('_id')
    .lean();
  const enrollmentIdList = enrollmentIds.map((e) => e._id);

  const attendanceAgg =
    enrollmentIdList.length > 0
      ? await AttendanceRecord.aggregate([
          {
            $match: {
              enrollmentId: { $in: enrollmentIdList },
              date: { $gte: today, $lt: tomorrow },
              periodNo: null,
            },
          },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
      : [];

  const attendanceSummary = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  for (const row of attendanceAgg) attendanceSummary[row._id] = row.count;

  // 6. Pending assignment evaluations (submissions not yet graded in teacher's sections)
  const offeringIds = (
    await SubjectOffering.find({ teacherId: profileId }).select('_id').lean()
  ).map((o) => o._id);

  const pendingGrading =
    offeringIds.length > 0
      ? await Submission.countDocuments({
          assignmentId: {
            $in: (
              await Assignment.find({ subjectOfferingId: { $in: offeringIds }, deletedAt: null })
                .select('_id')
                .lean()
            ).map((a) => a._id),
          },
          status: 'SUBMITTED',
        })
      : 0;

  // 7. Upcoming exams in the teacher's sections
  const now = new Date();
  const upcomingExams = await ExamSubject.find({
    subjectOfferingId: { $in: offeringIds },
    examDate: { $gte: now },
  })
    .populate('examId', 'name startsOn endsOn')
    .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } })
    .sort({ examDate: 1 })
    .limit(5)
    .lean();

  // 8. Recent announcements
  const announcementsArr = await recentAnnouncements(5);

  return {
    assignedClasses: assignedClassesRaw.map((s) => ({
      sectionId: s._id,
      sectionName: s.name,
      gradeName: s.gradeId?.name ?? '--',
    })),
    totalStudents,
    todayTimetable: todaySlots.map((slot) => {
      const sectionDoc = slot.subjectOfferingId?.sectionId;
      const gradeName = sectionDoc?.gradeId?.name ? `${sectionDoc.gradeId.name} – ` : '';
      const sectionName = sectionDoc?.name ?? '';
      return {
        periodNo: slot.periodNo,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subject: slot.subjectOfferingId?.subjectId?.name ?? 'Break',
        section: sectionDoc ? `${gradeName}${sectionName}`.trim() : '',
      };
    }),
    attendanceSummary,
    pendingAssignmentEvaluations: pendingGrading,
    upcomingExams: upcomingExams.map((es) => ({
      examName: es.examId?.name ?? '--',
      subject: es.subjectOfferingId?.subjectId?.name ?? '--',
      examDate: es.examDate,
    })),
    recentAnnouncements: announcementsArr,
  };
}

// ─── Student Dashboard ────────────────────────────────────────────────────────

export async function getStudentDashboard(profileId) {
  // Resolve student record
  const student = await Student.findOne({ profileId, deletedAt: null }).lean();
  if (!student) {
    return _emptyStudentDashboard();
  }

  // Active enrollment
  const enrollment = await Enrollment.findOne({
    studentId: student._id,
    status: 'ACTIVE',
  })
    .populate('sectionId')
    .lean();

  if (!enrollment) return _emptyStudentDashboard();

  const enrollmentId = enrollment._id;
  const sectionId = enrollment.sectionId?._id;

  // 1. Attendance percentage
  const [totalAtt, presentAtt] = await Promise.all([
    AttendanceRecord.countDocuments({ enrollmentId, periodNo: null }),
    AttendanceRecord.countDocuments({ enrollmentId, periodNo: null, status: { $in: ['PRESENT', 'LATE', 'HALF_DAY'] } }),
  ]);
  const attendancePct = pct(presentAtt, totalAtt);

  // 2. Today's timetable
  const dow = todayDow();
  const todaySlots = sectionId
    ? await TimetableSlot.find({ sectionId, dayOfWeek: dow })
        .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name code' } })
        .sort({ periodNo: 1 })
        .lean()
    : [];

  // 3. Pending assignments
  const pendingAssignments = await Submission.countDocuments({
    enrollmentId,
    status: 'PENDING',
  });

  // 4. Upcoming exams
  const now = new Date();
  const offeringIds = sectionId
    ? (await SubjectOffering.find({ sectionId }).select('_id').lean()).map((o) => o._id)
    : [];

  const examSchedule =
    offeringIds.length > 0
      ? await ExamSubject.find({
          subjectOfferingId: { $in: offeringIds },
          examDate: { $gte: now },
        })
          .populate('examId', 'name')
          .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } })
          .sort({ examDate: 1 })
          .limit(5)
          .lean()
      : [];

  // 5. Fee status
  const feeAgg = await Invoice.aggregate([
    { $match: { enrollmentId } },
    {
      $group: {
        _id: null,
        totalPaise: { $sum: '$totalPaise' },
        paidPaise: { $sum: '$paidPaise' },
        pendingCount: {
          $sum: { $cond: [{ $in: ['$status', ['PENDING', 'PARTIAL', 'OVERDUE']] }, 1, 0] },
        },
      },
    },
  ]);
  const feeData = feeAgg[0] ?? { totalPaise: 0, paidPaise: 0, pendingCount: 0 };

  // 6. Borrowed library books
  const borrowedBooks = await BookIssue.find({
    borrowerProfileId: profileId,
    status: { $in: ['ACTIVE', 'OVERDUE'] },
  })
    .populate('bookId', 'title author')
    .select('bookId issuedAt dueDate status fineAmount')
    .lean();

  // 7. Announcements
  const announcementsArr = await recentAnnouncements(5);

  return {
    attendancePercentage: attendancePct,
    totalDays: totalAtt,
    presentDays: presentAtt,
    todayTimetable: todaySlots.map((s) => ({
      periodNo: s.periodNo,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectOfferingId?.subjectId?.name ?? 'Break',
    })),
    upcomingClasses: todaySlots
      .filter((s) => s.startTime > new Date().toTimeString().slice(0, 5))
      .map((s) => ({
        periodNo: s.periodNo,
        startTime: s.startTime,
        subject: s.subjectOfferingId?.subjectId?.name ?? 'Break',
      })),
    pendingAssignments,
    examSchedule: examSchedule.map((es) => ({
      examName: es.examId?.name ?? '--',
      subject: es.subjectOfferingId?.subjectId?.name ?? '--',
      examDate: es.examDate,
      maxMarks: es.maxMarks,
    })),
    feeStatus: {
      totalFees: toRs(feeData.totalPaise),
      paidFees: toRs(feeData.paidPaise),
      pendingFees: toRs(feeData.totalPaise - feeData.paidPaise),
      pendingInvoices: feeData.pendingCount,
    },
    borrowedBooks: borrowedBooks.map((b) => ({
      title: b.bookId?.title ?? '--',
      author: b.bookId?.author ?? '--',
      dueDate: b.dueDate,
      status: b.status,
      fine: b.fineAmount,
    })),
    recentAnnouncements: announcementsArr,
  };
}

function _emptyStudentDashboard() {
  return {
    attendancePercentage: 0,
    totalDays: 0,
    presentDays: 0,
    todayTimetable: [],
    upcomingClasses: [],
    pendingAssignments: 0,
    examSchedule: [],
    feeStatus: { totalFees: 0, paidFees: 0, pendingFees: 0, pendingInvoices: 0 },
    borrowedBooks: [],
    recentAnnouncements: [],
  };
}

// ─── Parent Dashboard ─────────────────────────────────────────────────────────

export async function getParentDashboard(profileId) {
  const studentIds = await getGuardianStudentIds(profileId);
  if (studentIds.length === 0) {
    return _emptyParentDashboard();
  }
  const studentObjectIds = studentIds.map((id) => new mongoose.Types.ObjectId(id));

  // Children details
  const children = await Student.find({ _id: { $in: studentObjectIds }, deletedAt: null })
    .select('firstName lastName admissionNo gender dob photoUrl')
    .lean();

  // Active enrollments for all children
  const enrollments = await Enrollment.find({
    studentId: { $in: studentObjectIds },
    status: 'ACTIVE',
  })
    .populate('sectionId', 'name')
    .lean();

  const enrollmentIds = enrollments.map((e) => e._id);

  // Children's attendance (aggregate per student)
  const attAgg =
    enrollmentIds.length > 0
      ? await AttendanceRecord.aggregate([
          {
            $match: {
              enrollmentId: { $in: enrollmentIds },
              periodNo: null,
            },
          },
          {
            $lookup: {
              from: 'enrollments',
              localField: 'enrollmentId',
              foreignField: '_id',
              as: 'enrollment',
            },
          },
          { $unwind: '$enrollment' },
          {
            $group: {
              _id: '$enrollment.studentId',
              total: { $sum: 1 },
              present: {
                $sum: {
                  $cond: [{ $in: ['$status', ['PRESENT', 'LATE', 'HALF_DAY']] }, 1, 0],
                },
              },
            },
          },
        ])
      : [];

  const attendanceMap = Object.fromEntries(
    attAgg.map((a) => [
      a._id.toString(),
      { total: a.total, present: a.present, percentage: pct(a.present, a.total) },
    ])
  );

  // Pending fees
  const feeAgg =
    enrollmentIds.length > 0
      ? await Invoice.aggregate([
          { $match: { enrollmentId: { $in: enrollmentIds } } },
          {
            $group: {
              _id: null,
              totalPaise: { $sum: '$totalPaise' },
              paidPaise: { $sum: '$paidPaise' },
            },
          },
        ])
      : [];
  const totalPaise = feeAgg[0]?.totalPaise ?? 0;
  const paidPaise = feeAgg[0]?.paidPaise ?? 0;

  // Recent invoices
  const recentInvoices =
    enrollmentIds.length > 0
      ? await Invoice.find({ enrollmentId: { $in: enrollmentIds } })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('invoiceNo status totalPaise paidPaise dueOn enrollmentId')
          .lean()
      : [];

  // Upcoming exams for children's sections
  const sectionIds = enrollments.map((e) => e.sectionId?._id).filter(Boolean);
  const offeringIds =
    sectionIds.length > 0
      ? (await SubjectOffering.find({ sectionId: { $in: sectionIds } }).select('_id').lean()).map(
          (o) => o._id
        )
      : [];

  const now = new Date();
  const upcomingExams =
    offeringIds.length > 0
      ? await ExamSubject.find({
          subjectOfferingId: { $in: offeringIds },
          examDate: { $gte: now },
        })
          .populate('examId', 'name')
          .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } })
          .sort({ examDate: 1 })
          .limit(5)
          .lean()
      : [];

  // Today's timetable for children
  const dow = todayDow();
  const timetable =
    sectionIds.length > 0
      ? await TimetableSlot.find({ sectionId: { $in: sectionIds }, dayOfWeek: dow })
          .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } })
          .populate('sectionId', 'name')
          .sort({ periodNo: 1 })
          .lean()
      : [];

  // Recent results (published marks)
  const recentResults =
    enrollmentIds.length > 0
      ? await Mark.find({ enrollmentId: { $in: enrollmentIds }, status: 'PUBLISHED' })
          .populate({ path: 'examSubjectId', populate: [{ path: 'examId', select: 'name' }, { path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } }] })
          .sort({ publishedAt: -1 })
          .limit(10)
          .lean()
      : [];

  // Announcements
  const announcementsArr = await recentAnnouncements(5);

  return {
    linkedChildren: children.map((c) => ({
      studentId: c._id,
      name: `${c.firstName} ${c.lastName ?? ''}`.trim(),
      admissionNo: c.admissionNo,
      gender: c.gender,
      attendance: attendanceMap[c._id.toString()] ?? { total: 0, present: 0, percentage: 0 },
    })),
    pendingFees: toRs(totalPaise - paidPaise),
    pendingFeesPaise: totalPaise - paidPaise,
    feeInvoices: recentInvoices.map((inv) => ({
      invoiceNo: inv.invoiceNo,
      status: inv.status,
      total: toRs(inv.totalPaise),
      paid: toRs(inv.paidPaise),
      due: toRs(inv.totalPaise - inv.paidPaise),
      dueOn: inv.dueOn,
    })),
    upcomingExams: upcomingExams.map((es) => ({
      examName: es.examId?.name ?? '--',
      subject: es.subjectOfferingId?.subjectId?.name ?? '--',
      examDate: es.examDate,
    })),
    timetable: timetable.map((s) => ({
      periodNo: s.periodNo,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectOfferingId?.subjectId?.name ?? 'Break',
      section: s.sectionId?.name ?? '--',
    })),
    recentResults: recentResults.map((m) => ({
      examName: m.examSubjectId?.examId?.name ?? '--',
      subject: m.examSubjectId?.subjectOfferingId?.subjectId?.name ?? '--',
      marks: m.marks ?? 0,
      maxMarks: m.examSubjectId?.maxMarks ?? 0,
      grade: m.gradeLabel ?? '--',
    })),
    announcements: announcementsArr,
  };
}

function _emptyParentDashboard() {
  return {
    linkedChildren: [],
    pendingFees: 0,
    pendingFeesPaise: 0,
    feeInvoices: [],
    upcomingExams: [],
    timetable: [],
    recentResults: [],
    announcements: [],
  };
}

// ─── Warden Dashboard ─────────────────────────────────────────────────────────

export async function getWardenDashboard() {
  const [
    totalRooms,
    occupiedBeds,
    vacantCount,
    maintenanceRooms,
    maintenanceTickets,
    openInquiries,
    recentAllocations,
  ] = await Promise.all([
    HostelRoom.countDocuments({ status: { $ne: 'CLOSED' } }),
    HostelAllocation.countDocuments({ status: 'ACTIVE' }),

    // Vacant beds = rooms not at capacity
    HostelRoom.aggregate([
      { $match: { status: 'ACTIVE' } },
      {
        $lookup: {
          from: 'hostelallocations',
          let: { roomId: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$roomId', '$$roomId'] }, { $eq: ['$status', 'ACTIVE'] }] } } },
            { $count: 'count' },
          ],
          as: 'occupiedArr',
        },
      },
      {
        $addFields: {
          occupied: { $ifNull: [{ $arrayElemAt: ['$occupiedArr.count', 0] }, 0] },
        },
      },
      {
        $group: {
          _id: null,
          totalCapacity: { $sum: '$capacity' },
          totalOccupied: { $sum: '$occupied' },
        },
      },
    ]),

    HostelRoom.countDocuments({ status: 'MAINTENANCE' }),
    Ticket.countDocuments({ routedToRoleKey: 'WARDEN', status: { $in: ['NEW', 'OPEN', 'WAITING'] } }),
    HostelInquiry.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),

    HostelAllocation.find({ status: 'ACTIVE' })
      .populate('studentId', 'firstName lastName admissionNo gender')
      .populate('roomId', 'roomNo block floor type')
      .sort({ allottedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const capacityData = vacantCount[0] ?? { totalCapacity: 0, totalOccupied: 0 };
  const totalVacantBeds = Math.max(0, capacityData.totalCapacity - capacityData.totalOccupied);

  return {
    hostelStudents: occupiedBeds,
    occupiedRooms: occupiedBeds,
    vacantBeds: totalVacantBeds,
    totalCapacity: capacityData.totalCapacity,
    occupancyRate: pct(occupiedBeds, capacityData.totalCapacity),
    maintenanceRooms,
    maintenanceRequests: maintenanceTickets,
    visitorLogs: [], // no visitor model — return empty per spec
    leaveRequests: [], // no leave model — return empty per spec
    recentIncidents: openInquiries, // using open inquiries as incidents proxy
    openInquiries,
    recentAllocations: recentAllocations.map((a) => ({
      allocationId: a._id,
      studentName: `${a.studentId?.firstName ?? ''} ${a.studentId?.lastName ?? ''}`.trim(),
      admissionNo: a.studentId?.admissionNo ?? '--',
      roomNo: a.roomId?.roomNo ?? '--',
      block: a.roomId?.block ?? '--',
      allottedAt: a.allottedAt,
    })),
  };
}

// ─── Librarian Dashboard ──────────────────────────────────────────────────────

export async function getLibrarianDashboard() {
  // Mark overdue issues first
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: new Date() } },
    { $set: { status: 'OVERDUE' } }
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalBooks,
    issuedBooks,
    overdueBooks,
    issuedToday,
    returnedToday,
    recentIssues,
    recentReturns,
    bookAgg,
  ] = await Promise.all([
    Book.countDocuments({ deletedAt: null }),
    BookIssue.countDocuments({ status: 'ACTIVE' }),
    BookIssue.countDocuments({ status: 'OVERDUE' }),

    BookIssue.countDocuments({
      issuedAt: { $gte: today, $lt: tomorrow },
    }),

    BookIssue.countDocuments({
      returnedAt: { $gte: today, $lt: tomorrow },
      status: 'RETURNED',
    }),

    BookIssue.find({ status: { $in: ['ACTIVE', 'OVERDUE'] } })
      .populate('bookId', 'title author isbn')
      .populate('borrowerProfileId', 'displayName')
      .sort({ issuedAt: -1 })
      .limit(10)
      .lean(),

    BookIssue.find({
      returnedAt: { $gte: today, $lt: tomorrow },
      status: 'RETURNED',
    })
      .populate('bookId', 'title author isbn')
      .populate('borrowerProfileId', 'displayName')
      .sort({ returnedAt: -1 })
      .limit(10)
      .lean(),

    Book.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          totalCopies: { $sum: '$totalCopies' },
          availableCopies: { $sum: '$availableCopies' },
        },
      },
    ]),
  ]);

  const copies = bookAgg[0] ?? { totalCopies: 0, availableCopies: 0 };

  return {
    totalBooks,
    totalCopies: copies.totalCopies,
    availableBooks: copies.availableCopies,
    issuedBooks,
    overdueBooks,
    booksIssuedToday: issuedToday,
    booksReturnedToday: returnedToday,
    recentIssueHistory: recentIssues.map((i) => ({
      issueId: i._id,
      book: i.bookId?.title ?? '--',
      author: i.bookId?.author ?? '--',
      borrower: i.borrowerProfileId?.displayName ?? i.borrowerName ?? '--',
      issuedAt: i.issuedAt,
      dueDate: i.dueDate,
      status: i.status,
    })),
    recentReturnHistory: recentReturns.map((i) => ({
      issueId: i._id,
      book: i.bookId?.title ?? '--',
      author: i.bookId?.author ?? '--',
      borrower: i.borrowerProfileId?.displayName ?? i.borrowerName ?? '--',
      returnedAt: i.returnedAt,
      fine: i.fineAmount,
    })),
  };
}
