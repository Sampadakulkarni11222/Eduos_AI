'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, DateField, EmptyState, SkeletonRows } from '@/components/ui';
import { Tabs } from '@/components/ops/kit';
import { AttendanceOverviewView } from '@/components/leadership/attendance-overview';
import { api } from '@/lib/api';
import type { AttendanceRoster, SectionDto } from '@/lib/types';

// The school's local calendar day (the register's day), not UTC: before 05:30 IST
// toISOString() still reads yesterday.
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const STATUS_WORDS: Record<string, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused', HALF_DAY: 'Half day' };

export default function PrincipalAttendance() {
  const [tab, setTab] = useState<'overview' | 'register'>('overview');
  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Attendance Trends', desc: "Every class at a glance, today's registers, and the students below the attendance line." }}>
      <Tabs tabs={[{ key: 'overview', label: 'School overview' }, { key: 'register', label: 'Class register' }]} value={tab} onChange={setTab} />
      {tab === 'overview' ? <AttendanceOverviewView /> : <ClassRegister />}
    </PortalShell>
  );
}

function ClassRegister() {
  const today = localToday();
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceRoster | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.mySections().then((s) => { setSections(s); if (s[0]) setSectionId(s[0].id); }).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    setLoading(true);
    setFailed(false);
    api.attendanceRoster(sectionId, date).then(setData).catch(() => { setData(null); setFailed(true); }).finally(() => setLoading(false));
  }, [sectionId, date]);

  const present = data?.roster.filter((r) => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'EXCUSED').length ?? 0;
  const absent = data?.roster.filter((r) => r.status === 'ABSENT').length ?? 0;
  // Of the students actually marked: an unmarked or half-taken register is not low attendance.
  const marked = data?.roster.filter((r) => r.status).length ?? 0;
  const unmarked = (data?.roster.length ?? 0) - marked;
  const pct = marked ? Math.round((present / marked) * 100) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
          {sections?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.gradeName ? `${s.gradeName} – ${s.name}` : s.name}
            </option>
          ))}
        </select>
        <DateField className="date-field-inline" value={date} onChange={setDate} ariaLabel="Date" />
        {data && pct !== null && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-2)', alignSelf: 'center' }}>
            <strong style={{ color: pct >= 75 ? 'var(--green)' : 'var(--red)' }}>{pct}%</strong> of those marked · {present} present · {absent} absent{unmarked ? ` · ${unmarked} not marked` : ''}
          </span>
        )}
      </div>

      {sections === null && <Card><SkeletonRows rows={6} /></Card>}
      {sections?.length === 0 && <EmptyState title="No sections" sub="No sections found for this school." />}
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && failed && <EmptyState title="Could not load the register" sub="Check your connection and choose the class again." />}
      {!loading && data && data.roster.length === 0 && <EmptyState title="No records" sub="No attendance marked for this section on this date." />}
      {!loading && data && data.roster.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollmentId}>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Roll">{r.rollNo ?? '—'}</td>
                  <td className="cell-primary" data-label="Student">{r.studentName}</td>
                  <td style={{ color: statusColor(r.status), fontWeight: 600 }} data-label="Status">{r.status ? (STATUS_WORDS[r.status] ?? r.status) : 'Not marked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
function statusColor(s: string | null) {
  return { PRESENT: 'var(--green)', ABSENT: 'var(--red)', LATE: 'var(--amber)', EXCUSED: 'var(--blue)' }[s ?? ''] ?? 'var(--text-faint)';
}
