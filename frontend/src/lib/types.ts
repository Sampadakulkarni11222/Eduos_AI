export type RoleKey =
  | 'SUPER_ADMIN'
  | 'ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'PARENT'
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
export interface AttendanceSummaryDto { PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number; workingDays: number; pctPresent: number | null }
export interface StudentOverviewDto {
  id: string;
  admissionNo: string;
  name: string;
  dob: string | null;
  gender: string | null;
  address: string | null;
  photoUrl: string | null;
  enrollment: {
    id: string; rollNo: number | null; class: string;
    sectionId?: string | null; academicYearId?: string | null;
    classTeacher?: { name: string; phone: string | null; email: string | null } | null;
    classRepresentative?: { name: string } | null;
  } | null;
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

/**
 * Page-numbered result. Endpoints that accept `page`/`pageSize` return this
 * shape; called without those params they still return a plain array, so
 * existing "load everything" callers are unaffected.
 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SectionDto { id: string; name: string; gradeName: string; classTeacher?: string | null; classTeacherId?: string | null; classRepresentativeId?: string | null }
export interface OfferingDto { id: string; subject: string; subjectId?: string; sectionId: string; sectionName: string; gradeName?: string; teacherId?: string | null; teacherName?: string | null; isElective?: boolean; capacity?: number | null }
export interface GradeDto { id: string; name: string; level: number }
export interface SubjectDto { id: string; name: string; code?: string | null }
export interface TermDto { id: string; academicYearId: string; name: string; startsOn: string; endsOn: string }

// Actual shape of GET /users (account + nested profiles) — distinct from the
// flattened UserDto below, which some pages construct client-side.
export interface StaffAccountDto {
  accountId: string;
  displayName: string | null;
  profiles: { profileId: string; displayName: string; role: string | null }[];
  // Also present on the /users response and used by the staff directory.
  id?: string;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
}
export interface RosterRow { enrollmentId: string; rollNo: number | null; studentName: string; status: AttStatus | null; note: string | null }
export type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY';
export interface TimetabledPeriod {
  periodNo: number;
  subject: string;
  subjectId?: string | null;
  /** Who teaches this period, so the register says whose it is. */
  subjectTeacher?: string | null;
  startTime: string | null;
  endTime: string | null;
  /**
   * Whether *this* caller may mark this period. The server decides: a subject
   * teacher gets their own periods, the class teacher gets all of them, and a
   * school-wide grant gets everything. Offering a period the server would
   * refuse is how a teacher ends up marking a roll and losing it at save time.
   */
  canMark?: boolean;
}
/** `periodNo: null` is whole-day attendance; `periods` lists what is timetabled that weekday. */
export interface AttendanceRoster {
  section: {
    id: string;
    name: string;
    grade?: string | null;
    sectionName?: string | null;
    classTeacher?: string | null;
  };
  date: string;
  periodNo: number | null;
  subject: string | null;
  subjectTeacher?: string | null;
  /** Whole-day marking belongs to the class teacher. */
  canMarkWholeDay?: boolean;
  /** Whether the slot currently selected is markable by this caller. */
  canMark?: boolean;
  periods: TimetabledPeriod[];
  roster: RosterRow[];
}
export interface MySubmission { status: 'PENDING' | 'SUBMITTED' | 'LATE' | 'GRADED' | 'EXEMPT'; submittedAt: string | null; marks: number | null; feedback: string | null; attachments: string[] }
export interface AssignmentDto {
  id: string; title: string; description?: string | null; type: string; chapter?: string | null;
  dueAt: string; maxMarks: number | null; attachments: string[]; subject: string; subjectId?: string | null;
  /** Who set the work, from the subject offering. Null when the offering has no teacher. */
  teacher?: string | null;
  class: string;
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
  results: Array<{
    exam: string; subject: string; marks: number | null; maxMarks: number; pct: number | null;
    // Populated since the year/term history view; older callers ignore them.
    examId?: string | null; examDate?: string | null;
    termId?: string | null; termName?: string | null;
    academicYearId?: string | null; academicYearName?: string | null;
  }>;
}
export interface ExamDto { id: string; name: string; startsOn: string; endsOn: string }
export interface ExamSubjectDto { id: string; examId: string; examName: string; subject: string; class: string; maxMarks: number; examDate: string | null }
export interface MarkRow { enrollmentId: string; rollNo: number | null; studentName: string; marks: number | null; gradeLabel: string | null; remarks: string | null; status: 'PENDING' | 'DRAFT' | 'REVIEW' | 'PUBLISHED' }
export interface MarksGrid { examSubject: { id: string; examName: string; subject: string; class: string; maxMarks: number }; rows: MarkRow[] }
export interface CalendarEventDto { id: string; title: string; description: string | null; type: string; startsAt: string; endsAt: string }

// ── Attendance calendar & trend ──
export interface AttendanceDayDto { date: string; status: AttStatus }
export interface AttendanceCalendarDto { enrollmentId: string; month: string; days: AttendanceDayDto[] }
export interface AttendanceTrendPointDto { month: string; pctPresent: number | null; presentDays: number; workingDays: number }

/**
 * `basis` says where these numbers come from — PERIOD is a true per-subject
 * figure; DAY means the day's status was attributed to each subject timetabled
 * that day, so subjects taught daily will legitimately read alike.
 */
