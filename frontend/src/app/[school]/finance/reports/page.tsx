'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { FeeSummary, FinancialReportDto, InvoiceDto } from '@/lib/types';

export default function FinanceReports() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FinancialReportDto | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [savingCost, setSavingCost] = useState(false);
  const [cost, setCost] = useState({ category: '', description: '', amount: '', incurredOn: new Date().toISOString().slice(0, 10), vendor: '' });
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      api.feeSummary().then(setSummary),
      api.invoices().then(setInvoices),
      api.financialReport().then(setReport),
    ]).finally(() => setLoading(false));
  }, []);

  const dispatchReminders = async () => {
    setDispatching(true);
    try {
      const result = await api.dispatchFeeReminders(7);
      toast(`${result.sent} reminder${result.sent === 1 ? '' : 's'} sent for ${result.candidateInvoices} due invoice${result.candidateInvoices === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send reminders.');
    } finally { setDispatching(false); }
  };
  const saveCost = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingCost(true);
    try {
      await api.createExpense({ category: cost.category, description: cost.description, amountPaise: Math.round(Number(cost.amount) * 100), incurredOn: cost.incurredOn, vendor: cost.vendor || undefined });
      setReport(await api.financialReport()); setCost({ category: '', description: '', amount: '', incurredOn: new Date().toISOString().slice(0, 10), vendor: '' }); toast('Cost recorded.');
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not record cost.'); } finally { setSavingCost(false); }
  };

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

          <Card style={{ marginBottom: 20 } as React.CSSProperties}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div><strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Quarterly ERP report</strong><p style={{ margin: '5px 0 0', color: 'var(--text-faint)', fontSize: 13 }}>Finance, operations, hostel and library data in an access-controlled report.</p></div>
              <div style={{ display: 'flex', gap: 8 }}><Button small variant="soft" onClick={() => void api.downloadQuarterlyErpCsv()}>Download CSV</Button><Button small onClick={() => void api.downloadQuarterlyErpPdf()}>Download PDF</Button></div>
            </div>
          </Card>

          <Card style={{ marginBottom: 20 } as React.CSSProperties}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Record a school cost</strong>
            <form onSubmit={saveCost} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr .8fr .8fr auto', gap: 10, marginTop: 14 }}>
              <input required placeholder="Category (e.g. Electricity)" value={cost.category} onChange={(e) => setCost({ ...cost, category: e.target.value })} />
              <input required placeholder="Description" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
              <input required min="0.01" step="0.01" type="number" placeholder="Amount ₹" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
              <input required type="date" value={cost.incurredOn} onChange={(e) => setCost({ ...cost, incurredOn: e.target.value })} />
              <Button small disabled={savingCost}>{savingCost ? 'Saving…' : 'Record cost'}</Button>
            </form>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 20 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
                <div>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Collections & leakage watch</strong>
                  <p style={{ margin: '7px 0 0', color: 'var(--text-faint)', fontSize: 13 }}>Server-calculated financial health. Leakage risk is unpaid overdue balance, not an expense entry.</p>
                </div>
                <Pill tone={report?.overdueCount ? 'red' : 'green'}>{report?.overdueCount ? 'Needs action' : 'On track'}</Pill>
              </div>
              <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 18 }}>
                <div><span className="eyebrow">Collection rate</span><div style={{ fontSize: 22, fontWeight: 700 }}>{report?.collectionRate ?? 0}%</div></div>
                <div><span className="eyebrow">Overdue balance</span><div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(report?.overduePaise ?? 0)}</div></div>
                <div><span className="eyebrow">Leakage risk</span><div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(report?.leakageRiskPaise ?? 0)}</div></div>
                <div><span className="eyebrow">Recorded costs</span><div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(report?.totalExpensePaise ?? 0)}</div><small>Net {rupees(report?.netPositionPaise ?? 0)}</small></div>
              </div>
            </Card>
            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Bill reminders</strong>
              <p style={{ margin: '7px 0 16px', color: 'var(--text-faint)', fontSize: 13 }}>Send one secure in-app reminder per invoice and recipient today. Re-running is safe; duplicates are blocked server-side.</p>
              <Button small onClick={dispatchReminders} disabled={dispatching}>{dispatching ? 'Sending…' : 'Send due reminders'}</Button>
            </Card>
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
                  <table className="data-table data-table-cards" style={{ width: '100%' }}>
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
                          <td style={{ fontWeight: 600 }} data-label="Class">{cls}</td>
                          <td data-label="Invoices">{data.count}</td>
                          <td data-label="Billed">{rupees(data.total)}</td>
                          <td style={{ color: 'var(--green)' }} data-label="Collected">{rupees(data.paid)}</td>
                          <td style={{ color: 'var(--text-faint)' }} data-label="Pending">{rupees(data.pending)}</td>
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
