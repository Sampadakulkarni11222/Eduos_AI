export type RoleKey =
  | 'OWNER' | 'ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'PARENT'
  | 'STUDENT' | 'FINANCE' | 'LIBRARIAN' | 'WARDEN';

export interface ProfileSummary {
  id: string;
  displayName: string;
  role: RoleKey;
  avatarUrl?: string | null;
  // Optional tenant information for backward compatibility
  tenantId?: string;
  tenantName?: string;
}

export type PermissionScope = 'ALL' | 'OWN';
/** Backend-resolved permission map: { 'fees.read': 'ALL', ... } */
export type PermissionMap = Record<string, PermissionScope>;

export interface Me {
  accountId: string;
  profile: ProfileSummary;
  /** Server-trusted permission map resolved from the profile's role. */
  permissions?: PermissionMap;
  // Optional deprecated fields for backward compatibility
  profiles?: ProfileSummary[];
  activeProfileId?: string;
  tenantId?: string;
  roleKey?: RoleKey;
}

export interface StudentListItem {
  id: string;
  admissionNo: string;
  name: string;
  enrollment: { id: string; rollNo: number | null; class: string; sectionId?: string | null; academicYearId?: string | null } | null;
}

export interface StudentGuardianInfo { name: string; relation: 'FATHER' | 'MOTHER' | 'GUARDIAN'; phone: string | null; email: string | null; isPrimary: boolean }
export interface StudentAssignmentRow { id: string; title: string; subject: string; dueAt: string | null; status: string; marks: number | null; maxMarks: number | null }
export interface AttendanceSummaryDto { PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number; workingDays: number; pctPresent: number }
export interface StudentOverviewDto {
  id: string;
  admissionNo: string;
  name: string;
  dob: string | null;
  gender: string | null;
  address: string | null;
  photoUrl: string | null;
  enrollment: { id: string; rollNo: number | null; class: string; sectionId?: string | null; academicYearId?: string | null } | null;
  guardians: StudentGuardianInfo[];
  medical: MedicalDto | null;
  attendance: AttendanceSummaryDto | null;
  performance: PerformanceDto | null;
  assignments: StudentAssignmentRow[];
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SectionDto { id: string; name: string; gradeName: string; classTeacher?: string | null; classTeacherId?: string | null; classRepresentativeId?: string | null }
export interface OfferingDto { id: string; subject: string; subjectId?: string; sectionId: string; sectionName: string; gradeName?: string; teacherName?: string | null }
export interface GradeDto { id: string; name: string; level: number }
export interface SubjectDto { id: string; name: string; code?: string | null }
export interface TermDto { id: string; academicYearId: string; name: string; startsOn: string; endsOn: string }

// Actual shape of GET /users (account + nested profiles) — distinct from the
// flattened UserDto below, which some pages construct client-side.
export interface StaffAccountDto {
  accountId: string;
  displayName: string | null;
  profiles: { profileId: string; displayName: string; role: string | null }[];
}
export interface RosterRow { enrollmentId: string; rollNo: number | null; studentName: string; status: AttStatus | null; note: string | null }
export type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY';
export interface AttendanceRoster { section: { id: string; name: string }; date: string; periodNo: number | null; roster: RosterRow[] }
export interface MySubmission { status: 'PENDING' | 'SUBMITTED' | 'LATE' | 'GRADED' | 'EXEMPT'; submittedAt: string | null; marks: number | null; feedback: string | null; attachments: string[] }
export interface AssignmentDto {
  id: string; title: string; description?: string | null; type: string; chapter?: string | null;
  dueAt: string; maxMarks: number | null; subject: string; subjectId?: string | null; class: string;
  gradeId?: string | null; gradeName?: string | null; sectionId?: string | null; sectionName?: string | null;
  subjectOfferingId?: string | null; submissionCount: number; mySubmission?: MySubmission | null;
}
export interface SubmissionRow { enrollmentId: string; rollNo: number | null; studentName: string; status: string; submittedAt: string | null; marks: number | null; feedback: string | null; attachments: string[] }
export interface SubmissionRoster { assignment: { id: string; title: string; dueAt: string | null; maxMarks: number | null }; rows: SubmissionRow[] }
export interface TimetableSlotDto { id: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subject: string | null; teacher: string | null; subjectOfferingId: string | null; isBreak: boolean; room: string | null; liveClassLink: string | null }
export interface TimetableDto { sectionId: string; slots: TimetableSlotDto[] }
export interface PerformanceDto {
  student: { name: string; class: string };
  overallAvgPct: number | null;
  bestSubject: { subject: string; pct: number | null } | null;
  needsSupport: { subject: string; pct: number | null } | null;
  results: Array<{ exam: string; subject: string; marks: number | null; maxMarks: number; pct: number | null }>;
}
export interface ExamDto { id: string; name: string; startsOn: string; endsOn: string }
export interface ExamSubjectDto { id: string; examId: string; examName: string; subject: string; class: string; maxMarks: number; examDate: string | null }
export interface MarkRow { enrollmentId: string; rollNo: number | null; studentName: string; marks: number | null; gradeLabel: string | null; remarks: string | null; status: 'PENDING' | 'DRAFT' | 'REVIEW' | 'PUBLISHED' }
export interface MarksGrid { examSubject: { id: string; examName: string; subject: string; class: string; maxMarks: number }; rows: MarkRow[] }
export interface CalendarEventDto { id: string; title: string; description: string | null; type: string; startsAt: string; endsAt: string }

// ── Attendance calendar & trend ──
export interface AttendanceDayDto { date: string; status: AttStatus }
export interface AttendanceCalendarDto { enrollmentId: string; month: string; days: AttendanceDayDto[] }
export interface AttendanceTrendPointDto { month: string; pctPresent: number; presentDays: number; workingDays: number }

// ── Leave applications ──
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface LeaveApplicationDto {
  _id: string; enrollmentId: string; fromDate: string; toDate: string; reason: string;
  status: LeaveStatus; remarks: string | null; createdAt: string;
}

export interface InvoiceDto { id: string; invoiceNo: string; studentName: string; class: string | null; status: string; totalPaise: number; paidPaise: number; dueOn: string; sectionId?: string; studentId?: string; createdAt?: string }
export interface FeeSummary { totalBilledPaise: number; totalCollectedPaise: number; pendingPaise: number; pendingCount: number; collectionPct: number; overduePaise: number; overdueCount: number }
export interface AnnouncementAudience { all: boolean; gradeIds: string[]; sectionIds: string[]; subjectIds: string[] }
export interface AnnouncementChannels { app: boolean; email: boolean; whatsapp: boolean }
export interface AnnouncementDto {
  id: string; title: string; content: string; publishedAt: string;
  audience: AnnouncementAudience; audienceLabel: string; channels: AnnouncementChannels;
}
export interface TicketDto { id: string; subject: string; status: string; priority: string; routedToRoleKey: string | null; raisedBy: string; assignedTo?: string | null; studentName?: string | null; createdAt: string; messageCount: number }
export interface TicketThread { id: string; subject: string; status: string; routedToRoleKey: string | null; studentName?: string | null; messages: Array<{ id: string; body: string; channel: string; mine: boolean; createdAt: string }> }
export interface MedicalDto { studentId: string; bloodGroup: string | null; heightCm: number | null; weightKg: number | null; emergencyContact: { name: string; phone: string; relation: string } | null; allergies: string[]; medications: string[]; history: string | null; attachments?: Array<{ name: string; fileUrl: string }> | null }
export interface LeadCard { id: string; childName: string; guardianName: string; gradeApplying: string | null; source: string; nextActionAt: string | null }
export interface Pipeline { stages: string[]; byStage: Record<string, LeadCard[]> }

export interface GrowthComponent { key: string; label: string; raw: number; normalized: number; weight: number; points: number; detail: string }
export interface GrowthScore { enrollmentId: string; studentName: string; score: number; band: string; components: GrowthComponent[]; computedAt: string }
export interface RiskFeature { feature: string; value: string; contribution: number }
export interface RiskItem { enrollmentId: string; studentName: string; class: string; type: string; level: string; probability: number; topFeatures: RiskFeature[]; summary: string }
export interface RiskScan { items: RiskItem[]; counts: Record<string, number> }
export interface AiReply { conversationId: string; reply: string; toolsUsed: string[] }

export interface WaSimReply { reply: string; buttons: Array<{ id: string; title: string }> | null }

// ── Phase 8: Transport ──
export interface TransportRouteDto { id: string; name: string; operatorName: string | null; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; status: string; stopCount: number }
export interface TransportStopDto { id: string; routeId: string; name: string; sequenceNo: number; etaMinutesFromStart: number }
export interface MyBusDto { route: Omit<TransportRouteDto, 'stopCount'>; stop: TransportStopDto; direction: string; nextEta: string | null }

// ── Phase 8: Library ──
export interface BookDto { id: string; title: string; author: string; isbn: string | null; category: string; totalCopies: number; availableCopies: number }
export interface BookIssueDto { id: string; bookId: string; bookTitle: string; studentId: string; studentName: string; issuedAt: string; dueAt: string; returnedAt: string | null; status: 'ACTIVE' | 'RETURNED' | 'OVERDUE'; finePaise: number }

// ── Phase 8: Documents ──
export interface DocumentDto { id: string; title: string; type: string; fileUrl: string; mimeType: string; visibleToRoles: string[]; studentId: string | null; studentName: string | null; academicYearId: string | null; sectionId?: string | null; subjectOfferingId?: string | null; issuedAt: string }

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  channel: string;
  ip: string | null;
  createdAt: string;
}

