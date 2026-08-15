'use client';
/**
 * School Intelligence — the executive overview.
 *
 * This page answers "how is the school doing, and where should I look first";
 * the detail lives one click away in Performance & Risk, Attendance Trends,
 * Fee Health and Staff Directory. It therefore pulls only summaries and a
 * short top-priority list, never the full risk table: the risk engine scores
 * every enrollment against every signal, which is far more rows than an
 * overview should carry.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { RiskDetailDrawer } from '@/components/risk-detail-drawer';
import { api } from '@/lib/api';
import { RISK_CATEGORY_LABEL, RISK_LEVEL_TONE } from '@/lib/risk-labels';
import type { FeeSummary, OfferingDto, RiskItem, RiskScan, SectionDto, StaffAccountDto } from '@/lib/types';

export default function PrincipalDashboard() {
  const [scan, setScan] = useState<RiskScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [openItem, setOpenItem] = useState<RiskItem | null>(null);

  // Operational summaries, each from the API its own detail page already uses.
  const [fees, setFees] = useState<FeeSummary | null>(null);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);
  const [teachers, setTeachers] = useState<StaffAccountDto[] | null>(null);

  const runScan = useCallback(() => {
    setLoading(true); setErr(false);
    // Only the top handful of flagged signals — the summary block carries the
    // totals, so there is no reason to ship the rest to the browser.
    api.riskScan({ minProbability: 0.4, page: 1, pageSize: 6 })
      .then((data) => setScan(data))
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { runScan(); }, [runScan]);
  useEffect(() => {
    api.feeSummary().then(setFees).catch(() => setFees(null));
    api.mySections().then(setSections).catch(() => setSections([]));
    api.myOfferings().then(setOfferings).catch(() => setOfferings([]));
    api.listTeachers().then(setTeachers).catch(() => setTeachers([]));
  }, []);

  const summary = scan?.summary;
  const topAlerts = scan?.items ?? [];

  // Staff coverage: sections that have a class teacher assigned, and offerings
  // that still have no teacher on them.
  const sectionsWithTeacher = (sections ?? []).filter((s) => s.classTeacher).length;
  const unstaffedOfferings = (offerings ?? []).filter((o) => !o.teacherName).length;

  return (
    <PortalShell expectedSlug="principal" topbar={{
      title: 'School Intelligence',
      desc: 'How the school is doing today, and where to look first.',
      actions: <Button variant="soft" onClick={runScan} disabled={loading}>{loading ? '↻ Scanning…' : '↻ Rescan'}</Button>,
    }}>
      {/* ── Risk headline ───────────────────────────────────────────
          Wording matches what the engine produces: it runs a check per
          student per signal, and only the ones crossing a threshold are
          flags. A student can carry more than one flag. */}
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 10 }}>
        <StatCard
          label="Students at high risk"
          value={summary ? summary.studentsAtHighRisk : '—'}
          delta={summary ? (summary.studentsAtHighRisk > 0 ? 'needs attention' : 'all clear') : loading ? 'scanning…' : undefined}
          deltaDir={summary && summary.studentsAtHighRisk > 0 ? 'down' : 'up'}
          href="/principal/risk"
          hint="Open Performance & Risk"
        />
        <StatCard
          label="Students at medium risk"
          value={summary ? summary.studentsAtMediumRisk : '—'}
          delta="monitor closely"
          deltaDir="flat"
          href="/principal/risk"
          hint="Open Performance & Risk"
        />
        <StatCard
          label="Flagged students"
          value={summary ? summary.flaggedStudents : '—'}
          delta={summary ? `of ${summary.activeEnrollments} enrolled · ${summary.clearStudents} clear` : undefined}
          deltaDir="flat"
          href="/principal/risk"
          hint="Open Performance & Risk"
        />
        <StatCard
          label="Flagged signals"
          value={summary ? summary.flaggedSignals : '—'}
          delta={summary ? `from ${summary.signalsEvaluated} checks run` : undefined}
          deltaDir="flat"
          href="/principal/risk"
          hint="Open Performance & Risk"
        />
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 18, lineHeight: 1.5 }}>
        A <strong>check</strong> is one signal scored for one student (attendance, academics, fees). A check only becomes a
        <strong> flag</strong> once it crosses a risk threshold — one student can carry several flags.
      </p>

      {/* ── Operations at a glance ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 18 }}>
        <SummaryCard
          title="Attendance"
          href="/principal/attendance"
          linkLabel="Attendance trends →"
          rows={[
            { label: 'Attendance flags', value: summary ? String(summary.byCategory.ATTENDANCE ?? 0) : '—' },
            { label: 'Sections tracked', value: sections ? String(sections.length) : '—' },
          ]}
          foot="Daily marking by section, with per-day rosters."
        />
        <SummaryCard
          title="Fees"
          href="/principal/fees"
          linkLabel="Fee health →"
          rows={[
            { label: 'Collected', value: fees ? rupees(fees.totalCollectedPaise) : '—' },
            { label: 'Pending', value: fees ? rupees(fees.pendingPaise) : '—' },
            { label: 'Overdue invoices', value: fees ? String(fees.overdueCount) : '—' },
          ]}
          foot={fees ? `${fees.collectionPct}% of billed collected` : undefined}
          tone={fees && fees.overdueCount > 0 ? 'warn' : undefined}
        />
        <SummaryCard
          title="Staff"
          href="/principal/staff"
          linkLabel="Staff directory →"
          rows={[
            { label: 'Teaching staff', value: teachers ? String(teachers.length) : '—' },
            { label: 'Classes with a class teacher', value: sections ? `${sectionsWithTeacher} of ${sections.length}` : '—' },
            { label: 'Offerings without a teacher', value: offerings ? String(unstaffedOfferings) : '—' },
          ]}
          foot="Subjects, assigned classes and contact details."
          tone={unstaffedOfferings > 0 ? 'warn' : undefined}
        />
      </div>

      {/* ── Top priority ─────────────────────────────────────────── */}
      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Needs attention first</strong>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
              Highest-probability flags across the school
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {summary && <Pill tone={summary.studentsAtHighRisk > 0 ? 'red' : 'green'}>{summary.studentsAtHighRisk} students at high risk</Pill>}
            <Link href="/principal/risk" className="btn btn-soft btn-sm">View all →</Link>
          </div>
        </div>

        {loading && !scan && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {err && <EmptyState title="Scan failed" sub="Could not run the risk scan. Check your connection and retry." action={<Button variant="soft" small onClick={runScan}>Retry</Button>} />}
        {scan && topAlerts.length === 0 && !err && (
          <EmptyState icon="✓" title="Nothing flagged" sub="No attendance, academic or fee-default signal has crossed a risk threshold." />
        )}
        {topAlerts.length > 0 && (
          <table className="data-table data-table-cards">
            <thead><tr><th>Student</th><th>Class</th><th>Category</th><th>Level</th><th>Probability</th><th>Summary</th></tr></thead>
            <tbody>
              {topAlerts.map((item, i) => (
                <tr
                  key={`${item.enrollmentId}-${item.type}-${i}`}
                  onClick={() => setOpenItem(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenItem(item); }
                  }}
                  tabIndex={0}
                  role="button"
                  style={{ cursor: 'pointer' }}
                  title={`Open details for ${item.studentName}`}
                >
                  <td className="cell-primary" data-label="Student">{item.studentName}</td>
                  <td data-label="Class">{item.class}</td>
                  <td data-label="Category">{RISK_CATEGORY_LABEL[item.type] ?? item.type}</td>
                  <td data-label="Level"><Pill tone={RISK_LEVEL_TONE[item.level] ?? 'gray'}>{item.level.toLowerCase()}</Pill></td>
                  <td style={{ fontWeight: 600 }} data-label="Probability">{Math.round(item.probability * 100)}%</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-2b)' }} data-label="Summary">{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scan && (scan.total ?? 0) > topAlerts.length && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--hairline)', fontSize: 12.5, color: 'var(--text-faint)' }}>
            Showing the top {topAlerts.length} of {scan.total} flagged signals ·{' '}
            <Link href="/principal/risk" style={{ color: 'var(--accent)', fontWeight: 600 }}>filter and drill down →</Link>
          </div>
        )}
      </Card>

      {openItem && <RiskDetailDrawer item={openItem} onClose={() => setOpenItem(null)} />}
    </PortalShell>
  );
}

function SummaryCard({
  title, href, linkLabel, rows, foot, tone,
}: {
  title: string;
  href: string;
  linkLabel: string;
  rows: Array<{ label: string; value: string }>;
  foot?: string;
  tone?: 'warn';
}) {
  return (
    <Card style={tone === 'warn' ? { borderColor: '#e8c9a0' } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 8 }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>{title}</strong>
        <Link href={href} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{linkLabel}</Link>
      </div>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '4px 0' }}>
            <dt style={{ color: 'var(--text-faint)' }}>{r.label}</dt>
            <dd style={{ fontWeight: 600, color: 'var(--text-1)', textAlign: 'right' }}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {foot && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8 }}>{foot}</div>}
    </Card>
  );
}
