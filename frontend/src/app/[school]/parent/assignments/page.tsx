'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, DateField, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AssignmentDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'maroon'> = {
  HOMEWORK: 'blue', PROJECT: 'maroon', TEST: 'red', QUIZ: 'amber', CLASSWORK: 'green',
};
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PENDING: 'gray', SUBMITTED: 'blue', LATE: 'amber', GRADED: 'green', EXEMPT: 'gray',
};

function StatusCell({ a }: { a: AssignmentDto }) {
  const s = a.mySubmission?.status ?? 'PENDING';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Pill tone={STATUS_TONE[s] ?? 'gray'}>{s.toLowerCase()}</Pill>
      {s === 'GRADED' && a.mySubmission?.marks != null && (
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{a.mySubmission.marks}{a.maxMarks ? `/${a.maxMarks}` : ''}</span>
      )}
    </div>
  );
}

const emptyFilters = { subject: '', chapter: '', dateFrom: '', dateTo: '' };

export default function ParentAssignments() {
  const [assignments, setAssignments] = useState<AssignmentDto[] | null>(null);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    api.assignments().then(setAssignments).catch(() => setAssignments([]));
  }, []);

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

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Assignments', desc: "Your child's assignments and homework." }}>
      {assignments && assignments.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={filters.subject} onChange={(e) => setFilters((f) => ({ ...f, subject: e.target.value }))} aria-label="Subject">
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" placeholder="Chapter…" value={filters.chapter} onChange={(e) => setFilters((f) => ({ ...f, chapter: e.target.value }))} aria-label="Chapter" style={{ width: 140 }} />
          <DateField className="date-field-inline" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))} ariaLabel="Due from" />
          <DateField className="date-field-inline" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))} ariaLabel="Due to" />
          {hasFilters && <Button variant="ghost" small onClick={() => setFilters(emptyFilters)}>Clear filters</Button>}
        </div>
      )}

      {assignments === null && <Card><SkeletonRows rows={5} /></Card>}
      {assignments?.length === 0 && <EmptyState title="No assignments" sub="Assignments posted by teachers appear here." />}
      {assignments && assignments.length > 0 && filtered?.length === 0 && (
        <EmptyState title="No matching assignments" sub="Try widening or clearing your filters." />
      )}

      {filtered && filtered.length > 0 && (
        <>
          {upcoming.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Upcoming</div>
              <Card pad={false} style={{ marginBottom: 20 }}>
                <table className="data-table data-table-cards">
                  <thead><tr><th>Subject</th><th>Title</th><th>Chapter</th><th>Type</th><th>Due</th><th>Class</th><th>Status</th></tr></thead>
                  <tbody>
                    {upcoming.map((a) => (
                      <tr key={a.id}>
                        <td style={{ color: 'var(--text-faint)' }} data-label="Subject">{a.subject}</td>
                        <td className="cell-primary" data-label="Title">{a.title}</td>
                        <td data-label="Chapter">{a.chapter || '—'}</td>
                        <td data-label="Type"><Pill tone={TYPE_TONE[a.type] ?? 'gray'}>{a.type.toLowerCase()}</Pill></td>
                        <td style={{ color: isOverdue(a.dueAt) ? 'var(--red)' : 'var(--text-2)' }} data-label="Due">{fmtDate(a.dueAt)}</td>
                        <td data-label="Class">{a.class}</td>
                        <td data-label="Status"><StatusCell a={a} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
          {past.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Past</div>
              <Card pad={false}>
                <table className="data-table data-table-cards">
                  <thead><tr><th>Subject</th><th>Title</th><th>Chapter</th><th>Type</th><th>Was Due</th><th>Class</th><th>Status</th></tr></thead>
                  <tbody>
                    {past.map((a) => (
                      <tr key={a.id} style={{ opacity: 0.7 }}>
                        <td style={{ color: 'var(--text-faint)' }} data-label="Subject">{a.subject}</td>
                        <td className="cell-primary" data-label="Title">{a.title}</td>
                        <td data-label="Chapter">{a.chapter || '—'}</td>
                        <td data-label="Type"><Pill tone={TYPE_TONE[a.type] ?? 'gray'}>{a.type.toLowerCase()}</Pill></td>
                        <td data-label="Was Due">{fmtDate(a.dueAt)}</td>
                        <td data-label="Class">{a.class}</td>
                        <td data-label="Status"><StatusCell a={a} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}
    </PortalShell>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function isOverdue(iso: string) {
  return new Date(iso) < new Date();
}
