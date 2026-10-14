/**
 * Typed client for the laboratories API (/labs): labs, stock batches and the
 * movement ledger, instruments, computers and software seats, practical
 * sessions and incidents. Quantities come back in each item's display unit
 * (`*Display` fields) as well as the stored base unit.
 */
import { request } from './api';
import { qs, post, patch } from './ops-api';
import type { Attachment, HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export const LAB_TYPES = ['SCIENCE_CHEMISTRY', 'SCIENCE_PHYSICS', 'SCIENCE_BIOLOGY', 'SCIENCE_COMPOSITE', 'COMPUTER'] as const;
export const HAZARD_CLASSES = ['EXPLOSIVE', 'FLAMMABLE', 'OXIDISING', 'COMPRESSED_GAS', 'CORROSIVE', 'ACUTE_TOXIC', 'HEALTH_HAZARD', 'SERIOUS_HEALTH_HAZARD', 'ENVIRONMENTAL'] as const;
export const STORAGE_GROUPS = ['GENERAL', 'FLAMMABLE', 'OXIDISER', 'ACID', 'BASE', 'TOXIC', 'WATER_REACTIVE', 'COMPRESSED_GAS', 'BIOLOGICAL'] as const;
export const LAB_UNITS = ['g', 'kg', 'mg', 'mL', 'L', 'pcs'] as const;
export const INCIDENT_KINDS = ['SPILL', 'INJURY', 'BREAKAGE', 'FIRE', 'EXPOSURE', 'NEAR_MISS', 'EQUIPMENT_FAILURE', 'DEVICE_DAMAGE', 'OTHER'] as const;

export interface LabCounts {
  items: number; lowStock: number; expired: number; expiringSoon: number; quarantined: number; equipment: number; outOfService: number;
  calibrationOverdue: number; devices: number; devicesInRepair: number; sessionsThisWeek: number; openIncidents: number;
}
export interface LabDto {
  id: string; facilityId: string; facilityCode: string | null; facilityName: string | null; name: string; type: string; capacity: number | null;
  inChargeProfileIds: string[]; inChargeNames: string[]; assistantProfileId: string | null; assistantName: string | null;
  safetyChecklist: Array<{ item: string; required: boolean }>; alertDays: number; status: string; notes: string | null; counts?: LabCounts;
}
export interface BatchDto {
  id: string; itemId: string; labId: string; code: string; lotNo: string | null; supplierName: string | null; receivedOn: string; openedOn: string | null; expiresOn: string | null;
  quantity: number; quantityDisplay: number; initialDisplay: number; displayUnit: string; status: string; quarantineReason: string | null; location: string | null;
  expired: boolean; daysToExpiry: number | null; issuable: boolean; itemName?: string;
}
export interface LabItemDto {
  id: string; labId: string; name: string; kind: string; casNo: string | null; hazardClasses: string[]; storageGroup: string; baseUnit: string; displayUnit: string;
  minStock: number; minStockDisplay: number; reorderQty: number; estUnitPaise: number; sdsUrl: string | null; sds: Attachment[]; restricted: boolean; location: string | null; active: boolean;
  onHand: number; onHandDisplay: number; expiredQuantity: number; quarantinedQuantity: number; lowStock: boolean; hazardous: boolean; nextExpiry: string | null; batches: BatchDto[];
}
export interface MovementDto {
  id: string; refNo: string; type: string; quantity: number; quantityDisplay: number; balanceDisplay: number; displayUnit: string; itemName: string; batchCode: string | null;
  reason: string | null; issuedToName: string | null; byName: string | null; at: string; evidence: Attachment[]; outstanding?: number; outstandingDisplay?: number;
}
export interface FefoDto { itemName: string; displayUnit: string; wantedDisplay: number; plan: Array<{ batchId: string; code: string; expiresOn: string | null; takeDisplay: number; opened: boolean }>; shortByDisplay: number; hazardous: boolean; restricted: boolean }
export interface EquipmentDto {
  id: string; labId: string; assetId: string | null; name: string; code: string; serialNo: string | null; make: string | null; quantity: number;
  calibrationRequired: boolean; calibrationIntervalMonths: number; lastCalibratedOn: string | null; calibrationDueOn: string | null; calibrationOverdue: boolean; calibrationDaysLeft: number | null;
  certificates: Array<{ number: string; issuedOn: string; validUntil: string; by: string | null; url: string | null }>;
  warrantyUntil: string | null; amcUntil: string | null; condition: string; outOfService: boolean; outOfServiceReason: string | null; usable: boolean; openRepairs: number;
  repairs: Array<{ _id: string; at: string; issue: string; action: string | null; closedAt: string | null; costPaise: number }>; status: string;
}
export interface DeviceDto {
  id: string; labId: string; tag: string; code: string; serialNo: string | null; kind: string; make: string | null; os: string | null; workstationNo: string | null; status: string;
  hardware?: { cpu?: string | null; ramGb?: number | null; storageGb?: number | null; other?: string | null }; warrantyUntil: string | null; amcUntil: string | null;
  repairs: Array<{ _id: string; at: string; issue: string; closedAt: string | null }>; openRepairs: number; software: string[];
  decommission?: { at: string | null; reason: string | null; eWasteHandler: string | null };
}
export interface SoftwareDto {
  id: string; labId: string | null; name: string; publisher: string | null; version: string | null; licenceType: string; seatsTotal: number; seatsUsed: number; seatsFree: number | null;
  renewalOn: string | null; renewalDaysLeft: number | null; costPaise: number; vendorName: string | null; deviceIds: string[]; active: boolean;
}
export interface SessionDto {
  id: string; refNo: string; labId: string; labName: string | null; labType: string | null; title: string; subject: string | null; className: string | null; startsAt: string; endsAt: string | null;
  teacherName: string | null; status: string; safetyNotes: string; devicesNeeded: number;
  items: Array<{ itemId: string; name: string; quantityDisplay: number; displayUnit: string; hazardous: boolean }>;
  equipment: Array<{ equipmentId: string; name: string; quantity: number }>;
  readiness: { checkedAt: string | null; ok: boolean | null; problems: Array<{ kind: string; message: string }> };
  safetyChecks: Array<{ item: string; done: boolean }>;
  attendance: Array<{ enrollmentId?: string; name: string; present: boolean }>; presentCount: number; outcomeNote: string | null;
  prep?: { requestedAt?: string; preparedAt?: string; note?: string };
}
export interface IncidentDto {
  id: string; refNo: string; labId: string; labName: string | null; at: string; kind: string; severity: string; description: string; actionsTaken: string | null;
  reportedByName: string | null; status: string; closureNote: string | null; workOrderId: string | null; history?: HistoryEntry[];
}
export interface ScanResult { type: 'BATCH' | 'EQUIPMENT' | 'DEVICE'; code: string; labId: string; batch?: BatchDto; item?: { id: string; name: string; displayUnit: string; hazardClasses: string[]; restricted: boolean; sdsUrl: string | null } | null; equipment?: EquipmentDto; device?: DeviceDto }
export interface LabOverviewDto { labs: Array<{ id: string; name: string; type: string; facilityCode: string | null; counts: LabCounts }>; total: Partial<LabCounts>; software: Array<{ id: string; name: string; seatsTotal: number; seatsUsed: number; renewalOn: string | null }>; asOf: string }

export const labsApi = {
  labs: () => get<LabDto[]>('/labs'),
  overview: () => get<LabOverviewDto>('/labs/overview'),
  freeFacilities: () => get<Array<{ id: string; code: string; name: string; capacity: number | null }>>('/labs/facilities'),
  createLab: (body: unknown) => post<LabDto>('/labs', body),
  updateLab: (id: string, body: unknown) => patch<LabDto>(`/labs/${id}`, body),
  scan: (code: string) => get<ScanResult>(`/labs/scan/${encodeURIComponent(code)}`),
  syncDue: () => post<unknown>('/labs/due/sync'),

  items: (p: Q = {}) => get<LabItemDto[]>('/labs/items', p),
  createItem: (labId: string, body: unknown) => post<LabItemDto>(`/labs/${labId}/items`, body),
  updateItem: (id: string, body: unknown) => patch<LabItemDto>(`/labs/items/${id}`, body),
  receive: (itemId: string, body: unknown) => post<{ batch: BatchDto; movement: MovementDto }>(`/labs/items/${itemId}/receive`, body),
  fefo: (itemId: string, quantity: number, unit?: string) => get<FefoDto>(`/labs/items/${itemId}/fefo`, { quantity, unit }),
  reorder: (itemId: string, body: unknown = {}) => post<{ purchaseRequest: { id: string; refNo: string } }>(`/labs/items/${itemId}/reorder`, body),
  moveOut: (kind: 'issue' | 'consume' | 'damage' | 'dispose', body: unknown) => post<{ batch: BatchDto; movement: MovementDto }>(`/labs/stock/${kind}`, body),
  returnStock: (body: unknown) => post<{ batch: BatchDto; movement: MovementDto }>('/labs/stock/return', body),
  updateBatch: (id: string, body: unknown) => patch<BatchDto>(`/labs/batches/${id}`, body),
  stocktake: (labId: string, body: unknown) => post<{ adjusted: number; lines: Array<{ code: string; itemName: string; delta: number; deltaDisplay?: number; displayUnit?: string; applied: boolean; error?: string }> }>(`/labs/${labId}/stocktake`, body),
  movements: (p: Q = {}) => get<{ items: MovementDto[]; total: number; page: number; pageSize: number }>('/labs/movements', p),

  equipment: (p: Q = {}) => get<EquipmentDto[]>('/labs/equipment', p),
  createEquipment: (labId: string, body: unknown) => post<EquipmentDto>(`/labs/${labId}/equipment`, body),
  updateEquipment: (id: string, body: unknown) => patch<EquipmentDto>(`/labs/equipment/${id}`, body),
  calibrate: (id: string, body: unknown) => post<EquipmentDto>(`/labs/equipment/${id}/calibration`, body),
  equipmentRepair: (id: string, body: unknown) => post<EquipmentDto>(`/labs/equipment/${id}/repairs`, body),
  closeEquipmentRepair: (id: string, repairId: string, body: unknown = {}) => post<EquipmentDto>(`/labs/equipment/${id}/repairs/${repairId}/close`, body),

  devices: (p: Q = {}) => get<DeviceDto[]>('/labs/devices', p),
  createDevices: (labId: string, body: unknown) => post<DeviceDto | DeviceDto[]>(`/labs/${labId}/devices`, body),
  updateDevice: (id: string, body: unknown) => patch<DeviceDto>(`/labs/devices/${id}`, body),
  deviceRepair: (id: string, body: unknown) => post<DeviceDto>(`/labs/devices/${id}/repairs`, body),
  closeDeviceRepair: (id: string, repairId: string, body: unknown = {}) => post<DeviceDto>(`/labs/devices/${id}/repairs/${repairId}/close`, body),
  decommission: (id: string, body: unknown) => post<DeviceDto>(`/labs/devices/${id}/decommission`, body),
  software: (p: Q = {}) => get<SoftwareDto[]>('/labs/software', p),
  createSoftware: (body: unknown) => post<SoftwareDto>('/labs/software', body),
  updateSoftware: (id: string, body: unknown) => patch<SoftwareDto>(`/labs/software/${id}`, body),
  assignSeat: (id: string, deviceId: string) => post<SoftwareDto>(`/labs/software/${id}/seats`, { deviceId }),
  releaseSeat: (id: string, deviceId: string) => post<SoftwareDto>(`/labs/software/${id}/seats/release`, { deviceId }),

  sessions: (p: Q = {}) => get<{ items: SessionDto[]; total: number }>('/labs/sessions', p),
  session: (id: string) => get<SessionDto>(`/labs/sessions/${id}`),
  createSession: (body: unknown) => post<SessionDto>('/labs/sessions', body),
  readiness: (id: string) => post<SessionDto & { blocking: Array<{ kind: string; message: string }>; notes: Array<{ kind: string; message: string }> }>(`/labs/sessions/${id}/readiness`),
  requestPrep: (id: string, note?: string) => post<SessionDto>(`/labs/sessions/${id}/prep`, { note }),
  markPrepared: (id: string, body: unknown = {}) => post<SessionDto>(`/labs/sessions/${id}/prepared`, body),
  startSession: (id: string, checksDone: string[]) => post<SessionDto>(`/labs/sessions/${id}/start`, { checksDone }),
  attendance: (id: string, presentEnrollmentIds: string[]) => post<SessionDto>(`/labs/sessions/${id}/attendance`, { presentEnrollmentIds }),
  completeSession: (id: string, outcomeNote: string) => post<SessionDto>(`/labs/sessions/${id}/complete`, { outcomeNote }),
  cancelSession: (id: string, reason: string) => post<SessionDto>(`/labs/sessions/${id}/cancel`, { reason }),

  incidents: (p: Q = {}) => get<IncidentDto[]>('/labs/incidents', p),
  reportIncident: (body: unknown) => post<IncidentDto>('/labs/incidents', body),
  closeIncident: (id: string, closureNote: string) => post<IncidentDto>(`/labs/incidents/${id}/close`, { closureNote }),
};
