/**
 * Client for the leadership APIs (part 4): school-wide attendance, teacher
 * workload, board packs and certificates generated from the record.
 */
import { request } from './api';
import { downloadCsv, post, qs } from './ops-api';

export type ClassAttendance = { sectionId: string; class: string; level: number | null; students: number; marked: number; pctPresent: number | null; belowThreshold: boolean; ABSENT: number; LATE: number };
export type RegisterRow = { sectionId: string; class: string; classTeacher: string | null; students: number; marked: number };
export type AttendanceOverview = {
  period: { from: string; to: string; days: number };
  threshold: number;
  overall: { students: number; marked: number; pctPresent: number | null };
  classes: ClassAttendance[];
  today: { date: string; schoolDay: boolean; registers: number; notMarked: RegisterRow[]; partlyMarked: RegisterRow[] };
  trend: Array<{ date: string; marked: number; pctPresent: number | null; absent: number }>;
  belowThreshold: Array<{ enrollmentId: string; studentId: string; name: string; admissionNo: string | null; class: string; pctPresent: number; daysMarked: number; absent: number }>;
  belowThresholdTotal: number;
  basis: string;
};
export type TeacherLoad = { profileId: string; name: string; periodsPerWeek: number; perDay: number[]; maxInADay: number; sections: number; classes: string[]; subjects: string[]; classTeacherOf: string[]; coversLast30Days: number; leaveDaysThisYear: number; flags: string[]; clashes?: Array<{ day: string; at: string; classes: string[] }>; clashCount?: number };
export type Workload = { cap: number; teachers: TeacherLoad[]; summary: { teachers: number; averagePeriods: number | null; overCap: number; withoutPeriods: number; periodsWithoutTeacher: number; classTeachers: number; withClashes?: number }; basis: string };

type Unavailable = { available: false; reason: string };
export type BoardPackData = {
  meeting: { id: string; refNo: string; title: string; body: string; status: string; scheduledAt: string | null; quorum: number | null; agenda: Array<{ order: number; title: string; presenter: string | null; decisionNeeded: boolean; papers: Array<{ name: string; url: string | null }> }>; members: Array<{ name: string; role: string; rsvp: string; conflicts: Array<{ agendaOrder: number; declaration: string }> }> };
  previous: Unavailable | { available: true; refNo: string; title: string; heldOn: string; minutesStatus: string; minutes: string | null; minutesNote: string | null; resolutions: Array<{ number: string; text: string; outcome: string; votesFor: number; votesAgainst: number; abstentions: number }> };
  actions: Unavailable | { available: true; items: Array<{ actionId: string; title: string; meeting: string; ownerName: string | null; dueOn: string | null; overdue: boolean }> };
  finance: Unavailable | { available: true; period: { label: string }; comparison: { label: string } | null; metrics: Array<{ key: string; label: string; text: string; comparisonText: string | null; changePct: number | null; definition: string }>; note: string };
  budget: Unavailable | { available: true; fiscalYear: string; name: string; status: string; yearElapsedPct: number; totals: { planned: number; committed: number; actual: number }; lines: Array<{ code: string; head: string; plannedPaise: number; committedPaise: number; actualPaise: number; utilisationPct: number | null }>; previousYear: null | { fiscalYear: string; planned: number; actual: number; overruns: Array<{ code: string; head: string; overPct: number | null; explanation: string | null }> } };
  compliance: Unavailable | { available: true; overdue: Array<{ kind: string; title: string; date: string }>; dueIn30Days: Array<{ kind: string; title: string; date: string }> };
  decisions: Unavailable | { available: true; items: Array<{ id: string; refNo: string; title: string; amountPaise: number; dueAt: string | null; stage: string }>; note: string };
  enrolment: Unavailable | { available: true; studentsOnRoll: number };
  questions: Array<{ question: string; basis: string; section: string }>;
  questionsNote: string;
  builtAt: string;
};
export type BoardPackView = { mode: 'LIVE' | 'FROZEN'; version: number | null; frozenAt?: string; frozenBy?: string | null; note?: string | null; reads?: Array<{ name: string; at: string }>; versions: Array<{ version: number; frozenAt: string; frozenBy: string | null; note: string | null }>; pack: BoardPackData };

export type ClearanceCheck = { key: string; label: string; status: 'CLEAR' | 'DUE'; detail: string; link: string };
export type Clearance = { requestId: string; kind: string; title: string; required: boolean; clear: boolean; checks: ClearanceCheck[] };
export type CertificatePreview = { kind: string; title: string; body: string | null; rows: Array<[string, string]>; needsClearance: boolean; clearance: { clear: boolean; checks: ClearanceCheck[] } };
export type IssuedCertificateRow = { id: string; serialNo: string; kind: string; title: string; studentName: string; admissionNo: string | null; issuedAt: string; issuedBy: string | null; duesOpen: boolean | null; overrideReason: string | null; status: string; requestId: string };
export type OfficeFields = Partial<Record<'reasonForLeaving' | 'conduct' | 'promotion' | 'subjects' | 'lastExam' | 'concession' | 'activities' | 'purpose' | 'remarks' | 'leavingDate' | 'category' | 'overrideReason', string>>;

export const leadershipApi = {
  attendanceOverview: (p: { from?: string; to?: string; threshold?: number } = {}) => request<AttendanceOverview>(`/leadership/attendance-overview${qs(p)}`),
  workload: (cap?: number) => request<Workload>(`/leadership/workload${qs({ cap })}`),
  boardPack: (meetingId: string, live = false) => request<BoardPackView>(`/leadership/board-pack/${meetingId}${qs({ live: live ? '1' : undefined })}`),
  freezeBoardPack: (meetingId: string, note?: string) => post<BoardPackView>(`/leadership/board-pack/${meetingId}/freeze`, { note }),
  boardPackPdf: (meetingId: string, refNo: string, live = false) => downloadCsv(`/leadership/board-pack/${meetingId}/pdf${live ? '?live=1' : ''}`, `board-pack-${refNo.replace(/[^A-Za-z0-9-]/g, '-')}.pdf`),
  clearance: (requestId: string) => request<Clearance>(`/leadership/certificates/${requestId}/clearance`),
  previewCertificate: (requestId: string, body: OfficeFields) => post<CertificatePreview>(`/leadership/certificates/${requestId}/preview`, body),
  generateCertificate: (requestId: string, body: OfficeFields) => post<{ serialNo: string; verificationCode: string; title: string }>(`/leadership/certificates/${requestId}/generate`, body),
  certificateRegister: () => request<IssuedCertificateRow[]>('/leadership/certificates/register'),
  verifyCertificate: (code: string) => request<{ valid: boolean; serialNo?: string; title?: string; studentName?: string; issuedAt?: string; message?: string }>(`/leadership/certificates/verify/${encodeURIComponent(code)}`),
};
