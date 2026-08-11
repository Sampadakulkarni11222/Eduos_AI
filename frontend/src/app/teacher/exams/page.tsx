'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { ConfirmModal } from '@/components/confirm-modal';
import { api, ApiError } from '@/lib/api';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
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

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Exams & Performance', desc: 'Enter marks for your classes and view published results.',
      actions: (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="input" style={{ maxWidth: 200 }} value={examId} onChange={(e) => setExamId(e.target.value)} aria-label="Exam">
            <option value="">— Select exam —</option>
            {exams?.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
          </select>
          <select className="input" style={{ maxWidth: 240 }} value={examSubjectId} onChange={(e) => setExamSubjectId(e.target.value)} aria-label="Subject" disabled={!examId}>
            <option value="">— Select subject —</option>
            {subjects?.map((s) => <option key={s.id} value={s.id}>{s.class} · {s.subject}</option>)}
          </select>
          <Button disabled={!examSubjectId} onClick={() => setEntryOpen(true)}>Enter marks</Button>
        </div>
      ),
    }}>
      {examId && subjects?.length === 0 && (
        <EmptyState title="No papers set up for this exam" sub="Ask an admin to attach your subject to this exam before entering marks." />
      )}

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
                  <td style={{ fontWeight: 600 }} data-label="Marks">{r.marks ?? '—'}</td>
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

