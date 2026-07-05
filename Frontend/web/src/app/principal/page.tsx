'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { RiskScan } from '@/lib/types';

const RISK_TONE: Record<string, 'red' | 'amber' | 'gray'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const TYPE_LABEL: Record<string, string> = { ACADEMIC_DECLINE: 'Academic', DROPOUT: 'Dropout', FEE_DEFAULT: 'Fee default', ATTENDANCE: 'Attendance' };

export default function PrincipalDashboard() {
  const [scan, setScan] = useState<RiskScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const runScan = () => {
    setLoading(true); setErr(false);
    api.riskScan()
      .then((data) => {
        // Extra defensive: ensure items is always an array
        const safe = {
          items: Array.isArray(data?.items) ? data.items : [],
          counts: data?.counts && typeof data.counts === 'object' ? data.counts : {},
        };
        setScan(safe);
      })
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { runScan(); }, []);

  const highCount = scan?.counts?.['HIGH'] ?? 0;
  const medCount = scan?.counts?.['MEDIUM'] ?? 0;

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'School Intelligence', desc: 'Synthesized view of school health', actions: <AskEduOS label="Principal Copilot" /> }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard
          label="High-Risk Students"
          value={scan ? highCount : '—'}
          delta={scan ? (highCount > 0 ? 'needs attention' : 'all clear') : loading ? 'scanning…' : undefined}
          deltaDir={highCount > 0 ? 'down' : 'up'}
        />
        <StatCard
          label="Medium-Risk Students"
          value={scan ? medCount : '—'}
          delta={scan ? 'monitor closely' : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Total Risk Flags"
          value={scan ? scan.items.length : '—'}
          delta={scan ? 'across all categories' : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Risk Categories"
          value={scan ? Object.keys(scan.counts).length : '—'}
          delta="academic · attendance · fees · dropout"
          deltaDir="flat"
        />
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Risk Alerts</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {scan && <Pill tone={highCount > 0 ? 'red' : 'green'}>{highCount} high-risk</Pill>}
            <Button variant="soft" small onClick={runScan} disabled={loading}>{loading ? 'Scanning…' : 'Rescan'}</Button>
          </div>
        </div>

        {(loading && !scan) && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {err && <EmptyState title="Scan failed" sub="Could not run the risk scan. Check your connection and retry." action={<Button variant="soft" small onClick={runScan}>Retry</Button>} />}
        {scan && scan.items.length === 0 && <EmptyState title="No risk alerts" sub="All enrolled students are within normal parameters." />}
        {scan && scan.items.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Student</th><th>Class</th><th>Category</th><th>Level</th><th>Probability</th><th>Summary</th></tr></thead>
            <tbody>
              {scan.items.map((item, i) => (
                <tr key={`${item.enrollmentId}-${item.type}-${i}`}>
                  <td className="cell-primary">{item.studentName}</td>
                  <td>{item.class}</td>
                  <td>{TYPE_LABEL[item.type] ?? item.type}</td>
                  <td><Pill tone={RISK_TONE[item.level] ?? 'gray'}>{item.level.toLowerCase()}</Pill></td>
                  <td style={{ fontWeight: 600 }}>{Math.round(item.probability * 100)}%</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
