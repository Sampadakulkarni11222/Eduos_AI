import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { LabDto, LabItemDto } from '@/lib/labs-api';
import type { BillDto } from '@/lib/bills-api';

/**
 * Labs: an expired batch is badged and offers no Issue button; low stock is
 * marked. Bills: a recorded payment reads as awaiting confirmation, not paid,
 * a reader without bills.manage gets no action buttons, and a review flag
 * shows its explanation and never the word "fraud".
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/admin/labs',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const labs = vi.hoisted(() => ({
  labs: vi.fn(), items: vi.fn(), movements: vi.fn(), scan: vi.fn(), fefo: vi.fn(), equipment: vi.fn(), devices: vi.fn(), software: vi.fn(), sessions: vi.fn(), incidents: vi.fn(),
}));
vi.mock('@/lib/labs-api', async (orig) => ({ ...(await orig<typeof import('@/lib/labs-api')>()), labsApi: labs }));
const bills = vi.hoisted(() => ({ bills: vi.fn(), accounts: vi.fn(), bill: vi.fn(), review: vi.fn(), renewals: vi.fn(), dashboard: vi.fn(), visits: vi.fn() }));
vi.mock('@/lib/bills-api', async (orig) => ({ ...(await orig<typeof import('@/lib/bills-api')>()), billsApi: bills }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p-fin' } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));

const { LabsView } = await import('@/components/ops/labs-view');
const { BillsView } = await import('@/components/ops/bills-view');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const lab: LabDto = {
  id: 'lab1', facilityId: 'f1', facilityCode: '202', facilityName: 'Chemistry Lab', name: 'Chemistry Lab', type: 'SCIENCE_CHEMISTRY', capacity: 30,
  inChargeProfileIds: ['t1'], inChargeNames: ['Ms Rao'], assistantProfileId: null, assistantName: null, safetyChecklist: [], alertDays: 60, status: 'ACTIVE', notes: null,
  counts: { items: 2, lowStock: 1, expired: 1, expiringSoon: 0, quarantined: 0, equipment: 0, outOfService: 0, calibrationOverdue: 0, devices: 0, devicesInRepair: 0, sessionsThisWeek: 0, openIncidents: 0 },
};
const batch = (over: Partial<LabItemDto['batches'][number]>) => ({
  id: 'b1', itemId: 'i1', labId: 'lab1', code: 'LB-000001', lotNo: null, supplierName: null, receivedOn: '2025-01-01', openedOn: null, expiresOn: '2026-01-01',
  quantity: 250000, quantityDisplay: 250, initialDisplay: 250, displayUnit: 'mL', status: 'ACTIVE', quarantineReason: null, location: null, expired: true, daysToExpiry: -12, issuable: false, ...over,
});
const item: LabItemDto = {
  id: 'i1', labId: 'lab1', name: 'Methyl orange indicator', kind: 'CHEMICAL', casNo: '547-58-0', hazardClasses: ['ACUTE_TOXIC'], storageGroup: 'TOXIC', baseUnit: 'uL', displayUnit: 'mL',
  minStock: 50000, minStockDisplay: 50, reorderQty: 0, estUnitPaise: 0, sdsUrl: null, sds: [], restricted: true, location: null, active: true,
  onHand: 0, onHandDisplay: 0, expiredQuantity: 250000, quarantinedQuantity: 0, lowStock: true, hazardous: true, nextExpiry: null, batches: [batch({})],
};

beforeEach(() => {
  vi.clearAllMocks();
  labs.labs.mockResolvedValue([lab]);
  labs.items.mockResolvedValue([item]);
  labs.movements.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 30 });
});

describe('lab stock', () => {
  it('badges an expired batch, offers no Issue for it, and marks low stock', async () => {
    perms.value = { 'labs.read': 'ALL', 'labs.manage': 'ALL' };
    inApp(<LabsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Stock/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Methyl orange indicator' }));
    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(screen.getByText(/Below 50/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dispose' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issue' })).toBeNull();
  });
});

const bill = (over: Partial<BillDto>): BillDto => ({
  id: 'bl1', refNo: 'BIL/2026/0001', accountId: 'a1', accountName: 'Internet leased line', accountNo: 'FN-1', category: 'INTERNET', vendorName: 'FibreNet', billNo: 'FN-2610',
  billDate: '2026-09-25', dueOn: '2026-10-20', periodFrom: null, periodTo: null, amountPaise: 1416000, taxPaise: 0, units: null, unitLabel: null, attachments: [],
  payments: [{ _id: 'pm1', amountPaise: 1416000, mode: 'UPI', reference: 'UPI-1', paidOn: '2026-10-01', evidence: [], status: 'RECORDED', recordedByName: 'Finance', recordedByProfileId: 'p-fin', confirmedAt: null, bankReference: null, note: null }],
  confirmedPaidPaise: 0, recordedPaidPaise: 1416000, status: 'PAYMENT_RECORDED', disputeNote: null, outstandingPaise: 1416000, unconfirmedPaise: 1416000, overdue: false, daysToDue: 5, settled: false, task: null, ...over,
});

describe('bills', () => {
  it('shows a recorded payment as awaiting confirmation, and gives a principal no action buttons', async () => {
    perms.value = { 'bills.read': 'ALL' };
    bills.bills.mockResolvedValue({ items: [bill({})], total: 1, page: 1, pageSize: 100 });
    bills.accounts.mockResolvedValue([]);
    inApp(<BillsView />);
    expect(await screen.findByText('Paid, awaiting bank confirmation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
  });

  it('does not let the person who recorded a payment confirm it', async () => {
    perms.value = { 'bills.read': 'ALL', 'bills.manage': 'ALL' };
    bills.bills.mockResolvedValue({ items: [bill({})], total: 1, page: 1, pageSize: 100 });
    bills.accounts.mockResolvedValue([]);
    bills.bill.mockResolvedValue({ ...bill({}), history: [] });
    inApp(<BillsView />);
    fireEvent.click(await screen.findByRole('button', { name: /Internet leased line/ }));
    expect(await screen.findByText('Someone else confirms')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('explains each review flag and never calls it fraud', async () => {
    perms.value = { 'bills.read': 'ALL', 'bills.manage': 'ALL' };
    bills.bills.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    bills.accounts.mockResolvedValue([]);
    bills.review.mockResolvedValue({ items: [{ key: 'k1', code: 'AMOUNT_ABOVE_AVERAGE', severity: 'HIGH', title: 'Electricity BIL/2026/0009 is 61.2% above its usual amount', explanation: '₹1,31,500.00 against an average of ₹80,840.00 over the previous 5 bills (rule: more than 25% above).', entityType: 'Bill', entityId: 'x', amountPaise: 13150000, at: '2026-09-25', review: null }], counts: {}, rules: {}, note: '' });
    const { container } = inApp(<BillsView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Review queue' }));
    expect(await screen.findByText(/over the previous 5 bills/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Explained' })).toBeTruthy());
    expect(container.textContent).not.toMatch(/fraud/i);
  });
});