export interface InvoiceLineDto { id: string; description: string; amountPaise: number; concessionPaise: number }
export interface InvoiceDetailDto extends InvoiceDto {
  createdAt: string;
  lines: InvoiceLineDto[];
  payments: PaymentReceiptDto[];
}

export interface PaymentReceiptDto {
  id: string;
  receiptNo: string;
  invoiceNo: string;
  studentName: string;
  class: string;
  amountPaise: number;
  mode: string;
  status: string;
  createdAt: string;
}

export interface UserDto {
  id: string;
  displayName: string;
  roleKey: RoleKey;
  phone: string;
  email: string | null;
  studentDetails: {
    id: string;
    admissionNo: string;
    rollNo: number | null;
    class: string | null;
  } | null;
}

export interface CreateUserDto {
  roleKey: RoleKey;
  displayName: string;
  phone: string;
  email?: string;
  password?: string;
  admissionNo?: string;
  sectionId?: string;
}

// ── Uploads ──
export interface UploadResult { fileUrl: string; filename: string; size: number; mimeType: string }

// ── Bulk CSV import (leads / enrollments / attendance) ──
export interface BulkImportResult {
  imported: number;
  failed: number;
  errors: { row: number; error: string }[];
}

// ── Online payments ──
export interface PayOnlineResult { receiptNo: string; gatewayRef: string; provider: string; sandbox: boolean; status: string; paidPaise: number }

