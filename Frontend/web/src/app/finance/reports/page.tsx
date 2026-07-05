'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { FeeSummary, InvoiceDto } from '@/lib/types';

export default function FinanceReports() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.feeSummary().then(setSummary),
      api.invoices().then(setInvoices)
    ]).finally(() => setLoading(false));
  }, []);

  // Compute breakdown by class/grade
  const classBreakdown: Record<string, { total: number; paid: number; pending: number; count: number }> = {};
  if (invoices) {
    invoices.forEach((inv) => {
      const cls = inv.class || 'Unassigned';
      if (!classBreakdown[cls]) {
        classBreakdown[cls] = { total: 0, paid: 0, pending: 0, count: 0 };
      }
      classBreakdown[cls].total += inv.totalPaise;
      classBreakdown[cls].paid += inv.paidPaise;
      classBreakdown[cls].pending += (inv.totalPaise - inv.paidPaise);
      classBreakdown[cls].count += 1;
    });
  }

  // Compute status breakdown
  const statusBreakdown: Record<string, { amount: number; count: number }> = {};
  if (invoices) {
    invoices.forEach((inv) => {
      const status = inv.status || 'UNKNOWN';
      if (!statusBreakdown[status]) {
        statusBreakdown[status] = { amount: 0, count: 0 };
      }
      statusBreakdown[status].amount += inv.totalPaise;
      statusBreakdown[status].count += 1;
    });
  }

  return (
    <PortalShell expectedSlug="finance" topbar={{ title: 'Financial Reports', desc: 'Detailed analytics and breakdown of fee collections.' }}>
      {loading ? (
        <Card><SkeletonRows rows={8} /></Card>
      ) : (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <StatCard
              label="Realized Revenue"
              value={summary ? rupees(summary.totalCollectedPaise) : '—'}
              delta={summary ? `${summary.collectionPct}% collection rate` : undefined}
              deltaDir="up"
            />
            <StatCard
              label="Outstanding Balances"
              value={summary ? rupees(summary.pendingPaise) : '—'}
              delta={summary ? `${summary.pendingCount} unpaid/partial invoices` : undefined}
              deltaDir="down"
            />
            <StatCard
              label="Billed Target"
              value={summary ? rupees(summary.totalBilledPaise) : '—'}
              deltaDir="flat"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 20 }}>
            <Card pad={false}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Collection by Class</strong>
              </div>
              <div style={{ padding: 10 }}>
                {Object.keys(classBreakdown).length === 0 ? (
                  <EmptyState title="No data" sub="No billing records found to generate breakdown." />
                ) : (
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Invoices</th>
                        <th>Billed</th>
                        <th>Collected</th>
                        <th>Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(classBreakdown).map(([cls, data]) => (
                        <tr key={cls}>
                          <td style={{ fontWeight: 600 }}>{cls}</td>
                          <td>{data.count}</td>
                          <td>{rupees(data.total)}</td>
                          <td style={{ color: 'var(--green)' }}>{rupees(data.paid)}</td>
                          <td style={{ color: 'var(--text-faint)' }}>{rupees(data.pending)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card pad={false}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Invoice Status Summary</strong>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {Object.keys(statusBreakdown).length === 0 ? (
                  <EmptyState title="No data" sub="No invoices found." />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {Object.entries(statusBreakdown).map(([status, data]) => {
                      let tone: 'green' | 'amber' | 'red' | 'gray' = 'gray';
                      if (status === 'PAID') tone = 'green';
                      else if (status === 'PARTIAL') tone = 'amber';
                      else if (status === 'OVERDUE') tone = 'red';

                      return (
                        <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Pill tone={tone}>{status}</Pill>
                            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>{data.count} invoices</span>
                          </div>
                          <span style={{ fontWeight: 600 }}>{rupees(data.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </PortalShell>
  );
}
