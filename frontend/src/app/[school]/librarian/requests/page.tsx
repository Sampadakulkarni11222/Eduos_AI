'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, Select, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { BookRequestDto, RequestStatus } from '@/lib/types';

const TONE: Record<RequestStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

const FILTERS = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Withdrawn' },
  { value: 'ALL', label: 'All' },
];

/**
 * The librarian's queue of book requests.
 *
 * Approving here is not a status change — it issues the book, takes a copy off
 * the shelf and tells the student. That is why the button says so, and why a
 * title with no copy free is refused by the server rather than quietly marked
 * approved with no book behind it.
 */
export default function LibrarianBookRequests() {
  const [rows, setRows] = useState<BookRequestDto[] | null>(null);
  const [status, setStatus] = useState<RequestStatus | 'ALL'>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setRows(null);
    try {
      const page = await api.bookRequestsForReview(status);
      // The list endpoint pages; older screens in this app receive a bare
      // array, so both shapes are accepted rather than assumed.
      setRows(Array.isArray(page) ? page : (page.items ?? []));
    } catch {
      setRows([]);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(request: BookRequestDto, next: 'APPROVED' | 'REJECTED') {
    const note = next === 'REJECTED'
      ? (window.prompt('Why is this being refused? The student is shown this.') ?? '')
      : '';
    if (next === 'REJECTED' && !note.trim()) return;

    setBusy(request.id);
    try {
      await api.decideBookRequest(request.id, next, note || undefined);
      toast(
        next === 'APPROVED'
          ? `"${request.bookTitle}" has been issued to ${request.studentName ?? 'the student'}.`
          : 'The request has been refused and the student told why.',
        'success',
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not record that decision', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PortalShell
      expectedSlug="librarian"
      topbar={{ title: 'Book Requests', desc: 'Students asking for a copy. Approving issues the book.' }}
    >
      <Card style={{ marginBottom: 16 }}>
        <Select
          label="Show"
          value={status}
          onChange={(v) => setStatus(v as RequestStatus | 'ALL')}
          options={FILTERS}
        />
      </Card>

      {rows === null && <Card><SkeletonRows rows={4} /></Card>}

      {rows !== null && rows.length === 0 && (
        <EmptyState
          title={status === 'PENDING' ? 'Nothing waiting' : 'Nothing to show'}
          sub={status === 'PENDING' ? 'No student is waiting on a book.' : 'No requests match that filter.'}
        />
      )}

      {rows !== null && rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Student</th><th>Book</th><th>Copies</th><th>Status</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Student">
                    {r.studentName ?? '—'}
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      {r.admissionNo ?? '—'} · asked {new Date(r.requestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </td>
                  <td data-label="Book">
                    {r.bookTitle}
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.bookAuthor}</div>
                  </td>
                  <td data-label="Copies">
                    <Pill tone={(r.availableCopies ?? 0) > 0 ? 'green' : 'red'}>
                      {(r.availableCopies ?? 0) > 0 ? `${r.availableCopies} free` : 'none free'}
                    </Pill>
                  </td>
                  <td data-label="Status">
                    <Pill tone={TONE[r.status]}>{r.status.toLowerCase()}</Pill>
                    {r.decisionNote && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3 }}>{r.decisionNote}</div>
                    )}
                  </td>
                  <td data-label="Decision">
                    {r.status === 'PENDING' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          onClick={() => void decide(r, 'APPROVED')}
                          disabled={busy === r.id || (r.availableCopies ?? 0) < 1}
                          title={(r.availableCopies ?? 0) < 1 ? 'No copy is free to issue' : 'Issues the book to this student'}
                        >
                          Approve &amp; issue
                        </Button>
                        <Button onClick={() => void decide(r, 'REJECTED')} disabled={busy === r.id}>
                          Refuse
                        </Button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {r.decidedBy ? `by ${r.decidedBy}` : '—'}
                      </span>
                    )}
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
