'use client';
import { PortalShell } from '@/components/shell';

import { StatCard, Card, EmptyState, Pill, SkeletonRows, rupees } from '@/components/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { FinanceDashboardDto } from '@/lib/types';

export default function FinanceDashboard() {
  // One scoped call instead of /fees/invoices + /fees/summary. It also fixes
  // the invoice count: the page used to show `invoices.length`, which was the
  // size of one page of results, not the number of invoices raised.
  const [data, setData] = useState<FinanceDashboardDto | null>(null);

  useEffect(() => {
    api.financeDashboard().then(setData).catch(() => setData(null));
  }, []);

  const recent = data?.recentInvoices ?? null;

  return (
    <PortalShell
      expectedSlug="finance"
      topbar={{
        title: 'Finance Overview',
        desc: 'Payments, fees, and financial health.',
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <StatCard
          label="Pending Amount"
          value={data ? rupees(data.pendingAmountPaise) : '—'}
          delta={data ? `${data.pendingInvoices.length} unpaid invoice(s) due soonest` : undefined}
          deltaDir={data && data.pendingAmountPaise > 0 ? 'down' : 'flat'}
        />
        <StatCard
          label="Collected"
          value={data ? rupees(data.collectedAmountPaise) : '—'}
          delta={data ? `${data.collectionRate}% collection rate` : undefined}
          deltaDir="up"
        />
        <StatCard
          label="Invoices"
          value={data ? data.invoiceCount : '—'}
          delta="total raised"
          deltaDir="flat"
        />
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Invoices</strong>
        </div>
        <div style={{ padding: recent === null ? 20 : 0 }}>
          {recent === null && <SkeletonRows rows={3} />}
          {recent !== null && recent.length === 0 && (
            <EmptyState title="No invoices" sub="No fee invoices have been generated yet." />
          )}
          {recent?.slice(0, 5).map((inv) => (
            <div key={inv._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--hairline)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{inv.invoiceNo}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                  {inv.studentName} · {inv.admissionNo}
                </div>
              </div>
              <div style={{ fontSize: 12.5, textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>₹{inv.dueAmount.toLocaleString('en-IN')} due</div>
                <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                  of ₹{inv.totalAmount.toLocaleString('en-IN')}
                </div>
              </div>
              <Pill tone={inv.status === 'PAID' ? 'green' : inv.status === 'OVERDUE' ? 'red' : 'amber'}>
                {inv.status.toLowerCase()}
              </Pill>
            </div>
          ))}
        </div>
      </Card>
    </PortalShell>
  );
}
