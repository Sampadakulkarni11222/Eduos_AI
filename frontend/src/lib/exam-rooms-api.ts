/**
 * Typed client for exam halls, Rooms & Classes and room shifts (backend modules/examRooms).
 */
import { request } from './api';
import { qs, post, put, patch, del, downloadCsv } from './ops-api';
import type { HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export interface RoomRef { id: string; code: string; name: string; kind: string; capacity: number | null }
export interface Invigilator { id: string; name: string }
export interface Seat { seatNo: string; enrollmentId: string; studentId: string; name: string; admissionNo: string | null; rollNo: number | null; className: string }
export interface Venue { id: string; facilityId: string; room: string; code: string | null; capacity: number | null; seated: number; invigilators: Invigilator[]; seats?: Seat[] }
export interface Sitting {
  id: string; kind: 'BOARD' | 'TERM' | 'CLASS_TEST' | 'OTHER'; title: string; subject: string | null; examSubjectId: string | null;
  classes: Array<{ sectionId: string; className: string }>; date: string; dateLabel: string; startTime: string; endTime: string; delayMinutes: number;
  startsAt: string; endsAt: string; status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'POSTPONED' | 'CANCELLED'; banner: string | null; notes: string | null;
  candidates: number; seated: number; unseated: number; venues: Venue[]; canEdit: boolean; history?: HistoryEntry[];
  notified?: { students: number; guardians: number; invigilators: number } | null;
}
export interface SittingList { from: string; to: string; items: Sitting[]; canSchedule: 'ALL' | 'CLASS_TEST' | null }
export interface Duty { sittingId: string; profileId: string; invigilator: string; date: string; dateLabel: string; startTime: string; endTime: string; title: string; classes: string[]; room: string; seated: number; with: string[]; status: string; banner: string | null }
export interface DutyRoster { from: string; to: string; items: Duty[]; roster?: Array<{ profileId: string; name: string; duties: number; minutes: number; items: Duty[] }> }
export interface MyExam { id: string; title: string; subject: string | null; kind: string; date: string; dateLabel: string; startTime: string; endTime: string; delayMinutes: number; status: string; room: string | null; seatNo: string | null; rooms?: string[]; banner: string | null }
export interface MyExams { children: Array<{ studentId: string; name: string | null; className: string | null; exams: MyExam[] }>; note: string }
export interface InvigilatorOption { id: string; name: string; role: string | null; free: boolean; clashes: string[] }
export interface DoorList { sittingId: string; title: string; date: string; dateLabel: string; time: string; rooms: Array<{ room: string; code: string | null; capacity: number | null; seated: number; invigilators: string[]; groups: Array<{ className: string; fromRoll: number | null; toRoll: number | null; count: number; fromSeat: string; toSeat: string }> }> }

export interface ClassRow { sectionId: string; className: string; strength: number; classTeacher: string | null; homeRoom: RoomRef | null; fits: boolean | null; spare: number | null; shiftedToday: Array<{ refNo: string; room: string; periods: number[]; reason: string }> }
export interface RoomRow extends RoomRef { status: string; occupant: { sectionId: string; className: string; strength: number } | null; fits: boolean | null; movedInToday: Array<{ className: string; periods: number[]; reason: string }> }
export interface RoomsAndClasses { date: string; sections: ClassRow[]; rooms: RoomRow[]; totals: { classes: number; withoutRoom: number; overCapacity: number; freeRooms: number; shiftedToday: number; pendingRequests: number }; canManage: boolean; settings: { teacherSelfShift: boolean } }
export interface RoomShift {
  id: string; refNo: string; sectionId: string; className: string | null; kind: 'TEMPORARY' | 'PERMANENT'; status: 'REQUESTED' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
  startDate: string; endDate: string; periods: number[]; when: string; from: RoomRef | null; to: RoomRef | null; reason: string;
  requestedBy: string | null; requestedByProfileId: string | null; selfApplied: boolean; decidedBy: string | null; decisionNote: string | null; createdAt: string; history: HistoryEntry[];
  applied?: boolean; warnings?: string[];
}
export interface ShiftCheck { className: string; sectionId: string; strength: number; from: RoomRef | null; to: RoomRef; kind: string; startDate: string; endDate: string; periods: number[]; when: string; lessons: number; conflicts: Array<{ date: string; periodNo: number | null; kind: string; detail: string }>; warnings: string[]; fits: boolean | null; suggestions: Array<RoomRef & { fits: boolean | null }>; canApply: boolean }
export interface ShiftBody { sectionId?: string; className?: string; toFacilityId?: string; kind: 'TEMPORARY' | 'PERMANENT'; startDate: string; endDate?: string; periods?: number[]; reason: string }
export interface SittingBody { kind?: string; examSubjectId?: string; className?: string; subject?: string; title?: string; date: string; startTime: string; endTime: string; venues: Array<{ facilityId: string; capacity?: number | null; invigilatorProfileIds?: string[] }>; seatingMode?: 'ROLL' | 'ALTERNATE'; notes?: string }

export const examRoomsApi = {
  sittings: (p: Q = {}) => get<SittingList>('/exam-rooms/sittings', p),
  sitting: (id: string) => get<Sitting>(`/exam-rooms/sittings/${id}`),
  create: (body: SittingBody) => post<Sitting>('/exam-rooms/sittings', body),
  update: (id: string, body: Partial<SittingBody>) => patch<Sitting>(`/exam-rooms/sittings/${id}`, body),
  remove: (id: string) => del<{ id: string; deleted: boolean }>(`/exam-rooms/sittings/${id}`),
  changeVenue: (id: string, body: { toFacilityId: string; fromFacilityId?: string; reason?: string }) => post<Sitting>(`/exam-rooms/sittings/${id}/venue`, body),
  delay: (id: string, minutes: number, reason?: string) => post<Sitting>(`/exam-rooms/sittings/${id}/delay`, { minutes, reason }),
  status: (id: string, body: { status: string; reason?: string; newDate?: string }) => post<Sitting>(`/exam-rooms/sittings/${id}/status`, body),
  reseat: (id: string, mode: 'ROLL' | 'ALTERNATE') => post<Sitting>(`/exam-rooms/sittings/${id}/reseat`, { mode }),
  moveSeat: (id: string, body: { enrollmentId: string; toFacilityId?: string; seatNo?: string }) => post<Sitting>(`/exam-rooms/sittings/${id}/seat`, body),
  doorList: (id: string) => get<DoorList>(`/exam-rooms/sittings/${id}/door-list`),
  seatingCsv: (id: string, filename: string) => downloadCsv(`/exam-rooms/sittings/${id}/seating.csv`, filename),
  myExams: (p: Q = {}) => get<MyExams>('/exam-rooms/my-exams', p),
  duties: (p: Q = {}) => get<DutyRoster>('/exam-rooms/duties', p),
  invigilators: (p: { date: string; startTime: string; endTime: string; sittingId?: string }) => get<InvigilatorOption[]>('/exam-rooms/invigilators', p),
  rooms: (p: Q = {}) => get<RoomsAndClasses>('/exam-rooms/rooms', p),
  history: (sectionId: string) => get<{ sectionId: string; className: string; items: Array<{ id: string; at: string; to: string | null; from: string | null; reason: string | null; via: string; by: string | null }> }>(`/exam-rooms/rooms/history/${sectionId}`),
  assignHome: (body: { sectionId: string; facilityId: string | null; reason?: string; displace?: boolean }) => put<{ className: string; to: RoomRef | null; from: RoomRef | null; displaced: string | null; fits: boolean | null }>('/exam-rooms/rooms/home', body),
  setSettings: (teacherSelfShift: boolean) => put<{ teacherSelfShift: boolean }>('/exam-rooms/settings', { teacherSelfShift }),
  shifts: (p: Q = {}) => get<RoomShift[]>('/exam-rooms/shifts', p),
  checkShift: (body: ShiftBody) => post<ShiftCheck>('/exam-rooms/shifts/check', body),
  createShift: (body: ShiftBody) => post<RoomShift>('/exam-rooms/shifts', body),
  decideShift: (id: string, action: 'APPROVE' | 'REJECT', note?: string) => post<RoomShift>(`/exam-rooms/shifts/${id}/decide`, { action, note }),
  cancelShift: (id: string, reason: string) => post<RoomShift>(`/exam-rooms/shifts/${id}/cancel`, { reason }),
};
