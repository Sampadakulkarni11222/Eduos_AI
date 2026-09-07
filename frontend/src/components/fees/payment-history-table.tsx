'use client';
import { Button, Pill, rupees } from '../ui';
import { api } from '@/lib/api';
import { PaymentMethod } from './payment-verification';
import type { PaymentReceiptDto } from '@/lib/types';
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  SUCCESS: 'green', CAPTURED: 'green', INITIATED: 'amber', FAILED: 'red', REFUNDED: 'gray',
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PaymentHistoryTable({ payments }: { payments: PaymentReceiptDto[] }) {
  if (payments.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '14px 4px' }}>No payments recorded yet.</p>;
  }

  return (
    <table className="data-table data-table-cards">
      <thead>
        <tr><th>Transaction ID</th><th>Invoice</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}>
            <td className="cell-primary" data-label="Transaction ID">{p.receiptNo}</td>
            <td data-label="Invoice">{p.invoiceNo}</td>
            {/* When the money changed hands, not when the row was keyed in. */}
            <td data-label="Date">{fmtDateTime(p.paidOn ?? p.createdAt)}</td>
            <td data-label="Method"><PaymentMethod payment={p} showProof={false} /></td>
            <td data-label="Amount">{rupees(p.amountPaise)}</td>
            <td data-label="Status"><Pill tone={STATUS_TONE[p.status] ?? 'gray'}>{p.status.toLowerCase()}</Pill></td>
            <td data-label="Actions">
              <Button small variant="ghost" onClick={() => api.downloadReceiptPdf(p.id)}>Receipt PDF</Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