function MarksEntryModal({ examSubjectId, onClose, onSaved }: { examSubjectId: string; onClose: () => void; onSaved: () => void }) {
  const [grid, setGrid] = useState<MarksGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { marks: string; gradeLabel: string; remarks: string }>>({});
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'publish' | 'unpublish' | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimer = useRef<ReturnType<typeof setInterval>>();
  // isDirtyState drives the unsaved-warning hook (needs real state, not a ref).
  // isDirtyRef is checked inside setInterval callbacks without stale-closure issues.
  const [isDirtyState, setIsDirtyState] = useState(false);
  const isDirtyRef = useRef(false);
  const toast = useToast();

  const markClean = () => {
    isDirtyRef.current = false;
    setIsDirtyState(false);
  };
  const markDirty = () => {
    isDirtyRef.current = true;
    setIsDirtyState(true);
  };

  const load = useCallback(() => {
    api.marksGrid(examSubjectId)
      .then((g) => {
        setGrid(g);
        setErr(null);
        setDraft(Object.fromEntries(g.rows.map((r) => [r.enrollmentId, {
          marks: r.marks != null ? String(r.marks) : '',
          gradeLabel: r.gradeLabel ?? '',
          remarks: r.remarks ?? '',
        }])));
        // fresh data — nothing to save yet
        isDirtyRef.current = false;
        setIsDirtyState(false);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load the class roster.'));
  }, [examSubjectId]);

  useEffect(load, [load]);

  // isDirtyState is real React state → the hook re-evaluates when it flips,
  // so the beforeunload listener is correctly added/removed.
  useUnsavedWarning(isDirtyState);

  // Autosave every 30 s when there are unsaved draft marks.
  // Uses isDirtyRef (not state) so the callback never captures a stale value.
  useEffect(() => {
    autoSaveTimer.current = setInterval(async () => {
      if (!isDirtyRef.current || !grid) return;
      const statusByEnrollment = Object.fromEntries(grid.rows.map((r) => [r.enrollmentId, r.status]));
      const entries = Object.entries(draft)
        .filter(([eid, v]) => v.marks !== '' && statusByEnrollment[eid] !== 'PUBLISHED')
        .map(([eid, v]) => ({
          enrollmentId: eid,
          marks: Number(v.marks),
          gradeLabel: v.gradeLabel || undefined,
          remarks: v.remarks || undefined,
        }));
      if (!entries.length) return;
      setAutoSaveStatus('saving');
      try {
        await api.enterMarks({ examSubjectId, entries });
        markClean();
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2500);
      } catch {
        setAutoSaveStatus('error');
      }
    }, 30_000);
    return () => clearInterval(autoSaveTimer.current);
  }, [examSubjectId, draft, grid]);

  const publishableCount = grid?.rows.filter((r) => r.status !== 'PENDING' && r.status !== 'PUBLISHED').length ?? 0;
  const publishedCount  = grid?.rows.filter((r) => r.status === 'PUBLISHED').length ?? 0;

  const doPublish = async () => {
    setPublishing(true);
    try {
      await api.publishMarks(examSubjectId);
      toast('Marks published and students notified.');
      markClean();
      load();
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not publish marks.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const doUnpublish = async () => {
    setUnpublishing(true);
    try {
      await api.unpublishMarks(examSubjectId);
      toast('Marks moved back to draft — you can now correct them.');
      load();
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not unpublish marks.', 'error');
    } finally {
      setUnpublishing(false);
    }
  };

  const setField = (eid: string, field: 'marks' | 'gradeLabel' | 'remarks', value: string) => {
    markDirty();
    setDraft((d) => ({ ...d, [eid]: { ...d[eid], [field]: value } }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!grid) return;
    const statusByEnrollment = Object.fromEntries(grid.rows.map((r) => [r.enrollmentId, r.status]));
    const entries = Object.entries(draft)
      .filter(([eid, v]) => v.marks !== '' && statusByEnrollment[eid] !== 'PUBLISHED')
      .map(([eid, v]) => ({
        enrollmentId: eid,
        marks: Number(v.marks),
        gradeLabel: v.gradeLabel || undefined,
        remarks: v.remarks || undefined,
      }));
    if (entries.length === 0) { toast('Enter at least one mark first.', 'error'); return; }
    setBusy(true);
    try {
      await api.enterMarks({ examSubjectId, entries });
      markClean();
      toast(`Saved marks for ${entries.length} student${entries.length === 1 ? '' : 's'}.`);
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save marks.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 780, width: '94%' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              {grid ? `Enter marks — ${grid.examSubject.examName} · ${grid.examSubject.class} · ${grid.examSubject.subject}` : 'Enter marks'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {autoSaveStatus === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Autosaving…</span>}
              {autoSaveStatus === 'saved' && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Autosaved</span>}
              {autoSaveStatus === 'error' && <span style={{ fontSize: 11, color: 'var(--red)' }}>Autosave failed</span>}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>

          {err && <EmptyState title="Couldn't load" sub={err} />}
          {!err && grid === null && <SkeletonRows rows={5} />}

          {grid && grid.rows.length > 0 && grid.rows.every((r) => r.status === 'PUBLISHED') && (
            <div style={{ background: 'var(--panel-bg)', border: '1px solid var(--input-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 }}>
              All marks are published. Use <strong>Unpublish &amp; Correct</strong> below to fix a mistake.
            </div>
          )}

          {grid && (
            <form onSubmit={save}>
              <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
                <table className="data-table data-table-cards">
                  <thead><tr><th>Roll</th><th>Student</th><th style={{ width: 110 }}>Marks (of {grid.examSubject.maxMarks})</th><th style={{ width: 90 }}>Grade</th><th>Remarks</th><th>Status</th></tr></thead>
                  <tbody>
                    {grid.rows.map((r: MarkRow) => (
                      <tr key={r.enrollmentId}>
                        <td data-label="Roll">{r.rollNo ?? '—'}</td>
                        <td className="cell-primary" data-label="Student">{r.studentName}</td>
                        <td data-label="Marks">
                          <input
                            className="field-input" type="number" min={0} max={grid.examSubject.maxMarks} step="0.5"
                            value={draft[r.enrollmentId]?.marks ?? ''}
                            onChange={(e) => setField(r.enrollmentId, 'marks', e.target.value)}
                            disabled={r.status === 'PUBLISHED'}
                          />
                        </td>
                        <td data-label="Grade">
                          <input
                            className="field-input" value={draft[r.enrollmentId]?.gradeLabel ?? ''}
                            onChange={(e) => setField(r.enrollmentId, 'gradeLabel', e.target.value)}
                            placeholder="A" disabled={r.status === 'PUBLISHED'}
                          />
                        </td>
                        <td data-label="Remarks">
                          <input
                            className="field-input" value={draft[r.enrollmentId]?.remarks ?? ''}
                            onChange={(e) => setField(r.enrollmentId, 'remarks', e.target.value)}
                            placeholder="Optional" disabled={r.status === 'PUBLISHED'}
                          />
                        </td>
                        <td data-label="Status"><Pill tone={MARK_TONE[r.status] ?? 'gray'}>{r.status.toLowerCase()}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14, borderTop: '1px solid var(--hairline)', paddingTop: 12, flexWrap: 'wrap' }}>
                <Button type="submit" disabled={busy || publishing}>{busy ? 'Saving…' : 'Save marks'}</Button>
                <Button
                  variant="soft" type="button"
                  onClick={() => setConfirmAction('publish')}
                  disabled={busy || publishing || publishableCount === 0}
                >
                  {publishing ? 'Publishing…' : `Publish marks${publishableCount ? ` (${publishableCount})` : ''}`}
                </Button>
                {publishedCount > 0 && (
                  <Button
                    variant="ghost" type="button"
                    onClick={() => setConfirmAction('unpublish')}
                    disabled={busy || unpublishing}
                    style={{ color: 'var(--amber)' }}
                  >
                    {unpublishing ? 'Unpublishing…' : 'Unpublish & Correct'}
                  </Button>
                )}
                <Button variant="ghost" type="button" onClick={onClose} disabled={busy || publishing}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {confirmAction === 'publish' && (
        <ConfirmModal
          title="Publish marks?"
          body={`Marks for ${publishableCount} student${publishableCount === 1 ? '' : 's'} will become visible to students and parents. Use "Unpublish & Correct" to fix mistakes after publishing.`}
          confirmLabel="Publish"
          onConfirm={() => { setConfirmAction(null); doPublish(); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === 'unpublish' && (
        <ConfirmModal
          title="Unpublish marks?"
          body={`All ${publishedCount} published mark${publishedCount === 1 ? '' : 's'} will revert to draft. Students will temporarily lose access to these results. Re-publishing will notify them again.`}
          confirmLabel="Unpublish"
          danger
          onConfirm={() => { setConfirmAction(null); doUnpublish(); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function pctColor(p: number | null) {
  if (p == null) return 'var(--text-faint)';
  if (p >= 75) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}
