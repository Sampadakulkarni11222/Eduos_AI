'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { FileOrUrlInput } from '@/components/file-input';
import { api, ApiError, fileHref } from '@/lib/api';
import type { AssignmentDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'maroon'> = {
  HOMEWORK: 'blue', PROJECT: 'maroon', TEST: 'red', QUIZ: 'amber', CLASSWORK: 'green',
};
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PENDING: 'gray', SUBMITTED: 'blue', LATE: 'amber', GRADED: 'green', EXEMPT: 'gray',
};

const emptyFilters = { subject: '', chapter: '', dateFrom: '', dateTo: '' };

export default function StudentAssignments() {
  const [assignments, setAssignments] = useState<AssignmentDto[] | null>(null);
  const [submitFor, setSubmitFor] = useState<AssignmentDto | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const toast = useToast();

  const load = () => api.assignments().then(setAssignments).catch(() => setAssignments([]));
  useEffect(() => { void load(); }, []);

  const subjects = useMemo(() => [...new Set(assignments?.map((a) => a.subject) ?? [])].sort(), [assignments]);
  const hasFilters = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => assignments?.filter((a) => {
    if (filters.subject && a.subject !== filters.subject) return false;
    if (filters.chapter && !(a.chapter ?? '').toLowerCase().includes(filters.chapter.toLowerCase())) return false;
    if (filters.dateFrom && new Date(a.dueAt) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo && new Date(a.dueAt) > new Date(`${filters.dateTo}T23:59:59`)) return false;
    return true;
  }) ?? null, [assignments, filters]);

  const now = new Date();
  const upcoming = filtered?.filter((a) => new Date(a.dueAt) >= now) ?? [];
  const past = filtered?.filter((a) => new Date(a.dueAt) < now) ?? [];

  const statusCell = (a: AssignmentDto) => {
    const s = a.mySubmission?.status ?? 'PENDING';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill tone={STATUS_TONE[s] ?? 'gray'}>{s.toLowerCase()}</Pill>
        {s === 'GRADED' && a.mySubmission?.marks != null && (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
            {a.mySubmission.marks}{a.maxMarks ? `/${a.maxMarks}` : ''}
          </span>
        )}
      </div>
    );
  };

  const actionCell = (a: AssignmentDto) => {
    const s = a.mySubmission?.status ?? 'PENDING';
    if (s === 'GRADED') {
      return a.mySubmission?.feedback
        ? <span style={{ fontSize: 12, color: 'var(--text-2b)' }} title={a.mySubmission.feedback}>“{a.mySubmission.feedback.slice(0, 40)}{a.mySubmission.feedback.length > 40 ? '…' : ''}”</span>
        : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Graded</span>;
    }
    if (s === 'SUBMITTED' || s === 'LATE') {
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {a.mySubmission?.attachments?.[0] && (
            <a href={fileHref(a.mySubmission.attachments[0])} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>View work</a>
          )}
          <Button variant="soft" small onClick={() => setSubmitFor(a)}>Resubmit</Button>
        </div>
      );
    }
    return <Button small onClick={() => setSubmitFor(a)}>Submit</Button>;
  };

  const table = (rows: AssignmentDto[], dueLabel: string, dim = false) => (
    <Card pad={false} style={{ marginBottom: 20 }}>
      <table className="data-table data-table-cards">
        <thead><tr><th>Subject</th><th>Title</th><th>Chapter</th><th>Type</th><th>{dueLabel}</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} style={dim ? { opacity: 0.75 } : undefined}>
              <td style={{ color: 'var(--text-faint)' }} data-label="Subject">{a.subject}</td>
              <td className="cell-primary" data-label="Title">{a.title}</td>
              <td data-label="Chapter">{a.chapter || '—'}</td>
              <td data-label="Type"><Pill tone={TYPE_TONE[a.type] ?? 'gray'}>{a.type.toLowerCase()}</Pill></td>
              <td style={{ color: !dim && isOverdue(a.dueAt) ? 'var(--red)' : 'var(--text-2)' }} data-label={dueLabel}>{fmtDate(a.dueAt)}</td>
              <td data-label="Status">{statusCell(a)}</td>
              <td data-label="Action">{actionCell(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Assignments', desc: 'Your homework — submit your work before the due date.' }}>
      {assignments && assignments.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={filters.subject} onChange={(e) => setFilters((f) => ({ ...f, subject: e.target.value }))} aria-label="Subject">
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" placeholder="Chapter…" value={filters.chapter} onChange={(e) => setFilters((f) => ({ ...f, chapter: e.target.value }))} aria-label="Chapter" style={{ width: 140 }} />
          <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} aria-label="Due from" title="Due from" />
          <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} aria-label="Due to" title="Due to" />
          {hasFilters && <Button variant="ghost" small onClick={() => setFilters(emptyFilters)}>Clear filters</Button>}
        </div>
      )}

      {assignments === null && <Card><SkeletonRows rows={5} /></Card>}
      {assignments?.length === 0 && <EmptyState title="No assignments" sub="You are all caught up! Assignments posted by your teachers will appear here." />}
      {assignments && assignments.length > 0 && filtered?.length === 0 && (
        <EmptyState title="No matching assignments" sub="Try widening or clearing your filters." />
      )}

      {filtered && filtered.length > 0 && (
        <>
          {upcoming.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Upcoming</div>
              {table(upcoming, 'Due')}
            </>
          )}
          {past.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Past</div>
              {table(past, 'Was Due', true)}
            </>
          )}
        </>
      )}

      {submitFor && (
        <SubmitModal
          assignment={submitFor}
          onClose={() => setSubmitFor(null)}
          onDone={() => {
            setSubmitFor(null);
            toast('Work submitted successfully.');
            void load();
          }}
        />
      )}
    </PortalShell>
  );
}

function SubmitModal({ assignment, onClose, onDone }: { assignment: AssignmentDto; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ fileUrl: string; mimeType?: string }>({ fileUrl: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const late = isOverdue(assignment.dueAt);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.submitAssignment({
        assignmentId: assignment.id,
        attachments: file.fileUrl ? [file.fileUrl] : [],
      });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not submit. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Submit — {assignment.title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 12 }}>
            {assignment.subject} · due {fmtDate(assignment.dueAt)}
            {late && <span style={{ color: 'var(--red)', fontWeight: 700 }}> — past due; this will be marked LATE</span>}
          </div>

          <div className="field-label">Attach your work <span style={{ color: 'var(--red)' }}>*</span></div>
          <FileOrUrlInput value={file} onChange={setFile} />

          {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#991b1b' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy || !file.fileUrl.trim()}>{busy ? 'Submitting…' : 'Submit work'}</Button>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function isOverdue(iso: string) {
  return new Date(iso) < new Date();
}
