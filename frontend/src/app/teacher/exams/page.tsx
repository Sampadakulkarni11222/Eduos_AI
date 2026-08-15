'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
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
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.exams().then((r) => setExams(r)).catch(() => setExams(null));
    api.students().then((r) => setStudents(r.items)).catch(() => { setStudents(null); setErr(true); });
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

      {students === null && !err && <Card><SkeletonRows rows={4} /></Card>}
      {err && <EmptyState title="Couldn't load students" sub="Check your connection and reload the page." />}
      {!err && students?.length === 0 && <EmptyState title="No students in your classes" sub="You'll see student performance here once you're assigned to a class." />}
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
  const toast = useToast();

  const load = () => {
    api.marksGrid(examSubjectId)
      .then((g) => {
        setGrid(g);
        setErr(null);
        setDraft(Object.fromEntries(g.rows.map((r) => [r.enrollmentId, {
          marks: r.marks != null ? String(r.marks) : '',
          gradeLabel: r.gradeLabel ?? '',
          remarks: r.remarks ?? '',
        }])));
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load the class roster.'));
  };
  useEffect(load, [examSubjectId]);

  const publishableCount = grid?.rows.filter((r) => r.status !== 'PENDING' && r.status !== 'PUBLISHED').length ?? 0;

  const publish = async () => {
    if (!confirm(`Publish marks for ${publishableCount} student${publishableCount === 1 ? '' : 's'}? Published marks become visible to students and parents.`)) return;
    setPublishing(true);
    try {
      await api.publishMarks(examSubjectId);
      toast('Marks published.');
      load();
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not publish marks.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const setField = (enrollmentId: string, field: 'marks' | 'gradeLabel' | 'remarks', value: string) => {
    setDraft((d) => ({ ...d, [enrollmentId]: { ...d[enrollmentId], [field]: value } }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!grid) return;
    const statusByEnrollment = Object.fromEntries(grid.rows.map((r) => [r.enrollmentId, r.status]));
    const entries = Object.entries(draft)
      // Published marks are locked in this modal (inputs are disabled) — never resubmit them,
      // or a stray save would silently downgrade a published result back to DRAFT.
      .filter(([enrollmentId, v]) => v.marks !== '' && statusByEnrollment[enrollmentId] !== 'PUBLISHED')
      .map(([enrollmentId, v]) => ({
        enrollmentId,
        marks: Number(v.marks),
        gradeLabel: v.gradeLabel || undefined,
        remarks: v.remarks || undefined,
      }));
    if (entries.length === 0) { toast('Enter at least one mark first.', 'error'); return; }
    setBusy(true);
    try {
      await api.enterMarks({ examSubjectId, entries });
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 780, width: '94%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {grid ? `Enter marks — ${grid.examSubject.examName} · ${grid.examSubject.class} · ${grid.examSubject.subject}` : 'Enter marks'}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <EmptyState title="Couldn't load" sub={err} />}
        {!err && grid === null && <SkeletonRows rows={5} />}

        {grid && grid.rows.length > 0 && grid.rows.every((r) => r.status === 'PUBLISHED') && (
          <div style={{ background: 'var(--panel-bg)', border: '1px solid var(--input-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 }}>
            All marks for this exam are already published and locked. Select a different exam above to enter new marks.
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
            <div style={{ display: 'flex', gap: 10, marginTop: 14, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              <Button type="submit" disabled={busy || publishing}>{busy ? 'Saving…' : 'Save marks'}</Button>
              <Button variant="soft" type="button" onClick={publish} disabled={busy || publishing || publishableCount === 0}>
                {publishing ? 'Publishing…' : `Publish marks${publishableCount ? ` (${publishableCount})` : ''}`}
              </Button>
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
