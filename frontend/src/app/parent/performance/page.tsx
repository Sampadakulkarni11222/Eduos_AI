'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { PerformanceDto, StudentListItem } from '@/lib/types';

export default function ParentPerformance() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [perf, setPerf] = useState<PerformanceDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => setKids([])); }, []);
  const kid = kids?.[active];
  useEffect(() => {
    if (!kid?.enrollment) { setPerf(null); return; }
    setLoading(true);
    api.performance(kid.enrollment.id).then(setPerf).catch(() => setPerf(null)).finally(() => setLoading(false));
  }, [kid?.enrollment?.id]);

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Performance', desc: kid ? `${kid.name} · academic progress` : 'Academic progress' }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : '#fff', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}
      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your wards to this number." />}
      {loading && <Card><SkeletonRows rows={4} /></Card>}
      {!loading && perf && perf.results.length === 0 && (
        <EmptyState title="No published results yet" sub="Marks appear here once teachers publish them for the term." />
      )}
      {!loading && perf && perf.results.length > 0 && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard label="Overall average" value={perf.overallAvgPct != null ? `${perf.overallAvgPct}%` : '—'} />
            <StatCard label="Best subject" value={perf.bestSubject?.subject ?? '—'} delta={perf.bestSubject?.pct != null ? `${perf.bestSubject.pct}%` : undefined} deltaDir="up" />
            <StatCard label="Needs support" value={perf.needsSupport?.subject ?? '—'} delta={perf.needsSupport?.pct != null ? `${perf.needsSupport.pct}%` : undefined} deltaDir="down" />
          </div>
          <Card pad={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Marks Breakdown</strong>
            </div>
            <table className="data-table data-table-cards">
              <thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>%</th></tr></thead>
              <tbody>
                {perf.results.map((r, i) => (
                  <tr key={i}>
                    <td data-label="Exam">{r.exam}</td>
                    <td className="cell-primary" data-label="Subject">{r.subject}</td>
                    <td data-label="Marks">{r.marks ?? '—'} / {r.maxMarks}</td>
                    <td style={{ color: pctColor(r.pct), fontWeight: 600 }} data-label="%">{r.pct != null ? `${r.pct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </PortalShell>
  );
}
function pctColor(p: number | null) {
  if (p == null) return 'var(--text-faint)';
  if (p >= 75) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}
