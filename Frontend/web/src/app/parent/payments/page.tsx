'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { InvoiceDto } from '@/lib/types';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red' };

export default function ParentPayments() {
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  useEffect(() => { api.invoices().then(setInvoices).catch(() => setInvoices([])); }, []);
  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Payments', desc: 'Your fee invoices and balances.' }}>
      {invoices === null && <Card><SkeletonRows rows={3} /></Card>}
      {invoices?.length === 0 && <EmptyState title="No invoices" sub="Fee invoices for your children appear here." />}
      {invoices && invoices.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Invoice</th><th>Student</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="cell-primary">{i.invoiceNo}</td><td>{i.studentName}</td>
                  <td>{rupees(i.totalPaise)}</td><td>{rupees(i.paidPaise)}</td><td>{i.dueOn}</td>
                  <td><Pill tone={TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