export interface SubjectAttendanceRow {
  subjectOfferingId: string; subject: string; subjectId: string | null;
  present: number; absent: number; leave: number;
  totalSessions: number; periodBacked: number;
  pctPresent: number | null; derived: boolean;
}
export interface SubjectAttendanceDto {
  enrollmentId: string; yearMonth: string;
  basis: 'PERIOD' | 'DAY' | 'MIXED';
  subjects: SubjectAttendanceRow[];
}

// ── Leave applications ──
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface LeaveApplicationDto {
  _id: string; enrollmentId: string; fromDate: string; toDate: string; reason: string;
  status: LeaveStatus; remarks: string | null; createdAt: string;
  /** Optional supporting document, e.g. a medical certificate. Null when none was attached. */
  documentUrl?: string | null; documentName?: string | null;
}
/** LeaveApplicationDto plus the applicant fields listForReview() joins in for a teacher's queue. */
export interface LeaveRequestDto extends LeaveApplicationDto {
  studentName: string; admissionNo: string | null;
}

// ── Elective subject registration ──
export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

/** One elective on offer to the student's class, plus their own standing on it. */
export interface AvailableElectiveDto {
  subjectOfferingId: string;
  subjectName: string;
  subjectCode: string | null;
  termName: string | null;
  teacherName: string | null;
  /** null = uncapped. */
  capacity: number | null;
  seatsTaken: number;
  /** null when uncapped. */
  seatsLeft: number | null;
  isFull: boolean;
  myRegistrationId: string | null;
  myStatus: RegistrationStatus | null;
  myDecisionNote: string | null;
}

export interface SubjectRegistrationDto {
  id: string;
  status: RegistrationStatus;
  studentId: string;
  studentName: string | null;
  admissionNo: string | null;
  subjectOfferingId: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  termName: string | null;
  teacherName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  requestedAt: string;
}

export interface InvoiceDto { id: string; invoiceNo: string; studentName: string; class: string | null; status: string; totalPaise: number; paidPaise: number; dueOn: string; sectionId?: string; studentId?: string; enrollmentId?: string; academicYearId?: string; academicYearName?: string; planId?: string | null; installmentSeq?: number | null; createdAt?: string }
export interface FeeSummary { totalBilledPaise: number; totalCollectedPaise: number; pendingPaise: number; pendingCount: number; collectionPct: number; overduePaise: number; overdueCount: number; onlinePaymentEnabled?: boolean }
/** `roleKeys` narrows a class-wise notice to one role, e.g. the parents of a section. */
export interface AnnouncementAudience {
  all: boolean; gradeIds: string[]; sectionIds: string[]; subjectIds: string[]; roleKeys?: string[];
}
export interface AnnouncementChannels { app: boolean; email: boolean; whatsapp: boolean }
export interface AnnouncementDto {
  id: string; title: string; content: string; publishedAt: string;
  audience: AnnouncementAudience; audienceLabel: string; channels: AnnouncementChannels;
  attachments?: string[];
}

/** What the composer sends, for both the preview and the publish call. */
export interface AnnouncementDraft {
  title: string;
  content: string;
  audience?: { all?: boolean; gradeIds?: string[]; sectionIds?: string[]; subjectIds?: string[]; roleKeys?: string[] };
  channels?: { app?: boolean; email?: boolean; whatsapp?: boolean };
  attachments?: string[];
}

/**
 * The server's answer to "what would this send, and to whom".
 *
 * The channel renderings are built server-side so the preview cannot drift
 * from the fan-out; `null` means that channel is switched off.
 */
export interface AnnouncementPreviewDto {
  title: string;
  content: string;
  audience: AnnouncementAudience;
  audienceLabel: string;
  recipientCount: number;
  channels: AnnouncementChannels;
  attachments: string[];
  email: { subject: string; body: string; attachments: string[] } | null;
  whatsapp: { body: string; attachments: string[] } | null;
}
export interface TicketDto { id: string; subject: string; status: string; priority: string; routedToRoleKey: string | null; raisedBy: string; assignedTo?: string | null; studentName?: string | null; createdAt: string; messageCount: number }
export interface TicketThread { id: string; subject: string; status: string; routedToRoleKey: string | null; studentName?: string | null; documentUrl?: string | null; documentName?: string | null; messages: Array<{ id: string; body: string; channel: string; mine: boolean; createdAt: string }> }
export interface MedicalDto { studentId: string; bloodGroup: string | null; heightCm: number | null; weightKg: number | null; emergencyContact: { name: string; phone: string; relation: string } | null; allergies: string[]; medications: string[]; history: string | null; attachments?: Array<{ name: string; fileUrl: string }> | null }
export interface LeadCard { id: string; childName: string; guardianName: string; gradeApplying: string | null; source: string; nextActionAt: string | null; assigneeProfileId?: string | null; assigneeName?: string | null }
export interface Pipeline { stages: string[]; byStage: Record<string, LeadCard[]> }
export interface LeadInteractionDto { id: string; type: string; body: string; authorName: string | null; createdAt: string }
export interface LeadDetailDto {
  id: string;
  childName: string;
  guardianName: string;
  phone: string | null;
  email: string | null;
  gradeApplying: string | null;
  source: string;
  stage: string;
  notes: string | null;
  nextActionAt: string | null;
  assigneeName: string | null;
  assigneeProfileId: string | null;
  createdAt: string;
  updatedAt: string | null;
  interactions: LeadInteractionDto[];
}

