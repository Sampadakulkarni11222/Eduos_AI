/** Response shapes of the institution-operations APIs (backend/src/modules/*). */

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }
export interface HistoryEntry { at: string; actorName: string | null; action: string; from: string | null; to: string | null; note: string | null }
export interface Attachment { name: string; url: string; kind?: string; addedAt?: string }

export interface AttendanceDraftDto {
  id: string;
  sectionId: string;
  date: string;
  periodNo: number | null;
  cursor: number;
  version: number;
  updatedAt: string;
  entries: Array<{ enrollmentId: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | null; passed: boolean }>;
  rosterChanges: { added: string[]; removed: string[] };
}

// ── approvals ──
export interface ApprovalStage { order: number; name: string; approverRole: string; status: string; decidedByName: string | null; decidedAt: string | null; comment: string | null; onBehalfOfRole: string | null }
export interface ApprovalDto {
  id: string; refNo: string; category: string; title: string; summary: string; department: string | null;
  requesterName: string | null; amountPaise: number; priority: string; riskLevel: string; dueAt: string | null;
  policyBasis: string | null; recommendation: string | null; attachments: Attachment[]; entityType: string | null; entityId: string | null;
  version: number; changeNote: string | null; stages: ApprovalStage[]; currentStage: number; status: string;
  escalation?: { escalated: boolean; toRole: string | null; reason: string | null };
  conflictDeclarations: Array<{ name: string; declaration: string }>;
  history: HistoryEntry[]; createdAt: string;
  currentStageName: string | null; currentApproverRole: string | null; isOverdue: boolean; canDecide: boolean; isRequester: boolean;
}
export interface ApprovalPolicyDto { category: string; custom: boolean; dueDays: number; stages: Array<{ name: string; approverRole: string; minAmountPaise: number }> }
export interface DelegationDto { id: string; fromRole: string; toName: string | null; categories: string[]; maxAmountPaise: number | null; startsOn: string; endsOn: string; reason: string | null; revokedAt: string | null }

// ── insights ──
export interface KpiDto { key: string; label: string; value: number | string | null; unit: string; definition: string; source: string; link: string | null; tone: 'good' | 'warn' | 'bad' | 'neutral'; status: 'OK' | 'UNAVAILABLE' | 'NOT_APPLICABLE'; asOf: string }
export interface TaskDto { kind: string; title: string; dueOn: string | null; overdue: boolean; link: string }
export interface CalendarItemDto { kind: string; id: string; title: string; date: string; renewBy?: string; status: string; link: string; overdue: boolean }
export interface HomeDto {
  role: string; greeting?: string; kpis: KpiDto[]; tasks?: TaskDto[]; decisions?: ApprovalDto[]; deadlines?: CalendarItemDto[];
  exceptions?: Array<{ severity: 'HIGH' | 'MEDIUM' | 'LOW'; text: string; link: string | null }>;
  upcomingEvents?: Array<{ id: string; title: string; startsAt: string; status: string; readiness: number | null }>;
  funnel?: Array<{ stage: string; count: number }>; bySource?: Array<{ source: string; enquiries: number; enrolled: number }>;
  meetings?: MeetingDto[]; policies?: MyPolicyDto[]; trainings?: MyTrainingDto[];
}

// ── institution & org ──
export interface CampusDto { id?: string; code: string; name: string; type: 'SCHOOL' | 'COLLEGE'; addressLine?: string | null; city?: string | null; district?: string | null; state?: string | null; pincode?: string | null; udiseCode?: string | null; aisheCode?: string | null; active?: boolean }
export interface AffiliationDto { id?: string; body: string; kind: string; number?: string | null; level?: string | null; validFrom?: string | null; validTo?: string | null; status?: string; campusCode?: string | null }
export interface InstitutionDto {
  id: string; displayName: string; legalName: string | null; shortName: string | null; institutionType: 'SCHOOL' | 'COLLEGE' | 'COMBINED';
  legalEntity: { type: string | null; name: string | null; registrationNo: string | null; registeredOn: string | null };
  management: string | null; establishedYear: number | null; motto: string | null; about: string | null; website: string | null;
  contact: { email: string | null; phone: string | null }; boards: string[]; affiliations: AffiliationDto[]; campuses: CampusDto[];
  academicYearStartMonth: number; financialYearStartMonth: number; terminology: Record<string, string>;
  disclosures: Array<{ title: string; category: string; url: string | null; text: string | null; public: boolean }>;
  completeness: { percent: number; missing: string[] };
}
export interface OrgHolder { appointmentId: string; profileId: string; name: string; roleKey: string | null; kind: string; since: string; until: string | null; flagged: boolean }
export interface OrgPosition { id: string; title: string; orgUnitId: string; roleKey: string | null; isHead: boolean; reportsToPositionId: string | null; dottedLineToPositionIds: string[]; sanctioned: number; holders: OrgHolder[]; vacancies: number }
export interface OrgUnitNode { id: string; name: string; kind: string; code: string | null; description: string | null; campusCode: string | null; positions: OrgPosition[]; children: OrgUnitNode[] }
export interface OrgChartDto { tree: OrgUnitNode[]; positions: OrgPosition[]; stats: { units: number; positions: number; sanctioned: number; filled: number; vacancies: number; unplaced: number; flagged: number }; unplaced: Array<{ profileId: string; name: string; roleKey: string | null }> }

