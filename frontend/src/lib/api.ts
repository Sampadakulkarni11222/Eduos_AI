/**
 * Typed API client with refresh-token rotation.
 *
 * The access token lives in memory only. The refresh token lives in an
 * httpOnly cookie set by the BFF routes under /api/session, so it is never
 * readable from JavaScript — an XSS can steal at most the short-lived access
 * token, not the ability to mint new ones indefinitely.
 *
 * localStorage holds only a boolean marker saying a session probably exists,
 * which keeps hasSession() synchronous for its callers without storing
 * anything sensitive.
 */
import { cachedFetch, invalidateCache } from './cache';
import { getActingSchool } from './acting-school';
import { SESSION_MARKER } from './session-cookie';
import type { Me, Paged, PageResult, LeadDetailDto, RiskScanParams, ProfileSummary, StudentListItem, StudentOverviewDto, SectionDto, OfferingDto, GradeDto, SubjectDto, TermDto, StaffAccountDto, AttendanceRoster, AttStatus, AssignmentDto, TimetableDto, PerformanceDto, ExamDto, ExamSubjectDto, MarksGrid, CalendarEventDto, InvoiceDto, FeeSummary, AnnouncementDto, TicketDto, TicketThread, MedicalDto, Pipeline, GrowthScore, RiskScan, AiReply, WaSimReply, TransportRouteDto, TransportStopDto, MyBusDto, BookDto, BookIssueDto, DocumentDto, AuditLogDto, PaymentReceiptDto, UserDto, CreateUserDto, SchoolDto, SchoolAdminDto, CreateSchoolAdminDto, PublicSchoolDto, UploadResult, PayOnlineResult, SubmissionRoster, HostelRoomDto, HostelAllocationDto, HostelSummaryDto, PermissionDto, RoleDto, AdminDashboardDto, StudentDashboardDto, TeacherDashboardDto, ParentDashboardDto, WardenDashboardDto, LibrarianDashboardDto, FinanceDashboardDto, BulkImportResult, AttendanceCalendarDto, AttendanceTrendPointDto, LeaveApplicationDto, InvoiceDetailDto, NotificationDto, NotificationPage, ReportCardDto, FeeHeadDto, FeeStructureDto, GenerateInvoicesResult, AcademicYearDto, AgentReply, AgentTool, AiCreditStatusDto, AiCreditOrderDto, AiCreditPurchaseDto, SubjectAttendanceDto, WhatsappAssistantLink, TutorStatusDto, TutorSyllabusDto, TutorReplyDto, AvailableElectiveDto, SubjectRegistrationDto, RegistrationStatus } from './types';

/**
 * A document exactly as the API returns it, before this layer normalises it.
 * Mongo serialises its primary key as `_id`; some endpoints already map it to
 * `id`. Modelling that explicitly beats `any`, because the field reads in the
 * `.map()` calls below are then actually type-checked.
 */
type RawDoc<T> = Partial<Omit<T, 'id'>> & { _id?: string; id?: string };

// Backend URL – default to localhost:5000. Can be overridden via NEXT_PUBLIC_BACKEND_URL.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/**
 * The headers every call carries: the in-memory access token, and — for a
 * platform administrator who has opened one school — the school they are
 * looking at. The backend reads `X-School-Id` only for a Super Admin; for
 * every other actor the acting school comes from their own profile, so this
 * header cannot widen anyone's reach.
 */
function authHeaders(): Record<string, string> {
  const acting = getActingSchool();
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(acting ? { 'X-School-Id': acting.slug } : {}),
  };
}

/**
 * Hands the refresh token to the server-side cookie store and keeps the access
 * token in memory. Async because the cookie can only be set by the BFF route;
 * callers must await it before making an authenticated request.
 */
export async function setSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  localStorage.setItem(SESSION_MARKER, '1');
}

export async function clearSession() {
  accessToken = null;
  localStorage.removeItem(SESSION_MARKER);
  // Best-effort: a failure here must not stop the caller completing sign-out.
  await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
}

