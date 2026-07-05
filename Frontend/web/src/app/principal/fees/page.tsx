'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { FeeSummary, InvoiceDto } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

export default function PrincipalFees() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
  }, []);

  const filtered = invoices?.filter((i) => !filter || i.status === filter) ?? [];

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Fee Health', desc: 'School-wide fee collection overview.' }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Collected" value={summary ? rupees(summary.totalCollectedPaise) : '—'} delta={summary ? `${summary.collectionPct}% of billed` : undefined} deltaDir="up" />
        <StatCard label="Pending" value={summary ? rupees(summary.pendingPaise) : '—'} deltaDir="down" />
        <StatCard label="Pending Invoices" value={summary ? summary.pendingCount : '—'} />
        <StatCard label="Total Billed" value={summary ? rupees(summary.totalBilledPaise) : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['', 'PENDING', 'OVERDUE', 'PARTIAL', 'PAID'].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className="chip-tab"
            style={{ background: filter === s ? 'var(--accent)' : '#fff', color: filter === s ? 'var(--on-accent)' : 'var(--text-2)', borderColor: filter === s ? 'var(--accent)' : 'var(--input-border)' }}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {invoices === null && <Card><SkeletonRows rows={5} /></Card>}
      {invoices?.length === 0 && <EmptyState title="No invoices" sub="Fee invoices appear here once assigned." />}
      {filtered.length === 0 && invoices && invoices.length > 0 && <EmptyState title="No matching invoices" sub="Try a different filter." />}
      {filtered.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Invoice</th><th>Student</th><th>Class</th><th>Total</th><th>Paid</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="cell-primary">{i.invoiceNo}</td>
                  <td>{i.studentName}</td>
                  <td>{i.class}</td>
                  <td>{rupees(i.totalPaise)}</td>
                  <td>{rupees(i.paidPaise)}</td>
                  <td style={{ color: i.status === 'OVERDUE' ? 'var(--red)' : 'var(--text-2)' }}>{i.dueOn}</td>
                  <td><Pill tone={STATUS_TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