// ── administration ──
export interface CorrespondenceDto {
  id: string; refNo: string; direction: 'INWARD' | 'OUTWARD'; channel: string; counterpartyType: string; counterpartyName: string;
  theirReference: string | null; subject: string; summary: string; topic: string | null; receivedOn: string | null; issuedOn: string | null; dueOn: string | null;
  confidentiality: string; source: { verified: boolean; method: string | null; note: string | null }; attachments: Attachment[];
  ownerProfileId: string | null; assigneeProfileIds: string[]; status: string;
  drafts?: Array<{ version: number; body: string; at: string; byName: string; aiAssisted: boolean }>;
  approvalRequestId: string | null; dispatch: { channel: string | null; at: string | null; trackingNo: string | null; deliveredAt: string | null; acknowledgement: string | null };
  reminders?: Array<{ at: string; note: string | null; sentAt: string | null }>; resolution: string | null; legalHold: boolean;
  history?: HistoryEntry[]; isOpen: boolean; isOverdue: boolean; daysToDue: number | null; latestDraft: { version: number; body: string } | null; createdAt: string;
}
export interface ExtractDto { deadlines: Array<{ date: string; text: string; context: string }>; suggestedDueOn: string | null; actions: string[]; method: string }
export interface FacilityDto {
  id: string; code: string; name: string; kind: string; parentId: string | null; campusCode: string | null; floorNo: number | null; capacity: number | null;
  department?: string | null; equipment?: string[]; accessible?: boolean; bookable?: boolean; restricted: boolean; status: string;
  layout: { x: number; z: number; w: number; d: number; h: number; rotation?: number; color?: string | null }; sampleLayout: boolean;
}
export interface BookingDto { id: string; facilityId: string; facilityName: string | null; title: string; purpose: string | null; startsAt: string; endsAt: string; attendees: number | null; bookedByName: string | null; status: string; decisionNote: string | null; conflicts?: Array<{ type: string; title: string }> }
export interface WorkOrderDto { id: string; refNo: string; facilityId: string | null; facilityName: string | null; title: string; description: string; category: string; priority: string; kind: string; reportedByName: string | null; status: string; slaHours: number; dueAt: string; costPaise: number; closesFacility: boolean; resolution: string | null; isOverdue: boolean; history?: HistoryEntry[] }
export interface EventDto {
  id: string; refNo: string; title: string; kind: string; description: string; startsAt: string; endsAt: string; facilityId: string | null; venueText: string | null;
  audience: string; expectedAttendance: number; budgetLines: Array<{ head: string; amountPaise: number }>; budgetPaise: number; actualSpendPaise: number;
  consentRequired: boolean; consentsReceived: number; safetyPlan: string | null; accessibilityPlan: string | null; transportPlan: string | null;
  tasks: Array<{ title: string; department: string | null; ownerName: string | null; dueOn: string | null; status: string }>;
  conflicts: string[]; status: string; approvalRequestId: string | null; newsroomPostId: string | null;
  outcome: { summary: string | null; attendance: number | null; highlights: string[] }; organiserName: string | null;
  tasksDone: number; tasksTotal: number; readiness: number | null; budgetVariancePaise: number; history?: HistoryEntry[];
}
export interface ContractDto { id: string; refNo: string; title: string; kind: string; counterparty: string; valuePaise: number; startsOn: string | null; endsOn: string | null; noticePeriodDays: number; autoRenews: boolean; signatureMethod: string | null; legalReviewNote: string | null; obligations: Array<{ title: string; dueOn: string | null; done: boolean }>; status: string; daysToExpiry?: number; noticeDeadline?: string; renewalAttention?: boolean; openObligations: number; attachments: Attachment[] }
export interface VerificationCheckDto { _id: string; type: string; required: boolean; provider: string | null; status: string; reference: string | null; completedAt: string | null; expiresOn: string | null; note: string | null; evidence: Attachment[] }
export interface VerificationDto {
  id: string; refNo: string; subjectType: string; subjectName: string; subjectProfileId: string | null; positionTitle: string | null; status: string; recheckDueOn: string | null;
  decidedAt?: string | null; conditions?: string | null;
  consent?: { obtained: boolean; at: string | null; evidenceUrl: string | null };
  driver?: { licenceNo: string | null; licenceClass: string | null; licenceValidTo: string | null; heavyVehicleExperienceYears: number | null };
  checks?: VerificationCheckDto[]; hrReview?: { recommendation: string | null; note: string | null; at: string | null };
  decision?: { status: string | null; byName: string | null; at: string | null; conditions: string | null; note: string | null };
  dispute?: { raisedAt: string | null; note: string | null; resolution: string | null }; checksDone?: number; checksRequired?: number; adverse?: number; history?: HistoryEntry[];
}

// ── pulse (interactive dashboard) ──
export interface PulseChartDto {
  key: string; title: string; type: 'line' | 'bar' | 'funnel' | 'ageing'; unit: 'count' | 'percent' | 'paise'; link: string | null; definition: string;
  points: Array<{ label: string; value: number | null; detail?: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }>; status: 'OK' | 'EMPTY'; emptyText: string; footnote?: string;
}
export interface PulseDto {
  charts: PulseChartDto[];
  activity: Array<{ at: string; kind: string; text: string; link: string }>;
  departments: Array<{ key: string; name: string; link: string; lines: Array<[number | null, string]>; attention: boolean }>;
  briefing: string[]; asOf: string;
  /** What each briefing line is based on, with links. */
  briefingSources?: Array<{ text: string; link: string | null }>;
}

