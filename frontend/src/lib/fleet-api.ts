/**
 * Typed client for transport fleet and trips (backend modules/fleet):
 * vehicles, trips, seat allocation, boarding, safe handover, reconciliation,
 * live positions and "my bus today".
 */
import { request } from './api';
import { qs, post, put, patch } from './ops-api';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type ExpiryState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'NOT_SCHEDULED';
export type PositionStatus = 'LIVE' | 'STALE' | 'OFFLINE' | 'NO_DATA';

export interface VehicleDocument { id: string; kind: string; number: string | null; validTo: string | null; state: ExpiryState; daysLeft: number | null }
export interface Position { lat: number; lng: number; speedKmh?: number | null; heading?: number | null; eventAt: string; receivedAt?: string }
export interface VehicleDto {
  id: string; registrationNo: string; type: string; makeModel: string | null; lawfulCapacity: number; usableSeats: number;
  ownership: string; contractorName: string | null; status: string; statusNote: string | null; odometerKm: number;
  documents: VehicleDocument[]; blockingDocuments: string[];
  safety: { fireExtinguisherDueOn: string | null; firstAidDueOn: string | null };
  safetyState: { fireExtinguisher: ExpiryState; firstAid: ExpiryState; service: ExpiryState };
  service: { nextDueOn: string | null; everyDays: number | null; everyKm: number | null };
  defaultDriver?: { name: string | null; phone: string | null };
  gpsDeviceId: string | null; lastPosition?: Position | null; positionStatus?: PositionStatus;
  logs?: Array<{ id: string; kind: string; at: string; odometerKm: number | null; litres: number | null; amountPaise: number | null; note: string | null; severity: string | null; check: string | null; resolvedAt: string | null; byName: string | null }>;
}
export interface Crew { profileId: string | null; name: string | null; phone: string | null; cleared: boolean | null; clearanceNote: string | null }
export interface PlannedStop { _id: string; stopId: string | null; name: string; sequenceNo: number; plannedAt: string | null; arrivedAt: string | null; departedAt: string | null }
export interface Eta { method: 'GPS_ESTIMATE' | 'TIMETABLE' | 'ARRIVED'; at: string; minutes: number; isEstimate: boolean; label: string; distanceMeters?: number }
export interface AllocationDto { id: string; studentId: string; studentName: string; stopName: string | null; status: string; boardedAt: string | null; boardedVia: string | null; alightedAt: string | null; handover?: { at: string | null; receivedByName: string | null; receivedByKind: string | null } }
export interface AlertDto { id: string; kind: string; severity: string; department: string; message: string; status: string; count: number; lastSeenAt: string; tripId?: string | null; studentId?: string | null }
export interface Reconciliation { at: string | null; enrolled: number | null; allocated: number | null; boarded: number | null; alighted: number | null; handedOver: number | null; returnedToSchool: number | null; noShow: number | null; released: number | null; unmatched: Array<{ studentId: string; studentName: string; issue: string }> }
export interface TripDto {
  id: string; refNo: string; title: string; kind: string; kindLabel: string; status: string; date: string; routeName: string | null;
  vehicleId: string; registrationNo?: string | null; usableSeats: number; seatsAllocated: number; seatsFree: number;
  driver: Crew; attendant: Crew; plannedStops: PlannedStop[]; counts?: Record<string, number>;
  reconciliation?: Reconciliation; substitutions?: Array<{ at: string; reason: string }>;
  alerts?: AlertDto[] | { suppressUntil: string | null }; history?: unknown[];
}
export interface TripDetail extends Omit<TripDto, 'alerts'> {
  vehicle: { id: string; registrationNo: string; type: string; usableSeats: number; lawfulCapacity: number; lastPosition: Position | null; positionStatus: PositionStatus } | null;
  nextStop: (PlannedStop & { eta: Eta | null }) | null;
  allocations: AllocationDto[]; alerts: AlertDto[];
}
export interface LiveBoard { asOf: string; staleAfterMinutes: number; offlineAfterMinutes: number; vehicles: Array<{ id: string; registrationNo: string; type: string; vehicleStatus: string; hasGps: boolean; position: Position | null; positionStatus: PositionStatus; lastSeenMinutes: number | null; trip: { id: string; refNo: string; kind: string; status: string; routeName: string | null } | null }> }
export interface MyTrips {
  children: Array<{ studentId: string; name: string; trips: Array<{ tripId: string; title: string; kind: string; kindLabel: string; status: string; vehicle: { registrationNo: string; type: string } | null; attendantName: string | null; stop: { name: string; plannedAt?: string | null; arrivedAt?: string | null } | null; myStatus: string; boardedAt: string | null; alightedAt: string | null; handover: { at: string; receivedByName: string; receivedByKind: string } | null; eta: Eta | null; position: Position | null; positionStatus: PositionStatus | null }> }>;
  note: string | null;
}
export interface AdultsForStudent {
  student: { id: string; name: string; admissionNo: string };
  guardians: Array<{ guardianProfileId: string; name: string; relation: string; pickupAuthorized: boolean; restricted: boolean }>;
  adults: Array<{ id: string; kind: string; name: string; relationship: string | null; status: string; validFrom: string | null; validTo: string | null; validNow: boolean; restrictionNote?: string | null }>;
}

export const fleetApi = {
  myTrips: () => get<MyTrips>('/fleet/my-trips'),
  vehicles: (p: Q = {}) => get<VehicleDto[]>('/fleet/vehicles', p),
  vehicle: (id: string) => get<VehicleDto>(`/fleet/vehicles/${id}`),
  createVehicle: (body: unknown) => post<VehicleDto>('/fleet/vehicles', body),
  updateVehicle: (id: string, body: unknown) => patch<VehicleDto>(`/fleet/vehicles/${id}`, body),
  vehicleStatus: (id: string, body: { status: string; note?: string }) => post<VehicleDto>(`/fleet/vehicles/${id}/status`, body),
  addLog: (id: string, body: unknown) => post<unknown>(`/fleet/vehicles/${id}/logs`, body),
  resolveBreakdown: (id: string, logId: string, note: string) => post<unknown>(`/fleet/vehicles/${id}/logs/${logId}/resolve`, { note }),
  linkGps: (id: string, deviceId: string | null) => put<VehicleDto>(`/fleet/vehicles/${id}/gps-device`, { deviceId }),
  live: () => get<LiveBoard>('/fleet/live'),
  trips: (p: Q = {}) => get<TripDto[]>('/fleet/trips', p),
  trip: (id: string) => get<TripDetail>(`/fleet/trips/${id}`),
  createTrip: (body: unknown) => post<TripDetail>('/fleet/trips', body),
  planDay: (date?: string) => post<Array<Record<string, unknown>>>('/fleet/trips/plan-day', { date }),
  tripAction: <R = TripDetail>(id: string, action: string, body: unknown = {}) => post<R>(`/fleet/trips/${id}/${action}`, body),
  releaseSeat: (id: string, allocationId: string, reason?: string) => post<AllocationDto>(`/fleet/trips/${id}/allocations/${allocationId}/release`, { reason }),
  markStop: (id: string, stopId: string, event: 'ARRIVED' | 'DEPARTED') => post<TripDetail>(`/fleet/trips/${id}/stops/${stopId}`, { event }),
  adultsFor: (studentId: string) => get<AdultsForStudent>(`/pickup/students/${studentId}`),
  alerts: (p: Q = {}) => get<AlertDto[]>('/safety/alerts', p),
  closeAlert: (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED', note?: string) => post<AlertDto>(`/safety/alerts/${id}`, { status, note }),
};