export function hasSession(): boolean {
  return typeof window !== 'undefined' && !!localStorage.getItem(SESSION_MARKER);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

async function doRefresh(): Promise<boolean> {
  if (!hasSession()) return false;

  // Same-origin, so the httpOnly cookie is attached automatically and the
  // rotated token is written straight back into it server-side. Only the new
  // access token comes back to this code.
  const res = await fetch('/api/session/refresh', { method: 'POST' });

  if (res.status === 503) {
    // Backend unreachable — not a dead session. Leave the marker alone so the
    // next attempt can still succeed once it recovers.
    return false;
  }
  if (!res.ok) {
    accessToken = null;
    localStorage.removeItem(SESSION_MARKER);
    return false;
  }

  const tokens = await res.json().catch(() => null);
  if (!tokens?.accessToken) return false;
  accessToken = tokens.accessToken;
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
      ...authHeaders(),
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
  // Anything that isn't a plain read may have changed data another screen is
  // holding, so the read cache is dropped wholesale on every successful
  // mutation. Blunt on purpose: a needless refetch costs one request, whereas
  // a missed invalidation shows the user a stale record.
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') invalidateCache();
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // Backend wraps all success responses in { success: true, message: string, data: T }
  return (json?.data !== undefined ? json.data : json) as T;
}

/**
 * A GET that is served from the in-memory cache when a recent copy exists and
 * de-duplicated when several callers ask at once. Used for the reads that
 * repeat across pages (reference data, rosters, summaries) — navigating back
 * to a page you were just on no longer refires them.
 *
 * The cache key is the request path, so different filters/pages stay separate.
 */
function cachedRequest<T>(path: string, staleMs?: number): Promise<T> {
  return cachedFetch<T>(`GET ${path}`, () => request<T>(path), staleMs);
}

/** Raw-body file upload; returns the stored file's public URL. */
async function uploadFile(file: File): Promise<UploadResult> {
  const res = await fetch(`${BACKEND_URL}/api/v1/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name),
      ...authHeaders(),
    },
    body: file,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'UPLOAD_FAILED', body?.message ?? 'Upload failed');
  }
  const json = await res.json();
  invalidateCache();
  return (json?.data ?? json) as UploadResult;
}

/** Multipart CSV upload (bulk imports). Extra non-file fields go alongside the file. */
async function uploadCsv(path: string, file: File, fields: Record<string, string> = {}): Promise<BulkImportResult> {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file);
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'UPLOAD_FAILED', body?.message ?? 'Upload failed');
  }
  const json = await res.json();
  invalidateCache();
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
    headers: authHeaders(),
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

/**
 * The sign-in address a call is being made from: a school's slug at
 * `/oakridge`, null at the platform sign-in. Sent with every credential so the
 * server can refuse an account that belongs at a different door — the check
 * that matters happens there, not here.
 */
export type Door = string | null;

export const api = {
  requestOtp: (phone: string, schoolId: Door = null) =>
    request<{ message: string; devOtp?: string }>('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone, schoolId }) }),

  requestEmailOtp: (email: string, schoolId: Door = null) =>
    request<{ message: string; devOtp?: string }>('/auth/otp/email/request', { method: 'POST', body: JSON.stringify({ email, schoolId }) }),

  verifyEmailOtp: (email: string, code: string, schoolId: Door = null) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/otp/email/verify', { method: 'POST', body: JSON.stringify({ email, code, schoolId }) },
    ),

  googleLogin: (idToken: string, schoolId: Door = null) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/google', { method: 'POST', body: JSON.stringify({ idToken, schoolId }) },
    ),

  verifyOtp: (phone: string, code: string, schoolId: Door = null) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code, schoolId }) },
    ),

  passwordLogin: (email: string, password: string, schoolId: Door = null) =>
    request<{ accessToken: string; refreshToken: string; profile?: ProfileSummary; profiles?: ProfileSummary[]; requiresProfileSelection?: boolean }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, schoolId }) },
    ),

  selectProfile: (profileId: string) =>
    request<{ accessToken: string; refreshToken: string }>('/auth/profile/select', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  me: () => request<Me>('/auth/me'),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  students: async (params: { search?: string; cursor?: string; sectionId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.sectionId) q.set('sectionId', params.sectionId);
    const qs = q.toString();
    const res = await cachedRequest<StudentListItem[] | Paged<StudentListItem>>(`/students${qs ? `?${qs}` : ''}`);
    return Array.isArray(res) ? ({ items: res } as Paged<StudentListItem>) : res;
  },
  /**
   * Page-numbered student list. Distinct from `students()` above, which the
   * screens that genuinely need every student (invoice creation) still use.
   */
  studentsPage: async (params: { search?: string; sectionId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.sectionId) q.set('sectionId', params.sectionId);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 25));
    return request<PageResult<StudentListItem>>(`/students?${q.toString()}`);
  },
  createStudent: (body: { firstName: string; lastName?: string; admissionNo: string; sectionId?: string }) =>
    request<StudentListItem>('/students', { method: 'POST', body: JSON.stringify(body) }),
  studentOverview: (id: string) => request<StudentOverviewDto>(`/students/${id}/overview`),
  setStudentPhoto: (id: string, photoUrl: string) =>
    request<{ id: string; photoUrl: string }>(`/students/${id}/photo`, { method: 'PATCH', body: JSON.stringify({ photoUrl }) }),
  bulkAssignSection: (file: File, sectionId: string, academicYearId: string) =>
    uploadCsv('/enrollments/bulk', file, { sectionId, academicYearId }),

  // ── audit ──
  auditLogs: (params: {
    cursor?: string; action?: string; roleKey?: string; actorProfileId?: string;
    from?: string; to?: string; month?: string; year?: string;
  } = {}) => {
    const q = new URLSearchParams();
    for (const key of ['cursor', 'action', 'roleKey', 'actorProfileId', 'from', 'to', 'month', 'year'] as const) {
      const value = params[key];
      if (value) q.set(key, value);
    }
    const qs = q.toString();
    return request<Paged<AuditLogDto>>(`/audit/logs${qs ? `?${qs}` : ''}`);
  },

  // ── users ──
  listUsers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<UserDto[]>(`/users${qs}`);
  },
  /** Page-numbered user list with server-side search, role and class filters. */
  listUsersPage: (params: { search?: string; roleKey?: string; sectionId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.roleKey) q.set('roleKey', params.roleKey);
    if (params.sectionId) q.set('sectionId', params.sectionId);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 25));
    return request<PageResult<UserDto>>(`/users?${q.toString()}`);
  },
  createUser: (body: CreateUserDto) =>
    request<UserDto>('/users', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateUsers: (file: File) => uploadCsv('/users/bulk', file),

  // ── schools ──
  /** Resolves a portal URL slug to its school. Unauthenticated by design. */
  publicSchool: (slug: string) => request<PublicSchoolDto>(`/schools/public/${encodeURIComponent(slug)}`),
  listSchools: () => request<SchoolDto[]>('/schools'),
  createSchool: (body: { tenantId: string; tenantName: string; admin: CreateSchoolAdminDto }) =>
    request<{ school: SchoolDto; admins: SchoolAdminDto[] }>('/schools', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchool: (tenantId: string, body: { tenantName: string }) =>
    request<SchoolDto>(`/schools/${encodeURIComponent(tenantId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listSchoolAdmins: (tenantId: string) =>
    request<SchoolAdminDto[]>(`/schools/${encodeURIComponent(tenantId)}/admins`),
  createSchoolAdmin: (tenantId: string, body: CreateSchoolAdminDto) =>
    request<SchoolAdminDto>(`/schools/${encodeURIComponent(tenantId)}/admins`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchoolAdmin: (
    tenantId: string,
    profileId: string,
    body: { status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; displayName?: string },
  ) =>
    request<SchoolAdminDto>(`/schools/${encodeURIComponent(tenantId)}/admins/${profileId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),


  // ── academics helpers ──
  mySections: () => cachedRequest<SectionDto[]>('/academics/sections/mine'),
  myOfferings: () => cachedRequest<OfferingDto[]>('/academics/offerings/mine'),
  allSections: (gradeId?: string) =>
    cachedRequest<SectionDto[]>(`/academics/sections${gradeId ? `?gradeId=${gradeId}` : ''}`),
  createSection: (body: { gradeId: string; name: string; classTeacherId?: string }) =>
    request<SectionDto>('/academics/sections', { method: 'POST', body: JSON.stringify(body) }),
  updateSection: (id: string, body: { classTeacherId?: string; classRepresentativeId?: string }) =>
    request<SectionDto>(`/academics/sections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  assignSection: (body: { studentId: string; sectionId: string; academicYearId: string; rollNo?: string }) =>
    request<{ id: string }>('/enrollments', { method: 'POST', body: JSON.stringify(body) }),
  nextRollNo: (sectionId: string, academicYearId: string) =>
    request<{ nextRollNo: number }>(`/enrollments/next-roll-no?sectionId=${sectionId}&academicYearId=${academicYearId}`),
  allAcademicYears: async () => {
    const raw = await cachedRequest<RawDoc<{ id: string; name: string; isCurrent: boolean }>[]>('/academics/years');
    return raw.map((y) => ({ id: y._id ?? y.id ?? '', name: y.name ?? '', isCurrent: y.isCurrent ?? false }));
  },
  createAcademicYear: (body: { name: string; startsOn: string; endsOn: string; isCurrent?: boolean }) =>
    request<{ id: string }>('/academics/years', { method: 'POST', body: JSON.stringify(body) }),

  // ── classroom management (grades / sections / subjects / offerings) ──
  listGrades: async () => {
    const raw = await cachedRequest<RawDoc<GradeDto>[]>('/academics/grades');
    return raw.map((g) => ({ id: g._id ?? g.id ?? '', name: g.name ?? '', level: g.level ?? 0 }));
  },
  createGrade: (body: { name: string; level: number }) =>
    request<{ id: string }>('/academics/grades', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateGrades: (file: File) => uploadCsv('/academics/grades/bulk', file),
  bulkCreateSections: (file: File) => uploadCsv('/academics/sections/bulk', file),
  listSubjects: async () => {
    const raw = await cachedRequest<RawDoc<SubjectDto>[]>('/academics/subjects');
    return raw.map((s) => ({ id: s._id ?? s.id ?? '', name: s.name ?? '', code: s.code ?? null }));
  },
  createSubject: (body: { name: string; code?: string }) =>
    request<{ id: string }>('/academics/subjects', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateSubjects: (file: File) => uploadCsv('/academics/subjects/bulk', file),
  listTerms: async (academicYearId?: string) => {
    const qs = academicYearId ? `?academicYearId=${academicYearId}` : '';
    const raw = await request<RawDoc<TermDto>[]>(`/academics/terms${qs}`);
    return raw.map((t) => ({ id: t._id ?? t.id ?? '', academicYearId: t.academicYearId ?? '', name: t.name ?? '', startsOn: t.startsOn ?? '', endsOn: t.endsOn ?? '' }));
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
  /** Marks an offering elective / sets its seat cap. Capacity null = unlimited. */
  updateOffering: (id: string, body: { isElective?: boolean; capacity?: number | null; teacherId?: string | null }) =>
    request<OfferingDto>(`/academics/offerings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createOffering: (body: { sectionId: string; subjectId: string; termId: string; teacherId?: string }) =>
    request<{ id: string }>('/academics/offerings', { method: 'POST', body: JSON.stringify(body) }),
  listTeachers: () => cachedRequest<StaffAccountDto[]>('/users?roleKey=TEACHER'),

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
  applyLeave: (body: { fromDate: string; toDate: string; reason: string }) =>
    request<LeaveApplicationDto>('/leave/apply', { method: 'POST', body: JSON.stringify(body) }),
  myLeaveApplications: () => request<LeaveApplicationDto[]>('/leave/mine'),

  // ── elective subject registration ──
  availableElectives: () => request<AvailableElectiveDto[]>('/registrations/available'),
  myRegistrations: () => request<SubjectRegistrationDto[]>('/registrations/mine'),
  registerForElective: (subjectOfferingId: string) =>
    request<SubjectRegistrationDto>('/registrations', {
      method: 'POST',
      body: JSON.stringify({ subjectOfferingId }),
    }),
  withdrawRegistration: (id: string) =>
    request<SubjectRegistrationDto>(`/registrations/${id}/withdraw`, { method: 'PATCH' }),
  registrationsForReview: (status: RegistrationStatus | 'ALL' = 'PENDING') =>
    request<SubjectRegistrationDto[]>(`/registrations/review?status=${status}`),
  decideRegistration: (id: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
    request<SubjectRegistrationDto>(`/registrations/${id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    }),

  // ── timetable ──
  timetable: (sectionId: string) => request<TimetableDto>(`/timetable?sectionId=${sectionId}`),
  upsertTimetableSlot: (body: { sectionId: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subjectOfferingId: string | null; room?: string | null; liveClassLink?: string | null }) =>
    request<{ id: string }>('/timetable/slot', { method: 'POST', body: JSON.stringify(body) }),

  // ── assignments ──
  assignments: (offeringId?: string) =>
    request<AssignmentDto[]>(`/assignments${offeringId ? `?offeringId=${offeringId}` : ''}`),
  createAssignment: (body: { subjectOfferingId: string; title: string; type?: string; chapter?: string; dueAt: string; maxMarks?: number; description?: string }) =>
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
  invoices: (status?: string) => cachedRequest<InvoiceDto[]>(`/fees/invoices${status ? `?status=${status}` : ''}`),
  /**
   * Page-numbered invoices with server-side search/filtering, so a screen
   * showing 25 rows no longer downloads the school's entire invoice list.
   */
  invoicesPage: (params: { status?: string; search?: string; sectionId?: string; studentId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.sectionId) q.set('sectionId', params.sectionId);
    if (params.studentId) q.set('studentId', params.studentId);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 25));
    return cachedRequest<PageResult<InvoiceDto>>(`/fees/invoices?${q.toString()}`);
  },
  invoiceDetail: (id: string) => request<InvoiceDetailDto>(`/fees/invoices/${id}`),
  createInvoice: (body: { enrollmentId: string; invoiceNo: string; dueOn: string; lines: { description: string; amountPaise: number; concessionPaise?: number }[] }) =>
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
  feeSummary: () => cachedRequest<FeeSummary>('/fees/summary'),
  verifyCheckout: (body: { orderId: string; paymentId: string; signature: string }) =>
    request<{ handled: boolean; idempotent?: boolean; receiptNo?: string; invoiceNo?: string; invoiceStatus?: string; paidPaise?: number }>(
      '/fees/pay/verify', { method: 'POST', body: JSON.stringify(body) }
    ),
  recordPayment: (body: { invoiceId: string; amountPaise: number; mode: string; gatewayRef?: string }) =>
    request<{ receiptNo: string; status: string; paidPaise: number }>('/fees/payments', { method: 'POST', body: JSON.stringify(body) }),
  listPayments: (invoiceId?: string) =>
    request<PaymentReceiptDto[]>(`/fees/payments${invoiceId ? `?invoiceId=${invoiceId}` : ''}`),
  /** Page-numbered receipts with server-side search and receipt-date range. */
  listPaymentsPage: (params: { search?: string; from?: string; to?: string; invoiceId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.invoiceId) q.set('invoiceId', params.invoiceId);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 25));
    return request<PageResult<PaymentReceiptDto>>(`/fees/payments?${q.toString()}`);
  },
  payOnline: (body: { invoiceId: string; amountPaise?: number }) =>
    request<PayOnlineResult>('/fees/pay', { method: 'POST', body: JSON.stringify(body) }),
  downloadInvoicePdf: (invoiceId: string) => openProtectedFile(`/fees/invoices/${invoiceId}/pdf`),
  downloadReceiptPdf: (paymentId: string) => openProtectedFile(`/fees/payments/${paymentId}/pdf`),

  // ── announcements ──
  announcements: () => cachedRequest<AnnouncementDto[]>('/announcements'),
  createAnnouncement: (body: {
    title: string; content: string;
    audience?: { all?: boolean; gradeIds?: string[]; sectionIds?: string[]; subjectIds?: string[] };
    channels?: { app?: boolean; email?: boolean; whatsapp?: boolean };
  }) => request<{ id: string }>('/announcements', { method: 'POST', body: JSON.stringify(body) }),

  // ── tickets ──
  academicYears: () => cachedRequest<AcademicYearDto[]>('/academics/years'),

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
  leadDetail: (id: string) => request<LeadDetailDto>(`/admissions/leads/${id}`),
  createLead: (body: object) => request<{ id: string }>('/admissions/leads', { method: 'POST', body: JSON.stringify(body) }),
  updateLead: (body: object) => request<{ id: string }>('/admissions/leads/update', { method: 'POST', body: JSON.stringify(body) }),
  bulkImportLeads: (file: File) => uploadCsv('/admissions/leads/bulk', file),

  // ── AI layer ──
  growthScore: (enrollmentId: string) => request<GrowthScore>(`/growth/score?enrollmentId=${enrollmentId}`),
  riskScan: async (params: RiskScanParams = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    });
    const qs = q.toString();
    // The endpoint has returned three different shapes across versions, so the
    // envelope is modelled as a union rather than `any` — the field reads below
    // are then checked, and adding a fourth shape becomes a compile error.
    type RiskItem = { level?: string; riskLevel?: string };
    type RiskEnvelope =
      | RiskItem[]
      | {
          items?: RiskItem[]; flags?: RiskItem[]; data?: RiskItem[]; results?: RiskItem[];
          counts?: Record<string, number>; countsByLevel?: Record<string, number>;
          summary?: RiskScan['summary'];
          page?: number; pageSize?: number; total?: number; totalPages?: number;
          generatedAt?: string;
        };

    const raw = await request<RiskEnvelope>(`/risk/scan${qs ? `?${qs}` : ''}`);
    const envelope = Array.isArray(raw) ? {} : (raw ?? {});
    const items: RiskItem[] = Array.isArray(raw)
      ? raw
      : envelope.items ?? envelope.flags ?? envelope.data ?? envelope.results ?? [];
    let counts: Record<string, number> = envelope.counts ?? envelope.countsByLevel ?? {};

    // Older responses omit counts entirely; derive them from the rows.
    if (Object.keys(counts).length === 0) {
      counts = {};
      for (const it of items) {
        const lvl = it.level ?? it.riskLevel ?? 'UNKNOWN';
        counts[lvl] = (counts[lvl] ?? 0) + 1;
      }
    }
    return {
      items,
      counts,
      // Paging/summary come straight from the server when present; the
      // fallbacks keep an older unpaged response usable.
      summary: envelope.summary,
      total: envelope.total ?? items.length,
      page: envelope.page ?? 1,
      pageSize: envelope.pageSize ?? items.length,
      totalPages: envelope.totalPages ?? 1,
    } as RiskScan;
  },
  aiChat: (message: string, conversationId?: string) =>
    request<AiReply>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),

  // ── WhatsApp hand-off for families ──
  // The link is built server-side: the number is not exposed until the feature
  // is switched on. The prefill is just "Hi" — the bot identifies the sender
  // from their phone number and opens with their own records.
  whatsappAssistantLink: () => request<WhatsappAssistantLink>('/whatsapp/assistant-link'),
  trackWhatsappAssistantClick: (device: 'MOBILE' | 'DESKTOP' | 'TABLET') =>
    request<{ recorded: boolean }>('/whatsapp/assistant-link/click', { method: 'POST', body: JSON.stringify({ device }) }),

  // ── transport (Phase 8) ──
  listRoutes: () => cachedRequest<TransportRouteDto[]>('/transport/routes'),
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
  createBook: (body: { title: string; author: string; isbn?: string; category: string; totalCopies?: number }) =>
    request<{ id: string }>('/library/books', { method: 'POST', body: JSON.stringify(body) }),
  bulkCreateBooks: (file: File) => uploadCsv('/library/books/bulk', file),
  issueBook: (body: { bookId: string; studentId: string; dueAt: string }) =>
    request<BookIssueDto>('/library/issues', { method: 'POST', body: JSON.stringify(body) }),
  bulkIssueBooks: (file: File) => uploadCsv('/library/issues/bulk', file),
  returnBook: (issueId: string) =>
    request<BookIssueDto>(`/library/issues/${issueId}/return`, { method: 'PATCH' }),

  // ── documents (Phase 8) ──
  listDocuments: (
    studentId?: string,
    // The categories a document is filed under. Narrowing only — the server
    // still decides what this reader may see at all.
    filters: { type?: string; sectionId?: string; subjectOfferingId?: string } = {},
  ) => {
    const q = new URLSearchParams();
    if (studentId) q.set('studentId', studentId);
    for (const key of ['type', 'sectionId', 'subjectOfferingId'] as const) {
      const value = filters[key];
      if (value) q.set(key, value);
    }
    const qs = q.toString();
    return request<DocumentDto[]>(`/documents${qs ? `?${qs}` : ''}`);
  },
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
  hostelSummary: () => cachedRequest<HostelSummaryDto>('/hostel/summary'),
  hostelRooms: () => cachedRequest<HostelRoomDto[]>('/hostel/rooms'),
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

  // ── role dashboards (single scoped fetch per portal home) ──
  adminDashboard: () => cachedRequest<AdminDashboardDto>('/dashboard/admin'),
  financeDashboard: () => cachedRequest<FinanceDashboardDto>('/dashboard/finance'),
  teacherDashboard: () => cachedRequest<TeacherDashboardDto>('/dashboard/teacher'),
  studentDashboard: () => cachedRequest<StudentDashboardDto>('/dashboard/student'),
  parentDashboard: () => cachedRequest<ParentDashboardDto>('/dashboard/parent'),
  wardenDashboard: () => cachedRequest<WardenDashboardDto>('/dashboard/warden'),
  librarianDashboard: () => cachedRequest<LibrarianDashboardDto>('/dashboard/librarian'),

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
  listRoles: () => cachedRequest<RoleDto[]>('/roles'),
  listPermissionCatalog: () => cachedRequest<PermissionDto[]>('/permissions'),
  assignRolePermission: (roleId: string, body: { key: string; scope?: 'ALL' | 'OWN' }) =>
    request<RoleDto>(`/roles/${roleId}/permissions`, { method: 'POST', body: JSON.stringify(body) }),
  revokeRolePermission: (roleId: string, key: string) =>
    request<RoleDto>(`/roles/${roleId}/permissions/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};

/**
 * Narrows a caught value to a displayable message.
 *
 * `catch (e: any)` then reading `e.message` is a lie the compiler used to
 * accept: a thrown string, a rejected non-Error, or an aborted fetch all reach
 * that handler and none of them necessarily has `.message`. Catching `unknown`
 * and funnelling through this keeps the call sites as short as they were while
 * making the failure path honest.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