// ── digital lectures ──
export interface LectureDto {
  id: string; refNo: string; seriesId: string | null; kind: string; title: string; description: string | null; hostName: string | null; isHost: boolean; canManage: boolean;
  subjectName: string | null; sectionIds: string[]; includeGuardians: boolean; inviteeRoles: string[]; invitedPeople: number;
  startsAt: string; endsAt: string; when: string; durationMinutes: number; provider: string; status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'; cancelReason: string | null;
  joinOpen: boolean; joinOpensAt: string; materials: Attachment[]; recordingUrl: string | null; summary: string | null; joinedCount: number;
  occurrences?: number; delivery?: { recipients: number; byStatus?: Record<string, number> } | null;
}
export interface LectureOptionsDto { sections: Array<{ id: string; label: string }>; kinds: string[]; canInviteRoles: boolean; staffRoles: string[]; providers: Array<{ key: string; label: string; needsLink: boolean; note: string }> }
export interface LectureAttendanceDto { title: string; when: string; invited: number; joined: number; note: string; rows: Array<{ name: string; joined: boolean; firstJoinedAt: string | null; times: number }> }

// ── official documents ──
export type DocCell = string | number | boolean | null | undefined;
export interface OfficialDocumentDto {
  kind: 'RETURN' | 'LETTER';
  letterhead: { name: string; displayName: string | null; managedBy: string | null; address: string | null; codes: string[]; contact: string[]; missing: string[] };
  refNo: string; date: string; to: string; subject: string; period?: string; theirReference?: string | null; opening?: string; body?: string;
  sections?: Array<
    | { type: 'table'; title: string; columns: Array<{ key: string; label: string; num?: boolean }>; rows: Array<Record<string, DocCell>>; note: string | null }
    | { type: 'facts'; title: string; items: Array<[string, DocCell]>; note?: null }
  >;
  sources?: string[]; generatedAt?: string | null; findings?: { errors: string[]; warnings: string[] };
  declaration?: string; signatories: Array<{ role: string; name: string | null; seal?: boolean }>;
  watermark: string | null; confidential?: boolean; status?: string; filingNote: string;
}

// ── compliance ──
export interface AccreditationItemDto { id: string; metric: string; ownerProfileId: string | null; ownerName: string | null; dueOn: string | null; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'NOT_APPLICABLE'; note: string | null; evidence: Attachment[] }
export interface AccreditationCycleDto {
  id: string; refNo: string; framework: string; frameworkLabel: string; title: string; programme: string | null; targetDate: string | null;
  status: 'PREPARING' | 'SUBMITTED' | 'CLOSED'; templateVerified: boolean; templateNote: string | null;
  criteria: Array<{ id: string; code: string; title: string; items: AccreditationItemDto[]; ready: number; counted: number }>;
  progress: { items: number; counted: number; ready: number; inProgress: number; notStarted: number; overdue: number; readyPct: number | null };
  submission?: { at: string | null; reference: string | null }; outcome: string | null;
}
export interface AccreditationFrameworkDto { key: string; label: string; note: string; criteria: Array<{ code: string; title: string }> }
export interface MyEvidenceItemDto { cycleId: string; cycle: string; criterion: string; itemId: string; metric: string; status: AccreditationItemDto['status']; dueOn: string | null; note: string | null; evidence: Attachment[] }
export interface ObligationDto { id: string; code: string; title: string; authority: string; category: string; institutionTypes: string[]; frequency: string; dueRule: string | null; nextDueOn: string | null; applicability: string; applicabilityNote: string | null; reviewedAt: string | null; sourceRef: string | null; ownerRole: string; active: boolean }
export interface ReturnDto { id: string; refNo: string; template: string; title: string; authority: string; period: string; dueOn: string | null; status: string; data: Record<string, unknown>; generatedAt: string; validation: Array<{ level: 'ERROR' | 'WARNING'; field: string; message: string }>; submission: { method: string | null; at: string | null; acknowledgementNo: string | null; receiptUrl: string | null }; authorityResponse: string | null; approvalRequestId: string | null; errors: number; warnings: number; isOverdue: boolean; history?: HistoryEntry[] }
export interface LicenceDto { id: string; kind: string; title: string; issuer: string | null; number: string | null; campusCode: string | null; issuedOn: string | null; expiresOn: string | null; renewalLeadDays: number; renewalCostPaise: number; renewalStatus: string | null; publicDisclosure: boolean; evidence: Attachment[]; status: string; daysToExpiry: number | null; notes: string | null }
export interface PolicyVersionDto { version: number; summary: string | null; body: string | null; documentUrl: string | null; status: string; effectiveFrom: string | null; approvalRequestId: string | null; approvedAt: string | null }
export interface PolicyDto { id: string; code: string; title: string; category: string; audienceRoles: string[]; requiresAcknowledgement: boolean; reviewEveryMonths: number; nextReviewOn: string | null; versions: PolicyVersionDto[]; currentVersion: number | null; current: PolicyVersionDto | null; pendingVersion: PolicyVersionDto | null; reviewOverdue: boolean; acknowledgements?: number; audienceSize?: number | null }
export interface MyPolicyDto { id: string; code: string; title: string; category: string; version: number; summary: string | null; body: string | null; documentUrl: string | null; effectiveFrom: string | null; requiresAcknowledgement: boolean; acknowledged: boolean }
export interface TrainingDto { id: string; refNo: string; topic: string; title: string; audience: string; mandatory: boolean; basis: string | null; scheduledAt: string; durationMinutes: number; facilitator: string | null; location: string | null; status: string; participants: Array<{ profileId: string; name: string; status: string; acknowledgedAt: string | null }>; invited: number; attended: number; acknowledged: number; groupAttendance: number | null; evidence: Attachment[] }
export interface MyTrainingDto { id: string; refNo: string; title: string; topic: string; mandatory: boolean; scheduledAt: string; location: string | null; status: string; myStatus: string; acknowledgedAt: string | null; materials: Attachment[] }
export interface CoverageDto { topic: string; windowMonths: number; staff: number; covered: number; pct: number | null; untrained: Array<{ profileId: string; name: string }> }
export interface NoticeDto { id: string; refNo: string; source: string; jurisdiction: string | null; title: string; theirReference: string | null; url: string | null; documentUrl: string | null; receivedVia: string; publishedOn: string | null; effectiveOn: string | null; summary: string; authenticity: string; authenticityNote: string | null; status: string; decision: { byName: string | null; at: string | null; rationale: string | null }; actions: Array<{ title: string; ownerProfileId: string | null; dueOn: string | null; done: boolean }> }
export interface NoticeSourceDto { id: string; name: string; url: string; source: string; jurisdiction: string | null; lastCheckedAt: string | null; lastStatus: string; lastError: string | null }
export interface ComplianceOverviewDto { applicableObligations: number; obligationsUnderReview: number; returnsOpen: number; returnsOverdue: number; licencesExpired: number; licencesExpiring: number; noticesToReview: number; policiesReviewOverdue: number; trainingCoverage: CoverageDto[] }
export interface SafeguardingCaseDto { id: string; refNo: string; category: string; urgency: string; status: string; reportedAt: string; occurredOn: string | null; reporterRole: string | null; reportedByProfileId: string | null; anonymousToStaff: boolean; assignedOfficerProfileId: string | null; statutoryReport: { required: boolean | null; authority: string | null; reportedAt: string | null; reference: string | null; note: string | null } | null; statutoryReportPending: boolean; description?: string; notes?: Array<{ at: string; text: string }>; history?: HistoryEntry[]; guidance?: string | null }

