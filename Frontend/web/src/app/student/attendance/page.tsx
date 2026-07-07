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

export default function StudentAttendance() {
  const now = new Date();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.students().then((r) => {
      setStudent(r.items[0] ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!student?.enrollment) { setSummary(null); return; }
    setLoading(true);
    api.attendanceSummary(student.enrollment.id, month)
      .then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, [student?.enrollment?.id, month]);

  const pctColor = (p: number) => p >= 75 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Attendance', desc: 'Your monthly attendance track.' }}>
      <div style={{ marginBottom: 16 }}>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ maxWidth: 180 }} aria-label="Month" />
      </div>

      {!student && !loading && (
        <EmptyState title="No student record linked" sub="Contact the administration office to link your student profile." />
      )}
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
      {!loading && student?.enrollment && !summary && (
        <EmptyState title="No records" sub="No attendance records found for this month." />
      )}
    </PortalShell>
  );
}

function statusColor(s: string) {
  return { PRESENT: 'var(--green)', ABSENT: 'var(--red)', LATE: 'var(--amber)', EXCUSED: 'var(--blue)', HALF_DAY: 'var(--amber)' }[s] ?? 'var(--text-2)';
}
