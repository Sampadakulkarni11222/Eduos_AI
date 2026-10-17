'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, Button, rupees, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { FeeSummary, InvoiceDto, QuarterlyFinancialReportDto } from '@/lib/types';

export default function FinanceReports() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [reports, setReports] = useState<QuarterlyFinancialReportDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedQuarter, setSelectedQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
  const [distributeEmail, setDistributeEmail] = useState('');
  const [distributingId, setDistributingId] = useState<string | null>(null);
  const toast = useToast();

  const loadData = useCallback(() => {
    Promise.all([
      api.feeSummary().then(setSummary),
      api.invoices().then(setInvoices),
      api.quarterlyReports().then(setReports),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerateQuarterly = async () => {
    setGenerating(true);
    try {
      await api.generateQuarterlyReport({
        year: selectedYear,
        quarter: selectedQuarter,
      });
      toast(`Quarterly report for ${selectedQuarter} ${selectedYear} generated!`, 'success');
      loadData();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDistribute = async (reportId: string) => {
    if (!distributeEmail || !distributeEmail.includes('@')) {
      toast('Please enter a valid recipient email', 'error');
      return;
    }
    setDistributingId(reportId);
    try {
      const res = await api.distributeQuarterlyReport(reportId, [distributeEmail]);
      toast(`Report distributed to ${res.distributedCount} recipient(s).`, 'success');
      setDistributeEmail('');
      loadData();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Distribution failed', 'error');
    } finally {
      setDistributingId(null);
    }
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
      classBreakdown[cls].pending += inv.totalPaise - inv.paidPaise;
      classBreakdown[cls].count += 1;
    });
  }

  return (
    <PortalShell
      expectedSlug="finance"
      topbar={{
        title: 'Quarterly Financial Analysis & Reports',
        desc: 'Automated executive summaries, collections roll-forward, and formal PDF exports.',
      }}
    >
      {loading ? (
        <Card><SkeletonRows rows={8} /></Card>
      ) : (
        <>
          {/* Top KPI Cards */}
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <StatCard
              label="Realized Revenue"
              value={summary ? rupees(summary.totalCollectedPaise) : '—'}
              delta={summary ? `${summary.collectionPct}% collection rate` : undefined}
              deltaDir="up"
            />
            <StatCard
              label="Outstanding Receivables"
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

          {/* Quarterly Report Generation Bar */}
          <Card pad={true} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>
                  Automated Quarterly Financial Analysis
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
                  Generates executive review, opening/closing balance roll-forward, ageing schedule, and leakage metrics.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--input-border)' }}
                >
                  <option value={2026}>FY 2026</option>
                  <option value={2027}>FY 2027</option>
                </select>

                <select
                  value={selectedQuarter}
                  onChange={(e) => setSelectedQuarter(e.target.value as 'Q1' | 'Q2' | 'Q3' | 'Q4')}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--input-border)' }}
                >
                  <option value="Q1">Q1 (Apr - Jun)</option>
                  <option value="Q2">Q2 (Jul - Sep)</option>
                  <option value="Q3">Q3 (Oct - Dec)</option>
                  <option value="Q4">Q4 (Jan - Mar)</option>
                </select>

                <Button small disabled={generating} onClick={handleGenerateQuarterly}>
                  {generating ? 'Generating...' : 'Generate Report'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Saved Quarterly Reports Table */}
          <Card pad={false} style={{ marginBottom: 20 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Generated Quarterly Reports</strong>
            </div>
            <div style={{ padding: 12 }}>
              {reports === null || reports.length === 0 ? (
                <EmptyState title="No quarterly reports" sub="Click 'Generate Report' above to create an automated quarterly report." />
              ) : (
                <table className="data-table data-table-cards" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Billed Target</th>
                      <th>Collections</th>
                      <th>Efficiency</th>
                      <th>Net Margin</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r._id}>
                        <td style={{ fontWeight: 600 }}>{r.quarter} {r.year}</td>
                        <td>{rupees(r.metrics.totalBilledPaise)}</td>
                        <td style={{ color: 'var(--green)', fontWeight: 600 }}>{rupees(r.metrics.totalCollectedPaise)}</td>
                        <td>{r.metrics.collectionRatePct}%</td>
                        <td>{rupees(r.metrics.netOperatingMarginPaise)}</td>
                        <td><Pill tone={r.status === 'DISTRIBUTED' ? 'green' : 'amber'}>{r.status}</Pill></td>
                        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button small variant="ghost" onClick={() => api.downloadQuarterlyReportPdf(r._id)}>
                            Download PDF
                          </Button>
                          <input
                            type="email"
                            placeholder="recipient@school.edu"
                            value={distributeEmail}
                            onChange={(e) => setDistributeEmail(e.target.value)}
                            style={{ padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--input-border)', width: 140 }}
                          />
                          <Button
                            small
                            variant="soft"
                            disabled={distributingId === r._id}
                            onClick={() => handleDistribute(r._id)}
                          >
                            {distributingId === r._id ? 'Sending...' : 'Send'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Segment Performance Breakdown */}
          <div style={{ marginBottom: 20 }}>
            <Card pad={false}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Segment-wise Financial Performance</strong>
              </div>
              <div style={{ padding: 10 }}>
                {Object.keys(classBreakdown).length === 0 ? (
                  <EmptyState title="No data" sub="No billing records found to generate breakdown." />
                ) : (
                  <table className="data-table data-table-cards" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Class / Segment</th>
                        <th>Invoices</th>
                        <th>Billed</th>
                        <th>Collected</th>
                        <th>Pending</th>
                        <th>Collection Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(classBreakdown).map(([cls, data]) => {
                        const rate = data.total > 0 ? Math.round((data.paid / data.total) * 100) : 0;
                        return (
                          <tr key={cls}>
                            <td style={{ fontWeight: 600 }} data-label="Class">{cls}</td>
                            <td data-label="Invoices">{data.count}</td>
                            <td data-label="Billed">{rupees(data.total)}</td>
                            <td style={{ color: 'var(--green)' }} data-label="Collected">{rupees(data.paid)}</td>
                            <td style={{ color: 'var(--text-faint)' }} data-label="Pending">{rupees(data.pending)}</td>
                            <td data-label="Rate">{rate}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </PortalShell>
  );
}