// ── governance ──
export interface MeetingMemberDto { _id: string; profileId: string | null; name: string; role: string; voting: boolean; rsvp: string; attended: boolean | null }
export interface MeetingDto {
  id: string; refNo: string; body: string; title: string; proposedSlots: Array<{ at: string; available: string[] }>; scheduledAt: string | null; durationMinutes: number;
  mode: string; location: string | null; meetingLink: string | null; quorum: number | null; members: MeetingMemberDto[];
  agenda: Array<{ order: number; title: string; presenter: string | null; decisionNeeded: boolean; papers: Attachment[]; notes: string | null }>;
  agendaStatus: string; status: string; minutes: { body: string | null; status: string; approvedAt: string | null };
  resolutions: Array<{ number: string; text: string; proposer: string | null; seconder: string | null; votesFor: number; votesAgainst: number; abstentions: number; outcome: string }>;
  actions: Array<{ _id: string; title: string; ownerName: string | null; ownerProfileId: string | null; dueOn: string | null; status: string; resolutionNumber: string | null }>;
  presentVoting: number; quorumMet: boolean | null; accepted: number; openActions: number; isMember: boolean;
}

// ── finance ops ──
export interface PayComponent { code: string; name: string; kind: 'EARNING' | 'DEDUCTION'; calc: 'FIXED' | 'PERCENT_OF_BASIC'; value: number; statutoryWage?: boolean; prorate?: boolean }
export interface CompensationDto { id: string; profileId: string; employeeCode: string; name: string; designation: string | null; department: string | null; employmentType: string; joiningDate: string; exitDate: string | null; workState: string | null; pfApplicable: boolean; esiApplicable: boolean; uan?: string | null; panMasked: string | null; monthlyTdsPaise?: number; components?: PayComponent[]; bankLast4: string | null; status: string }
export interface StatutoryRuleDto { id: string; code: string; jurisdiction: string | null; effectiveFrom: string; effectiveTo: string | null; params: Record<string, unknown>; sourceRef: string | null; verified: boolean; note: string | null }
export interface PayLineDto { name: string; employeeCode: string; paidDays: number; lopDays: number; warnings: string[]; earnings?: Array<{ code: string; name: string; amountPaise: number }>; deductions?: Array<{ code: string; name: string; amountPaise: number }>; employerContributions?: Array<{ code: string; name: string; amountPaise: number }>; grossPaise?: number; totalDeductionsPaise?: number; netPaise?: number; arrearsPaise?: number; bankReady?: boolean; profileId?: string }
export interface PayrollRunDto { id: string; refNo: string; period: string; kind: string; status: string; lines?: PayLineDto[]; totals: { grossPaise: number; deductionsPaise: number; netPaise: number; employerContributionsPaise: number; headcount: number }; warnings: string[]; unverifiedRules: string[]; approvalRequestId: string | null; bankFile?: { generatedAt: string; rows: number; totalPaise: number; checksum: string }; payment?: { bankReference?: string; confirmedAt?: string; confirmedAmountPaise?: number; mismatchPaise?: number }; statutory: Array<{ code: string; exportedAt: string | null; submittedAt: string | null; acknowledgementNo: string | null; challanNo: string | null }>; history?: HistoryEntry[]; inputs?: Array<{ profileId: string; lopDays: number; arrearsPaise: number }> }
export interface PayslipDto extends PayLineDto { runId: string; period: string; kind: string; status: 'PAID' | 'APPROVED_NOT_YET_PAID' }
export interface VendorDto { id: string; name: string; category: string | null; gstin: string | null; contactName: string | null; phone: string | null; email: string | null; status: string; bankLast4: string | null; dueDiligence?: { note: string | null; at: string | null } }
export interface PurchaseRequestDto {
  id: string; refNo: string; title: string; requesterName: string | null; department: string | null; budgetId: string | null; budgetLineCode: string | null; kind: string;
  items: Array<{ description: string; qty: number; unit: string; estUnitPaise: number; receivedQty: number; rejectedQty: number; isAsset: boolean }>;
  estimatedTotalPaise: number; justification: string; emergency: boolean; emergencyReason: string | null;
  quotes: Array<{ vendorId: string; vendorName: string; amountPaise: number; validTill: string | null; url: string | null; selected: boolean }>;
  selectionNote: string | null; checks: Array<{ level: string; code: string; message: string }>; status: string; approvalRequestId: string | null;
  po?: { number: string; issuedAt: string; vendorName: string; amountPaise: number };
  invoices: Array<{ vendorInvoiceNo: string; amountPaise: number; matchStatus: string; matchNote: string | null }>;
  payment?: { approvedAt?: string; reference?: string; confirmedAt?: string; bankReference?: string; amountPaise?: number; approvalRequestId?: string };
  receivedPct: number; amountPaise: number; isRequester: boolean; history?: HistoryEntry[];
}
export interface BudgetLineDto { code: string; department: string | null; head: string; kind: string; plannedPaise: number; committedPaise: number; actualPaise: number; varianceExplanation?: string | null; availablePaise: number; variancePaise: number; utilisationPct: number | null }
export interface BudgetDto { id: string; fiscalYear: string; name: string; status: string; lines: BudgetLineDto[]; totals: { planned: number; committed: number; actual: number }; approvalRequestId: string | null }
export interface FundingDto { id: string; refNo: string; kind: string; title: string; purpose: string; amountRequestedPaise: number; restricted: boolean; status: string; offers: Array<{ provider: string; principalPaise: number; annualRateBp: number; tenureMonths: number; processingFeePaise: number; emiPaise: number; totalInterestPaise: number; totalCostPaise: number; covenants: string | null; selected: boolean }>; disbursements: Array<{ at: string; amountPaise: number; reference: string }>; utilisation: Array<{ at: string; amountPaise: number; description: string }> }
export interface AssetDto { id: string; tag: string; description: string; costPaise: number; acquiredOn: string | null; vendorName: string | null; status: string; facilityId: string | null }

