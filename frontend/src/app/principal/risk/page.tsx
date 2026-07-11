'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { RiskItem, RiskScan } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = {
  ACADEMIC_DECLINE: 'Academic decline', DROPOUT: 'Dropout risk', FEE_DEFAULT: 'Fee default', ATTENDANCE: 'Attendance risk',
};
const LEVEL_TONE: Record<string, 'red' | 'amber' | 'gray'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };

export default function PrincipalRisk() {
  const [scan, setScan] = useState<RiskScan | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.riskScan().then(setScan).catch(() => setErr(true)); }, []);

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Performance & Risk', desc: 'Predictive flags with the reasons behind them.' }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <StatCard label="High risk" value={scan ? scan.counts.HIGH ?? 0 : '—'} deltaDir="down" />
        <StatCard label="Medium risk" value={scan ? scan.counts.MEDIUM ?? 0 : '—'} deltaDir="flat" />
        <StatCard label="Flagged students" value={scan ? scan.items.length : '—'} />
      </div>
      {scan === null && !err && <Card><SkeletonRows rows={5} /></Card>}
      {err && <EmptyState title="Couldn't run the scan" sub="The risk engine didn't respond. Reload to try again." />}
      {scan && scan.items.length === 0 && <EmptyState icon="✓" title="No students flagged" sub="No academic, attendance, dropout or fee-default risks detected." />}
      {scan && scan.items.length > 0 && (
        <Card pad={false}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Risk Alerts</strong>
            <Pill tone="maroon">Predictive Analytics · interpretable</Pill>
          </div>
          {scan.items.map((it, i) => <RiskRow key={`${it.enrollmentId}-${it.type}`} item={it} top={i < 3} />)}
        </Card>
      )}
    </PortalShell>
  );
}

function RiskRow({ item, top }: { item: RiskItem; top: boolean }) {
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Pill tone={LEVEL_TONE[item.level]}>{item.level.toLowerCase()}</Pill>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>
            {TYPE_LABEL[item.type]} — {item.studentName} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {item.class}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>{item.summary}</div>
        </div>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, color: 'var(--text-1b)' }}>{Math.round(item.probability * 100)}%</div>
      </div>
      {/* the "why": top features driving the flag */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {item.topFeatures.map((f, i) => (
          <span key={i} style={{ fontSize: 11.5, color: 'var(--text-2)', background: 'var(--panel-bg,#F3ECDC)', borderRadius: 6, padding: '3px 8px' }}>
            {f.feature}: <b>{f.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
