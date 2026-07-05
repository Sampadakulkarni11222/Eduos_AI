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

export interface Me {
  accountId: string;
  profile: ProfileSummary;
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
export interface OfferingDto { id: string; subject: string; sectionId: string; sectionName: string }
export interface RosterRow { enrollmentId: string; rollNo: number | null; studentName: string; status: AttStatus | null; note: string | null }
export type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY';
export interface AttendanceRoster { section: { id: string; name: string }; date: string; periodNo: number | null; roster: RosterRow[] }
export interface AssignmentDto { id: string; title: string; type: string; dueAt: string; maxMarks: number | null; subject: string; class: string; submissionCount: number }
export interface TimetableSlotDto { id: string; dayOfWeek: number; periodNo: number; startTime: string; endTime: string; subject: string | null; teacher: string | null; subjectOfferingId: string | null; isBreak: boolean }
export interface TimetableDto { section: { id: string; name: string }; slots: TimetableSlotDto[] }
export interface PerformanceDto {
  student: { name: string; class: string };
  overallAvgPct: number | null;
  bestSubject: { subject: string; pct: number | null } | null;
  needsSupport: { subject: string; pct: number | null } | null;
  results: Array<{ exam: string; subject: string; marks: number | null; maxMarks: number; pct: number | null }>;
}
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



