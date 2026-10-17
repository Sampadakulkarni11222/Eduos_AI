'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { StatCard, Card, EmptyState, Pill, SkeletonRows, Button, rupees, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { FinanceDashboardDto, LeakageSummaryDto, RevenueLeakageFindingDto, BudgetUtilizationDto } from '@/lib/types';

export default function FinanceDashboard() {
  const [data, setData] = useState<FinanceDashboardDto | null>(null);
  const [leakageSummary, setLeakageSummary] = useState<LeakageSummaryDto | null>(null);
  const [findings, setFindings] = useState<RevenueLeakageFindingDto[] | null>(null);
  const [budgets, setBudgets] = useState<BudgetUtilizationDto[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const toast = useToast();

  const loadData = useCallback(() => {
    api.financeDashboard().then(setData).catch(() => setData(null));
    api.leakageSummary().then(setLeakageSummary).catch(() => setLeakageSummary(null));
    api.leakageFindings({ page: 1, pageSize: 5 }).then((res) => setFindings(res.items)).catch(() => setFindings([]));
    api.budgetUtilization().then(setBudgets).catch(() => setBudgets([]));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleScanLeakage = async () => {
    setScanning(true);
    try {
      const res = await api.scanLeakage();
      toast(`Leakage scan complete: ${res.newFindingsCreated} new finding(s) detected.`, 'success');
      loadData();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Leakage scan failed', 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleRunReminders = async () => {
    setSweeping(true);
    try {
      const res = await api.runReminderSweep();
      toast(`Automated sweep dispatched ${res.sentCount} reminder(s).`, 'success');
      loadData();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Reminder sweep failed', 'error');
    } finally {
      setSweeping(false);
    }
  };

  const handleResolveFinding = async (findingId: string) => {
    try {
      await api.updateLeakageStatus(findingId, { status: 'RESOLVED' });
      toast('Finding marked as resolved', 'success');
      loadData();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  const recent = data?.recentInvoices ?? null;
  const pending = data?.pendingInvoices ?? null;

  return (
    <PortalShell
      expectedSlug="finance"
      topbar={{
        title: 'Financial Control & Revenue Management',
        desc: 'Comprehensive billing, collection tracking, expense monitoring, and revenue leakage detection.',
      }}
    >
      {/* Top action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-faint)', fontWeight: 500 }}>Automated Controls:</span>
          <Button small variant="soft" disabled={sweeping} onClick={handleRunReminders}>
            {sweeping ? 'Dispatching...' : 'Dispatch Overdue Reminders'}
          </Button>
          <Button small variant="soft" disabled={scanning} onClick={handleScanLeakage}>
            {scanning ? 'Scanning...' : 'Scan Revenue Leakage'}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button small variant="ghost" onClick={loadData}>Refresh Metrics</Button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
        <StatCard
          label="Total Billed"
          value={data ? rupees(Math.round(data.totalBilled * 100)) : '—'}
          delta={data ? `${data.invoiceCount} invoices issued` : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Collected Revenue"
          value={data ? rupees(data.collectedAmountPaise) : '—'}
          delta={data ? `${data.collectionRate}% collection efficiency` : undefined}
          deltaDir="up"
        />
        <StatCard
          label="Outstanding Receivables"
          value={data ? rupees(data.pendingAmountPaise) : '—'}
          delta={data && data.overdueCount ? `${data.overdueCount} overdue (${rupees(data.overdueAmountPaise || 0)})` : undefined}
          deltaDir={data && (data.overdueCount || 0) > 0 ? 'down' : 'flat'}
        />
        <StatCard
          label="Operating Expenses"
          value={data && data.totalExpensePaise !== undefined ? rupees(data.totalExpensePaise) : '—'}
          delta={data ? `Net Margin: ${rupees(data.collectedAmountPaise - (data.totalExpensePaise || 0))}` : undefined}
          deltaDir="up"
        />
      </div>

      {/* Revenue Leakage Alert Banner */}
      <Card pad={true} style={{ marginBottom: 20, borderLeft: '4px solid var(--accent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, color: 'var(--text-1)' }}>
                Revenue Leakage &amp; Discrepancy Overview
              </strong>
              {leakageSummary && leakageSummary.openCount > 0 && (
                <Pill tone="amber">{leakageSummary.openCount} open issue(s)</Pill>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
              Identifies unbilled enrollments, missing hostel/bus fees, orphan payments, and budget overruns.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20, textAlign: 'right' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Potential Leakage</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>
                {leakageSummary ? rupees(leakageSummary.potentialPaise) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Confirmed Losses</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>
                {leakageSummary ? rupees(leakageSummary.confirmedPaise) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Recovered</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
                {leakageSummary ? rupees(leakageSummary.recoveredPaise) : '—'}
              </div>
            </div>
          </div>
        </div>

        {findings && findings.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
            <table className="data-table data-table-cards" style={{ width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>Detection Rule</th>
                  <th>Severity</th>
                  <th>Estimated Exposure</th>
                  <th>Status</th>
                  <th>Detected On</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f._id}>
                    <td style={{ fontWeight: 600 }}>{f.ruleName}</td>
                    <td>
                      <Pill tone={f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'red' : 'amber'}>
                        {f.severity}
                      </Pill>
                    </td>
                    <td>{rupees(f.estimatedAmountPaise)}</td>
                    <td><Pill tone={f.status === 'RESOLVED' ? 'green' : 'amber'}>{f.status}</Pill></td>
                    <td>{new Date(f.detectedAt).toLocaleDateString('en-IN')}</td>
                    <td>
                      {f.status !== 'RESOLVED' && (
                        <Button small variant="ghost" onClick={() => handleResolveFinding(f._id)}>
                          Resolve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Two-Column Detail Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 18, marginBottom: 20 }}>
        {/* Budget Utilization Breakdown */}
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Budget Utilization &amp; Expense Controls</strong>
          </div>
          <div style={{ padding: 16 }}>
            {budgets === null && <SkeletonRows rows={3} />}
            {budgets !== null && budgets.length === 0 && (
              <EmptyState title="No budgets defined" sub="No active departmental budgets allocated for this period." />
            )}
            {budgets && budgets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {budgets.map((b) => (
                  <div key={b.budgetId} style={{ borderBottom: '1px solid var(--hairline)', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{b.category} ({b.quarter})</span>
                      <span>{rupees(b.spentPaise)} of {rupees(b.allocatedPaise)} ({b.utilizationPct}%)</span>
                    </div>
                    <div style={{ background: '#eee', height: 7, borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, b.utilizationPct)}%`,
                          background: b.utilizationPct > 90 ? 'var(--red)' : b.utilizationPct > 70 ? 'var(--amber)' : 'var(--green)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Immediate Priority Invoices */}
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Highest Priority Collection Targets</strong>
          </div>
          <div style={{ padding: pending === null ? 20 : 0 }}>
            {pending === null && <SkeletonRows rows={3} />}
            {pending !== null && pending.length === 0 && (
              <EmptyState title="All caught up" sub="No pending or overdue invoices require collection." />
            )}
            {pending?.slice(0, 5).map((inv) => (
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
                    Due {new Date(inv.dueOn).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <Pill tone={inv.status === 'PAID' ? 'green' : inv.status === 'OVERDUE' ? 'red' : 'amber'}>
                  {inv.status.toLowerCase()}
                </Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Invoices Ledger */}
      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Billed Invoices</strong>
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
