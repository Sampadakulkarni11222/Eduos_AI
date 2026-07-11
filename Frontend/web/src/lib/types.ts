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
  enrollment: { id: string; rollNo: number | null; class: string } | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SectionDto { id: string; name: string; gradeName: string; classTeacher?: string | null }
export interface OfferingDto { id: string; subject: string; subjectId?: string; sectionId: string; sectionName: string; teacherName?: string | null }
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
export interface AssignmentDto { id: string; title: string; description?: string | null; type: string; dueAt: string; maxMarks: number | null; subject: string; class: string; subjectOfferingId?: string | null; submissionCount: number; mySubmission?: MySubmission | null }
export interface SubmissionRow { enrollmentId: string; rollNo: number | null; studentName: string; status: string; submittedAt: string | null; marks: number | null; feedback: string | null; attachments: string[] }
export interface SubmissionRoster { assignment: { id: string; title: string; dueAt: string | null; maxMarks: number | null }; rows: SubmissionRow[] }
export interface TimetableSlotDto { id: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subject: string | null; teacher: string | null; subjectOfferingId: string | null; isBreak: boolean }
export interface TimetableDto { section: { id: string; name: string }; slots: TimetableSlotDto[] }
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

export interface InvoiceDto { id: string; invoiceNo: string; studentName: string; class: string | null; status: string; totalPaise: number; paidPaise: number; dueOn: string }
export interface FeeSummary { totalBilledPaise: number; totalCollectedPaise: number; pendingPaise: number; pendingCount: number; collectionPct: number }
export interface AnnouncementDto { id: string; title: string; content: string; publishedAt: string; author: string | null }
export interface TicketDto { id: string; subject: string; status: string; priority: string; routedToRoleKey: string | null; raisedBy: string; createdAt: string; messageCount: number }
export interface TicketThread { id: string; subject: string; status: string; routedToRoleKey: string | null; messages: Array<{ id: string; body: string; channel: string; mine: boolean; createdAt: string }> }
export interface MedicalDto { studentId: string; bloodGroup: string | null; heightCm: number | null; weightKg: number | null; emergencyContact: { name: string; phone: string; relation: string } | null; allergies: string[]; medications: string[]; history: string | null }
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
export interface DocumentDto { id: string; title: string; type: string; fileUrl: string; mimeType: string; visibleToRoles: string[]; studentId: string | null; studentName: string | null; academicYearId: string | null; issuedAt: string }

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
  todayTimetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string }>;
  upcomingClasses: Array<{ periodNo: number; startTime: string; subject: string }>;
  pendingAssignments: number;
  examSchedule: Array<{ examName: string; subject: string; examDate: string; maxMarks?: number }>;
  feeStatus: { totalFees: number; paidFees: number; pendingFees: number; pendingInvoices: number };
  borrowedBooks: Array<{ title: string; author: string; dueDate: string; status: string; fine: number }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface TeacherDashboardDto {
  assignedClasses: Array<{ sectionId: string; sectionName: string; gradeName: string }>;
  totalStudents: number;
  todayTimetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; section: string }>;
  attendanceSummary: Record<string, number>;
  pendingAssignmentEvaluations: number;
  upcomingExams: Array<{ examName: string; subject: string; examDate: string }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface ParentDashboardDto {
  linkedChildren: Array<{ studentId: string; name: string; admissionNo: string; gender?: string; attendance: { total: number; present: number; percentage: number } }>;
  pendingFees: number; pendingFeesPaise: number;
  feeInvoices: Array<{ invoiceNo: string; status: string; total: number; paid: number; due: number; dueOn: string }>;
  upcomingExams: Array<{ examName: string; subject: string; examDate: string }>;
  timetable: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; section: string }>;
  recentResults: Array<{ examName: string; subject: string; marks: number; maxMarks: number; grade: string }>;
  announcements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface WardenDashboardDto {
  hostelStudents: number; occupiedRooms: number; vacantBeds: number; totalCapacity: number; occupancyRate: number;
  maintenanceRooms: number; maintenanceRequests: number; openInquiries: number;
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
  feesCollectedPaise: number; pendingFeesPaise: number; unpaidInvoices: number;
  admissionsSummary: Array<{ stage: string; count: number }>;
  recentAuditLogs: Array<{ _id: string; subject?: string; status?: string; createdAt: string }>;
  recentAnnouncements: Array<{ _id: string; title: string; content: string; publishedAt: string }>;
}
export interface FinanceDashboardDto {
  pendingAmountPaise: number; collectedAmountPaise: number; totalBilled: number; collectionRate: number; invoiceCount: number;
  recentInvoices: Array<{ _id: string; invoiceNo: string; status: string; totalAmount: number; paidAmount: number; dueAmount: number; dueOn: string; studentName: string; admissionNo: string }>;
  pendingInvoices: Array<{ _id: string; invoiceNo: string; status: string; totalAmount: number; paidAmount: number; dueAmount: number; dueOn: string; studentName: string; admissionNo: string }>;
}



