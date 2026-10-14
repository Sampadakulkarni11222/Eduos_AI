/**
 * Typed client for recurring bills and services (/bills), fee concessions and
 * invoice adjustments (/fee-adjustments) and the accounts export
 * (/accounts-export). Money is whole paise throughout.
 */
import { request } from './api';
import { qs, post, patch, put, downloadCsv } from './ops-api';
import type { Attachment, HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export const BILL_CATEGORIES = ['ELECTRICITY', 'WATER', 'INTERNET', 'PHONE', 'GAS', 'AMC', 'SOFTWARE', 'RENT', 'SECURITY', 'HOUSEKEEPING', 'WASTE', 'INSURANCE', 'LIFT', 'TRANSPORT', 'FUEL', 'OTHER'] as const;
export const BILLING_CYCLES = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME'] as const;
export const PAY_MODES = ['BANK', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'AUTO_DEBIT', 'OTHER'] as const;

export interface ServiceAccountDto {
  id: string; refNo: string; name: string; category: string; vendorId: string | null; vendorName: string | null; accountNo: string | null; billingCycle: string;
  expectedAmountPaise: number; nextDueOn: string | null; consumptionUnit: string | null; ownerProfileId: string | null; ownerName: string | null;
  contractStartsOn: string | null; contractEndsOn: string | null; noticeDays: number; noticeBy: string | null; autoRenews: boolean; visitsPerYear: number; status: string;
  billCount?: number; lastAmountPaise?: number | null; lastBillDate?: string | null; outstandingPaise?: number; nextVisitOn?: string | null;
}
export interface BillPaymentDto { _id: string; amountPaise: number; mode: string; reference: string | null; paidOn: string; evidence: Attachment[]; status: string; recordedByName: string | null; recordedByProfileId: string | null; confirmedAt: string | null; bankReference: string | null; note: string | null }
export interface BillDto {
  id: string; refNo: string; accountId: string; accountName?: string | null; accountNo?: string | null; category: string; vendorName: string | null; billNo: string | null;
  billDate: string; dueOn: string; periodFrom: string | null; periodTo: string | null; amountPaise: number; taxPaise: number; units: number | null; unitLabel: string | null;
  attachments: Attachment[]; payments: BillPaymentDto[]; confirmedPaidPaise: number; recordedPaidPaise: number; status: string; disputeNote: string | null;
  outstandingPaise: number; unconfirmedPaise: number; overdue: boolean; daysToDue: number; settled: boolean;
  task?: { id: string; status: string; snoozeReason: string | null; snoozedUntil: string | null; escalationLevel: number } | null; history?: HistoryEntry[];
}
export interface VisitDto { id: string; refNo: string; accountId: string; accountName: string | null; vendorName: string | null; scheduledOn: string; status: string; doneOn: string | null; technician: string | null; findings: string | null; evidence: Attachment[]; overdue: boolean }
export interface RenewalDto {
  source: string; kind: string; entityId: string; title: string; counterparty?: string | null; dueOn: string; decideBy: string; costPaise: number | null;
  ownerProfileId: string | null; ownerName: string | null; department: string; status: string; link: string; consequence: string; daysLeft: number; decideInDays: number; overdue: boolean;
}
export interface RenewalsDto { withinDays: number; items: RenewalDto[]; bySource: Record<string, { count: number; costPaise: number; overdue: number }>; total: { count: number; costPaise: number; overdue: number; unowned: number }; definition: string }
export interface ReviewFlagDto { key: string; code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; title: string; explanation: string; entityType: string; entityId: string; amountPaise: number | null; at: string; review: { status: string; note: string; byName: string | null; at: string } | null }
export interface ReviewQueueDto { items: ReviewFlagDto[]; counts: Record<string, number>; rules: Record<string, number>; note: string }
export interface ChangeDto { current: number | null; previous: number | null; abs: number | null; pct: number | null; comparable: boolean; reason: string | null }
export interface BillsDashboardDto {
  period: { from: string; to: string; label: string }; comparison: { from: string; to: string; label: string } | null; totalPaise: number; previousTotalPaise: number | null; change: ChangeDto;
  byCategory: Array<{ category: string; amountPaise: number; bills: number; units: number; confirmedPaidPaise: number; viaProcurementPaise: number; previousPaise: number | null; change: ChangeDto }>;
  series: Array<{ label: string; totalPaise: number; byCategory: Record<string, number> }>; open: { outstandingPaise: number; overdue: number; count: number }; definitions: Record<string, string>;
}

export interface ConcessionTypeDto { id: string; code: string; name: string; kind: string; method: string; valueBp: number | null; amountPaise: number | null; feeHeadIds: string[]; feeHeadNames: string[]; eligibility: string | null; active: boolean }
export interface AdjustmentDto { id: string; refNo: string; kind: string; invoiceId: string; invoiceNo: string | null; concessionName: string | null; amountPaise: number; reason: string; status: string; approvalRequestId: string | null; requestedByName: string | null; appliedAt: string | null; beforeTotalPaise: number | null; afterTotalPaise: number | null; studentName?: string | null; admissionNo?: string | null; createdAt: string }
export interface InvoiceForAdjustmentDto { invoice: { id: string; invoiceNo: string; status: string; totalPaise: number; paidPaise: number; grossTotalPaise: number | null; adjustedPaise: number; dueOn: string }; lines: Array<{ id: string; description: string; amountPaise: number; concessionPaise: number; taxPaise: number }>; adjustments: AdjustmentDto[]; outstandingPaise: number; reservedPaise: number; adjustablePaise: number }
export interface VoucherSummaryDto { period: { from: string; to: string }; byType: Record<string, { count: number; amountPaise: number }>; count: number; sample: Array<{ type: string; date: string; number: string; party: string | null; narration: string; entries: Array<{ ledger: string; amountPaise: number }> }> }
export interface GstSummaryDto { period: { from: string; to: string }; rows: Array<{ hsnSac: string | null; ratePct: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; taxPaise: number; lines: number; invoices: number }>; totals: { taxablePaise: number; taxPaise: number; cgstPaise: number; sgstPaise: number }; untaxed: { amountPaise: number; lines: number; note: string }; creditsOnTaxedInvoices: Array<{ refNo: string; invoiceNo: string; kind: string; amountPaise: number }>; disclaimer: string }
export interface FeeHeadTaxDto { id: string; name: string; category: string; hsnSac: string | null; gstRateBp: number | null }

export const billsApi = {
  accounts: (p: Q = {}) => get<ServiceAccountDto[]>('/bills/accounts', p),
  createAccount: (body: unknown) => post<ServiceAccountDto>('/bills/accounts', body),
  updateAccount: (id: string, body: unknown) => patch<ServiceAccountDto>(`/bills/accounts/${id}`, body),
  scheduleVisit: (accountId: string, scheduledOn: string) => post<VisitDto>(`/bills/accounts/${accountId}/visits`, { scheduledOn }),
  visits: (p: Q = {}) => get<VisitDto[]>('/bills/visits', p),
  completeVisit: (id: string, body: unknown) => post<{ visit: VisitDto; next: VisitDto | null }>(`/bills/visits/${id}/complete`, body),
  bills: (p: Q = {}) => get<{ items: BillDto[]; total: number; page: number; pageSize: number }>('/bills', p),
  bill: (id: string) => get<BillDto>(`/bills/${id}`),
  createBill: (body: unknown) => post<BillDto>('/bills', body),
  recordPayment: (id: string, body: unknown) => post<BillDto>(`/bills/${id}/payments`, body),
  confirmPayment: (id: string, paymentId: string, body: unknown) => post<BillDto>(`/bills/${id}/payments/${paymentId}/confirm`, body),
  setStatus: (id: string, body: unknown) => post<BillDto>(`/bills/${id}/status`, body),
  renewals: (withinDays = 90) => get<RenewalsDto>('/bills/renewals', { withinDays }),
  review: (show = 'open') => get<ReviewQueueDto>('/bills/review', { show }),
  reviewFlag: (flagKey: string, status: string, note: string) => post<unknown>('/bills/review', { flagKey, status, note }),
  dashboard: (p: Q = {}) => get<BillsDashboardDto>('/bills/dashboard', p),
  syncDue: () => post<unknown>('/bills/due/sync'),

  concessionTypes: () => get<ConcessionTypeDto[]>('/fee-adjustments/types'),
  createConcessionType: (body: unknown) => post<ConcessionTypeDto>('/fee-adjustments/types', body),
  updateConcessionType: (id: string, body: unknown) => patch<ConcessionTypeDto>(`/fee-adjustments/types/${id}`, body),
  adjustments: (p: Q = {}) => get<AdjustmentDto[]>('/fee-adjustments', p),
  invoiceForAdjustment: (id: string) => get<InvoiceForAdjustmentDto>(`/fee-adjustments/invoices/${id}`),
  requestAdjustment: (body: unknown) => post<AdjustmentDto>('/fee-adjustments', body),
  withdrawAdjustment: (id: string, reason?: string) => post<AdjustmentDto>(`/fee-adjustments/${id}/withdraw`, { reason }),

  voucherSummary: (p: Q) => get<VoucherSummaryDto>('/accounts-export/vouchers', { ...p, format: 'summary' }),
  downloadVouchers: (p: Q, format: 'xml' | 'csv') => downloadCsv(`/accounts-export/vouchers${qs({ ...p, format })}`, `vouchers-${p.from}-to-${p.to}.${format}`),
  gst: (p: Q) => get<GstSummaryDto>('/accounts-export/gst', p),
  feeHeads: () => get<FeeHeadTaxDto[]>('/accounts-export/fee-heads'),
  setFeeHeadTax: (id: string, body: { hsnSac: string | null; gstRateBp: number | null }) => put<FeeHeadTaxDto>(`/accounts-export/fee-heads/${id}/tax`, body),
};
