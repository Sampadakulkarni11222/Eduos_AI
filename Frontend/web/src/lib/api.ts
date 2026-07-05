/**
 * Typed API client with refresh-token rotation.
 * Access token lives in memory; refresh token in localStorage.
 * Production hardening (Phase 7): move refresh into an httpOnly cookie
 * behind a BFF route handler so it never touches JS-readable storage.
 */
import type { Me, Paged, ProfileSummary, StudentListItem, SectionDto, OfferingDto, AttendanceRoster, AttStatus, AssignmentDto, TimetableDto, PerformanceDto, CalendarEventDto, InvoiceDto, FeeSummary, AnnouncementDto, TicketDto, TicketThread, MedicalDto, Pipeline, GrowthScore, RiskScan, AiReply, WaSimReply, TransportRouteDto, TransportStopDto, MyBusDto, BookDto, BookIssueDto, DocumentDto, AuditLogDto, PaymentReceiptDto, UserDto, CreateUserDto } from './types';

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

export const api = {
  requestOtp: (phone: string) =>
    request<{ message: string; devOtp?: string }>('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) }),

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


  // ── academics helpers ──
  mySections: () => request<SectionDto[]>('/academics/sections/mine'),
  myOfferings: () => request<OfferingDto[]>('/academics/offerings/mine'),
  allSections: () => request<SectionDto[]>('/academics/sections'),
  assignSection: (body: { studentId: string; sectionId: string; academicYearId: string; rollNo?: string }) =>
    request<{ id: string }>('/enrollments', { method: 'POST', body: JSON.stringify(body) }),
  nextRollNo: (sectionId: string, academicYearId: string) =>
    request<{ nextRollNo: number }>(`/enrollments/next-roll-no?sectionId=${sectionId}&academicYearId=${academicYearId}`),
  allAcademicYears: async () => {
    const raw: any[] = await request<any[]>('/academics/years');
    return raw.map((y) => ({ id: y._id ?? y.id, name: y.name, isCurrent: y.isCurrent ?? false })) as { id: string; name: string; isCurrent: boolean }[];
  },

  // ── attendance ──
  attendanceRoster: (sectionId: string, date: string, periodNo?: number) => {
    const q = new URLSearchParams({ sectionId, date });
    if (periodNo) q.set('periodNo', String(periodNo));
    return request<AttendanceRoster>(`/attendance/roster?${q.toString()}`);
  },
  markAttendance: (body: { sectionId: string; date: string; periodNo?: number; entries: Array<{ enrollmentId: string; status: AttStatus; note?: string }> }) =>
    request<{ marked: number }>('/attendance/mark', { method: 'POST', body: JSON.stringify(body) }),
  attendanceSummary: (enrollmentId: string, yearMonth: string) =>
    request<{ enrollmentId: string; yearMonth: string; PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number; workingDays: number; pctPresent: number }>(`/attendance/summary?enrollmentId=${enrollmentId}&month=${yearMonth}`),

  // ── timetable ──
  timetable: (sectionId: string) => request<TimetableDto>(`/timetable?sectionId=${sectionId}`),
  upsertTimetableSlot: (body: { sectionId: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subjectOfferingId: string | null }) =>
    request<{ id: string }>('/timetable/slot', { method: 'POST', body: JSON.stringify(body) }),

  // ── assignments ──
  assignments: (offeringId?: string) =>
    request<AssignmentDto[]>(`/assignments${offeringId ? `?offeringId=${offeringId}` : ''}`),
  createAssignment: (body: { subjectOfferingId: string; title: string; type?: string; dueAt: string; maxMarks?: number; description?: string }) =>
    request<{ id: string; seededSubmissions: number }>('/assignments', { method: 'POST', body: JSON.stringify(body) }),

  // ── exams / performance ──
  performance: (enrollmentId: string) => request<PerformanceDto>(`/exams/performance?enrollmentId=${enrollmentId}`),

  // ── calendar ──
  calendar: (from: string, to: string) => request<CalendarEventDto[]>(`/calendar?from=${from}&to=${to}`),
  createEvent: (body: { title: string; type?: string; startsAt: string; endsAt: string; description?: string; audience?: object }) =>
    request<{ id: string }>('/calendar', { method: 'POST', body: JSON.stringify(body) }),

  // ── fees ──
  invoices: (status?: string) => request<InvoiceDto[]>(`/fees/invoices${status ? `?status=${status}` : ''}`),
  createInvoice: (body: { enrollmentId: string; invoiceNo: string; dueOn: string; lines: { description: string; amountPaise: number; concessionPaise?: number }[] }) =>
    request<{ id: string }>('/fees/invoices', { method: 'POST', body: JSON.stringify(body) }),
  listEnrollments: (studentId?: string) => {
    const qs = studentId ? `?studentId=${studentId}` : '';
    return request<{ id: string; studentName: string; class: string }[]>(`/enrollments${qs}`);
  },
  feeSummary: async () => {
    const raw: any = await request<any>('/fees/summary');
    // Backend returns: totalPaise, paidPaise, outstandingPaise, collectionRate, pendingCount
    // Frontend expects: totalBilledPaise, totalCollectedPaise, pendingPaise, collectionPct, pendingCount
    return {
      totalBilledPaise: raw.totalPaise ?? raw.billedTargetPaise ?? raw.totalBilledPaise ?? 0,
      totalCollectedPaise: raw.paidPaise ?? raw.realizedRevenuePaise ?? raw.totalCollectedPaise ?? 0,
      pendingPaise: raw.outstandingPaise ?? raw.outstandingBalancePaise ?? raw.pendingPaise ?? 0,
      pendingCount: raw.pendingCount ?? raw.unpaidCount ?? raw.outstandingCount ?? 0,
      collectionPct: raw.collectionRate ?? raw.collectionRatePercentage ?? raw.collectionPct ?? 0,
    } as FeeSummary;
  },
  recordPayment: (body: { invoiceId: string; amountPaise: number; mode: string; gatewayRef?: string }) =>
    request<{ receiptNo: string; status: string; paidPaise: number }>('/fees/payments', { method: 'POST', body: JSON.stringify(body) }),
  listPayments: (invoiceId?: string) =>
    request<PaymentReceiptDto[]>(`/fees/payments${invoiceId ? `?invoiceId=${invoiceId}` : ''}`),

  // ── announcements ──
  announcements: () => request<AnnouncementDto[]>('/announcements'),
  createAnnouncement: (body: { title: string; content: string; audience?: object }) =>
    request<{ id: string }>('/announcements', { method: 'POST', body: JSON.stringify(body) }),

  // ── tickets ──
  tickets: (status?: string) => request<TicketDto[]>(`/tickets${status ? `?status=${status}` : ''}`),
  ticketThread: (id: string) => request<TicketThread>(`/tickets/${id}`),
  createTicket: (body: { subject: string; body: string; routedToRoleKey?: string; studentId?: string }) =>
    request<{ id: string }>('/tickets', { method: 'POST', body: JSON.stringify(body) }),
  replyTicket: (body: { ticketId: string; body: string; status?: string }) =>
    request<{ id: string; status: string }>('/tickets/reply', { method: 'POST', body: JSON.stringify(body) }),

  // ── medical ──
  medical: (studentId: string) => request<MedicalDto>(`/medical/${studentId}`),
  saveMedical: (body: object) => request<{ studentId: string }>('/medical', { method: 'PUT', body: JSON.stringify(body) }),

  // ── admissions ──
  pipeline: () => request<Pipeline>('/admissions/pipeline'),
  createLead: (body: object) => request<{ id: string }>('/admissions/leads', { method: 'POST', body: JSON.stringify(body) }),
  updateLead: (body: object) => request<{ id: string }>('/admissions/leads/update', { method: 'POST', body: JSON.stringify(body) }),

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

  // ── WhatsApp simulator (runs the real bot as the logged-in user) ──
  waSimulate: (text: string) => request<WaSimReply>('/whatsapp/simulate', { method: 'POST', body: JSON.stringify({ text }) }),

  // ── transport (Phase 8) ──
  listRoutes: () => request<TransportRouteDto[]>('/transport/routes'),
  listStops: (routeId: string) => request<TransportStopDto[]>(`/transport/routes/${routeId}/stops`),
  myBus: (studentId?: string) => request<MyBusDto | null>(`/transport/my-bus${studentId ? `?studentId=${studentId}` : ''}`),
  createRoute: (body: { name: string; operatorName?: string; vehicleNo?: string; driverName?: string; driverPhone?: string }) =>
    request<{ id: string }>('/transport/routes', { method: 'POST', body: JSON.stringify(body) }),
  createStop: (body: { routeId: string; name: string; sequenceNo: number; etaMinutesFromStart: number }) =>
    request<{ id: string }>('/transport/stops', { method: 'POST', body: JSON.stringify(body) }),
  enrollStudent: (body: { studentId: string; routeId: string; stopId: string; academicYearId?: string; direction?: string }) =>
    request<{ id: string }>('/transport/enroll', { method: 'POST', body: JSON.stringify(body) }),

  // ── library (Phase 8) ──
  listBooks: (search?: string) => request<BookDto[]>(`/library/books${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  listIssued: (studentId?: string) => request<BookIssueDto[]>(`/library/issues${studentId ? `?studentId=${studentId}` : ''}`),
  createBook: (body: { title: string; author: string; isbn?: string; category: string; totalCopies?: number }) =>
    request<{ id: string }>('/library/books', { method: 'POST', body: JSON.stringify(body) }),
  issueBook: (body: { bookId: string; studentId: string; dueAt: string }) =>
    request<BookIssueDto>('/library/issues', { method: 'POST', body: JSON.stringify(body) }),
  returnBook: (issueId: string) =>
    request<BookIssueDto>(`/library/issues/${issueId}/return`, { method: 'PATCH' }),

  // ── documents (Phase 8) ──
  listDocuments: (studentId?: string) => request<DocumentDto[]>(`/documents${studentId ? `?studentId=${studentId}` : ''}`),
  createDocument: (body: { title: string; type: string; fileUrl: string; mimeType?: string; visibleToRoles?: string[]; studentId?: string; academicYearId?: string }) =>
    request<{ id: string }>('/documents', { method: 'POST', body: JSON.stringify(body) }),
  deleteDocument: (id: string) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),
};
