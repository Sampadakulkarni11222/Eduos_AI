'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AttendanceRoster, SectionDto } from '@/lib/types';

export default function PrincipalAttendance() {
  const today = new Date().toISOString().slice(0, 10);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceRoster | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.mySections().then((s) => { setSections(s); if (s[0]) setSectionId(s[0].id); }).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    setLoading(true);
    api.attendanceRoster(sectionId, date).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [sectionId, date]);

  const present = data?.roster.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length ?? 0;
  const absent = data?.roster.filter((r) => r.status === 'ABSENT').length ?? 0;
  const pct = data?.roster.length ? Math.round((present / data.roster.length) * 100) : null;

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Attendance Trends', desc: 'Daily attendance across all sections.' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
          {sections?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.gradeName ? `${s.gradeName} – ${s.name}` : s.name}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ maxWidth: 180 }} />
        {data && pct !== null && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-2)', alignSelf: 'center' }}>
            <strong style={{ color: pct >= 75 ? 'var(--green)' : 'var(--red)' }}>{pct}%</strong> present · {present} present · {absent} absent
          </span>
        )}
      </div>

      {sections === null && <Card><SkeletonRows rows={6} /></Card>}
      {sections?.length === 0 && <EmptyState title="No sections" sub="No sections found for this school." />}
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && data && data.roster.length === 0 && <EmptyState title="No records" sub="No attendance marked for this section on this date." />}
      {!loading && data && data.roster.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollmentId}>
                  <td style={{ color: 'var(--text-faint)' }}>{r.rollNo ?? '—'}</td>
                  <td className="cell-primary">{r.studentName}</td>
                  <td style={{ color: statusColor(r.status), fontWeight: 600 }}>{r.status ?? 'Not marked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
function statusColor(s: string | null) {
  return { PRESENT: 'var(--green)', ABSENT: 'var(--red)', LATE: 'var(--amber)', EXCUSED: 'var(--blue)' }[s ?? ''] ?? 'var(--text-faint)';
}
