'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, ApiError, request } from '@/lib/api';
import { ABSENCE_LABEL, buildEntries, cellValue, derivedGrade, parseMarkInput, type AbsenceCode } from './marks';
import type { ExamDto, ExamSubjectDto, MarkRow, MarksGrid, PerformanceDto, StudentListItem } from '@/lib/types';

const MARK_TONE: Record<string, 'green' | 'amber' | 'blue' | 'gray'> = {
  PENDING: 'gray', DRAFT: 'amber', REVIEW: 'blue', PUBLISHED: 'green',
};

export default function TeacherExams() {
  const [exams, setExams] = useState<ExamDto[] | null>(null);
  const [examId, setExamId] = useState('');
  const [subjects, setSubjects] = useState<ExamSubjectDto[] | null>(null);
  const [examSubjectId, setExamSubjectId] = useState('');

  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [classFilter, setClassFilter] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [perf, setPerf] = useState<PerformanceDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);

  useEffect(() => {
    api.exams().then((r) => setExams(r)).catch(() => setExams([]));
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  useEffect(() => {
    setExamSubjectId(''); setSubjects(null);
    if (!examId) return;
    api.examSubjects(examId).then(setSubjects).catch(() => setSubjects([]));
  }, [examId]);

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

  const selectedSubject = subjects?.find((s) => s.id === examSubjectId) ?? null;

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Exams & Performance', desc: 'Enter marks for your classes and view published results.',
    }}>
      {/* Marks entry — the exam and subject selectors sit with the action they
          drive rather than in the topbar, where their link to this workflow
          wasn't visible. Behaviour and state are unchanged. */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, color: 'var(--text-1b)', marginBottom: 4 }}>
          Marks entry
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 12 }}>
          Pick the exam and the paper you teach, then enter marks for the whole class.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
            <label className="field-label" htmlFor="exam-select">Exam</label>
            <select
              id="exam-select"
              className="input"
              style={{ width: '100%' }}
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
            >
              <option value="">— Select exam —</option>
              {exams?.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label className="field-label" htmlFor="subject-select">Subject / paper</label>
            <select
              id="subject-select"
              className="input"
              style={{ width: '100%' }}
              value={examSubjectId}
              onChange={(e) => setExamSubjectId(e.target.value)}
              disabled={!examId}
            >
              <option value="">— Select subject —</option>
              {subjects?.map((s) => <option key={s.id} value={s.id}>{s.class} · {s.subject}</option>)}
            </select>
          </div>
          <Button disabled={!examSubjectId} onClick={() => setEntryOpen(true)}>Enter marks</Button>
          {selectedSubject && (
            <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
              Max marks: <strong>{selectedSubject.maxMarks}</strong>
              {selectedSubject.examDate ? ` · ${new Date(selectedSubject.examDate).toLocaleDateString('en-IN')}` : ''}
            </span>
          )}
        </div>
        {examId && subjects?.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--amber)', marginTop: 10 }}>
            ⚠ No papers are set up for this exam. Ask an admin to attach your subject to it before entering marks.
          </p>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, marginTop: 8, flexWrap: 'wrap' }}>
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
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Max</th><th>%</th></tr></thead>
            <tbody>
              {perf.results.map((r, i) => (
                <tr key={i}>
                  <td data-label="Exam">{r.exam}</td>
                  <td className="cell-primary" data-label="Subject">{r.subject}</td>
                  <td style={{ fontWeight: 600 }} data-label="Marks">{r.marks ?? (r as { absence?: string | null }).absence ?? '—'}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Max">{r.maxMarks}</td>
                  <td style={{ color: pctColor(r.pct), fontWeight: 600 }} data-label="%">{r.pct != null ? `${r.pct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {entryOpen && examSubjectId && (
        <MarksEntryModal
          examSubjectId={examSubjectId}
          onClose={() => setEntryOpen(false)}
          onSaved={() => { if (enrollmentId) api.performance(enrollmentId).then(setPerf).catch(() => {}); }}
        />
      )}
    </PortalShell>
  );
}

/** The editable columns of the marks grid, used for keyboard navigation. Grade is derived, not typed. */
type GridField = 'marks' | 'remarks';
const cellKey = (enrollmentId: string, field: GridField) => `${enrollmentId}:${field}`;

/** The grid as the server now returns it: AB/ML per row, and whether the paper has been sat. */
type GridRow = MarkRow & { absence?: AbsenceCode | null };
type Grid = Omit<MarksGrid, 'rows' | 'examSubject'> & {
  examSubject: MarksGrid['examSubject'] & { examDate?: string | null; held?: boolean };
  rows: GridRow[];
};

/** The server's own reason when it gives one, else the fallback. */
const reasonOf = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.message && e.message !== e.code ? e.message : fallback);

function MarksEntryModal({ examSubjectId, onClose, onSaved }: { examSubjectId: string; onClose: () => void; onSaved: () => void }) {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { marks: string; remarks: string }>>({});
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const toast = useToast();
  /** Every grid input by "<enrollmentId>:<field>", so focus can jump between rows. */
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => {
    request<Grid>(`/exams/marks-grid?examSubjectId=${encodeURIComponent(examSubjectId)}`)
      .then((g) => {
        setGrid(g);
        setErr(null);
        setInvalid(new Set());
        setDraft(Object.fromEntries(g.rows.map((r) => [r.enrollmentId, {
          marks: cellValue(r),
          remarks: r.remarks ?? '',
        }])));
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load the class roster.'));
  };
  useEffect(load, [examSubjectId]);

  const notHeld = grid?.examSubject.held === false;
  const publishableCount = grid?.rows.filter((r) => r.status !== 'PENDING' && r.status !== 'PUBLISHED').length ?? 0;
  const publishedCount = grid?.rows.filter((r) => r.status === 'PUBLISHED').length ?? 0;
  const missingCount = grid?.rows.filter((r) => r.status !== 'PUBLISHED' && r.marks == null && !r.absence).length ?? 0;

  const publish = async () => {
    if (!confirm(`Publish marks for ${publishableCount} student${publishableCount === 1 ? '' : 's'}? Published marks become visible to students and parents.`)) return;
    setPublishing(true);
    try {
      await api.publishMarks(examSubjectId);
      toast('Marks published.');
      load();
      onSaved();
    } catch (e) {
      toast(reasonOf(e, 'Could not publish marks.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  /** Reopen a published paper for correction. The reason is recorded in the audit trail. */
  const reopen = async () => {
    const reason = window.prompt('Reopen these published marks for correction? Students and parents keep seeing nothing new until you publish again.\n\nReason (recorded):');
    if (reason === null) return;
    setPublishing(true);
    try {
      await request<{ reopened: number }>('/exams/unpublish', { method: 'POST', body: JSON.stringify({ examSubjectId, reason }) });
      toast('Marks reopened for correction.');
      load();
      onSaved();
    } catch (e) {
      toast(reasonOf(e, 'Could not reopen the marks.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const setField = (enrollmentId: string, field: GridField, value: string) => {
    setDraft((d) => ({ ...d, [enrollmentId]: { ...d[enrollmentId], [field]: value } }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!grid) return;
    const { entries, invalid: bad } = buildEntries(grid.rows, draft, grid.examSubject.maxMarks);
    setInvalid(new Set(bad));
    if (bad.length) { toast(`${bad.length} mark${bad.length === 1 ? ' is' : 's are'} not valid — use a number, AB or ML.`, 'error'); return; }
    if (entries.length === 0) { toast('Nothing has changed yet.', 'error'); return; }
    setBusy(true);
    try {
      await request<unknown>('/exams/marks', { method: 'POST', body: JSON.stringify({ examSubjectId, entries }) });
      toast(`Saved marks for ${entries.length} student${entries.length === 1 ? '' : 's'}.`);
      onSaved();
      onClose();
    } catch (e2) {
      toast(reasonOf(e2, 'Could not save marks.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Spreadsheet-style vertical movement between students.
   *
   * Enter / Shift+Enter and the arrow keys move down / up the column being
   * edited. Enter would otherwise submit the form and close the dialog
   * mid-entry, so it is intercepted for the grid inputs regardless of whether
   * a next row exists. Any modifier combo (Ctrl/Cmd/Alt) passes straight
   * through to the browser, and Tab is never touched, so its native
   * left-to-right order still works.
   */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, field: GridField) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const isEnter = e.key === 'Enter';
    const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    if (!isEnter && !isArrow) return;

    e.preventDefault();
    const step = (isEnter ? e.shiftKey : e.key === 'ArrowUp') ? -1 : 1;
    focusCell(rowIndex + step, field, step);
  };

  /**
   * Moves focus to the same column of another row, continuing in the direction
   * of travel past any locked (published) input rather than stopping on it.
   */
  const focusCell = (rowIndex: number, field: GridField, step: 1 | -1) => {
    if (!grid) return;
    for (let i = rowIndex; i >= 0 && i < grid.rows.length; i += step) {
      const el = cellRefs.current[cellKey(grid.rows[i].enrollmentId, field)];
      if (el && !el.disabled) { el.focus(); el.select(); return; }
    }
  };

  const noticeStyle = { background: 'var(--panel-bg)', border: '1px solid var(--input-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 } as const;

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal marks-modal">
        <div className="modal-header">
          <div className="modal-title">
            {grid ? `Enter marks — ${grid.examSubject.examName} · ${grid.examSubject.class} · ${grid.examSubject.subject}` : 'Enter marks'}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <EmptyState title="Couldn't load" sub={err} />}
        {!err && grid === null && <SkeletonRows rows={5} />}

        {notHeld && (
          <div role="status" style={noticeStyle}>
            This paper is on {grid?.examSubject.examDate ? new Date(grid.examSubject.examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'a later date'}. Marks can be entered once it has been held.
          </div>
        )}

        {grid && grid.rows.length > 0 && grid.rows.every((r) => r.status === 'PUBLISHED') && (
          <div style={noticeStyle}>
            All marks for this paper are published and locked. To correct one, reopen the paper for correction below.
          </div>
        )}

        {grid && (
          <form onSubmit={save}>
            <div className="marks-hint">
              Type a score, <strong>AB</strong> (absent) or <strong>ML</strong> (medical leave); clear a cell to remove a draft mark.
              {' '}<kbd>Enter</kbd> / <kbd>↓</kbd> next student · <kbd>Shift</kbd>+<kbd>Enter</kbd> / <kbd>↑</kbd> previous · <kbd>Tab</kbd> across a row
            </div>
            <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {/* Roll and status moved into the student cell: six columns with
                  three text inputs could not fit the dialog without a
                  horizontal scrollbar. Every field is still present. */}
              <table className="data-table data-table-cards marks-grid">
                <colgroup>
                  <col className="col-student" />
                  <col className="col-marks" />
                  <col className="col-grade" />
                  <col className="col-remarks" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Marks (of {grid.examSubject.maxMarks})</th>
                    <th>Grade <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(auto)</span></th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((r: GridRow, rowIndex: number) => {
                    const locked = r.status === 'PUBLISHED' || notHeld;
                    const value = draft[r.enrollmentId]?.marks ?? '';
                    const bad = invalid.has(r.enrollmentId) || parseMarkInput(value, grid.examSubject.maxMarks).kind === 'invalid';
                    const grade = derivedGrade(value, grid.examSubject.maxMarks);
                    return (
                      <tr key={r.enrollmentId}>
                        <td data-label="Student">
                          <div className="marks-student-name">{r.studentName}</div>
                          <div className="marks-student-meta">
                            <span>Roll {r.rollNo ?? '—'}</span>
                            <Pill tone={MARK_TONE[r.status] ?? 'gray'}>{r.status.toLowerCase()}</Pill>
                          </div>
                        </td>
                        <td data-label="Marks">
                          <input
                            className="field-input" inputMode="decimal" autoComplete="off"
                            value={value}
                            onChange={(e) => setField(r.enrollmentId, 'marks', e.target.value)}
                            onKeyDown={(e) => onGridKeyDown(e, rowIndex, 'marks')}
                            ref={(el) => { cellRefs.current[cellKey(r.enrollmentId, 'marks')] = el; }}
                            aria-label={`Marks for ${r.studentName}`}
                            aria-invalid={bad || undefined}
                            style={bad ? { borderColor: 'var(--red)' } : undefined}
                            placeholder="—"
                            disabled={locked}
                          />
                        </td>
                        <td data-label="Grade">
                          {/* Derived from the marks with the school's scale; the server stores the same. */}
                          <output aria-label={`Grade for ${r.studentName}`} style={{ fontWeight: 600, color: grade ? 'var(--text-1b)' : 'var(--text-faint)' }}
                            title={grade === 'AB' || grade === 'ML' ? ABSENCE_LABEL[grade] : 'Worked out from the marks'}>
                            {grade || '—'}
                          </output>
                        </td>
                        <td data-label="Remarks">
                          <input
                            className="field-input" value={draft[r.enrollmentId]?.remarks ?? ''}
                            onChange={(e) => setField(r.enrollmentId, 'remarks', e.target.value)}
                            onKeyDown={(e) => onGridKeyDown(e, rowIndex, 'remarks')}
                            ref={(el) => { cellRefs.current[cellKey(r.enrollmentId, 'remarks')] = el; }}
                            aria-label={`Remarks for ${r.studentName}`}
                            placeholder="Optional" disabled={locked}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {missingCount > 0 && publishableCount > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--amber)', marginTop: 10 }}>
                {missingCount} student{missingCount === 1 ? ' has' : 's have'} no mark yet. Enter a score, AB or ML for everyone before publishing.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, borderTop: '1px solid var(--hairline)', paddingTop: 12, flexWrap: 'wrap' }}>
              <Button type="submit" disabled={busy || publishing || notHeld}>{busy ? 'Saving…' : 'Save marks'}</Button>
              <Button variant="soft" type="button" onClick={publish} disabled={busy || publishing || publishableCount === 0 || missingCount > 0}>
                {publishing ? 'Working…' : `Publish marks${publishableCount ? ` (${publishableCount})` : ''}`}
              </Button>
              {publishedCount > 0 && (
                <Button variant="ghost" type="button" onClick={reopen} disabled={busy || publishing}>Reopen for correction</Button>
              )}
              <Button variant="ghost" type="button" onClick={onClose} disabled={busy || publishing}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function pctColor(p: number | null) {
  if (p == null) return 'var(--text-faint)';
  if (p >= 75) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}
