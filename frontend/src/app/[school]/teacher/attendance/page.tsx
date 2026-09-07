'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, DateField, EmptyState, SkeletonRows, cx } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api, errorMessage } from '@/lib/api';
import type { AttStatus, AttendanceRoster, SectionDto } from '@/lib/types';

const STATUSES: { key: AttStatus; label: string; tone: string }[] = [
  { key: 'PRESENT', label: 'P', tone: 'var(--green)' },
  { key: 'ABSENT', label: 'A', tone: 'var(--red)' },
  { key: 'LATE', label: 'L', tone: 'var(--amber)' },
  { key: 'EXCUSED', label: 'E', tone: 'var(--blue)' },
];

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function AttendancePage() {
  const today = getLocalDateString();
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceRoster | null>(null);
  const [marks, setMarks] = useState<Record<string, AttStatus>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  // null = whole day. Marking a period is what produces genuine per-subject
  // attendance; without it every record is day-level and subject breakdowns
  // can only be inferred from the timetable.
  const [periodNo, setPeriodNo] = useState<number | null>(null);

  useEffect(() => {
    api.mySections().then((s) => { setSections(s); if (s[0]) setSectionId(s[0].id); }).catch(() => setSections([]));
  }, []);

  // Guards against an older in-flight roster response overwriting a newer one
  // when the teacher switches section/date quickly.
  const loadSeq = useRef(0);
  const load = useCallback(async (sid: string, d: string, p: number | null) => {
    if (!sid) return;
    const seq = ++loadSeq.current;
    setLoading(true); setSaved(false); setSaveErr(null);
    try {
      const r = await api.attendanceRoster(sid, d, p ?? undefined);
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

  useEffect(() => { if (sectionId) void load(sectionId, date, periodNo); }, [sectionId, date, periodNo, load]);

  /**
   * Keep the selected slot on something this teacher may actually mark.
   *
   * Two cases: a period that is not timetabled on the newly chosen day, and
   * the whole day when the caller is a subject teacher rather than the class
   * teacher. Both used to leave the roll editable and fail only on save.
   */
  useEffect(() => {
    if (!data) return;
    if (periodNo !== null && !data.periods.some((p) => p.periodNo === periodNo)) {
      setPeriodNo(null);
      return;
    }
    if (periodNo === null && data.canMarkWholeDay === false) {
      const mine = data.periods.find((p) => p.canMark);
      if (mine) setPeriodNo(mine.periodNo);
    }
  }, [data, periodNo]);

  const allPresent = () => {
    if (!data) return;
    const next: Record<string, AttStatus> = {};
    data.roster.forEach((r) => { next[r.enrollmentId] = 'PRESENT'; });
    setMarks(next); setSaved(false);
  };

  // `saving` state alone can't stop a double submit: two clicks (or Enter plus
  // a click) landing in the same React batch both see the old value. The ref
  // flips synchronously, so the second call returns immediately.
  const savingRef = useRef(false);

  const save = async () => {
    if (!data || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setSaveErr(null);
    try {
      const entries = data.roster
        .filter((r) => marks[r.enrollmentId] !== undefined)
        .map((r) => ({ enrollmentId: r.enrollmentId, status: marks[r.enrollmentId]! }));
      if (!entries.length) { setSaveErr('Mark at least one student before saving.'); setSaving(false); savingRef.current = false; return; }
      const updatedRoster = await api.markAttendance({
        sectionId: data.section.id,
        date,
        ...(periodNo !== null && { periodNo }),
        entries,
      });
      setData(updatedRoster);
      const nextMarks: Record<string, AttStatus> = {};
      updatedRoster.roster.forEach((row) => { if (row.status) nextMarks[row.enrollmentId] = row.status; });
      setMarks(nextMarks);
      setSaved(true);
    } catch (err: unknown) {
      setSaveErr(errorMessage(err, 'Save failed. Please try again.'));
    } finally { setSaving(false); savingRef.current = false; }
  };

  const summary = data ? countStatuses(data, marks) : null;
  // Only students with a status contribute an entry to the save payload, so
  // this is exactly what the Save button would submit.
  const markedCount = data ? data.roster.filter((r) => marks[r.enrollmentId] !== undefined).length : 0;

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Attendance', desc: 'One-tap marking for your sections.',
      // Save now lives in a sticky bar next to the roster it applies to, so it
      // stays reachable while scrolling a long class instead of sitting in the
      // topbar the teacher has to scroll back up to.
      actions: data ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={() => setShowBulk(true)}>⇧ Bulk upload</Button>
        </div>
      ) : undefined,
    }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
          {sections?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.gradeName ? `${s.gradeName} – ${s.name}` : s.name}
            </option>
          ))}
        </select>
        <DateField className="date-field-inline" value={date} onChange={setDate} ariaLabel="Date" disabled={saving} />
        {data && data.periods.length > 0 && (
          <select
            className="input"
            value={periodNo ?? ''}
            onChange={(e) => setPeriodNo(e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Subject"
            disabled={saving}
            title="Mark one subject period, or the whole day if you are the class teacher"
          >
            {/* Whole-day is the class teacher's register, so it is offered
                only to someone the server would accept it from. */}
            {data.canMarkWholeDay !== false && <option value="">Whole day</option>}
            {data.periods.filter((p) => p.canMark !== false).map((p) => (
              <option key={p.periodNo} value={p.periodNo}>
                P{p.periodNo} · {p.subject}{p.startTime ? ` (${p.startTime})` : ''}
              </option>
            ))}
          </select>
        )}
        {data && data.roster.length > 0 && <Button variant="soft" small onClick={allPresent} disabled={saving}>Mark all present</Button>}
        {summary && (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-2)' }}>
            {summary.PRESENT} present · {summary.ABSENT} absent · {summary.LATE} late
          </span>
        )}
      </div>

      {/* Whose register this is. A teacher covering an unfamiliar class should
          not have to guess which class, or whose subject, they are marking. */}
      {data && (
        <div className="att-context">
          <span><b>Class</b> {data.section.grade ?? data.section.name}</span>
          {data.section.sectionName && <span><b>Section</b> {data.section.sectionName}</span>}
          {data.section.classTeacher && <span><b>Class teacher</b> {data.section.classTeacher}</span>}
          <span><b>Subject</b> {data.subject ?? 'Whole day'}</span>
          {data.subjectTeacher && <span><b>Subject teacher</b> {data.subjectTeacher}</span>}
        </div>
      )}

      {data && data.canMark === false && (
        <p className="att-locked" role="status">
          This register belongs to another teacher — you can view it, but only the
          teacher of this period (or the class teacher) can save it.
        </p>
      )}

      {showBulk && data && (
        <BulkUploadModal
          title="Bulk mark attendance"
          description={`Upload a CSV of admission numbers (or roll numbers) with a status to mark attendance for "${data.section.name}" on ${date} in one go.`}
          templateHeaders={['admissionNo', 'rollNo', 'status', 'note']}
          templateSampleRow={['ADM-2026-0010', '12', 'PRESENT', '']}
          onSubmit={(file) => api.bulkMarkAttendance(file, data.section.id, date, periodNo ?? undefined)}
          onClose={() => setShowBulk(false)}
          onImported={() => { setShowBulk(false); void load(sectionId, date, periodNo); }}
        />
      )}

      {sections === null && <Card><SkeletonRows rows={5} /></Card>}
      {sections?.length === 0 && <EmptyState title="No sections assigned" sub="You'll mark attendance here once classes are linked to you." />}
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && data && data.roster.length === 0 && <EmptyState title="No students in this section" sub="Add enrollments to begin marking attendance." />}
      {!loading && data && data.roster.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Roll</th><th>Student</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.enrollmentId}>
                  <td style={{ color: 'var(--text-faint)', width: 60 }} data-label="Roll">{r.rollNo ?? '—'}</td>
                  <td className="cell-primary" data-label="Student">{r.studentName}</td>
                  <td data-label="Status">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {STATUSES.map((s) => {
                        const active = (marks[r.enrollmentId] ?? null) === s.key;
                        return (
                          <button key={s.key}
                            disabled={saving}
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

      {/* Sticky save bar — stays visible while the roster scrolls. */}
      {!loading && data && data.roster.length > 0 && (
        <div className={cx('sticky-actions', saveErr && 'is-error', saved && !saveErr && 'is-saved')}>
          <div className="sticky-actions-status" role="status" aria-live="polite">
            {saveErr ? (
              <span style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ {saveErr}</span>
            ) : saving ? (
              <span>Saving attendance…</span>
            ) : saved ? (
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Attendance saved</span>
            ) : (
              <span>
                <strong>{markedCount}</strong> of {data.roster.length} marked
                {markedCount < data.roster.length && ` · ${data.roster.length - markedCount} left`}
              </span>
            )}
          </div>
          <div className="sticky-actions-spacer">
            {summary && (
              <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                {summary.PRESENT}P · {summary.ABSENT}A · {summary.LATE}L · {summary.EXCUSED}E
              </span>
            )}
            {/* A register this teacher may not save is read-only here as well
                as at the API, so the refusal is visible before the work. */}
            <Button onClick={() => void save()} disabled={saving || markedCount === 0 || data.canMark === false}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save attendance'}
            </Button>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

function countStatuses(data: AttendanceRoster, marks: Record<string, AttStatus>) {
  const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  data.roster.forEach((r) => {
    const s = marks[r.enrollmentId] ?? null;
    if (s) c[s] += 1;
  });
  return c;
}
