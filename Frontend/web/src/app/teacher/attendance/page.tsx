'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, cx } from '@/components/ui';
import { api } from '@/lib/api';
import type { AttStatus, AttendanceRoster, SectionDto } from '@/lib/types';

const STATUSES: { key: AttStatus; label: string; tone: string }[] = [
  { key: 'PRESENT', label: 'P', tone: 'var(--green)' },
  { key: 'ABSENT', label: 'A', tone: 'var(--red)' },
  { key: 'LATE', label: 'L', tone: 'var(--amber)' },
  { key: 'EXCUSED', label: 'E', tone: 'var(--blue)' },
];

export default function AttendancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceRoster | null>(null);
  const [marks, setMarks] = useState<Record<string, AttStatus>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    api.mySections().then((s) => { setSections(s); if (s[0]) setSectionId(s[0].id); }).catch(() => setSections([]));
  }, []);

  // Guards against an older in-flight roster response overwriting a newer one
  // when the teacher switches section/date quickly.
  const loadSeq = useRef(0);
  const load = useCallback(async (sid: string, d: string) => {
    if (!sid) return;
    const seq = ++loadSeq.current;
    setLoading(true); setSaved(false); setSaveErr(null);
    try {
      const r = await api.attendanceRoster(sid, d);
      if (seq !== loadSeq.current) return;
      setData(r);
      const initial: Record<string, AttStatus> = {};
      r.roster.forEach((row) => { if (row.status) initial[row.enrollmentId] = row.status; });
      setMarks(initial);
    } catch {
      if (seq === loadSeq.current) setData(null);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { if (sectionId) void load(sectionId, date); }, [sectionId, date, load]);

  const allPresent = () => {
    if (!data) return;
    const next: Record<string, AttStatus> = {};
    data.roster.forEach((r) => { next[r.enrollmentId] = 'PRESENT'; });
    setMarks(next); setSaved(false);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true); setSaveErr(null);
    try {
      const entries = data.roster
        .filter((r) => marks[r.enrollmentId] !== undefined)
        .map((r) => ({ enrollmentId: r.enrollmentId, status: marks[r.enrollmentId]! }));
      if (!entries.length) { setSaveErr('Mark at least one student before saving.'); setSaving(false); return; }
      await api.markAttendance({ sectionId: data.section.id, date, entries });
      setSaved(true);
    } catch (err: any) {
      setSaveErr(err?.message ?? 'Save failed. Please try again.');
    } finally { setSaving(false); }
  };

  const summary = data ? countStatuses(data, marks) : null;

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Attendance', desc: 'One-tap marking for your sections.',
      actions: data ? <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : saved ? '✓ Saved' : 'Save attendance'}</Button> : undefined,
    }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
          {sections?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        {data && data.roster.length > 0 && <Button variant="soft" small onClick={allPresent}>Mark all present</Button>}
        {summary && (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-2)' }}>
            {summary.PRESENT} present · {summary.ABSENT} absent · {summary.LATE} late
          </span>
        )}
      </div>

      {saveErr && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13.5 }}>{saveErr}</div>}
      {sections === null && <Card><SkeletonRows rows={5} /></Card>}
      {sections?.length === 0 && <EmptyState title="No sections assigned" sub="You'll mark attendance here once classes are linked to you." />}
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && data && data.roster.length === 0 && <EmptyState title="No students in this section" sub="Add enrollments to begin marking attendance." />}
      {!loading && data && data.roster.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Roll</th><th>Student</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollmentId}>
                  <td style={{ color: 'var(--text-faint)', width: 60 }}>{r.rollNo ?? '—'}</td>
                  <td className="cell-primary">{r.studentName}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {STATUSES.map((s) => {
                        const active = (marks[r.enrollmentId] ?? null) === s.key;
                        return (
                          <button key={s.key}
                            onClick={() => { setMarks((m) => ({ ...m, [r.enrollmentId]: s.key })); setSaved(false); }}
                            title={s.key} aria-pressed={active}
                            className={cx('btn', 'btn-sm')}
                            style={{
                              width: 34, padding: 0, justifyContent: 'center',
                              background: active ? s.tone : '#F3ECDC',
                              color: active ? '#fff' : 'var(--text-2)',
                              border: active ? 'none' : '1px solid var(--input-border)',
                            }}>
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}

function countStatuses(data: AttendanceRoster, marks: Record<string, AttStatus>) {
  const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  data.roster.forEach((r) => { const s = marks[r.enrollmentId] ?? 'PRESENT'; c[s] += 1; });
  return c;
}
