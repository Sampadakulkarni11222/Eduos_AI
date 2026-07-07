'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AttendanceRoster, SectionDto } from '@/lib/types';

/** Admin sees attendance read-only across all sections. */
export default function AdminAttendance() {
  const today = new Date().toISOString().slice(0, 10);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceRoster | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.mySections().then((s) => {
      setSections(s);
      if (s[0]) setSectionId(s[0].id);
    }).catch(() => setSections([]));
  }, []);
  useEffect(() => {
    if (!sectionId) return; setLoading(true);
    api.attendanceRoster(sectionId, date).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [sectionId, date]);

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Attendance', desc: 'View attendance across all classes.' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          {sections?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {sections === null && <Card><SkeletonRows rows={6} /></Card>}
      {sections?.length === 0 && <EmptyState title="No sections available" sub="Sections assigned to your account appear here. Contact the system admin if you expect to see sections." />}
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && data && data.roster.length === 0 && <EmptyState title="No records" sub="No attendance marked for this section and date." />}
      {data && data.roster.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollmentId}>
                  <td style={{ color: 'var(--text-faint)' }}>{r.rollNo ?? '—'}</td>
                  <td className="cell-primary">{r.studentName}</td>
                  <td style={{ color: statusColor(r.status) }}>{r.status ?? 'Not marked'}</td>
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