// ── Hostel ──
export interface HostelRoomDto { _id: string; roomNo: string; block: string; floor?: number | null; type: string; capacity: number; status: string; occupied: number; available: number }
export interface HostelAllocationDto {
  _id: string;
  status: string;
  allottedAt: string;
  roomId: { _id: string; roomNo: string; block: string; floor?: number | null; type: string } | null;
  studentId: { _id: string; firstName: string; lastName?: string; admissionNo: string; gender?: string } | null;
}
export interface HostelSummaryDto { totalRooms: number; totalCapacity: number; occupiedBeds: number; availableBeds: number; occupancyRate: number; hostelInquiries: number; maintenanceRequests: number }

// ── RBAC (backend catalog) ──
export interface PermissionDto { _id: string; key: string; group: string; description: string; isSystem?: boolean }
export interface RoleDto { _id: string; key: string; name: string; description?: string; isSystem?: boolean; permissions: Array<{ key: string; scope: PermissionScope }> }

// ── Role dashboards (shapes served by /dashboard/:role) ──
export interface AdminDashboardDto {
  totalStudents: number; openTickets: number; announcementsCount: number;
  admissionsPipeline: Array<{ stage: string; count: number }>;
  recentStudents: Array<{ _id: string; firstName: string; lastName?: string; admissionNo: string; createdAt: string }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
  recentTickets: Array<{ _id: string; subject: string; status: string; priority?: string; routedToRoleKey?: string | null; createdAt: string; raisedByProfileId?: { displayName?: string } | null }>;
}
export interface StudentDashboardDto {
  attendancePercentage: number; totalDays: number; presentDays: number;
  monthlyAttendance: { percentage: number; presentDays: number; totalDays: number };
  todayAttendanceStatus: AttStatus | 'NOT_MARKED' | 'HOLIDAY';
  todayTimetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; room: string | null; liveClassLink: string | null }>;
  upcomingClasses: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; room: string | null; liveClassLink: string | null }>;
  pendingAssignments: number;
  examSchedule: Array<{ examName: string; subject: string; examDate: string; maxMarks?: number }>;
  feeStatus: { totalFees: number; paidFees: number; pendingFees: number; pendingInvoices: number };
  borrowedBooks: Array<{ title: string; author: string; dueDate: string; status: string; fine: number }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface TeacherDashboardDto {
  assignedClasses: Array<{ sectionId: string; sectionName: string; gradeName: string }>;
  totalStudents: number;
  totalOfferings: number;
  courseMaterialsCount: number;
  todayTimetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; section: string }>;
  attendanceSummary: Record<string, number>;
  pendingAssignmentEvaluations: number;
  upcomingExams: Array<{ examName: string; subject: string; examDate: string }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface ParentDashboardDto {
  linkedChildren: Array<{ studentId: string; name: string; admissionNo: string; gender?: string; attendance: { total: number; present: number; percentage: number }; classTeacher?: { name: string; phone: string | null; email: string | null } | null; classRepresentative?: { name: string } | null }>;
  pendingFees: number; pendingFeesPaise: number;
  feeInvoices: Array<{ invoiceNo: string; status: string; total: number; paid: number; due: number; dueOn: string }>;
  upcomingExams: Array<{ examName: string; subject: string; examDate: string }>;
  timetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; section: string; sectionId: string | null }>;
  recentResults: Array<{ examName: string; subject: string; marks: number; maxMarks: number; grade: string }>;
  announcements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface WardenDashboardDto {
  hostelStudents: number; occupiedRooms: number; vacantBeds: number; totalCapacity: number; occupancyRate: number;
  maintenanceRooms: number; maintenanceRequests: number; openInquiries: number;
  openTickets: Array<{ id: string; subject: string; status: string; priority: string | null; raisedBy: string | null; createdAt: string }>;
  pendingLeaveCount: number;
  leaveRequests: Array<{ id: string; studentName: string; admissionNo: string; fromDate: string; toDate: string; reason: string; status: string }>;
  recentAllocations: Array<{ allocationId: string; studentName: string; admissionNo: string; roomNo: string; block: string; allottedAt: string }>;
}
export interface LibrarianDashboardDto {
  totalBooks: number; totalCopies: number; availableBooks: number; issuedBooks: number; overdueBooks: number;
  booksIssuedToday: number; booksReturnedToday: number;
  recentIssueHistory: Array<{ issueId: string; book: string; author: string; borrower: string; issuedAt: string; dueDate: string; status: string }>;
  recentReturnHistory: Array<{ issueId: string; book: string; author: string; borrower: string; returnedAt: string; fine: number }>;
}
export interface OwnerDashboardDto {
  totalStudents: number; activeCRMLeads: number;
  feesCollectedPaise: number; pendingFeesPaise: number; unpaidInvoices: number; collectionRate: number;
  admissionsSummary: Array<{ stage: string; count: number }>;
  recentAuditLogs: Array<{ _id: string; action: string; entityType: string | null; actorName: string | null; channel: string; createdAt: string }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface FinanceDashboardDto {
  pendingAmountPaise: number; collectedAmountPaise: number; totalBilled: number; collectionRate: number; invoiceCount: number;
  recentInvoices: Array<{ _id: string; invoiceNo: string; status: string; totalAmount: number; paidAmount: number; dueAmount: number; dueOn: string; studentName: string; admissionNo: string }>;
  pendingInvoices: Array<{ _id: string; invoiceNo: string; status: string; totalAmount: number; paidAmount: number; dueAmount: number; dueOn: string; studentName: string; admissionNo: string }>;
}




export interface TutorModeDto { key: string; label: string }
export interface TutorStatusDto { llmEnabled: boolean; modes: TutorModeDto[] }
export interface TutorSyllabusDto {
  enrollmentId: string;
  className: string;
  gradeName: string | null;
  subjects: Array<{ id: string; name: string; code: string | null }>;
}
/**
 * `generated: false` means no model produced this — `content` is null and
 * `scaffold` holds a study plan built from the student's own timetable and
 * results. The UI must label that difference rather than presenting a scaffold
 * as if it were a tutor's answer.
 */
export interface TutorReplyDto {
  mode: string; modeLabel: string;
  subject: string | null; topic: string; className: string;
  language: string; languageName: string;
  content: string | null;
  generated: boolean;
  reason?: string;
  scaffold?: string;
  groundedOn: { subjects: string[]; performance: { overall: number; weakest: string | null } | null };
  credits?: { charged: number; source: string; remaining: number };
}

export interface AiCreditPackDto { key: string; label: string; credits: number; amountPaise: number }
/**
 * `metered: false` is returned for staff — the school covers their AI usage —
 * so the balance fields are absent rather than zero. A UI that shows "0 credits
 * left" to a teacher would be reporting a limit that does not exist.
 */
export interface AiCreditStatusDto {
  metered: boolean;
  reason?: string;
  freeAllowance?: number; freeUsed?: number; freeRemaining?: number;
  paidBalance?: number; totalRemaining?: number;
  periodKey?: string; freeResetsOn?: string;
  lifetimeSpent?: number; lifetimePurchased?: number;
  onlinePaymentEnabled?: boolean;
  packs: AiCreditPackDto[];
}
export interface AiCreditOrderDto {
  id: string; orderNo: string; packKey: string; credits: number;
  amountPaise: number; status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'; paidAt: string | null;
}
export interface AiCreditPurchaseDto {
  order: AiCreditOrderDto;
  paid: boolean;
  linkKind?: 'IN_APP' | 'NONE';
  url?: string | null;
  message?: string;
  wallet?: { totalRemaining: number; paidBalance: number; freeRemaining: number };
}

export type NotificationType =
  | 'ANNOUNCEMENT' | 'ASSIGNMENT' | 'MARKS' | 'ATTENDANCE'
  | 'FEES' | 'LIBRARY' | 'TICKET' | 'LEAVE' | 'SYSTEM';

export interface NotificationDto {
  _id: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface ReportCardSubject {
  exam: string; subject: string; marks: number | null; maxMarks: number;
  percentage: number | null; grade: string | null; gradePoints: number | null; descriptor: string | null;
}
export interface ReportCardDto {
  student: { name: string; class: string };
  exam: string;
  generatedAt: string;
  subjects: ReportCardSubject[];
  summary: {
    totalMarks: number; totalMaxMarks: number; percentage: number | null;
    grade: { label: string; points: number; descriptor: string } | null;
    gpa: number | null; subjectsMarked: number; subjectsTotal: number;
    passed: boolean | null; failedSubjects: string[];
  };
}
export interface FeeHeadDto { _id: string; name: string; category: string }
export interface FeeStructureDto {
  _id: string; name: string; amountPaise: number; dueOn: string;
  feeHeadId?: { _id: string; name: string; category: string } | null;
  gradeId?: { _id: string; name: string } | null;
}
export interface GenerateInvoicesResult {
  generated: number; skipped: number; totalPaise: number; dryRun: boolean;
  invoices: Array<{ invoiceNo: string; enrollmentId: string; totalPaise: number }>;
}

export interface AcademicYearDto {
  _id: string; name: string; startsOn: string; endsOn: string; isCurrent?: boolean;
}

export interface AgentTool { name: string; description: string; mutates: boolean }

export interface AgentProposedAction {
  id: string;
  confirmToken: string;
  summary: string;
  tool: string;
  affectsOthers: boolean;
  expiresInMinutes: number;
}

export interface AgentReply {
  reply: string;
  /** Language the assistant answered in, echoed back by the server. */
  lang?: string;
  data?: unknown;
  action: AgentProposedAction | null;
  flagged?: string;
  suggestions?: string[];
}
