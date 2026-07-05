'use client';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { StatCard, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { InvoiceDto, FeeSummary } from '@/lib/types';

export default function FinanceDashboard() {
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [summary, setSummary] = useState<FeeSummary | null>(null);

  useEffect(() => {
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
    api.feeSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  const totalDue = summary?.pendingPaise ?? 0;

  return (
    <PortalShell
      expectedSlug="finance"
      topbar={{
        title: 'Finance Overview',
        desc: 'Payments, fees, and financial health.',
        actions: <AskEduOS />,
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <StatCard
          label="Pending Amount"
          value={summary ? `${(totalDue / 100).toFixed(2)} ₹` : '—'}
          delta={summary?.pendingCount?.toString() ?? undefined}
          deltaDir="down"
        />
        <StatCard
          label="Collected"
          value={summary ? `${(summary.totalCollectedPaise / 100).toFixed(2)} ₹` : '—'}
          delta={summary?.collectionPct?.toString() ?? undefined}
          deltaDir="up"
        />
        <StatCard
          label="Invoices"
          value={invoices ? invoices.length : '—'}
          deltaDir="flat"
        />
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Invoices</strong>
        </div>
        <div style={{ padding: invoices === null ? 20 : 0 }}>
          {invoices === null && <SkeletonRows rows={3} />}
          {invoices !== null && invoices.length === 0 && (
            <EmptyState title="No invoices" sub="No fee invoices have been generated yet." />
          )}
          {invoices?.slice(0, 5).map((inv) => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--hairline)' }}>
              <div>{inv.invoiceNo}</div>
              <div>{inv.status}</div>
            </div>
          ))}
        </div>
      </Card>
    </PortalShell>
  );
}
