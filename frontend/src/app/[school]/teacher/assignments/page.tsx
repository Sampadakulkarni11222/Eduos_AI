'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, DateField, EmptyState, Pill, SkeletonRows, divisionLabel, useToast } from '@/components/ui';
import { api, ApiError, fileHref, fileNameOf } from '@/lib/api';
import type { AssignmentDto, OfferingDto, SubmissionRoster, SubmissionRow } from '@/lib/types';

const SUB_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PENDING: 'gray', SUBMITTED: 'blue', LATE: 'amber', GRADED: 'green', EXEMPT: 'gray',
};

const emptyFilters = { sectionId: '', subject: '', chapter: '', dateFrom: '', dateTo: '' };
const CHAPTER_OPTIONS = Array.from({ length: 20 }, (_, i) => `Chapter ${i + 1}`);

export default function AssignmentsPage() {
  const [items, setItems] = useState<AssignmentDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyFilters);

  const reload = () => api.assignments().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); api.myOfferings().then(setOfferings).catch(() => {}); }, []);

  // One combined "class" option per section — labeled with its grade so same-named sections across grades stay distinguishable.
  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    items?.forEach((a) => {
      if (a.sectionId && a.sectionName) seen.set(a.sectionId, a.class || (a.gradeName ? `${a.gradeName} - ${a.sectionName}` : a.sectionName));
    });
    return [...seen.entries()];
  }, [items]);
  const subjects = useMemo(() => [...new Set(items?.map((a) => a.subject) ?? [])].sort(), [items]);
  // Fixed Chapter 1..20 list, plus any legacy free-text chapter values already in use.
  const chapters = useMemo(() => {
    const extra = (items ?? []).map((a) => a.chapter).filter((c): c is string => !!c && !CHAPTER_OPTIONS.includes(c));
    return [...CHAPTER_OPTIONS, ...new Set(extra)];
  }, [items]);

  const filtered = useMemo(() => items?.filter((a) => {
    if (filters.sectionId && a.sectionId !== filters.sectionId) return false;
    if (filters.subject && a.subject !== filters.subject) return false;
    if (filters.chapter && a.chapter !== filters.chapter) return false;
    if (filters.dateFrom && new Date(a.dueAt) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo && new Date(a.dueAt) > new Date(`${filters.dateTo}T23:59:59`)) return false;
    return true;
  }) ?? null, [items, filters]);

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Assignments', desc: 'Homework, projects and worksheets for your classes.',
      actions: <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New assignment'}</Button>,
    }}>
      {showForm && <NewAssignment offerings={offerings} onCreated={() => { setShowForm(false); void reload(); }} />}

      {items && items.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={filters.sectionId} onChange={(e) => setFilters((f) => ({ ...f, sectionId: e.target.value }))} aria-label="Class">
            <option value="">All classes</option>
            {classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="input" value={filters.subject} onChange={(e) => setFilters((f) => ({ ...f, subject: e.target.value }))} aria-label="Subject">
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={filters.chapter} onChange={(e) => setFilters((f) => ({ ...f, chapter: e.target.value }))} aria-label="Chapter">
            <option value="">All chapters</option>
            {chapters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <DateField className="date-field-inline" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))} ariaLabel="Due from" />
          <DateField className="date-field-inline" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))} ariaLabel="Due to" />
          {hasFilters && <Button variant="ghost" small onClick={() => setFilters(emptyFilters)}>Clear filters</Button>}
        </div>
      )}

      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && <EmptyState title="No assignments yet" sub="Create your first assignment — students can submit from their portal." />}
      {filtered && filtered.length === 0 && items && items.length > 0 && (
        <EmptyState title="No matching assignments" sub="Try widening or clearing your filters." />
      )}
      {filtered && filtered.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Chapter</th><th>Due</th><th>Type</th><th>Submitted</th><th></th></tr></thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td className="cell-primary" data-label="Title">
                    {a.title}
                    {a.attachments.length > 0 && (
                      <a href={fileHref(a.attachments[0])} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                        📎
                      </a>
                    )}
                  </td>
                  <td data-label="Class">{a.class}</td>
                  <td data-label="Subject">{a.subject}</td>
                  <td data-label="Chapter">{a.chapter || '—'}</td>
                  <td data-label="Due">{fmtDue(a.dueAt)}</td>
                  <td data-label="Type"><Pill tone="blue">{a.type.toLowerCase()}</Pill></td>
                  <td data-label="Submitted">{a.submissionCount}</td>
                  <td data-label="Actions">
                    <Button variant="soft" small onClick={() => setOpenId(a.id)}>Submissions</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {openId && (
        <SubmissionsModal
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onGraded={() => void reload()}
        />
      )}
    </PortalShell>
  );
}