export interface GrowthComponent { key: string; label: string; raw: number; normalized: number; weight: number; points: number; detail: string }
export interface GrowthScore { enrollmentId: string; studentName: string; score: number; band: string; components: GrowthComponent[]; computedAt: string }
export interface RiskFeature { feature: string; value: string; contribution: number }
export interface RiskItem {
  enrollmentId: string;
  studentId?: string | null;
  studentName: string;
  class: string;
  sectionId?: string | null;
  sectionName?: string | null;
  gradeName?: string | null;
  type: string;
  level: string;
  probability: number;
  topFeatures: RiskFeature[];
  summary: string;
}

/**
 * What the scan actually measured. `signalsEvaluated` counts every check run
 * (one per student per signal with data) — most come back at 0% and are not
 * flags. `flaggedSignals` counts the checks that crossed a threshold, and
 * `flaggedStudents` counts distinct students behind them.
 */
export interface RiskSummary {
  activeEnrollments: number;
  signalsEvaluated: number;
  flaggedSignals: number;
  flaggedStudents: number;
  studentsAtHighRisk: number;
  studentsAtMediumRisk: number;
  clearStudents: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface RiskScan {
  /** When the stored predictions were last computed. */
  computedAt?: string | null;
  items: RiskItem[];
  counts: Record<string, number>;
  summary?: RiskSummary;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

export interface RiskScanParams {
  /** Forces the expensive rescoring pass; omit to read the stored predictions. */
  refresh?: boolean;
  level?: string;
  type?: string;
  sectionId?: string;
  gradeName?: string;
  search?: string;
  minProbability?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'probability' | 'level' | 'student' | 'class' | 'category';
  sortDir?: 'asc' | 'desc';
}

export interface WaSimReply { reply: string; buttons: Array<{ id: string; title: string }> | null }

/**
 * `enabled: false` carries a `reason` (disabled, no number configured, or the
 * caller is staff) and no link — the client hides the entry point rather than
 * rendering a button that cannot work.
 */
export type WhatsappAssistantLink =
  | { enabled: true; phone: string; message: string; url: string }
  | { enabled: false; reason: string };

// ── Phase 8: Transport ──
export interface TransportRouteDto { id: string; name: string; operatorName: string | null; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; status: string; stopCount: number; /** Yearly fare in paise; 0 means the route carries no charge. */ fareAmountPaise?: number }
export interface TransportStopDto { id: string; routeId: string; name: string; sequenceNo: number; etaMinutesFromStart: number }
export interface MyBusDto { route: Omit<TransportRouteDto, 'stopCount'>; stop: TransportStopDto; direction: string; nextEta: string | null }

/**
 * One student's travel arrangements as a class list shows them.
 *
 * `route` and `stop` are null for a student who does not travel by school
 * transport - a real answer, which is why `status` says NOT_ENROLLED rather
 * than the row being absent.
 */
export interface TransportRosterRow {
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  rollNo: number | null;
  class: string | null;
  sectionId: string | null;
  route: { id: string; name: string; vehicleNo: string | null } | null;
  stop: { id: string; name: string; etaMinutesFromStart: number | null } | null;
  direction: string | null;
  status: 'ENROLLED' | 'NOT_ENROLLED';
}

// ── Phase 8: Library ──
/** What kind of catalogue row this is. A note and a question paper are library
 *  resources, filed and searched by the same code that serves the books. */
export type LibraryResourceKind = 'BOOK' | 'NOTE' | 'QUESTION_PAPER';

export interface BookDto {
  id: string; title: string; author: string; isbn: string | null; category: string;
  resourceType?: 'PHYSICAL' | 'DIGITAL'; resourceUrl?: string | null;
  publisher?: string | null; publishedYear?: number | null;
  totalCopies: number; availableCopies: number;

  resourceKind?: LibraryResourceKind;
  subjectId?: string | null; subject?: string | null;
  gradeId?: string | null; grade?: string | null;
  academicYearId?: string | null; academicYear?: string | null;
  language?: string | null;
  examType?: string | null;
  /** A note that is written rather than uploaded keeps its text here. */
  body?: string | null;
  uploadedBy?: string | null;
  uploadedAt?: string | null;
}
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A student's request for a copy of a book, and what was decided on it. */
export interface BookRequestDto {
  id: string;
  status: RequestStatus;
  bookId: string | null;
  bookTitle: string | null;
  bookAuthor: string | null;
  availableCopies: number | null;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  /** The lending record an approval created. */
  issueId: string | null;
  requestedAt: string;
}

/**
 * A route a student may ask for. Deliberately without the driver's name and
 * phone number: those come with the route you are actually on, from myBus().
 */
export interface AvailableRouteDto {
  id: string;
  name: string;
  operatorName: string | null;
  vehicleNo: string | null;
  fareAmountPaise: number;
  /**
   * Not TransportStopDto: the picker is sent only what choosing needs, so
   * these carry no routeId and the ETA may be absent.
   */
  stops: { id: string; name: string; sequenceNo: number; etaMinutesFromStart?: number }[];
}

export interface TransportRequestDto {
  id: string;
  status: RequestStatus;
  routeId: string | null;
  routeName: string | null;
  vehicleNo: string | null;
  stopId: string | null;
  stopName: string | null;
  direction: 'BOTH' | 'PICKUP' | 'DROP';
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  fareAmountPaise: number;
  /** The invoice an approval raised for the fare, if the route carries one. */
  invoiceId: string | null;
  busEnrollmentId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  requestedAt: string;
}

/** What the student's route picker needs in one call. */
export interface AvailableRoutesDto {
  routes: AvailableRouteDto[];
  myRequest: TransportRequestDto | null;
  myRouteId: string | null;
  canRequest: boolean;
}

export interface BookIssueDto { id: string; bookId: string; bookTitle: string; bookAuthor?: string | null; category?: string | null; resourceType?: 'PHYSICAL' | 'DIGITAL'; resourceUrl?: string | null; studentId: string; studentName: string; issuedAt: string; dueAt: string; returnedAt: string | null; status: 'ACTIVE' | 'RETURNED' | 'OVERDUE'; finePaise: number }

// ── Phase 8: Documents ──
export interface DocumentDto { id: string; title: string; type: string; fileUrl: string; mimeType: string; visibleToRoles: string[]; studentId: string | null; studentName: string | null; academicYearId: string | null; sectionId?: string | null; subjectOfferingId?: string | null; issuedAt: string }

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorProfileId?: string | null;
  actorName: string | null;
  actorRole: string | null;
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

/** Cheque / DD / bank-transfer details captured with a manual payment. */
export interface PaymentInstrumentDto {
  number: string | null;
  /** The transfer's UTR / reference id. Null on cheque and DD. */
  referenceNo?: string | null;
  bankName: string | null;
  instrumentDate: string | null;
  proofUrl: string | null;
  proofName: string | null;
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
  /**
   * Where the record sits in the approval workflow. Families are only ever
   * served PUBLISHED rows, so on the student portal this is always PUBLISHED;
   * staff screens use it to tell settled money from a queued record.
   */
  recordStatus?: 'PENDING_ADMIN_APPROVAL' | 'PUBLISHED' | 'REJECTED';
  paidOn?: string;
  instrument?: PaymentInstrumentDto | null;
  createdAt: string;

  /**
   * The verification facing of the same record: `recordStatus` in the words
   * the finance office uses, plus who made the call and when. Derived
   * server-side from `recordStatus`, never stored twice.
   */
  verificationStatus?: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';
  recordedBy?: string | null;
  recordedByRole?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
}

// ── Fee plans (installment configuration + approval workflow) ──
export type FeePlanMode = 'ONE_TIME' | 'PARTIAL' | 'INSTALLMENT';

export type FeePlanStatus =
  | 'DRAFT'
  | 'PENDING_FINANCE_REVIEW'
  | 'FINANCE_REVIEWED'
  | 'PENDING_ADMIN_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'PUBLISHED';

export interface FeePlanInstallmentDto {
  seq: number;
  label: string | null;
  amountPaise: number;
  dueOn: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  paidPaise: number;
  remainingPaise: number;
  status: 'NOT_BILLED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'DUE';
}

export interface FeePlanDto {
  id: string;
  name: string;
  mode: FeePlanMode;
  status: FeePlanStatus;
  academicYearId: string;
  academicYearName: string | null;
  studentId: string;
  enrollmentId: string;
  totalPaise: number;
  paidPaise: number;
  remainingPaise: number;
  firstPaymentOn: string | null;
  notes: string | null;
  installments: FeePlanInstallmentDto[];
  publishedAt: string | null;
  createdAt: string;
}

/** Who did what to a plan — shown on the admin review screen. */
export interface FeePlanWorkflowDto {
  createdBy: string | null;
  createdByRole: string | null;
  createdAt: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  financeReviewedBy: string | null;
  financeReviewedAt: string | null;
  financeNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  publishedAt: string | null;
}

export interface FeePlanDetailDto extends FeePlanDto {
  studentName: string | null;
  admissionNo: string | null;
  workflow: FeePlanWorkflowDto;
}

export interface PaymentChangeRequestDto {
  id: string;
  paymentId: string;
  receiptNo: string;
  field: string;
  currentValue: string | null;
  requestedValue: string | null;
  reason: string;
  documentUrl: string | null;
  documentName: string | null;
  status: 'PENDING_ADMIN_APPROVAL' | 'APPROVED' | 'REJECTED';
  requestedBy: string | null;
  requestedByRole: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface PaymentHistoryDto {
  id: string;
  receiptNo: string;
  amountPaise: number;
  mode: string;
  recordStatus: string;
  createdBy: string | null;
  createdByRole: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  changeRequests: PaymentChangeRequestDto[];
  trail: Array<{
    id: string;
    action: string;
    actor: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    at: string;
  }>;
}

/** An academic year the caller actually has fee records for. */
export interface PaymentAcademicYearDto {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  invoiceCount: number;
}

/**
 * Everything the student payment page shows for ONE academic year.
 *
 * The year is resolved server-side and every list inside belongs to it, which
 * is what keeps two years from ever appearing in the same table.
 */
export interface PaymentOverviewDto {
  years: PaymentAcademicYearDto[];
  academicYearId: string | null;
  academicYearName?: string;
  summary: FeeSummary | null;
  plans: FeePlanDto[];
  invoices: InvoiceDto[];
  payments: PaymentReceiptDto[];
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

/** What `/oakridge` can learn about a school before anyone signs in. */
/**
 * A school's public identity — everything its sign-in door may show before
 * anyone has signed in. Branding only: no option lists, no audit fields.
 */
export interface PublicSchoolDto {
  slug: string;
  name: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  tagline?: string | null;
  /** Computed server-side, the same way a portal's are. */
  cssVariables?: Record<string, string>;
}

// ── Schools (Super Admin) ──
/** A school is the tenant already carried on every profile. */
export interface SchoolDto {
  /** The school's id and the first segment of its portal URL. */
  slug: string;
  /** The same value, under the name the tenant fields have always used. */
  tenantId: string;
  tenantName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  profileCount: number;
  adminCount: number;
  activeAdminCount: number;
  createdAt: string | null;
}

export interface SchoolAdminDto {
  profileId: string;
  accountId: string;
  displayName: string;
  roleKey: RoleKey;
  tenantId: string;
  tenantName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  accountStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | null;
  phone: string | null;
  email: string | null;
  /** The school's website as entered on this profile; feeds domain management. */
  website: string | null;
  createdAt: string;
}

// ── School domains ──

export type DomainType = 'SUBDOMAIN' | 'CUSTOM';
export type DomainSource = 'MANUAL' | 'PROFILE';
/** What the School Admin profile's website gives. */
export type ProfileDomainStatus = 'FOUND' | 'NOT_PROVIDED' | 'INVALID' | 'CONFLICT';
/** The profile's domain compared with the school's configuration. */
export type ProfileDomainSync = 'NOT_PROVIDED' | 'INVALID' | 'CONFLICT' | 'DUPLICATE' | 'NOT_CONFIGURED' | 'IN_SYNC' | 'CHANGED';
export type PendingProfileChange = 'CHANGED' | 'REMOVED' | 'INVALID' | 'CONFLICT' | 'DUPLICATE';

export interface PendingProfileDomainDto {
  change: PendingProfileChange;
  hostname: string | null;
  website: string | null;
  profileName: string | null;
  detectedAt: string;
}

export interface ProfileDomainDto {
  status: ProfileDomainStatus;
  /** Null unless FOUND. Never guessed. */
  hostname: string | null;
  website?: string;
  profileId?: string;
  profileName?: string;
  error?: string;
  candidates?: Array<{ hostname: string; profileName: string }>;
  takenByAnotherSchool: boolean;
  sync: ProfileDomainSync;
}
export type DomainVerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED';
export type DomainSslStatus = 'NOT_CHECKED' | 'ACTIVE' | 'FAILED';
/** INCONCLUSIVE: the resolver or handshake could not be completed; nothing changed. */
export type DomainCheckOutcome = 'VERIFIED' | 'FAILED' | 'ACTIVE' | 'INCONCLUSIVE';

export interface DomainDnsRecordDto {
  purpose: 'OWNERSHIP' | 'ROUTING';
  type: 'TXT' | 'CNAME' | 'ALIAS';
  name: string;
  /** Null when the deployment has not configured the value (e.g. no CNAME target). */
  value: string | null;
  managedBy: 'SCHOOL' | 'PLATFORM';
  note: string;
}

export interface DomainDnsInstructionsDto {
  summary: string;
  records: DomainDnsRecordDto[];
  steps: string[];
  warning?: string;
}

export interface SchoolDomainDto {
  tenantId: string;
  tenantName: string | null;
  type: DomainType;
  subdomain: string | null;
  customDomain: string | null;
  hostname: string;
  platformDomain: string | null;
  verificationStatus: DomainVerificationStatus;
  verificationRecordName: string | null;
  lastVerificationAt: string | null;
  lastVerificationError: string | null;
  verifiedAt: string | null;
  sslStatus: DomainSslStatus;
  sslCheckedAt: string | null;
  sslError: string | null;
  sslValidTo: string | null;
  sslIssuer: string | null;
  source: DomainSource;
  sourceProfileId: string | null;
  sourceProfileName: string | null;
  sourceWebsite: string | null;
  sourceFetchedAt: string | null;
  pendingProfileDomain: PendingProfileDomainDto | null;
  active: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  configuredBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  dnsInstructions: DomainDnsInstructionsDto | null;
}

export interface SchoolDomainSummaryDto {
  tenantId: string;
  tenantName: string;
  schoolStatus: 'ACTIVE' | 'SUSPENDED';
  configured: boolean;
  type: DomainType | null;
  hostname: string | null;
  verificationStatus: DomainVerificationStatus | null;
  sslStatus: DomainSslStatus | null;
  active: boolean;
  updatedAt: string | null;
  profileDomain: string | null;
  profileDomainStatus: ProfileDomainStatus;
  profileDomainSync: ProfileDomainSync;
  source: DomainSource | null;
  pendingProfileChange: PendingProfileChange | null;
}

export interface DomainSettingsDto {
  platformDomain: string | null;
  subdomainsEnabled: boolean;
  cnameTarget: string | null;
  reservedSubdomains: string[];
}

export interface DomainListDto {
  settings: DomainSettingsDto;
  schools: SchoolDomainSummaryDto[];
}

export interface SchoolDomainDetailDto {
  tenantId: string;
  tenantName: string;
  domain: SchoolDomainDto | null;
  profileDomain: ProfileDomainDto;
}

export interface DomainChangeDto {
  changed: boolean;
  domain: SchoolDomainDto;
}

export interface DomainCheckDto {
  outcome: DomainCheckOutcome;
  error: string | null;
  routing?: { expected: string | null; found: string[]; pointsAtPlatform: boolean | null; error?: string } | null;
  domain: SchoolDomainDto;
}

// ── School customization ──
/**
 * What one school is allowed to differ on.
 *
 * Every colour is nullable and null means "not customised" — the role theme in
 * design-system.css stands. There is no separate "is themed" flag to fall out
 * of step with the values.
 */
export interface SchoolThemeColorsDto {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

export interface SchoolBrandingDto {
  displayName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
}

/** Each flag names exactly one thing on screen — see the model's own note. */
export interface SchoolHeaderConfigDto {
  /** The school's name in the browser tab. */
  showSchoolName: boolean;
  /** The tagline under the page title. */
  showTagline: boolean;
}

export interface SchoolSidebarConfigDto {
  /** The logo mark in the brand block; falls back to an initial. */
  showLogo: boolean;
  /** The portal's name under the school's, e.g. "Admin Console". */
  showPortalLabel: boolean;
  /** The rail's starting state, until this device says otherwise. */
  defaultCollapsed: boolean;
}

export interface SchoolDropdownOptionDto {
  /** What a record stores. */
  value: string;
  /** What a person reads. */
  label: string;
  order: number;
}

export interface SchoolDropdownDto {
  key: string;
  label: string;
  options: SchoolDropdownOptionDto[];
}

/** What a portal needs to paint itself. Readable by any member of the school. */
export interface SchoolThemeDto {
  tenantId: string;
  theme: SchoolThemeColorsDto;
  branding: SchoolBrandingDto;
  header: SchoolHeaderConfigDto;
  sidebar: SchoolSidebarConfigDto;
  dropdowns: SchoolDropdownDto[];
  /** Computed server-side, so every client paints the same thing. */
  cssVariables: Record<string, string>;
}

/** The full configuration, as the customisation screen edits it. */
export interface SchoolCustomizationDto extends Omit<SchoolThemeDto, 'cssVariables'> {
  customized: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** One row of the platform's customisation console. */
export interface SchoolCustomizationSummaryDto {
  tenantId: string;
  tenantName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  customized: boolean;
  theme: SchoolThemeColorsDto;
  branding: SchoolBrandingDto;
  dropdownCount: number;
  updatedAt: string | null;
}

/** What the save would write, returned by the preview without writing it. */
export interface SchoolCustomizationInput {
  theme?: Partial<SchoolThemeColorsDto>;
  branding?: Partial<SchoolBrandingDto>;
  header?: Partial<SchoolHeaderConfigDto>;
  sidebar?: Partial<SchoolSidebarConfigDto>;
  dropdowns?: Array<{ key: string; label: string; options: Array<{ value: string; label: string; order?: number }> }>;
}

// ── Seats ──
/**
 * A school's seat position.
 *
 * `purchasedSeats` is what has been paid for; `approvedSeats` is what the
 * platform has released for use. Only the second one buys anybody a login, so
 * the gap between them — `awaitingApprovalSeats` — is a real state a screen has
 * to show rather than a rounding artefact.
 */
export interface SeatSummaryDto {
  tenantId: string;
  tenantName?: string;
  status?: 'ACTIVE' | 'SUSPENDED';
  purchasedSeats: number;
  approvedSeats: number;
  usedSeats: number;
  availableSeats: number;
  awaitingApprovalSeats: number;
  pendingRequestCount: number;
  pendingRequestSeats: number;
  provisioned: boolean;
  updatedAt: string | null;
  priceList?: SeatPriceListDto;
  /** Present on the platform list: this school's rate, resolved server-side. */
  unitPricePaise?: number;
  currency?: string;
  priceSource?: 'SCHOOL' | 'PLATFORM_DEFAULT';
}

/**
 * The rate in force for a school, as a screen shows it.
 *
 * `source` is the difference between "priced specifically at this rate" and
 * "not priced, so charged the platform default" — two states that look the same
 * if only the number is shown.
 */
export interface SeatPriceListDto {
  unitPricePaise: number;
  currency: string;
  source: 'SCHOOL' | 'PLATFORM_DEFAULT';
  seatPriceId: string | null;
  maxSeatsPerRequest: number;
  tiers: Array<{ minSeats: number; discountPct: number }>;
  version: string;
}

/** One version of a school's per-seat price. Prices are versioned, never edited. */
export interface SeatPriceDto {
  id: string;
  tenantId: string;
  unitPricePaise: number;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  effectiveFrom: string;
  effectiveTo: string | null;
  supersededByPriceId: string | null;
  note: string | null;
  setBy: string | null;
  deactivatedBy: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A school's current rate, as the platform pricing table lists it. */
export interface SchoolSeatPriceDto {
  tenantId: string;
  tenantName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  unitPricePaise: number;
  currency: string;
  source: 'SCHOOL' | 'PLATFORM_DEFAULT';
  seatPriceId: string | null;
  versionCount: number;
}

export type SeatRequestStatus = 'PENDING_PAYMENT' | 'PAID' | 'APPROVED' | 'REJECTED';
export type SeatPaymentStatus = 'UNPAID' | 'INITIATED' | 'PAID' | 'FAILED';

export interface SeatRequestDto {
  id: string;
  tenantId: string;
  seats: number;
  unitPricePaise: number;
  discountPct: number;
  amountPaise: number;
  currency: string;
  priceListVersion: string;
  /** Which price version priced this request, and whether the school had one. */
  seatPriceId: string | null;
  priceSource: 'SCHOOL' | 'PLATFORM_DEFAULT';
  pricedAt: string;
  status: SeatRequestStatus;
  paymentStatus: SeatPaymentStatus;
  paymentProvider: string | null;
  gatewayOrderRef: string | null;
  gatewayRef: string | null;
  receiptNo: string | null;
  paidAt: string | null;
  paymentFailureReason: string | null;
  requestedBy: string | null;
  requestedByProfileId: string | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeatHistoryEntryDto {
  id: string;
  tenantId: string;
  event: 'PURCHASE' | 'EXTRA_SEATS_PAID' | 'EXTRA_SEATS_APPROVED' | 'EXTRA_SEATS_REJECTED' | 'ADJUSTMENT';
  purchasedDelta: number;
  approvedDelta: number;
  purchasedAfter: number;
  approvedAfter: number;
  amountPaise: number | null;
  unitPricePaise: number | null;
  currency: string | null;
  requestId: string | null;
  actor: string | null;
  note: string | null;
  at: string;
}

/** What POST /seats/requests/:id/pay hands back. */
export interface SeatPaymentStartDto {
  requiresClientAction: boolean;
  requestId: string;
  provider: string | null;
  orderId?: string;
  keyId?: string;
  currency?: string;
  amountPaise: number;
  seats: number;
  sandbox?: boolean;
  receiptNo?: string;
  status?: string;
  reused?: boolean;
}

export interface CreateSchoolAdminDto {
  displayName: string;
  phone: string;
  email?: string;
  password?: string;
  website?: string;
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
/**
 * A per-row import report.
 *
 * Each failure names the row, the column, what is wrong with it and what to
 * put there instead, so a rejected sheet can be fixed without guesswork.
 * `error` is the same facts flattened into one sentence, kept because it is
 * what older callers render.
 */
export interface BulkRowError {
  row: number;
  field?: string | null;
  value?: string | number | null;
  problem?: string;
  suggestion?: string | null;
  error: string;
}

export interface BulkImportResult {
  imported: number;
  failed: number;
  errors: BulkRowError[];
}

// ── Online payments ──
/**
 * Result of POST /fees/pay.
 *
 * A real gateway cannot capture from the server, so it answers with an order
 * for the browser to complete (`requiresClientAction: true`) and no receipt —
 * the ledger only moves once the signed webhook arrives. The sandbox provider
 * captures immediately and returns the receipt fields. Callers must branch on
 * `requiresClientAction` before showing any confirmation.
 */
export interface PayOnlineResult {
  requiresClientAction?: boolean;
  orderId?: string; keyId?: string; currency?: string; amountPaise?: number;
  receiptNo: string; gatewayRef: string; provider: string; sandbox: boolean; status: string; paidPaise: number;
}

// ── Hostel ──
export interface HostelRoomDto { _id: string; roomNo: string; block: string; floor?: number | null; type: string; capacity: number; status: string; amenities?: string[]; occupied: number; available: number }
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

/* ── Student Study Help (Student Learning Buddy) — /ai/tutor/learn ──
   Student-only. The parent portal keeps using the Tutor* types above. */
export type LearnModeKey = 'explain' | 'worked' | 'questions' | 'quiz' | 'flashcards' | 'notes' | 'mindmap' | 'exam';
export interface LearnModeDto { key: LearnModeKey; label: string; description: string }
export interface LearnStatusDto {
  llmEnabled: boolean;
  modes: LearnModeDto[];
  skill: { name: string; version: string };
}
export interface MindMapNode { label: string; children: MindMapNode[] }
export type RedirectKind = 'off_topic' | 'integrity' | 'unsafe' | 'safety' | 'needs_detail';
/** A validated result. Every string is model text: render it as text, never as HTML. */
export type LearnResult =
  | { type: 'explain'; idea: string; example: string; steps: string[]; takeaway: string; checkQuestion: { prompt: string; answer: string } | null }
  | { type: 'worked'; problem: string; method: string; steps: string[]; finalAnswer: string; verification: string | null }
  | { type: 'questions'; questions: Array<{ prompt: string; hints: string[]; solution: string }> }
  | { type: 'quiz'; questions: Array<{ prompt: string; options: string[]; correctIndex: number; explanation: string }> }
  | { type: 'flashcards'; cards: Array<{ front: string; back: string }> }
  | { type: 'notes'; sections: Array<{ heading: string; points: string[] }>; commonConfusion: string | null; recallPrompts: Array<{ prompt: string; answer: string }> }
  | { type: 'mindmap'; root: MindMapNode }
  | { type: 'exam'; questions: Array<{ prompt: string; marks: number | null; formalAnswer: string; plainExplanation: string }> }
  | { type: 'redirect'; kind: RedirectKind; message: string };
/**
 * `generated: false` means no valid model answer is shown: `structured` is null,
 * `reasonMessage` says why, and `scaffold` is a study plan from the student's
 * own data. `generated: true` with a `redirect` result is a model reply that is
 * not a lesson (off-topic, safety, a clarifying question) and is never charged.
 */
export interface LearnReplyDto {
  mode: LearnModeKey; modeLabel: string;
  subject: string; topic: string; className: string;
  language: string; languageName: string;
  skill: { name: string; version: string };
  generated: boolean;
  structured: LearnResult | null;
  content: string | null;
  reason?: string;
  reasonMessage?: string;
  scaffold?: string;
  attempts: number;
  groundedOn: {
    subjects: string[];
    performance: { overall: number | null; weakest: string | null } | null;
    syllabus: { available: boolean; chapters: string[]; materialTitles: string[]; materialCount: number };
  };
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
  /** Real gateway: complete `orderId` in checkout, then call verifyAiCreditPurchase. */
  requiresClientAction?: boolean;
  provider?: string;
  orderId?: string; keyId?: string; currency?: string; amountPaise?: number;
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

/**
 * One earlier turn of an assistant conversation, as the client replays it.
 *
 * Transcript only. The server resolves who is asking from the session on every
 * turn, so nothing here establishes identity or what the caller may access.
 */
export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentReply {
  reply: string;
  /** Language the assistant answered in, echoed back by the server. */
  lang?: string;
  data?: unknown;
  action: AgentProposedAction | null;
  flagged?: string;
  suggestions?: string[];
  /** Present when the answer holds part of a longer list: how to load the next rows. */
  continuation?: AgentContinuation | null;
}

/**
 * The way to the next window of a long answer. The token is the server's own
 * (signed, bound to this person and school, short-lived); the client only
 * hands it back.
 */
export interface AgentContinuation {
  token: string;
  shown: { from: number; to: number };
  next: { from: number; to: number };
  total: number | null;
}

/* ── Student assignments: extra fields used by the student filters ──
   `teacher` comes from the subject offering, so a student can search their
   assignment list by who set the work. */

// ── Lecture-level attendance ──
export interface LectureAttendanceRow {
  id: string;
  date: string;
  dayOfWeek: number;
  periodNo: number;
  subject: string | null;
  teacher: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  status: AttStatus;
  note: string | null;
}
export interface LectureAttendanceDto {
  enrollmentId: string;
  from: string | null;
  to: string | null;
  totalLectures: number;
  counts: Record<AttStatus, number>;
  pctPresent: number | null;
  lectures: LectureAttendanceRow[];
}

// ── Performance history (year → term → results) ──
export interface PerformanceResultRow {
  exam: string;
  examId: string | null;
  examDate: string | null;
  termId: string | null;
  termName: string | null;
  academicYearId: string | null;
  academicYearName: string | null;
  subject: string;
  marks: number | null;
  maxMarks: number;
  pct: number | null;
}
export interface PerformanceSummary {
  totalMarks: number;
  totalMaxMarks: number;
  percentage: number | null;
  grade: { label: string; points: number; descriptor: string } | null;
  gpa: number | null;
  subjectsMarked: number;
  subjectsTotal: number;
  passed: boolean | null;
  failedSubjects: string[];
  subjects: Array<{
    subject: string; exam?: string; marks: number | null; maxMarks: number;
    percentage: number | null; grade: string | null; gradePoints: number | null;
  }>;
}
export interface PerformanceTermDto {
  termId: string | null;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  results: PerformanceResultRow[];
  summary: PerformanceSummary;
}
export interface PerformanceYearDto {
  academicYearId: string | null;
  academicYearName: string;
  startsOn: string | null;
  endsOn: string | null;
  isCurrent: boolean;
  enrollmentId: string;
  class: string | null;
  rollNo: number | null;
  enrollmentStatus: string;
  attendance: AttendanceSummaryDto | null;
  bestSubject: { subject: string; pct: number | null } | null;
  needsSupport: { subject: string; pct: number | null } | null;
  summary: PerformanceSummary;
  terms: PerformanceTermDto[];
}
export interface PerformanceHistoryDto {
  student: { name: string; class: string } | null;
  years: PerformanceYearDto[];
}

// ── Library filters ──
export type LibraryResourceType = 'PHYSICAL' | 'DIGITAL';
export interface BookFacetsDto {
  categories: string[];
  authors: string[];
  resourceTypes: string[];
  languages?: string[];
  examTypes?: string[];
}

// ── Student-raised requests reviewed by the class teacher ──
export type StudentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface CoCurricularActivityDto {
  id: string;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  name: string;
  category: string;
  description: string | null;
  activityDate: string | null;
  achievement: string | null;
  level: string;
  documentUrl: string | null;
  documentName: string | null;
  status: StudentRequestStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  requestedAt: string | null;
  class?: string | null;
}

export interface ProfileEditFieldDto {
  field: string;
  label: string;
  type: 'text' | 'date';
  required: boolean;
}

export interface ProfileEditChangeDto {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface ProfileEditRequestDto {
  id: string;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  changes: ProfileEditChangeDto[];
  note: string | null;
  documentUrl: string | null;
  documentName: string | null;
  status: StudentRequestStatus;
  rejectionReason: string | null;
  requestedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  class?: string | null;
}
