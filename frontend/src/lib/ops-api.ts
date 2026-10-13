/**
 * Typed client for the institution-operations APIs (approvals, administration,
 * finance operations, marketing, community, campus). Kept apart from api.ts,
 * which serves the original modules; both share the same request() and its
 * token refresh, cache invalidation and error shape.
 */
import { request, fileHref } from './api';
import { getActingSchool } from './acting-school';
import type * as T from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
export const qs = (params: Q = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
export const post = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <R>(path: string) => request<R>(path, { method: 'DELETE' });
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

/**
 * Downloads a CSV the API streams (bank file, statutory working files,
 * return exports). Goes through fetch with the session's auth, then saves
 * via a blob link — never a URL with a token in it.
 */
export async function downloadCsv(path: string, filename: string) {
  const { getAccessToken } = await import('./api');
  const acting = getActingSchool();
  const res = await fetch(fileHref(`/api/v1${path}`), {
    headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}), ...(acting ? { 'X-School-Id': acting.slug } : {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const opsApi = {
  // ── attendance flashcard drafts ──
  attendanceDraft: (sectionId: string, date: string, periodNo: number | null) => get<T.AttendanceDraftDto | null>('/attendance/drafts', { sectionId, date, periodNo }),
  saveAttendanceDraft: (body: { sectionId: string; date: string; periodNo: number | null; version: number; cursor: number; entries: Array<{ enrollmentId: string; status: string | null; passed: boolean }> }) =>
    put<T.AttendanceDraftDto>('/attendance/drafts', body),
  discardAttendanceDraft: (sectionId: string, date: string, periodNo: number | null) => del<{ deleted: number }>(`/attendance/drafts${qs({ sectionId, date, periodNo })}`),

  // ── insights ──
  home: () => get<T.HomeDto>('/insights/home'),

  // ── approvals ──
  approvalInbox: () => get<T.ApprovalDto[]>('/approvals/inbox'),
  approvals: (p: Q = {}) => get<T.Paged<T.ApprovalDto>>('/approvals', p),
  approval: (id: string) => get<T.ApprovalDto>(`/approvals/${id}`),
  raiseApproval: (body: unknown) => post<T.ApprovalDto>('/approvals', body),
  decide: (id: string, action: 'APPROVE' | 'REJECT' | 'RETURN', comment?: string) => post<T.ApprovalDto>(`/approvals/${id}/decide`, { action, comment }),
  resubmit: (id: string, body: unknown) => post<T.ApprovalDto>(`/approvals/${id}/resubmit`, body),
  withdraw: (id: string, reason: string) => post<T.ApprovalDto>(`/approvals/${id}/withdraw`, { reason }),
  declareConflict: (id: string, declaration: string) => post<T.ApprovalDto>(`/approvals/${id}/conflict`, { declaration }),
  escalate: (id: string, reason: string) => post<T.ApprovalDto>(`/approvals/${id}/escalate`, { reason }),
  approvalPolicies: () => get<T.ApprovalPolicyDto[]>('/approvals/policies'),
  setApprovalPolicy: (category: string, body: unknown) => put<T.ApprovalPolicyDto>(`/approvals/policies/${category}`, body),
  resetApprovalPolicy: (category: string) => del<T.ApprovalPolicyDto>(`/approvals/policies/${category}`),
  delegations: () => get<T.DelegationDto[]>('/approvals/delegations'),
  delegate: (body: unknown) => post<T.DelegationDto>('/approvals/delegations', body),
  revokeDelegation: (id: string) => post<T.DelegationDto>(`/approvals/delegations/${id}/revoke`),

  // ── institution & org ──
  institution: () => get<T.InstitutionDto>('/institution'),
  saveInstitution: (body: unknown) => put<T.InstitutionDto>('/institution', body),
  terminology: () => get<Record<string, string>>('/institution/terminology'),
  orgChart: () => get<T.OrgChartDto>('/org/chart'),
  orgStaff: () => get<Array<{ profileId: string; name: string; roleKey: string | null }>>('/org/staff'),
  orgBootstrap: () => post<T.OrgChartDto>('/org/bootstrap'),
  orgUnit: (body: unknown, id?: string) => (id ? patch(`/org/units/${id}`, body) : post('/org/units', body)),
  orgDeleteUnit: (id: string) => del(`/org/units/${id}`),
  orgPosition: (body: unknown, id?: string) => (id ? patch(`/org/positions/${id}`, body) : post('/org/positions', body)),
  orgDeletePosition: (id: string) => del(`/org/positions/${id}`),
  orgAppoint: (body: unknown) => post('/org/appointments', body),
  orgEndAppointment: (id: string) => post(`/org/appointments/${id}/end`, {}),

  // ── correspondence ──
  letters: (p: Q = {}) => get<T.Paged<T.CorrespondenceDto>>('/correspondence', p),
  letterStats: () => get<{ open: number; overdue: number; dueSoon: number; awaitingApproval: number; toDispatch: number }>('/correspondence/stats'),
  letter: (id: string) => get<T.CorrespondenceDto>(`/correspondence/${id}`),
  registerLetter: (body: unknown) => post<T.CorrespondenceDto>('/correspondence', body),
  extract: (text: string) => post<T.ExtractDto>('/correspondence/extract', { text }),
  letterSuggest: (id: string) => get<T.ExtractDto>(`/correspondence/${id}/suggest`),
  letterAction: (id: string, action: string, body: unknown = {}) => post<T.CorrespondenceDto>(`/correspondence/${id}/${action}`, body),
  runLetterReminders: () => post<{ itemsDue: number; notified: number }>('/correspondence/reminders/run'),

  // ── facilities ──
  facilities: (p: Q = {}) => get<T.FacilityDto[]>('/facilities', p),
  facilityStats: () => get<Record<string, number>>('/facilities/stats'),
  saveFacility: (body: unknown, id?: string) => (id ? patch<T.FacilityDto>(`/facilities/${id}`, body) : post<T.FacilityDto>('/facilities', body)),
  sampleCampus: () => post<{ created: number }>('/facilities/sample-campus'),
  bookings: (p: Q = {}) => get<T.BookingDto[]>('/facilities/bookings', p),
  book: (body: unknown) => post<T.BookingDto>('/facilities/bookings', body),
  decideBooking: (id: string, decision: 'CONFIRMED' | 'REJECTED', note?: string) => post(`/facilities/bookings/${id}/decide`, { decision, note }),
  cancelBooking: (id: string) => post(`/facilities/bookings/${id}/cancel`),
  workOrders: (p: Q = {}) => get<T.Paged<T.WorkOrderDto>>('/facilities/work-orders', p),
  reportIssue: (body: unknown) => post<T.WorkOrderDto>('/facilities/work-orders', body),
  updateWorkOrder: (id: string, body: unknown) => patch<T.WorkOrderDto>(`/facilities/work-orders/${id}`, body),

  // ── events & agreements ──
  events: (p: Q = {}) => get<T.Paged<T.EventDto>>('/institution-events', p),
  event: (id: string) => get<T.EventDto>(`/institution-events/${id}`),
  proposeEvent: (body: unknown) => post<T.EventDto>('/institution-events', body),
  updateEvent: (id: string, body: unknown) => patch<T.EventDto>(`/institution-events/${id}`, body),
  submitEvent: (id: string) => post<T.EventDto>(`/institution-events/${id}/submit`),
  moveEvent: (id: string, to: string, note?: string) => post<T.EventDto>(`/institution-events/${id}/move`, { to, note }),
  completeEvent: (id: string, body: unknown) => post<T.EventDto>(`/institution-events/${id}/complete`, body),
  eventHighlight: (id: string) => post<T.PostDto>(`/community/events/${id}/highlight`),
  contracts: (p: Q = {}) => get<T.ContractDto[]>('/contracts', p),
  saveContract: (body: unknown, id?: string) => (id ? patch<T.ContractDto>(`/contracts/${id}`, body) : post<T.ContractDto>('/contracts', body)),
  submitContract: (id: string) => post<T.ContractDto>(`/contracts/${id}/submit`),

  // ── verification ──
  verifications: (p: Q = {}) => get<T.VerificationDto[]>('/verification', p),
  verificationStats: () => get<Record<string, number>>('/verification/stats'),
  verification: (id: string) => get<T.VerificationDto>(`/verification/${id}`),
  initiateVerification: (body: unknown) => post<T.VerificationDto>('/verification', body),
  verificationAction: (id: string, action: string, body: unknown = {}) => post<T.VerificationDto>(`/verification/${id}/${action}`, body),
  recordCheck: (id: string, checkId: string, body: unknown) => post<T.VerificationDto>(`/verification/${id}/checks/${checkId}`, body),

  // ── compliance ──
  complianceOverview: () => get<T.ComplianceOverviewDto>('/compliance/overview'),
  complianceCalendar: (days = 120) => get<T.CalendarItemDto[]>('/compliance/calendar', { days }),
  obligations: (p: Q = {}) => get<T.ObligationDto[]>('/compliance/obligations', p),
  seedObligations: () => post<{ added: number; total: number }>('/compliance/obligations/seed'),
  reviewObligation: (id: string, body: unknown) => patch<T.ObligationDto>(`/compliance/obligations/${id}`, body),
  returns: () => get<T.ReturnDto[]>('/compliance/returns'),
  returnById: (id: string) => get<T.ReturnDto>(`/compliance/returns/${id}`),
  createReturn: (body: unknown) => post<T.ReturnDto>('/compliance/returns', body),
  returnAction: (id: string, action: string, body: unknown = {}) => post<T.ReturnDto>(`/compliance/returns/${id}/${action}`, body),
  licences: (p: Q = {}) => get<T.LicenceDto[]>('/compliance/licences', p),
  saveLicence: (body: unknown, id?: string) => (id ? patch<T.LicenceDto>(`/compliance/licences/${id}`, body) : post<T.LicenceDto>('/compliance/licences', body)),
  policies: () => get<T.PolicyDto[]>('/compliance/policies'),
  createPolicy: (body: unknown) => post<T.PolicyDto>('/compliance/policies', body),
  draftPolicy: (id: string, body: unknown) => post<T.PolicyDto>(`/compliance/policies/${id}/versions`, body),
  submitPolicy: (id: string, body: unknown = {}) => post<T.PolicyDto>(`/compliance/policies/${id}/submit`, body),
  trainings: () => get<T.TrainingDto[]>('/compliance/trainings'),
  trainingCoverage: () => get<T.CoverageDto[]>('/compliance/trainings/coverage'),
  scheduleTraining: (body: unknown) => post<T.TrainingDto>('/compliance/trainings', body),
  trainingAttendance: (id: string, body: unknown) => post<T.TrainingDto>(`/compliance/trainings/${id}/attendance`, body),
  notices: (p: Q = {}) => get<T.NoticeDto[]>('/compliance/notices', p),
  createNotice: (body: unknown) => post<T.NoticeDto>('/compliance/notices', body),
  decideNotice: (id: string, body: unknown) => post<T.NoticeDto>(`/compliance/notices/${id}/decide`, body),
  noticeSources: () => get<T.NoticeSourceDto[]>('/compliance/notice-sources'),
  addNoticeSource: (body: unknown) => post<T.NoticeSourceDto>('/compliance/notice-sources', body),
  checkNoticeSource: (id: string) => post<{ source: T.NoticeSourceDto; notice: T.NoticeDto | null }>(`/compliance/notice-sources/${id}/check`),
  myPolicies: () => get<T.MyPolicyDto[]>('/compliance/my/policies'),
  acknowledgePolicy: (id: string) => post(`/compliance/my/policies/${id}/acknowledge`),
  myTrainings: () => get<T.MyTrainingDto[]>('/compliance/my/trainings'),
  acknowledgeTraining: (id: string) => post(`/compliance/my/trainings/${id}/acknowledge`),

  // ── safeguarding ──
  reportConcern: (body: unknown) => post<{ id: string; refNo: string; status: string; officersNotified: number; guidance: string | null }>('/safeguarding/reports', body),
  myReports: () => get<Array<{ id: string; refNo: string; category: string; status: string; reportedAt: string }>>('/safeguarding/reports/mine'),
  safeguardingGuidance: () => get<Record<string, string>>('/safeguarding/guidance'),
  cases: (p: Q = {}) => get<T.SafeguardingCaseDto[]>('/safeguarding/cases', p),
  caseById: (id: string) => get<T.SafeguardingCaseDto>(`/safeguarding/cases/${id}`),
  updateCase: (id: string, body: unknown) => patch<T.SafeguardingCaseDto>(`/safeguarding/cases/${id}`, body),

  // ── governance ──
  meetings: (p: Q = {}) => get<T.MeetingDto[]>('/governance/meetings', p),
  meeting: (id: string) => get<T.MeetingDto>(`/governance/meetings/${id}`),
  createMeeting: (body: unknown) => post<T.MeetingDto>('/governance/meetings', body),
  meetingAction: (id: string, action: string, body: unknown = {}) => post<T.MeetingDto>(`/governance/meetings/${id}/${action}`, body),
  boardActions: () => get<Array<{ meetingId: string; meeting: string; actionId: string; title: string; ownerName: string | null; dueOn: string | null; overdue: boolean }>>('/governance/actions'),
  meetingReminders: () => post<{ meetings: number; messages: number }>('/governance/reminders/run'),

  // ── payroll ──
  payrollRules: () => get<T.StatutoryRuleDto[]>('/payroll/rules'),
  seedPayrollRules: () => post<{ added: number }>('/payroll/rules/seed'),
  verifyRule: (id: string) => post(`/payroll/rules/${id}/verify`),
  addRule: (body: unknown) => post<T.StatutoryRuleDto>('/payroll/rules', body),
  compensation: () => get<T.CompensationDto[]>('/payroll/compensation'),
  saveCompensation: (body: unknown) => put<T.CompensationDto>('/payroll/compensation', body),
  payrollRuns: () => get<T.PayrollRunDto[]>('/payroll/runs'),
  payrollRun: (id: string) => get<T.PayrollRunDto>(`/payroll/runs/${id}`),
  createPayrollRun: (body: unknown) => post<T.PayrollRunDto>('/payroll/runs', body),
  payrollInputs: (id: string, inputs: unknown) => put<T.PayrollRunDto>(`/payroll/runs/${id}/inputs`, { inputs }),
  payrollAction: (id: string, action: string, body: unknown = {}) => post<T.PayrollRunDto>(`/payroll/runs/${id}/${action}`, body),
  myPayslips: () => get<T.PayslipDto[]>('/payroll/payslips/mine'),

  // ── procurement, budgets, funding ──
  procurementStats: () => get<Record<string, number>>('/procurement/stats'),
  vendors: () => get<T.VendorDto[]>('/procurement/vendors'),
  createVendor: (body: unknown) => post<T.VendorDto>('/procurement/vendors', body),
  vendorAction: (id: string, action: 'due-diligence' | 'conflict', body: unknown) => post(`/procurement/vendors/${id}/${action}`, body),
  purchaseRequests: (p: Q = {}) => get<T.Paged<T.PurchaseRequestDto>>('/procurement/requests', p),
  purchaseRequest: (id: string) => get<T.PurchaseRequestDto>(`/procurement/requests/${id}`),
  createPurchaseRequest: (body: unknown) => post<T.PurchaseRequestDto>('/procurement/requests', body),
  setQuotes: (id: string, body: unknown) => put<T.PurchaseRequestDto>(`/procurement/requests/${id}/quotes`, body),
  prAction: (id: string, action: string, body: unknown = {}) => post<T.PurchaseRequestDto>(`/procurement/requests/${id}/${action}`, body),
  assets: () => get<T.AssetDto[]>('/procurement/assets'),
  budgets: () => get<T.BudgetDto[]>('/budgets'),
  createBudget: (body: unknown) => post<T.BudgetDto>('/budgets', body),
  submitBudget: (id: string) => post<T.BudgetDto>(`/budgets/${id}/submit`),
  explainVariance: (id: string, code: string, explanation: string) => post<T.BudgetDto>(`/budgets/${id}/variance`, { code, explanation }),
  funding: () => get<T.FundingDto[]>('/budgets/funding'),
  createFunding: (body: unknown) => post<T.FundingDto>('/budgets/funding', body),
  submitFunding: (id: string) => post<T.FundingDto>(`/budgets/funding/${id}/submit`),
  updateFunding: (id: string, body: unknown) => patch<T.FundingDto>(`/budgets/funding/${id}`, body),

  // ── marketing ──
  marketingAnalytics: (p: Q = {}) => get<T.MarketingAnalyticsDto>('/marketing/analytics', p),
  campaigns: () => get<T.CampaignDto[]>('/marketing/campaigns'),
  createCampaign: (body: unknown) => post<T.CampaignDto>('/marketing/campaigns', body),
  updateCampaign: (id: string, body: unknown) => patch<T.CampaignDto>(`/marketing/campaigns/${id}`, body),
  creativeAssets: (p: Q = {}) => get<T.CreativeAssetDto[]>('/marketing/assets', p),
  assetSizes: () => get<Record<string, { w: number | null; h: number | null; unit: string | null }>>('/marketing/assets/sizes'),
  createCreative: (body: unknown) => post<T.CreativeAssetDto>('/marketing/assets', body),
  updateCreative: (id: string, body: unknown) => patch<T.CreativeAssetDto>(`/marketing/assets/${id}`, body),
  capacity: (p: Q = {}) => get<T.CapacityDto[]>('/marketing/capacity', p),
  setCapacity: (body: unknown) => put<T.CapacityDto>('/marketing/capacity', body),
  offers: (p: Q = {}) => get<T.OfferDto[]>('/marketing/offers', p),
  offerSeat: (body: unknown) => post<T.OfferDto>('/marketing/offers', body),
  moveOffer: (id: string, body: unknown) => post<T.OfferDto>(`/marketing/offers/${id}`, body),
  appointments: (p: Q = {}) => get<T.AppointmentDto[]>('/marketing/appointments', p),
  bookAppointment: (body: unknown) => post<T.AppointmentDto>('/marketing/appointments', body),
  updateAppointment: (id: string, body: unknown) => patch<T.AppointmentDto>(`/marketing/appointments/${id}`, body),
  updateLeadMarketing: (id: string, body: unknown) => patch(`/marketing/leads/${id}`, body),
  duplicateLeads: () => get<Array<Array<{ id: string; childName: string; guardianName: string; stage: string }>>>('/marketing/leads/duplicates'),

  // ── community ──
  feed: (p: Q = {}) => get<{ items: T.PostDto[]; page: number; pageSize: number }>('/community/feed', p),
  publicFeed: (slug: string) => get<{ items: T.PostDto[] }>(`/community/public/${slug}`),
  postById: (id: string) => get<T.PostDto>(`/community/posts/${id}`),
  createPost: (body: unknown) => post<T.PostDto>('/community/posts', body),
  submitPost: (id: string) => post<T.PostDto>(`/community/posts/${id}/submit`),
  moderatePost: (id: string, decision: string, note?: string) => post<T.PostDto>(`/community/posts/${id}/moderate`, { decision, note }),
  react: (id: string, type: string | null) => post<T.PostDto>(`/community/posts/${id}/react`, { type }),
  bookmark: (id: string) => post<{ bookmarked: boolean }>(`/community/posts/${id}/bookmark`),
  comment: (id: string, body: string) => post<{ id: string; status: string }>(`/community/posts/${id}/comments`, { body }),
  pendingComments: () => get<Array<{ id: string; postId: string; authorName: string; body: string }>>('/community/comments/pending'),
  moderateComment: (id: string, decision: 'APPROVE' | 'HIDE', reason?: string) => post(`/community/comments/${id}/moderate`, { decision, reason }),
  reportContent: (body: unknown) => post('/community/reports', body),
  communityReports: () => get<Array<{ id: string; targetType: string; targetId: string; reason: string; detail: string | null; createdAt: string }>>('/community/reports'),
  resolveReport: (id: string, body: unknown) => post(`/community/reports/${id}/resolve`, body),
  circles: () => get<T.CircleDto[]>('/community/circles'),
  createCircle: (body: unknown) => post<T.CircleDto>('/community/circles', body),
  joinCircle: (id: string) => post<{ status: string }>(`/community/circles/${id}/join`),
  circleMember: (id: string, body: unknown) => post(`/community/circles/${id}/members`, body),
  consents: () => get<T.ConsentDto[]>('/community/consents'),
  setConsent: (studentId: string, level: string) => post('/community/consents', { studentId, level }),
  mentors: (p: Q = {}) => get<T.MentorDto[]>('/community/mentors', p),
  saveMentorProfile: (body: unknown) => put<T.MentorDto>('/community/mentors/me', body),
  verifyMentor: (id: string) => post(`/community/mentors/${id}/verify`),
  mentoring: () => get<T.MentorshipDto[]>('/community/mentoring'),
  requestMentoring: (body: unknown) => post<T.MentorshipDto>('/community/mentoring', body),
  mentoringAction: (id: string, body: unknown) => post<T.MentorshipDto>(`/community/mentoring/${id}`, body),

  // ── campus ──
  campusMap: (campusCode?: string) => get<T.CampusMapDto>('/campus/map', { campusCode }),
  campusFacility: (id: string) => get<T.FacilityDetailDto>(`/campus/facilities/${id}`),

  // ── messaging ──
  preferences: () => get<T.PreferencesDto>('/messaging/preferences'),
  savePreferences: (body: unknown) => put<T.PreferencesDto>('/messaging/preferences', body),
  outbox: (p: Q = {}) => get<T.Paged<T.OutboxDto>>('/messaging/outbox', p),
  channels: () => get<{ whatsapp: { mode: string; templates: Array<{ key: string; category: string; configuredName: string | null }> }; sms: { mode: string }; email: { mode: string } }>('/messaging/channels'),
};
