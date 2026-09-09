'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, DateRangeFilter, EmptyState, FilterBar, Pill, SearchInput, Select,
  SkeletonRows, matchesSearch, useToast, withinDateRange,
} from '@/components/ui';
import { FileOrUrlInput } from '@/components/file-input';
import { api, ApiError, fileHref } from '@/lib/api';
import type { AssignmentDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'maroon'> = {
  HOMEWORK: 'blue', PROJECT: 'maroon', TEST: 'red', QUIZ: 'amber', CLASSWORK: 'green',
};
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PENDING: 'gray', SUBMITTED: 'blue', LATE: 'amber', GRADED: 'green', EXEMPT: 'gray',
};

/**
 * The state a student actually cares about, derived from the submission and
 * the due date together.
 *
 * The stored submission status alone cannot answer "what have I not done?":
 * PENDING means the same thing for work due next week and work that was due a
 * fortnight ago, and only the second is a problem. So:
 *
 *   pending    — nothing handed in yet, and there is still time.
 *   incomplete — nothing handed in and the due date has passed.
 *   completed  — handed in, however late, or excused.
 *   graded     — a mark has been recorded.
 *   nongraded  — handed in and still waiting on the teacher.
 *
 * These overlap on purpose: graded work is also completed work, and the filter
 * is a lens on the same list rather than a partition of it.
 */
type DerivedStatus = 'pending' | 'incomplete' | 'completed' | 'graded' | 'nongraded';

const STATUS_OPTIONS: Array<{ value: '' | DerivedStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'graded', label: 'Graded' },
  { value: 'nongraded', label: 'Non-graded' },
];

function derivedStatuses(a: AssignmentDto, now: Date): Set<DerivedStatus> {
  const out = new Set<DerivedStatus>();
  const status = a.mySubmission?.status ?? 'PENDING';
  const handedIn = status === 'SUBMITTED' || status === 'LATE' || status === 'GRADED';
  const overdue = new Date(a.dueAt) < now;

  if (handedIn || status === 'EXEMPT') out.add('completed');
  if (!handedIn && status !== 'EXEMPT') out.add(overdue ? 'incomplete' : 'pending');
  if (status === 'GRADED') out.add('graded');
  else if (handedIn) out.add('nongraded');

  return out;
}

/** The label under the Status column, so the filter and the row agree. */
function statusLabel(a: AssignmentDto, now: Date): { text: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' } {
  const status = a.mySubmission?.status ?? 'PENDING';
  if (status === 'PENDING') {
    return new Date(a.dueAt) < now
      ? { text: 'Incomplete', tone: 'red' }
      : { text: 'Pending', tone: 'gray' };
  }
  const labels: Record<string, string> = {
    SUBMITTED: 'Completed', LATE: 'Completed (late)', GRADED: 'Graded', EXEMPT: 'Exempt',
  };
  return { text: labels[status] ?? status, tone: STATUS_TONE[status] ?? 'gray' };
}

const emptyFilters = { search: '', subject: '', status: '' as '' | DerivedStatus, dueFrom: '', dueTo: '' };

export default function StudentAssignments() {
  const [assignments, setAssignments] = useState<AssignmentDto[] | null>(null);
  const [submitFor, setSubmitFor] = useState<AssignmentDto | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const toast = useToast();

  const load = () => api.assignments().then(setAssignments).catch(() => setAssignments([]));
  useEffect(() => { void load(); }, []);

  const subjects = useMemo(
    () => [...new Set(assignments?.map((a) => a.subject).filter(Boolean) ?? [])].sort(),
    [assignments],
  );
  const hasFilters = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => {
    if (!assignments) return null;
    const now = new Date();
    return assignments.filter((a) => {
      if (filters.subject && a.subject !== filters.subject) return false;
      if (filters.status && !derivedStatuses(a, now).has(filters.status)) return false;
      // Filtered on the due date, never on when the teacher created the work —
      // "show me what is due this fortnight" is the question being asked.
      if (!withinDateRange(a.dueAt, filters.dueFrom, filters.dueTo)) return false;
      // One box across every column a student might remember the work by.
      return matchesSearch(filters.search, [
        a.title, a.subject, a.teacher, a.chapter, a.type,
        statusLabel(a, now).text,
        a.dueAt ? fmtDate(a.dueAt) : null,
      ]);
    });
  }, [assignments, filters]);

  const now = new Date();
  const upcoming = filtered?.filter((a) => new Date(a.dueAt) >= now) ?? [];
  const past = filtered?.filter((a) => new Date(a.dueAt) < now) ?? [];

  const statusCell = (a: AssignmentDto) => {
    const label = statusLabel(a, now);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill tone={label.tone}>{label.text}</Pill>
        {a.mySubmission?.status === 'GRADED' && a.mySubmission?.marks != null && (
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
        <thead><tr><th>Subject</th><th>Title</th><th>Teacher</th><th>Chapter</th><th>Type</th><th>{dueLabel}</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} style={dim ? { opacity: 0.75 } : undefined}>
              <td style={{ color: 'var(--text-faint)' }} data-label="Subject">{a.subject}</td>
              <td className="cell-primary" data-label="Title">
                {a.title}
                {a.attachments.length > 0 && (
                  <a href={fileHref(a.attachments[0])} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                    📎 Material
                  </a>
                )}
              </td>
              <td data-label="Teacher">{a.teacher || '—'}</td>
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
        <>
          <FilterBar
            actions={hasFilters
              ? <Button variant="ghost" small onClick={() => setFilters(emptyFilters)}>Clear filters</Button>
              : undefined}
          >
            <SearchInput
              label="Search"
              value={filters.search}
              onChange={(search) => setFilters((f) => ({ ...f, search }))}
              placeholder="Title, subject, teacher, status…"
            />
            <Select
              label="Subject"
              value={filters.subject}
              placeholder="All subjects"
              onChange={(subject) => setFilters((f) => ({ ...f, subject }))}
              options={subjects.map((s) => ({ value: s, label: s }))}
            />
            <Select
              label="Status"
              value={filters.status}
              onChange={(status) => setFilters((f) => ({ ...f, status: status as '' | DerivedStatus }))}
              options={STATUS_OPTIONS.filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All statuses"
            />
            <DateRangeFilter
              label="Due date"
              from={filters.dueFrom}
              to={filters.dueTo}
              onChange={({ from, to }) => setFilters((f) => ({ ...f, dueFrom: from, dueTo: to }))}
            />
          </FilterBar>

          {filtered && (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 }}>
              Showing {filtered.length} of {assignments.length} assignment{assignments.length === 1 ? '' : 's'}
            </div>
          )}
        </>
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
  // A file upload sets fileUrl to the stored path; "paste a link" sets it to
  // the typed URL. Either counts as work; whitespace does not.
  const canSubmit = file.fileUrl.trim() !== '';

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
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Submit — {assignment.title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 12 }}>
            {assignment.subject} · due {fmtDate(assignment.dueAt)}
            {late && <span style={{ color: 'var(--red)', fontWeight: 700 }}> — past due; this will be marked LATE</span>}
          </div>

          <div className="field-label">Attach your work</div>
          <FileOrUrlInput value={file} onChange={setFile} required />

          {!canSubmit && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-2b)' }}>
              Upload a file or paste a link to enable submitting.
            </div>
          )}

          {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#991b1b' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy || !canSubmit}>{busy ? 'Submitting…' : 'Submit work'}</Button>
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
