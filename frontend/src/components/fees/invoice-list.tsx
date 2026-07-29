'use client';
import { Button, Pill, rupees } from '../ui';
import { api } from '@/lib/api';
import type { InvoiceDto } from '@/lib/types';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

/** Late-fee indicator: no stored late-fee field exists anywhere in the schema —
 * this is a derived display flag (past due date, not yet fully paid/cancelled). */
function isLate(inv: InvoiceDto) {
  if (inv.status === 'PAID' || inv.status === 'CANCELLED') return false;
  return new Date(inv.dueOn) < new Date();
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InvoiceList({
  invoices, onPay, onViewTimeline,
}: {
  invoices: InvoiceDto[];
  onPay: (invoice: InvoiceDto) => void;
  onViewTimeline: (invoice: InvoiceDto) => void;
}) {
  if (invoices.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '14px 4px' }}>No invoices here.</p>;
  }

  return (
    <table className="data-table data-table-cards">
      <thead>
        <tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Due Date</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {invoices.map((inv) => {
          const due = inv.totalPaise - inv.paidPaise;
          const late = isLate(inv);
          return (
            <tr key={inv.id}>
              <td className="cell-primary" data-label="Invoice">{inv.invoiceNo}</td>
              <td data-label="Total">{rupees(inv.totalPaise)}</td>
              <td data-label="Paid">{rupees(inv.paidPaise)}</td>
              <td data-label="Due Date">
                {fmtDate(inv.dueOn)}
                {late && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--red)' }}>● Late</span>}
              </td>
              <td data-label="Status"><Pill tone={TONE[inv.status] ?? 'gray'}>{inv.status.toLowerCase()}</Pill></td>
              <td data-label="Actions">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {due > 0 && inv.status !== 'CANCELLED' && (
                    <Button small onClick={() => onPay(inv)}>Pay {rupees(due)}</Button>
                  )}
                  <Button small variant="ghost" onClick={() => onViewTimeline(inv)}>Timeline</Button>
                  <Button small variant="ghost" onClick={() => api.downloadInvoicePdf(inv.id)}>PDF</Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
