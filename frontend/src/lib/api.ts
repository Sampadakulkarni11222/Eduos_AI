/**
 * Typed API client with refresh-token rotation.
 * Access token lives in memory; refresh token in localStorage.
 * Production hardening (Phase 7): move refresh into an httpOnly cookie
 * behind a BFF route handler so it never touches JS-readable storage.
 */
import type { Me, Paged, ProfileSummary, StudentListItem, StudentOverviewDto, SectionDto, OfferingDto, GradeDto, SubjectDto, TermDto, StaffAccountDto, AttendanceRoster, AttStatus, AssignmentDto, TimetableDto, PerformanceDto, ExamDto, ExamSubjectDto, MarksGrid, CalendarEventDto, InvoiceDto, FeeSummary, AnnouncementDto, TicketDto, TicketThread, MedicalDto, Pipeline, GrowthScore, RiskScan, AiReply, WaSimReply, TransportRouteDto, TransportStopDto, MyBusDto, BookDto, BookIssueDto, BookReservationDto, DocumentDto, AuditLogDto, PaymentReceiptDto, UserDto, CreateUserDto, UpdateUserDto, UploadResult, PayOnlineResult, SubmissionRoster, HostelRoomDto, HostelAllocationDto, HostelSummaryDto, HostelPassDto, PermissionDto, RoleDto, AdminDashboardDto, StudentDashboardDto, TeacherDashboardDto, ParentDashboardDto, WardenDashboardDto, LibrarianDashboardDto, OwnerDashboardDto, FinanceDashboardDto, BulkImportResult, AttendanceCalendarDto, AttendanceTrendPointDto, LeaveApplicationDto, InvoiceDetailDto, NotificationDto, NotificationPage, ReportCardDto, FeeHeadDto, FeeStructureDto, GenerateInvoicesResult, AcademicYearDto, AgentReply, AgentTool, AiCreditStatusDto, AiCreditOrderDto, AiCreditPurchaseDto, SubjectAttendanceDto, WhatsappAssistantLink, TutorStatusDto, TutorSyllabusDto, TutorReplyDto, IncidentDto, PtThreadDto, PtMessageDto, PtThreadDetailDto, StudentTeacherDto } from './types';

// Backend URL – default to localhost:5000. Can be overridden via NEXT_PUBLIC_BACKEND_URL.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

const REFRESH_KEY = 'eduos.refresh';
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearSession() {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

export function hasSession(): boolean {
  return typeof window !== 'undefined' && !!localStorage.getItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

async function doRefresh(): Promise<boolean> {
  const token = localStorage.getItem(REFRESH_KEY);
  if (!token) return false;
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  });
  if (!res.ok) {
    clearSession();
    return false;
  }
  const body = await res.json();
  // Backend wraps all responses in { success, message, data }
  setSession(body?.data ?? body);
  return true;
}

function refresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried && (await refresh())) {
    return request<T>(path, init, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Backend error shape: { success: false, message: string } OR { error: { code, message } }
    const msg = body?.message ?? body?.error?.message;
    const code = body?.error?.code ?? 'ERROR';
    throw new ApiError(res.status, code, msg);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // Backend wraps all success responses in { success: true, message: string, data: T }
  return (json?.data !== undefined ? json.data : json) as T;
}

/** Raw-body file upload; returns the stored file's public URL. */
async function uploadFile(file: File): Promise<UploadResult> {
  const res = await fetch(`${BACKEND_URL}/api/v1/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'UPLOAD_FAILED', body?.message ?? 'Upload failed');
  }
  const json = await res.json();
  return (json?.data ?? json) as UploadResult;
}

/** Multipart CSV upload (bulk imports). Extra non-file fields go alongside the file. */
async function uploadCsv(path: string, file: File, fields: Record<string, string> = {}): Promise<BulkImportResult> {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file);
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'UPLOAD_FAILED', body?.message ?? 'Upload failed');
  }
  const json = await res.json();
  return (json?.data ?? json) as BulkImportResult;
}

/** Turn a stored fileUrl (which may be server-relative "/uploads/…") into an absolute link. */
export function fileHref(fileUrl: string): string {
  if (!fileUrl) return '#';
  return fileUrl.startsWith('/') ? `${BACKEND_URL}${fileUrl}` : fileUrl;
}

/**
 * Opens a protected (auth-gated) file endpoint in a new tab.
 * Auth here is a Bearer token held in memory, not a cookie — a plain
 * `<a href>` to an endpoint behind `authenticate` would 401. This fetches
 * the bytes with the Authorization header attached, then opens the result
 * as a blob URL, so the browser still renders/downloads it like a normal link.
 */
async function openProtectedFile(path: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'FILE_ERROR', body?.message ?? 'Could not open this file.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  requestOtp: (phone: string) =>
    request<{ message: string; devOtp?: string }>('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) }),

  requestEmailOtp: (email: string) =>
    request<{ message: string; devOtp?: string }>('/auth/otp/email/request', { method: 'POST', body: JSON.stringify({ email }) }),

  verifyEmailOtp: (email: string, code: string) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/otp/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) },
    ),

  googleLogin: (idToken: string) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) },
    ),

  verifyOtp: (phone: string, code: string) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) },
    ),

  passwordLogin: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) },
    ),

  selectProfile: (profileId: string) =>
    request<{ accessToken: string; refreshToken: string }>('/auth/profile/select', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  me: () => request<Me>('/auth/me'),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  students: async (params: { search?: string; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    const res: any = await request<any>(`/students${qs ? `?${qs}` : ''}`);
    return (Array.isArray(res) ? { items: res } : res) as Paged<StudentListItem>;
  },
  createStudent: (body: { firstName: string; lastName?: string; admissionNo: string; sectionId?: string }) =>
    request<StudentListItem>('/students', { method: 'POST', body: JSON.stringify(body) }),
  studentOverview: (id: string) => request<StudentOverviewDto>(`/students/${id}/overview`),
  setStudentPhoto: (id: string, photoUrl: string) =>
    request<{ id: string; photoUrl: string }>(`/students/${id}/photo`, { method: 'PATCH', body: JSON.stringify({ photoUrl }) }),
  bulkAssignSection: (file: File, sectionId: string, academicYearId: string) =>
    uploadCsv('/enrollments/bulk', file, { sectionId, academicYearId }),

  // ── audit ──
  auditLogs: (params: { cursor?: string; action?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.action) q.set('action', params.action);
    const qs = q.toString();
    return request<Paged<AuditLogDto>>(`/audit/logs${qs ? `?${qs}` : ''}`);
  },

  // ── users ──
  listUsers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<UserDto[]>(`/users${qs}`);
  },
  createUser: (body: CreateUserDto) =>
    request<UserDto>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: UpdateUserDto) =>
    request<UserDto>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  bulkCreateUsers: (file: File) => uploadCsv('/users/bulk', file),


  // ── academics helpers ──
  mySections: () => request<SectionDto[]>('/academics/sections/mine'),
  myOfferings: () => request<OfferingDto[]>('/academics/offerings/mine'),
  allSections: (gradeId?: string) =>
    request<SectionDto[]>(`/academics/sections${gradeId ? `?gradeId=${gradeId}` : ''}`),
  createSection: (body: { gradeId: string; name: string; classTeacherId?: string }) =>
    request<SectionDto>('/academics/sections', { method: 'POST', body: JSON.stringify(body) }),
  updateSection: (id: string, body: { classTeacherId?: string; classRepresentativeId?: string }) =>
    request<SectionDto>(`/academics/sections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  assignSection: (body: { studentId: string; sectionId: string; academicYearId: string; rollNo?: string }) =>
    request<{ id: string }>('/enrollments', { method: 'POST', body: JSON.stringify(body) }),
  nextRollNo: (sectionId: string, academicYearId: string) =>
    request<{ nextRollNo: number }>(`/enrollments/next-roll-no?sectionId=${sectionId}&academicYearId=${academicYearId}`),
  allAcademicYears: async () => {
    const raw: any[] = await request<any[]>('/academics/years');
    return raw.map((y) => ({ id: y._id ?? y.id, name: y.name, isCurrent: y.isCurrent ?? false })) as { id: string; name: string; isCurrent: boolean }[];
  },
  createAcademicYear: (body: { name: string; startsOn: string; endsOn: string; isCurrent?: boolean }) =>
    request<{ id: string }>('/academics/years', { method: 'POST', body: JSON.stringify(body) }),

  // ── classroom management (grades / sections / subjects / offerings) ──
  listGrades: async () => {
    const raw: any[] = await request<any[]>('/academics/grades');
    return raw.map((g) => ({ id: g._id ?? g.id, name: g.name, level: g.level })) as GradeDto[];
  },
  createGrade: (body: { name: string; level: number }) =>
    request<{ id: string }>('/academics/grades', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateGrades: (file: File) => uploadCsv('/academics/grades/bulk', file),
  bulkCreateSections: (file: File) => uploadCsv('/academics/sections/bulk', file),
  listSubjects: async () => {
    const raw: any[] = await request<any[]>('/academics/subjects');
    return raw.map((s) => ({ id: s._id ?? s.id, name: s.name, code: s.code ?? null })) as SubjectDto[];
  },
  createSubject: (body: { name: string; code?: string }) =>
    request<{ id: string }>('/academics/subjects', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateSubjects: (file: File) => uploadCsv('/academics/subjects/bulk', file),
  listTerms: async (academicYearId?: string) => {
    const qs = academicYearId ? `?academicYearId=${academicYearId}` : '';
    const raw: any[] = await request<any[]>(`/academics/terms${qs}`);
    return raw.map((t) => ({ id: t._id ?? t.id, academicYearId: t.academicYearId, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })) as TermDto[];
  },
  createTerm: (body: { academicYearId: string; name: string; startsOn: string; endsOn: string }) =>
    request<{ id: string }>('/academics/terms', { method: 'POST', body: JSON.stringify(body) }),
  listOfferings: (filter: { sectionId?: string; subjectId?: string; termId?: string } = {}) => {
    const q = new URLSearchParams();
    if (filter.sectionId) q.set('sectionId', filter.sectionId);
    if (filter.subjectId) q.set('subjectId', filter.subjectId);
    if (filter.termId) q.set('termId', filter.termId);
    const qs = q.toString();
    return request<OfferingDto[]>(`/academics/offerings${qs ? `?${qs}` : ''}`);
  },
  createOffering: (body: { sectionId: string; subjectId: string; termId: string; teacherId?: string }) =>
    request<{ id: string }>('/academics/offerings', { method: 'POST', body: JSON.stringify(body) }),
  listTeachers: () => request<StaffAccountDto[]>('/users?roleKey=TEACHER'),

  // ── attendance ──
  attendanceRoster: (sectionId: string, date: string, periodNo?: number) => {
    const q = new URLSearchParams({ sectionId, date });
    if (periodNo) q.set('periodNo', String(periodNo));
    return request<AttendanceRoster>(`/attendance/roster?${q.toString()}`);
  },
  markAttendance: (body: { sectionId: string; date: string; periodNo?: number; entries: Array<{ enrollmentId: string; status: AttStatus; note?: string }> }) =>
    request<AttendanceRoster>('/attendance/mark', { method: 'POST', body: JSON.stringify(body) }),
  bulkMarkAttendance: (file: File, sectionId: string, date: string, periodNo?: number) =>
    uploadCsv('/attendance/mark/bulk', file, { sectionId, date, ...(periodNo ? { periodNo: String(periodNo) } : {}) }),
  attendanceSummary: (enrollmentId: string, yearMonth: string) =>
    request<{ enrollmentId: string; yearMonth: string; PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number; workingDays: number; pctPresent: number }>(`/attendance/summary?enrollmentId=${enrollmentId}&month=${yearMonth}`),
  attendanceCalendar: (enrollmentId: string, month: string) =>
    request<AttendanceCalendarDto>(`/attendance/calendar?enrollmentId=${enrollmentId}&month=${month}`),
  attendanceTrend: (enrollmentId: string, months = 6) =>
    request<AttendanceTrendPointDto[]>(`/attendance/trend?enrollmentId=${enrollmentId}&months=${months}`),
  attendanceSubjectWise: (enrollmentId: string, month: string) =>
    request<SubjectAttendanceDto>(`/attendance/subject-wise?enrollmentId=${enrollmentId}&month=${month}`),

  // ── leave ──
  applyLeave: (body: { leaveType?: string; fromDate: string; toDate: string; reason: string }) =>
    request<LeaveApplicationDto>('/leave/apply', { method: 'POST', body: JSON.stringify(body) }),
  myLeaveApplications: () => request<LeaveApplicationDto[]>('/leave/mine'),
  listLeaveApplications: (params?: { status?: string; role?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.role) q.set('role', params.role);
    const qs = q.toString();
    return request<LeaveApplicationDto[]>(`/leave${qs ? `?${qs}` : ''}`);
  },
  reviewLeaveApplication: (id: string, body: { status: 'APPROVED' | 'REJECTED'; remarks?: string }) =>
    request<LeaveApplicationDto>(`/leave/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── timetable ──
  timetable: (sectionId: string) => request<TimetableDto>(`/timetable?sectionId=${sectionId}`),
  upsertTimetableSlot: (body: { sectionId: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subjectOfferingId: string | null; room?: string | null; liveClassLink?: string | null }) =>
    request<{ id: string }>('/timetable/slot', { method: 'POST', body: JSON.stringify(body) }),

  // ── assignments ──
  assignments: (offeringId?: string) =>
    request<AssignmentDto[]>(`/assignments${offeringId ? `?offeringId=${offeringId}` : ''}`),
  createAssignment: (body: { subjectOfferingId: string; title: string; type?: string; chapter?: string; dueAt: string; maxMarks?: number; description?: string; attachments?: string[] }) =>
    request<{ id: string; seededSubmissions: number }>('/assignments', { method: 'POST', body: JSON.stringify(body) }),
  submitAssignment: (body: { assignmentId: string; attachments?: string[] }) =>
    request<{ status: string; submittedAt: string }>('/assignments/submit', { method: 'POST', body: JSON.stringify(body) }),
  gradeSubmission: (body: { assignmentId: string; enrollmentId: string; marks: number; feedback?: string }) =>
    request<{ status: string }>('/assignments/grade', { method: 'POST', body: JSON.stringify(body) }),
  assignmentSubmissions: (assignmentId: string) =>
    request<SubmissionRoster>(`/assignments/${assignmentId}/submissions`),

  // ── exams / performance ──
  performance: (enrollmentId: string) => request<PerformanceDto>(`/exams/performance?enrollmentId=${enrollmentId}`),
  exams: () => request<ExamDto[]>('/exams'),
  examSubjects: (examId: string) => request<ExamSubjectDto[]>(`/exams/subjects?examId=${examId}`),
  marksGrid: (examSubjectId: string) => request<MarksGrid>(`/exams/marks-grid?examSubjectId=${examSubjectId}`),
  enterMarks: (body: { examSubjectId: string; entries: Array<{ enrollmentId: string; marks: number; gradeLabel?: string; remarks?: string }> }) =>
    request<{ id: string }[]>('/exams/marks', { method: 'POST', body: JSON.stringify(body) }),
  publishMarks: (examSubjectId: string) =>
    request<{ matched: number; modified: number }>('/exams/publish', { method: 'POST', body: JSON.stringify({ examSubjectId }) }),

  // ── calendar ──
  calendar: (from: string, to: string) => request<CalendarEventDto[]>(`/calendar?from=${from}&to=${to}`),
  createEvent: (body: { title: string; type?: string; startsAt: string; endsAt: string; description?: string; audience?: object }) =>
    request<{ id: string }>('/calendar', { method: 'POST', body: JSON.stringify(body) }),

  // ── fees ──
  invoices: (status?: string) => request<InvoiceDto[]>(`/fees/invoices${status ? `?status=${status}` : ''}`),
  invoiceDetail: (id: string) => request<InvoiceDetailDto>(`/fees/invoices/${id}`),
  createInvoice: (body: { enrollmentId: string; invoiceNo?: string; dueOn: string; lines: { description: string; amountPaise: number; concessionPaise?: number }[] }) =>
    request<{ id: string }>('/fees/invoices', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateInvoices: (file: File) => uploadCsv('/fees/invoices/bulk', file),
  listEnrollments: (studentId?: string) => {
    const qs = studentId ? `?studentId=${studentId}` : '';
    return request<{ id: string; studentName: string; class: string }[]>(`/enrollments${qs}`);
  },
  // /fees/summary returns FeeSummary directly — the backend and this type are
  // the same contract. The alias-guessing that used to live here (three
  // candidate spellings per field, each defaulting to 0) is gone on purpose:
  // it turned a renamed field into a silent ₹0 instead of a visible failure,
  // which is how a broken dashboard went unnoticed.
  feeSummary: () => request<FeeSummary>('/fees/summary'),
  verifyCheckout: (body: { orderId: string; paymentId: string; signature: string }) =>
    request<{ handled: boolean; idempotent?: boolean; receiptNo?: string; invoiceNo?: string; invoiceStatus?: string; paidPaise?: number }>(
      '/fees/pay/verify', { method: 'POST', body: JSON.stringify(body) }
    ),
  recordPayment: (body: { invoiceId: string; amountPaise: number; mode: string; gatewayRef?: string }) =>
    request<{ receiptNo: string; status: string; paidPaise: number }>('/fees/payments', { method: 'POST', body: JSON.stringify(body) }),
  listPayments: (invoiceId?: string) =>
    request<PaymentReceiptDto[]>(`/fees/payments${invoiceId ? `?invoiceId=${invoiceId}` : ''}`),
  payOnline: (body: { invoiceId: string; amountPaise?: number }) =>
    request<PayOnlineResult>('/fees/pay', { method: 'POST', body: JSON.stringify(body) }),
  downloadInvoicePdf: (invoiceId: string) => openProtectedFile(`/fees/invoices/${invoiceId}/pdf`),
  downloadReceiptPdf: (paymentId: string) => openProtectedFile(`/fees/payments/${paymentId}/pdf`),

  // ── announcements ──
  announcements: () => request<AnnouncementDto[]>('/announcements'),
  createAnnouncement: (body: {
    title: string; content: string;
    audience?: { all?: boolean; gradeIds?: string[]; sectionIds?: string[]; subjectIds?: string[] };
    channels?: { app?: boolean; email?: boolean; whatsapp?: boolean };
  }) => request<{ id: string }>('/announcements', { method: 'POST', body: JSON.stringify(body) }),

  // ── tickets ──
  academicYears: () => request<AcademicYearDto[]>('/academics/years'),

  // ── agentic assistant (shared core with WhatsApp) ──
  agentAsk: (message: string, lang?: string) =>
    request<AgentReply>('/ai/agent', { method: 'POST', body: JSON.stringify({ message, source: 'WEB', lang }) }),
  agentConfirm: (confirmToken: string, accept: boolean, lang?: string) =>
    request<{ reply: string; executed?: boolean }>('/ai/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ confirmToken, accept, source: 'WEB', lang }),
    }),
  agentCapabilities: () => request<{ tools: AgentTool[] }>('/ai/agent/capabilities'),

  // ── report cards ──
  reportCard: (enrollmentId?: string, exam?: string) => {
    const q = new URLSearchParams();
    if (enrollmentId) q.set('enrollmentId', enrollmentId);
    if (exam) q.set('exam', exam);
    const qs = q.toString();
    return request<ReportCardDto>(`/exams/report-card${qs ? `?${qs}` : ''}`);
  },
  downloadReportCardPdf: (enrollmentId?: string, exam?: string) => {
    const q = new URLSearchParams();
    if (enrollmentId) q.set('enrollmentId', enrollmentId);
    if (exam) q.set('exam', exam);
    const qs = q.toString();
    // Uses the same authenticated blob-fetch as the invoice/receipt PDFs —
    // a plain link would not carry the Bearer token.
    return openProtectedFile(`/exams/report-card/pdf${qs ? `?${qs}` : ''}`);
  },

  // ── fee structures & invoice generation ──
  feeHeads: () => request<FeeHeadDto[]>('/fees/heads'),
  feeStructures: (academicYearId?: string, gradeId?: string) => {
    const q = new URLSearchParams();
    if (academicYearId) q.set('academicYearId', academicYearId);
    if (gradeId) q.set('gradeId', gradeId);
    const qs = q.toString();
    return request<FeeStructureDto[]>(`/fees/structures${qs ? `?${qs}` : ''}`);
  },
  createFeeHead: (body: { name: string; category?: string }) =>
    request<FeeHeadDto>('/fees/heads', { method: 'POST', body: JSON.stringify(body) }),
  createFeeStructure: (body: { feeHeadId: string; academicYearId: string; gradeId?: string | null; name: string; amountPaise: number; dueOn: string }) =>
    request<FeeStructureDto>('/fees/structures', { method: 'POST', body: JSON.stringify(body) }),
  generateInvoices: (body: { academicYearId: string; gradeId?: string | null; dueOn?: string; dryRun?: boolean }) =>
    request<GenerateInvoicesResult>('/fees/invoices/generate', { method: 'POST', body: JSON.stringify(body) }),

  // ── notifications (per-profile inbox) ──
  notifications: (opts: { unreadOnly?: boolean; limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.unreadOnly) q.set('unreadOnly', 'true');
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.before) q.set('before', opts.before);
    const qs = q.toString();
    return request<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  unreadNotificationCount: () => request<{ unreadCount: number }>('/notifications/unread-count'),
  markNotificationsRead: (ids: string[]) =>
    request<{ updated: number; unreadCount: number }>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  markAllNotificationsRead: () =>
    request<{ updated: number; unreadCount: number }>('/notifications/read-all', { method: 'POST' }),

  tickets: (status?: string) => request<TicketDto[]>(`/tickets${status ? `?status=${status}` : ''}`),
  ticketThread: (id: string) => request<TicketThread>(`/tickets/${id}`),
  createTicket: (body: { subject: string; body: string; routedToRoleKey?: string; studentId?: string }) =>
    request<{ id: string }>('/tickets', { method: 'POST', body: JSON.stringify(body) }),
  replyTicket: (body: { ticketId: string; body: string; status?: string }) =>
    request<{ id: string; status: string }>('/tickets/reply', { method: 'POST', body: JSON.stringify(body) }),

  // ── medical ──
  medical: (studentId: string) => request<MedicalDto>(`/medical/${studentId}`),
  saveMedical: (studentId: string, body: object) => request<{ studentId: string }>(`/medical/${studentId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMedical: (studentId: string) => request<void>(`/medical/${studentId}`, { method: 'DELETE' }),

  // ── admissions ──
  pipeline: () => request<Pipeline>('/admissions/pipeline'),
  createLead: (body: object) => request<{ id: string }>('/admissions/leads', { method: 'POST', body: JSON.stringify(body) }),
  updateLead: (body: object) => request<{ id: string }>('/admissions/leads/update', { method: 'POST', body: JSON.stringify(body) }),
  bulkImportLeads: (file: File) => uploadCsv('/admissions/leads/bulk', file),

  // ── AI layer ──
  growthScore: (enrollmentId: string) => request<GrowthScore>(`/growth/score?enrollmentId=${enrollmentId}`),
  riskScan: async () => {
    const raw: any = await request<any>('/risk/scan');
    // Normalize: backend may return an array, or { flags, counts }, or { items, counts }
    let items: any[] = [];
    let counts: Record<string, number> = {};
    if (Array.isArray(raw)) {
      items = raw;
    } else if (raw && typeof raw === 'object') {
      items = raw.items ?? raw.flags ?? raw.data ?? raw.results ?? [];
      counts = raw.counts ?? raw.countsByLevel ?? {};
    }
    // If counts is empty, build it from items
    if (!counts || Object.keys(counts).length === 0) {
      counts = {};
      (items as any[]).forEach((it: any) => {
        const lvl: string = it.level ?? it.riskLevel ?? 'UNKNOWN';
        counts[lvl] = (counts[lvl] ?? 0) + 1;
      });
    }
    return { items, counts } as RiskScan;
  },
  aiChat: (message: string, conversationId?: string) =>
    request<AiReply>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),

  // ── WhatsApp hand-off for families ──
  // The link is built server-side: the identifiers in the prefilled message
  // come from records the client cannot assert, and the number is not exposed
  // until the feature is switched on.
  whatsappAssistantLink: () => request<WhatsappAssistantLink>('/whatsapp/assistant-link'),
  trackWhatsappAssistantClick: (device: 'MOBILE' | 'DESKTOP' | 'TABLET') =>
    request<{ recorded: boolean }>('/whatsapp/assistant-link/click', { method: 'POST', body: JSON.stringify({ device }) }),

  // ── transport (Phase 8) ──
  listRoutes: () => request<TransportRouteDto[]>('/transport/routes'),
  listStops: (routeId: string) => request<TransportStopDto[]>(`/transport/routes/${routeId}/stops`),
  myBus: (studentId?: string) => request<MyBusDto | null>(`/transport/my-bus${studentId ? `?studentId=${studentId}` : ''}`),
  createRoute: (body: { name: string; operatorName?: string; vehicleNo?: string; driverName?: string; driverPhone?: string }) =>
    request<{ id: string }>('/transport/routes', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateRoutes: (file: File) => uploadCsv('/transport/routes/bulk', file),
  createStop: (body: { routeId: string; name: string; sequenceNo: number; etaMinutesFromStart: number }) =>
    request<{ id: string }>('/transport/stops', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateStops: (file: File) => uploadCsv('/transport/stops/bulk', file),
  enrollStudent: (body: { studentId: string; routeId: string; stopId: string; academicYearId?: string; direction?: string }) =>
    request<{ id: string }>('/transport/enroll', { method: 'POST', body: JSON.stringify(body) }),
  bulkEnrollStudents: (file: File) => uploadCsv('/transport/enroll/bulk', file),

  // ── library (Phase 8) ──
  listBooks: (search?: string) => request<BookDto[]>(`/library/books${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  listIssued: (studentId?: string) => request<BookIssueDto[]>(`/library/issues${studentId ? `?studentId=${studentId}` : ''}`),
  listOverdueIssues: () => request<BookIssueDto[]>('/library/issues/overdue'),
  processLibraryReminders: () =>
    request<{ processed: number; remindersSent: number }>('/library/reminders/process', { method: 'POST' }),
  createBook: (body: { title: string; author: string; isbn?: string; category: string; totalCopies?: number }) =>
    request<{ id: string }>('/library/books', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateBooks: (file: File) => uploadCsv('/library/books/bulk', file),
  issueBook: (body: { bookId: string; studentId: string; dueAt: string }) =>
    request<BookIssueDto>('/library/issues', { method: 'POST', body: JSON.stringify(body) }),
  bulkIssueBooks: (file: File) => uploadCsv('/library/issues/bulk', file),
  returnBook: (issueId: string) =>
    request<BookIssueDto>(`/library/issues/${issueId}/return`, { method: 'PATCH' }),
  createBookReservation: (bookId: string) =>
    request<BookReservationDto>('/library/reservations', { method: 'POST', body: JSON.stringify({ bookId }) }),
  listMyBookReservations: () =>
    request<BookReservationDto[]>('/library/reservations/mine'),
  listBookReservations: (params?: { bookId?: string; studentId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.bookId) q.set('bookId', params.bookId);
    if (params?.studentId) q.set('studentId', params.studentId);
    if (params?.status) q.set('status', params.status);
    const str = q.toString();
    return request<BookReservationDto[]>(`/library/reservations${str ? `?${str}` : ''}`);
  },
  cancelBookReservation: (id: string, reason?: string) =>
    request<BookReservationDto>(`/library/reservations/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  fulfillBookReservation: (id: string) =>
    request<BookReservationDto>(`/library/reservations/${id}/fulfill`, { method: 'PATCH' }),

  // ── documents (Phase 8) ──
  listDocuments: (studentId?: string) => request<DocumentDto[]>(`/documents${studentId ? `?studentId=${studentId}` : ''}`),
  createDocument: (body: { title: string; type: string; fileUrl: string; mimeType?: string; visibleToRoles?: string[]; studentId?: string; academicYearId?: string; sectionId?: string; subjectOfferingId?: string }) =>
    request<{ id: string }>('/documents', { method: 'POST', body: JSON.stringify(body) }),
  updateDocument: (id: string, body: { title?: string; fileUrl?: string; mimeType?: string; visibleToRoles?: string[]; sectionId?: string | null; subjectOfferingId?: string | null }) =>
    request<{ id: string }>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDocument: (id: string) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),
  /** Opens a document's actual file (auth-checked server-side) in a new tab; throws ApiError on failure. */
  openDocumentFile: (id: string) => openProtectedFile(`/documents/${id}/file`),
  /** Generates and opens a student's ID card PDF in a new tab; throws ApiError (404) if it isn't available yet. */
  openIdCard: (studentId: string) => openProtectedFile(`/students/${studentId}/id-card`),

  // ── uploads ──
  uploadFile,

  // ── hostel ──
  hostelSummary: () => request<HostelSummaryDto>('/hostel/summary'),
  hostelRooms: () => request<HostelRoomDto[]>('/hostel/rooms'),
  createHostelRoom: (body: { roomNo: string; block: string; floor?: number; type?: string; capacity: number }) =>
    request<HostelRoomDto>('/hostel/rooms', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateHostelRooms: (file: File) => uploadCsv('/hostel/rooms/bulk', file),
  hostelAllocations: (roomId?: string) =>
    request<HostelAllocationDto[]>(`/hostel/allocations${roomId ? `?roomId=${roomId}` : ''}`),
  allocateHostelRoom: (body: { roomId: string; studentId: string }) =>
    request<HostelAllocationDto>('/hostel/allocations', { method: 'POST', body: JSON.stringify(body) }),
  bulkAllocateHostelRooms: (file: File) => uploadCsv('/hostel/allocations/bulk', file),
  vacateHostelRoom: (allocationId: string) =>
    request<HostelAllocationDto>(`/hostel/allocations/${allocationId}/vacate`, { method: 'PATCH' }),
  hostelStudents: () => request<HostelAllocationDto[]>('/hostel/students'),
  applyHostelPass: (body: { studentId?: string; passType?: string; fromDate: string; toDate: string; reason: string; destination: string; emergencyContact: string }) =>
    request<HostelPassDto>('/hostel/passes/apply', { method: 'POST', body: JSON.stringify(body) }),
  listMyHostelPasses: () => request<HostelPassDto[]>('/hostel/passes/mine'),
  listHostelPasses: (params?: { status?: string; passType?: string; studentId?: string; parentApprovalStatus?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.passType) query.set('passType', params.passType);
    if (params?.studentId) query.set('studentId', params.studentId);
    if (params?.parentApprovalStatus) query.set('parentApprovalStatus', params.parentApprovalStatus);
    const qStr = query.toString();
    return request<HostelPassDto[]>(`/hostel/passes${qStr ? `?${qStr}` : ''}`);
  },
  parentReviewHostelPass: (id: string, body: { status: 'APPROVED' | 'REJECTED'; remarks?: string }) =>
    request<HostelPassDto>(`/hostel/passes/${id}/parent-review`, { method: 'PATCH', body: JSON.stringify(body) }),
  wardenReviewHostelPass: (id: string, body: { status: 'APPROVED' | 'REJECTED'; remarks?: string }) =>
    request<HostelPassDto>(`/hostel/passes/${id}/review`, { method: 'PATCH', body: JSON.stringify(body) }),
  recordHostelMovement: (id: string, body: { action: 'EXIT' | 'ENTRY' }) =>
    request<HostelPassDto>(`/hostel/passes/${id}/movement`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── role dashboards (single scoped fetch per portal home) ──
  adminDashboard: () => request<AdminDashboardDto>('/dashboard/admin'),
  ownerDashboard: () => request<OwnerDashboardDto>('/dashboard/owner'),
  financeDashboard: () => request<FinanceDashboardDto>('/dashboard/finance'),
  teacherDashboard: () => request<TeacherDashboardDto>('/dashboard/teacher'),
  studentDashboard: () => request<StudentDashboardDto>('/dashboard/student'),
  parentDashboard: () => request<ParentDashboardDto>('/dashboard/parent'),
  wardenDashboard: () => request<WardenDashboardDto>('/dashboard/warden'),
  librarianDashboard: () => request<LibrarianDashboardDto>('/dashboard/librarian'),
  reviewLeave: (id: string, status: 'APPROVED' | 'REJECTED', remarks?: string) =>
    request<any>(`/leave/${id}/review`, { method: 'POST', body: JSON.stringify({ status, remarks }) }),

  // ── AI tutor (grounded in the caller's own syllabus, server-side) ──
  tutorStatus: () => request<TutorStatusDto>('/ai/tutor/status'),
  tutorSyllabus: () => request<TutorSyllabusDto>('/ai/tutor/syllabus'),
  tutor: (body: { topic: string; subject?: string; mode?: string; lang?: string }) =>
    request<TutorReplyDto>('/ai/tutor', { method: 'POST', body: JSON.stringify(body) }),

  // ── AI credits (students & parents; staff are not metered) ──
  aiCredits: () => request<AiCreditStatusDto>('/ai/credits'),
  aiCreditOrders: () => request<AiCreditOrderDto[]>('/ai/credits/orders'),
  buyAiCredits: (packKey: string) =>
    request<AiCreditPurchaseDto>('/ai/credits/purchase', { method: 'POST', body: JSON.stringify({ packKey }) }),
  verifyAiCreditPurchase: (body: { orderId: string; paymentId: string; signature: string }) =>
    request<AiCreditPurchaseDto & { idempotent?: boolean }>('/ai/credits/purchase/verify', { method: 'POST', body: JSON.stringify(body) }),

  // ── RBAC administration ──
  listRoles: () => request<RoleDto[]>('/roles'),
  listPermissionCatalog: () => request<PermissionDto[]>('/permissions'),
  assignRolePermission: (roleId: string, body: { key: string; scope?: 'ALL' | 'OWN' }) =>
    request<RoleDto>(`/roles/${roleId}/permissions`, { method: 'POST', body: JSON.stringify(body) }),
  revokeRolePermission: (roleId: string, key: string) =>
    request<RoleDto>(`/roles/${roleId}/permissions/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // ── Incidents / disciplinary reports ──
  listIncidents: (params?: { studentId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.studentId) qs.set('studentId', params.studentId);
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return request<IncidentDto[]>(`/incidents${query ? `?${query}` : ''}`);
  },
  createIncident: (body: {
    studentId: string;
    date: string;
    type: string;
    severity: string;
    description: string;
    actionTaken?: string;
  }) => request<IncidentDto>('/incidents', { method: 'POST', body: JSON.stringify(body) }),
  updateIncident: (id: string, body: { status?: string; actionTaken?: string }) =>
    request<IncidentDto>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Parent-Teacher Direct Messaging ──
  ptListThreads: () => request<PtThreadDto[]>('/pt-messages/threads'),
  ptStudentTeachers: (studentId: string) => request<StudentTeacherDto[]>(`/pt-messages/student-teachers/${studentId}`),
  ptStartThread: (body: { studentId: string; teacherProfileId?: string; subject?: string }) =>
    request<PtThreadDto>('/pt-messages/threads', { method: 'POST', body: JSON.stringify(body) }),
  ptGetThread: (id: string) => request<PtThreadDetailDto>(`/pt-messages/threads/${id}`),
  ptSendMessage: (body: { threadId: string; body: string }) =>
    request<PtMessageDto>('/pt-messages/send', { method: 'POST', body: JSON.stringify(body) }),
};