// ── marketing ──
export interface CampaignDto { id: string; name: string; code: string; objective: string; channels: string[]; audience: string | null; startsOn: string; endsOn: string; budgetPaise: number; spentPaise: number; status: string; enquiries: number; enrolments: number; costPerEnquiryPaise: number | null; costPerEnrolmentPaise: number | null; attribution: string }
export interface CreativeAssetDto { id: string; campaignId: string | null; kind: string; title: string; size: string; dimensions: { w: number | null; h: number | null; unit: string | null }; headline: string | null; copy: string | null; callToAction: string | null; altText: string | null; claims: Array<{ text: string; verified: boolean; evidence: string | null }>; versions: Array<{ version: number; url: string; note: string | null }>; status: string; aiAssisted: boolean }
export interface CapacityDto { id: string; academicYear: string; gradeOrProgramme: string; capacity: number; reserved: Array<{ category: string; seats: number }>; offered: number; accepted: number; available: number; utilisationPct: number | null }
export interface OfferDto { id: string; leadId: string; childName: string; guardianName: string; academicYear: string; gradeOrProgramme: string; category: string; status: string; waitlistPosition: number | null; offerExpiresOn: string | null }
export interface AppointmentDto { id: string; leadId: string; childName: string; guardianName: string; kind: string; at: string; durationMinutes: number; status: string; outcome: string | null }
export interface MarketingAnalyticsDto { enquiries: number; lost: number; funnel: Array<{ stage: string; count: number }>; conversionPct: number | null; bySource: Array<{ source: string; enquiries: number; enrolled: number }>; response: { definition: string; medianHours: number | null; unresponded: number }; offers: Record<string, number>; capacity: CapacityDto[]; dataNotes: string[] }

// ── community ──
export interface PostDto { id: string; kind: string; title: string | null; body: string; tags: string[]; audience: string; circleId: string | null; eventId: string | null; authorName: string | null; authorRole: string | null; status: string; publishedAt: string | null; pinned: boolean; commentsEnabled: boolean; media: Array<{ id: string; url: string; kind: string; caption: string | null; altText: string | null }>; mediaWithheld: number; reactions: Record<string, number>; myReaction: string | null; bookmarked: boolean; isMine: boolean; moderationNote?: string | null; comments?: Array<{ id: string; authorName: string | null; body: string; status: string; createdAt: string; isMine: boolean }> }
export interface CircleDto { id: string; name: string; kind: string; description: string | null; joinPolicy: string; adultsOnly: boolean; memberCount: number; myStatus: string | null; isModerator: boolean; members?: Array<{ profileId: string; name: string; roleKey: string; status: string }> }
export interface MentorDto { id: string; profileId: string; name: string; kind: string; batch: string | null; headline: string | null; topics: string[]; availability: string | null; verified: boolean }
export interface MentorshipDto { id: string; mentorProfileId: string; menteeProfileId: string; topic: string; message: string | null; supervised: boolean; supervisorProfileId: string | null; status: string; sessions: Array<{ at: string; mode: string; link: string | null }> }
export interface ConsentDto { studentId: string; name: string; level: 'NONE' | 'INTERNAL' | 'PUBLIC' }

