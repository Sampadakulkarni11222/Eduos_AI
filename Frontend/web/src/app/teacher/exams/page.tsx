'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { PerformanceDto, StudentListItem } from '@/lib/types';

export default function TeacherExams() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [classFilter, setClassFilter] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [perf, setPerf] = useState<PerformanceDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const classes = [...new Set((students ?? []).map((s) => s.enrollment?.class).filter(Boolean) as string[])];
  const filtered = students?.filter((s) => !classFilter || s.enrollment?.class === classFilter) ?? [];

  useEffect(() => {
    setPerf(null); setEnrollmentId('');
  }, [classFilter]);

  useEffect(() => {
    if (!enrollmentId) { setPerf(null); return; }
    setLoading(true);
    api.performance(enrollmentId).then(setPerf).catch(() => setPerf(null)).finally(() => setLoading(false));
  }, [enrollmentId]);

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Exams & Performance', desc: 'View published exam results for your students.' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 200 }} value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 280 }} value={enrollmentId} onChange={(e) => setEnrollmentId(e.target.value)} aria-label="Student">
          <option value="">— Select student —</option>
          {filtered.map((s) => s.enrollment && <option key={s.enrollment.id} value={s.enrollment.id}>{s.name}</option>)}
        </select>
      </div>

      {students === null && <Card><SkeletonRows rows={4} /></Card>}
      {students?.length === 0 && <EmptyState title="No students in your classes" sub="You'll see student performance here once you're assigned to a class." />}
      {!enrollmentId && students && students.length > 0 && (
        <EmptyState icon="◌" title="Select a student" sub="Choose a class and student above to view their exam performance." />
      )}
      {loading && <Card><SkeletonRows rows={4} /></Card>}
      {!loading && perf && perf.results.length === 0 && (
        <EmptyState title="No published results" sub="Marks appear here once they are published for this student." />
      )}
      {!loading && perf && perf.results.length > 0 && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard label="Overall average" value={perf.overallAvgPct != null ? `${perf.overallAvgPct}%` : '—'} />
            <StatCard label="Best subject" value={perf.bestSubject?.subject ?? '—'} delta={perf.bestSubject?.pct != null ? `${perf.bestSubject.pct}%` : undefined} deltaDir="up" />
            <StatCard label="Needs support" value={perf.needsSupport?.subject ?? '—'} delta={perf.needsSupport?.pct != null ? `${perf.needsSupport.pct}%` : undefined} deltaDir="down" />
          </div>
          <Card pad={false}>
            <table className="data-table">
              <thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Max</th><th>%</th></tr></thead>
              <tbody>
                {perf.results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.exam}</td>
                    <td className="cell-primary">{r.subject}</td>
                    <td style={{ fontWeight: 600 }}>{r.marks ?? '—'}</td>
                    <td style={{ color: 'var(--text-faint)' }}>{r.maxMarks}</td>
                    <td style={{ color: pctColor(r.pct), fontWeight: 600 }}>{r.pct != null ? `${r.pct}%` : '—'}</td>
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
