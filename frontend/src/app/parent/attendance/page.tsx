'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

interface Summary {
  enrollmentId: string; yearMonth: string;
  PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number;
  workingDays: number; pctPresent: number;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ParentAttendance() {
  const now = new Date();
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => setKids([])); }, []);
  const kid = kids?.[active];

  useEffect(() => {
    if (!kid?.enrollment) { setSummary(null); return; }
    setLoading(true);
    api.attendanceSummary(kid.enrollment.id, month)
      .then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  // Intentionally narrower than the rule wants: this effect reads only the
  // enrollment id, so widening the dependency to the whole `kid` object would
  // refetch on unrelated changes to the selected child.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kid?.enrollment?.id, month]);

  const pctColor = (p: number) => p >= 75 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Attendance', desc: kid ? `${kid.name} · monthly attendance` : 'Monthly attendance' }}>
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

      <div style={{ marginBottom: 16 }}>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ maxWidth: 180 }} aria-label="Month" />
      </div>

      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your wards to this number." />}
      {kid && !kid.enrollment && <EmptyState title="Not enrolled" sub="Your child has no active enrollment for this year." />}
      {loading && <Card><SkeletonRows rows={4} /></Card>}

      {!loading && summary && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Attendance %" value={<span style={{ color: pctColor(summary.pctPresent) }}>{summary.pctPresent}%</span>} />
            <StatCard label="Present" value={summary.PRESENT} delta={summary.LATE ? `+${summary.LATE} late` : undefined} deltaDir="flat" />
            <StatCard label="Absent" value={summary.ABSENT} deltaDir={summary.ABSENT > 3 ? 'down' : 'flat'} />
            <StatCard label="Working Days" value={summary.workingDays} />
          </div>

          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
              {MONTHS[parseInt(month.split('-')[1]) - 1]} {month.split('-')[0]} Summary
            </strong>
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, textAlign: 'center' }}>
              {(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY'] as const).map((s) => (
                <div key={s}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: statusColor(s) }}>{summary[s]}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{s.replace('_', ' ')}</div>
                </div>
              ))}
            </div>
            {summary.pctPresent < 75 && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>
                Attendance is below 75%. Please ensure regular attendance to avoid academic disruption.
              </div>
            )}
          </Card>
        </>
      )}
      {!loading && kid?.enrollment && !summary && (
        <EmptyState title="No records" sub="No attendance records found for this month." />
      )}
    </PortalShell>
  );
}

function statusColor(s: string) {
  return { PRESENT: 'var(--green)', ABSENT: 'var(--red)', LATE: 'var(--amber)', EXCUSED: 'var(--blue)', HALF_DAY: 'var(--amber)' }[s] ?? 'var(--text-2)';
}