// ── campus ──
export interface CampusNodeNow { type: string; label: string; teacher?: string | null; until?: string; source: string }
export interface ModuleNowDto { title: string; nextTopic: string | null; progressPct: number; expectedPct?: number; pace: string; plannedEnd?: string }
/** Headcount from today's register. `present` is null until the register is taken. */
export interface RoomLiveDto { class: string | null; homeRoom: boolean; away?: boolean; awayIn?: string; inSession?: boolean; activity?: string | null; enrolled: number; present: number | null; absent: number | null; registerTaken: boolean; attendancePct: number | null; source: string }
export interface RoomLessonDto { periodNo: number; startTime: string; endTime: string; class: string; subject: string; teacher?: string | null; module: ModuleNowDto | null }
export interface CampusNodeDto { id: string; code: string; name: string; kind: string; parentId: string | null; campusCode: string | null; floorNo: number | null; capacity: number | null; accessible: boolean; status: string; restricted: boolean; layout: FacilityDto['layout']; sampleLayout: boolean; department?: string | null; now: CampusNodeNow[] | null; live?: RoomLiveDto; lesson?: RoomLessonDto; nextScheduled?: { label: string; at: string }; periodsToday?: number; bookingsToday?: number; openWorkOrders?: number; urgentWorkOrders?: number }
export interface CampusDepartmentDto { code: string; name: string; description: string | null; head: { name: string | null; title: string } | null; staffCount: number | null; facilityIds: string[]; metrics: Array<{ value: number | string; label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }>; pages: string[] }
export interface CampusMapDto { institution: string | null; institutionType: string; campuses: Array<{ code: string; name: string }>; sampleLayout: boolean; layers: Record<string, boolean>; asOf: string; preview?: boolean; localTime: string; moment?: CampusMomentDto | null; kpis: Record<string, number | string | null>; facilities: CampusNodeDto[]; departments?: CampusDepartmentDto[]; eventsToday: Array<{ id: string; title: string; facilityId: string | null; startsAt: string; endsAt: string; status: string }> }
/** Operational layers for the map (GET /campus/layers), each present only for readers allowed the underlying read. */
export interface CampusLabLayerDto { labId: string; name: string; facilityId: string | null; practicalNow: { title: string; subject: string | null; className: string | null; until: string | null; status: string } | null; openIncidents: number | null; lowStock: number | null; expiringSoon: number | null; calibrationOverdue: number | null }
export interface CampusVehicleLayerDto { id: string; registrationNo: string; type: string; vehicleStatus: string; positionStatus: 'LIVE' | 'STALE' | 'OFFLINE' | 'NO_DATA'; trips: Array<{ refNo: string; kind: string; status: string; routeName: string | null; seatsUsed: number; capacity: number }>; documentsDue: Array<{ kind: string; state: string; daysLeft: number | null }>; checksDue: Array<{ kind: string; state: string }>; blocked: boolean }
export interface CampusCoverLayerDto { facilityId: string | null; room: string | null; className: string | null; periodNo: number; startTime: string; endTime: string; substituteName: string | null; absentName: string | null; label: string }
export interface CampusOptionalLayerDto { available: boolean; note?: string; items?: Array<Record<string, string | number | boolean | null>>; totals?: Record<string, number> }
export interface CampusLayersDto {
  asOf: string; layers: Record<string, boolean>; unavailable: string[];
  labs?: CampusLabLayerDto[] | null;
  transport?: { facilityId: string | null; vehicles: CampusVehicleLayerDto[]; live: number; stale: number; offline: number; dueSoon: number } | null;
  cover?: { today: number; now: CampusCoverLayerDto[] } | null;
  tasks?: { scope: string; byDepartment: Array<{ department: string; mapDepartment: string | null; overdue: number; dueThisWeek: number; open: number }>; overdue: number; dueThisWeek: number } | null;
  gate?: { facilityId: string | null; visitorsOnSite: number | null; studentsOutOnPass: number | null } | null;
  activities?: CampusOptionalLayerDto | null;
  greenery?: CampusOptionalLayerDto | null;
}
export interface ClassTodayDto { class: string | null; sectionId: string; enrolled: number; present: number | null; absent: number | null; late: number | null; registerTaken: boolean; attendancePct: number | null; exam: { name: string; subject: string | null; paperToday: boolean } | null; week: Array<{ date: string; present: number; marked: number; pct: number | null }>; source: string }
export interface FacilityDetailDto extends FacilityDto { layers: Record<string, boolean>; children: Array<{ id: string; name: string; kind: string; capacity: number | null; status: string; floorNo: number | null }>; scheduleToday?: Array<{ periodNo?: number; startTime: string; endTime: string; section: string; subject: string | null; teacher: string | null; subjectOfferingId?: string; module?: ModuleNowDto | null; isNow?: boolean }>; scheduleSource?: string; classToday?: ClassTodayDto; upcomingBookings?: Array<{ startsAt: string; endsAt: string; title: string }>; workOrders?: Array<{ id: string; refNo: string; title: string; priority: string; status: string; dueAt: string; overdue: boolean }>; bookable?: boolean }