function SubmissionsModal({ assignmentId, onClose, onGraded }: { assignmentId: string; onClose: () => void; onGraded: () => void }) {
  const [roster, setRoster] = useState<SubmissionRoster | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grading, setGrading] = useState<SubmissionRow | null>(null);
  const toast = useToast();

  const load = () => {
    api.assignmentSubmissions(assignmentId)
      .then((r) => { setRoster(r); setErr(null); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load submissions.'));
  };
  useEffect(load, [assignmentId]);

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, width: '94%' }}>
        <div className="modal-header">
          <div className="modal-title">
            {roster ? `Submissions — ${roster.assignment.title}` : 'Submissions'}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <EmptyState title="Couldn't load" sub={err} />}
        {!err && roster === null && <SkeletonRows rows={5} />}

        {roster && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table className="data-table data-table-cards">
              <thead><tr><th>Roll</th><th>Student</th><th>Status</th><th>Submitted</th><th>Work</th><th>Marks</th><th></th></tr></thead>
              <tbody>
                {roster.rows.map((r) => (
                  <tr key={r.enrollmentId}>
                    <td data-label="Roll">{r.rollNo ?? '—'}</td>
                    <td className="cell-primary" data-label="Student">{r.studentName}</td>
                    <td data-label="Status"><Pill tone={SUB_TONE[r.status] ?? 'gray'}>{r.status.toLowerCase()}</Pill></td>
                    <td style={{ fontSize: 12.5 }} data-label="Submitted">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                    <td data-label="Work">
                      {r.attachments.length > 0
                        ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {r.attachments.map((att, i) => (
                              <a key={att} href={fileHref(att)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>
                                Open{r.attachments.length > 1 ? ` (${i + 1})` : ''}
                              </a>
                            ))}
                          </div>
                        )
                        : <span style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>Not submitted</span>}
                    </td>
                    <td data-label="Marks">{r.marks != null ? `${r.marks}${roster.assignment.maxMarks ? `/${roster.assignment.maxMarks}` : ''}` : '—'}</td>
                    <td data-label="Actions">
                      {(r.status === 'SUBMITTED' || r.status === 'LATE' || r.status === 'GRADED') && (
                        <Button variant="soft" small onClick={() => setGrading(r)}>
                          {r.status === 'GRADED' ? 'Regrade' : 'Grade'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {roster && grading && (
          <GradeForm
            maxMarks={roster.assignment.maxMarks}
            row={grading}
            onCancel={() => setGrading(null)}
            onSave={async (marks, feedback) => {
              try {
                await api.gradeSubmission({ assignmentId, enrollmentId: grading.enrollmentId, marks, feedback });
                toast(`Graded ${grading.studentName}.`);
                setGrading(null);
                load();
                onGraded();
              } catch (e) {
                toast(e instanceof ApiError ? e.message : 'Could not save the grade.', 'error');
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function GradeForm({ row, maxMarks, onSave, onCancel }: {
  row: SubmissionRow;
  maxMarks: number | null;
  onSave: (marks: number, feedback?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [marks, setMarks] = useState(row.marks != null ? String(row.marks) : '');
  const [feedback, setFeedback] = useState(row.feedback ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onSave(Number(marks), feedback || undefined);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--hairline)', marginTop: 12, paddingTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Grade — {row.studentName}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
        <div>
          <div className="field-label">Marks{maxMarks ? ` (of ${maxMarks})` : ''}</div>
          <input className="field-input" type="number" required min={0} max={maxMarks ?? undefined} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} />
        </div>
        <div>
          <div className="field-label">Feedback (optional)</div>
          <input className="field-input" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Good work — revise Q4" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <Button type="submit" small disabled={busy || marks === ''}>{busy ? 'Saving…' : 'Save grade'}</Button>
        <Button variant="ghost" small type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function NewAssignment({ offerings, onCreated }: { offerings: OfferingDto[]; onCreated: () => void }) {
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('HOMEWORK');
  const [chapter, setChapter] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [maxMarks, setMaxMarks] = useState('20');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!offeringId && offerings[0]) setOfferingId(offerings[0].id); }, [offerings, offeringId]);

  const addFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const uploaded = await api.uploadFile(file);
      setAttachments((prev) => [...prev, uploaded.fileUrl]);
    } catch { setErr('Could not upload the file. Please try again.'); } finally { setUploading(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.createAssignment({
        subjectOfferingId: offeringId, title, type, chapter: chapter || undefined,
        dueAt: new Date(dueAt).toISOString(), maxMarks: maxMarks ? parseInt(maxMarks, 10) : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      onCreated();
    } catch { setErr('Could not create. Check the fields and try again.'); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.7fr', gap: 12 }}>
          <div>
            <div className="field-label">Title</div>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Algebra worksheet" />
          </div>
          <div>
            <div className="field-label">Class &amp; subject</div>
            <select className="field-input" value={offeringId} onChange={(e) => setOfferingId(e.target.value)} required>
              {offerings.map((o) => <option key={o.id} value={o.id}>{divisionLabel(o.gradeName, o.sectionName)} · {o.subject}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Due</div>
            <input className="field-input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
          </div>
          <div>
            <div className="field-label">Max marks</div>
            <input className="field-input" type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="field-label">Chapter (optional)</div>
          <select className="field-input" value={chapter} onChange={(e) => setChapter(e.target.value)}>
            <option value="">No chapter</option>
            {CHAPTER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="field-label">Attach a worksheet or document (optional)</div>
          <input
            className="field-input"
            type="file"
            disabled={uploading}
            onChange={(e) => { void addFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          {uploading && <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4 }}>Uploading…</p>}
          {attachments.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
              {attachments.map((a, i) => (
                <li key={a} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {fileNameOf(a)}
                  <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: 'var(--red, #b52a2a)', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy || !offeringId || uploading} style={{ marginTop: 12 }}>{busy ? 'Creating…' : 'Create assignment'}</Button>
      </form>
    </Card>
  );
}

function fmtDue(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}
