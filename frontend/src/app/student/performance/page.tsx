'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { ReportCardView } from '@/components/report-card-view';
import { MarksTrendChart } from '@/components/marks-trend-chart';
import { api } from '@/lib/api';
import type { PerformanceDto, StudentListItem } from '@/lib/types';

export default function StudentPerformance() {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [perf, setPerf] = useState<PerformanceDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.students().then((r) => {
      const s = r.items[0] ?? null;
      setStudent(s);
      if (s?.enrollment?.id) {
        api.performance(s.enrollment.id)
          .then(setPerf)
          .catch(() => setPerf(null))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));
  }, []);

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Performance', desc: 'Your academic report card and progress.' }}>
      {loading && <Card><SkeletonRows rows={4} /></Card>}
      {!loading && !student && (
        <EmptyState title="No student record linked" sub="Contact the administration office to link your student profile." />
      )}
      {!loading && student && !perf && (
        <EmptyState title="No published results yet" sub="Marks appear here once your teachers publish them." />
      )}

      {!loading && perf && perf.results.length > 0 && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Overall average" value={perf.overallAvgPct != null ? `${perf.overallAvgPct}%` : '—'} />
            <StatCard label="Class rank" value={perf.classRank ? `#${perf.classRank.rank} of ${perf.classRank.totalStudents}` : '—'} />
            <StatCard label="Best subject" value={perf.bestSubject?.subject ?? '—'} delta={perf.bestSubject?.pct != null ? `${perf.bestSubject.pct}%` : undefined} deltaDir="up" />
            <StatCard label="Needs support" value={perf.needsSupport?.subject ?? '—'} delta={perf.needsSupport?.pct != null ? `${perf.needsSupport.pct}%` : undefined} deltaDir="down" />
          </div>
          <div style={{ marginBottom: 18 }}>
            <Card>
              <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Performance Trend Across Exams</strong>
              </div>
              <MarksTrendChart results={perf.results} />
            </Card>
          </div>
          <div style={{ marginBottom: 18 }}>
            <ReportCardView />
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