// ── syllabus and modules ──
export interface CourseModuleDto {
  id: string; subjectOfferingId: string; order: number; title: string; description: string | null; plannedStart: string; plannedEnd: string; plannedPeriods: number | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'; startedAt: string | null; completedAt: string | null;
  topics: Array<{ id: string; title: string; done: boolean; doneAt: string | null }>;
  updates: Array<{ taughtOn: string; byName: string | null; note: string | null; topicsCovered: string[]; homework: string | null }>;
  topicsDone: number; topicsTotal: number; progressPct: number; expectedPct: number; pace: string; daysLeft: number; lastUpdateOn: string | null;
}
export interface SyllabusSummaryDto { modulesTotal: number; modulesDone: number; coveragePct: number | null; health: string; lastUpdateOn: string | null; current: (ModuleNowDto & { id: string; expectedPct: number; plannedEnd: string }) | null }
export interface SyllabusRowDto extends SyllabusSummaryDto { subjectOfferingId: string; subject: string; class: string; teacherId: string | null; teacher: string | null; canManage: boolean }
export interface SyllabusPlanDto extends SyllabusSummaryDto { subjectOfferingId: string; subject: string; class: string; teacher: string | null; canManage: boolean; modules: CourseModuleDto[] }
export interface SyllabusOverviewDto {
  rows: SyllabusRowDto[];
  byTeacher: Array<{ teacherId: string | null; teacher: string; subjects: number; onTrack: number; behind: number; noPlan: number; noUpdate: number; coveragePct: number | null; lessonsThisWeek: number; avgScorePct: number | null }>;
  totals: { subjects: number; onTrack: number; behind: number; noPlan: number; noRecentUpdate: number };
  definition: string;
}

// ── messaging ──
export interface PreferencesDto { whatsappOptIn: { status: string; at?: string | null }; language: string; quietHours: { enabled: boolean; startHour: number; endHour: number } }
export interface OutboxDto { id: string; channel: string; templateKey: string; recipientMasked: string | null; preview: string; status: string; statusReason: string | null; createdAt: string; relatedEntityType: string | null }

// ── Campus live detail and "my campus" (GET /campus/live, /campus/my-view) ──
export interface CampusLivePeriodDto {
  periodNo: number; startTime: string; endTime: string; startsAt: string; endsAt: string;
  subject: string; teacher: string | null; teacherProfileId?: string | null; coveringFor: string | null; room: string | null; subjectOfferingId?: string;
}
export interface CampusLiveAttendanceDto {
  marked: boolean; strength: number; present: number | null; absent?: number | null; late?: number | null;
  attendancePct?: number | null; periodRegister?: { marked: number; present: number } | null; lastUpdatedAt: string | null; source?: string;
}
export interface CampusLiveNowDto {
  className?: string; sectionId?: string; period?: CampusLivePeriodDto | null;
  next?: { periodNo: number; startTime: string; endTime: string; subject: string; teacher: string | null; room: string | null } | null;
  attendance?: CampusLiveAttendanceDto; classTeacher?: string | null;
  practical?: { labId: string; title: string; subject: string | null; className: string | null; teacher: string | null; until: string | null; status: string } | null;
  club?: { title: string; activity: string | null; startTime: string | null; endTime: string | null } | null;
  homeRoom?: boolean; awayIn?: string | null; updatedAt: string | null;
}
export interface CampusLiveLinkDto { page: string; label: string; query: string }
export type CampusLiveSectionDto =
  | { key: string; title: string; type: 'facts'; rows: Array<{ label: string; value: string | number; format?: 'time' }>; link?: CampusLiveLinkDto | null }
  | { key: string; title: string; type: 'metrics'; items: Array<{ label: string; value: string | number | null; tone?: string }>; note?: string; updatedAt?: string | null; link?: CampusLiveLinkDto | null }
  | { key: string; title: string; type: 'list'; items: Array<{ title: string; sub?: string | null; badge?: string | null; at?: string; state?: string; go?: { kind: string; id: string } }>; empty?: string; link?: CampusLiveLinkDto | null }
  | { key: string; title: string; type: 'roster'; items: Array<{ id: string; name: string; initial: string; admissionNo: string | null; rollNo: number | null; status: string | null; at?: string | null }>; counts: CampusLiveAttendanceDto; link?: CampusLiveLinkDto | null }
  | { key: string; title: string; type: 'period'; period: CampusLivePeriodDto; attendance: CampusLiveAttendanceDto; className: string; link?: CampusLiveLinkDto | null }
  | { key: string; title: string; type: 'note'; text: string; link?: CampusLiveLinkDto | null };
export interface CampusLiveDetailDto {
  asOf: string; refreshSeconds: number; kind: string; id: string; title: string; subtitle?: string | null;
  facilityId?: string | null; sectionId?: string | null; live?: CampusLiveNowDto | null; sections: CampusLiveSectionDto[]; pages?: string[];
}
export interface CampusMyClassDto {
  sectionId: string; className: string; subject: string; startTime: string; endTime: string; startsAt?: string; endsAt?: string; periodNo: number;
  room: string | null; roomName?: string | null; facilityId?: string | null; cover: string | null; strength?: number; present?: number | null; marked?: boolean; state?: string;
}
export interface CampusMyViewDto {
  role: 'PARENT' | 'STUDENT' | 'TEACHER' | 'STAFF' | 'ALUMNUS'; asOf: string; refreshSeconds: number; note?: string;
  children?: Array<{ studentId: string; name: string; className: string | null }>; selectedStudentId?: string | null;
  focus: { sectionId: string; className: string; facilityId: string | null; roomName?: string | null; homeFacilityId?: string | null } | null;
  now?: CampusLivePeriodDto | null; next?: CampusLiveNowDto['next'] | CampusMyClassDto | null;
  teacher?: { name: string; subject: string; coveringFor: string | null; profileId?: string | null; about?: TeacherPublicDto | null } | null;
  timetable?: Array<{ periodNo: number; startTime: string; endTime: string; subject: string; teacher: string | null; room: string | null; state: string }>;
  classCounts?: { strength: number; present: number | null; marked: boolean; lastUpdatedAt: string | null };
  child?: { studentId: string; name: string; today: string | null; markedAt: string | null; checkpoints: Array<{ point: string; label: string; at: string }> | null; bus: Array<{ title: string; status: string; myStatus: string; vehicle: string | null; stop: string | null; stopPlannedAt: string | null; eta: { at: string; isEstimate: boolean; label: string } | null }> | null };
  current?: CampusMyClassDto | null; today?: CampusMyClassDto[];
  departments?: string[]; layers?: string[];
}

// ── Campus World day plan, shifts and staff professional profiles (p3-campus) ──
export type CampusActivity = 'CLASS' | 'EXAM' | 'SPORTS' | 'STUDY' | 'CHANGEOVER' | 'ASSEMBLY' | 'BREAK' | 'LUNCH' | 'ARRIVAL' | 'DISPERSAL' | 'CLUB' | 'STAFF';
export interface CampusCrowdDto { facilityId: string; students: number | null; teachers: number; activity: CampusActivity; labels: string[] }
export interface CampusMomentDto {
  date: string; time: string; dayOfWeek: number; timezone: string; isToday: boolean; live: boolean;
  day: { kind: 'SCHOOL_DAY' | 'HOLIDAY' | 'VACATION' | 'CLOSURE' | 'WEEKLY_OFF' | 'EXAM_ONLY'; title: string | null; open: boolean };
  banner: { text: string; sub: string | null; tone: 'class' | 'break' | 'closed' | 'holiday' | 'exam' | 'arrival' | 'clubs'; motion: boolean };
  nextOpen: { date: string; time: string; label: string } | null;
  shifts: Array<{ code: string; name: string; color: string | null; phase: string; label: string; periodNo: number | null; periodsTotal: number; minutesLeft: number | null; opensAt: string | null; closesAt: string | null; sections: number }>;
  sections: Array<{ sectionId: string; className: string; shift: { code: string; name: string } | null; phase: string; activity: CampusActivity | null; facilityId: string | null; place: string | null; students: number; strength: number; headcountFrom: 'REGISTER' | 'STRENGTH'; periodNo: number | null; subject: string | null; teacher: string | null; teacherProfileId: string | null; until: string | null }>;
  crowd: CampusCrowdDto[];
  buses: { phase: 'AWAY' | 'ARRIVING' | 'PARKED' | 'DEPARTING'; trips: number | null; label: string };
  walkers: 'NONE' | 'FEW' | 'BUSY';
  totals: { onCampus: number; sectionsInSession: number; sections: number; registerTaken: number } | null;
  source: string;
}
export interface ShiftBellDto { kind: 'ARRIVAL' | 'ASSEMBLY' | 'PERIOD' | 'BREAK' | 'LUNCH' | 'DISPERSAL' | 'CLUBS'; label: string | null; periodNo: number | null; start: string; end: string }
export interface ShiftDto { id: string; code: string; name: string; color: string | null; active: boolean; daysOfWeek: number[]; bells: ShiftBellDto[]; periods: number; startsAt: string | null; endsAt: string | null; sections: Array<{ id: string; name: string }>; note: string | null; updatedAt: string | null; retimedPeriods?: number; moved?: string[] }
export interface ShiftConflictDto { room: string; day: string; dayOfWeek: number; from: string; to: string; classes: string[] }
export interface ShiftsDto { shifts: ShiftDto[]; unassigned: Array<{ id: string; name: string }>; sections: Array<{ id: string; name: string }>; conflicts: ShiftConflictDto[]; bellKinds: string[]; note: string }
export type CredentialPart = 'qualifications' | 'subjects' | 'experience' | 'certifications' | 'bio';
export interface TeacherPublicDto { profileId?: string; name: string | null; shown: CredentialPart[]; qualifications?: Array<{ degree: string; institution: string | null; year: number | null }>; subjects?: string[]; specialisations?: string[]; experienceYears?: number; certifications?: Array<{ name: string; issuer: string | null; year: number | null }>; bio?: string; teaches?: string[]; classTeacher?: boolean }
export interface StaffCredentialDto {
  profileId: string; name: string; role: string | null;
  qualifications: Array<{ degree: string; institution: string | null; year: number | null }>;
  subjects: string[]; specialisations: string[]; experienceYears: number | null;
  certifications: Array<{ name: string; issuer: string | null; year: number | null }>;
  bio: string | null; showToFamilies: Record<CredentialPart, boolean>; updatedAt: string | null;
  canEdit?: boolean; canEditConsent?: boolean; familiesSee?: TeacherPublicDto;
}
export interface StaffCredentialRowDto { profileId: string; name: string; role: string | null; roleKey: string | null; filled: number; of: number; shownToFamilies: CredentialPart[] }
export interface TeachersOfDto { studentId: string | null; child: string | null; teachers: Array<TeacherPublicDto & { profileId: string; name: string; teaches: string[]; classTeacher: boolean }>; note?: string }
