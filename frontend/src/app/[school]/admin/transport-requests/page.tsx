'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, Select, SkeletonRows, rupees, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { RequestStatus, TransportRequestDto } from '@/lib/types';

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
 * The office's queue of requests for a place on a bus route.
 *
 * Approving does two things at once — it puts the student on the route, and
 * where the route carries a fare it raises the invoice for it against their
 * fees. The button and the confirmation both say so, because an approval that
 * silently bills a family would be the wrong kind of surprise.
 */
export default function AdminTransportRequests() {
  const [rows, setRows] = useState<TransportRequestDto[] | null>(null);
  const [status, setStatus] = useState<RequestStatus | 'ALL'>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setRows(null);
    try {
      const page = await api.transportRequestsForReview(status);
      setRows(Array.isArray(page) ? page : (page.items ?? []));
    } catch {
      setRows([]);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(request: TransportRequestDto, next: 'APPROVED' | 'REJECTED') {
    if (next === 'APPROVED' && request.fareAmountPaise > 0) {
      const ok = window.confirm(
        `Grant ${request.studentName ?? 'this student'} a place on ${request.routeName}?\n\n`
        + `${rupees(request.fareAmountPaise)} will be added to their fees as an invoice.`,
      );
      if (!ok) return;
    }
    const note = next === 'REJECTED'
      ? (window.prompt('Why is this being refused? The student is shown this.') ?? '')
      : '';
    if (next === 'REJECTED' && !note.trim()) return;

    setBusy(request.id);
    try {
      const result = await api.decideTransportRequest(request.id, next, note || undefined);
      toast(
        next === 'APPROVED'
          ? `Place granted on ${result.routeName}.${result.invoiceId ? ` ${rupees(result.fareAmountPaise)} added to their fees.` : ''}`
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
      expectedSlug="admin"
      topbar={{ title: 'Transport Requests', desc: 'Students asking for a place. Approving grants it and bills the fare.' }}
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
          sub={status === 'PENDING' ? 'No student is waiting on a bus place.' : 'No requests match that filter.'}
        />
      )}

      {rows !== null && rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Student</th><th>Route &amp; stop</th><th>Fare</th><th>Status</th><th>Decision</th></tr>
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
                  <td data-label="Route &amp; stop">
                    {r.routeName}
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      {r.stopName} · {r.direction === 'BOTH' ? 'both ways' : r.direction.toLowerCase()}
                    </div>
                  </td>
                  <td data-label="Fare">
                    {r.fareAmountPaise > 0 ? rupees(r.fareAmountPaise) : <span style={{ color: 'var(--text-faint)' }}>no charge</span>}
                    {r.invoiceId && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>invoiced</div>
                    )}
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
                        <Button onClick={() => void decide(r, 'APPROVED')} disabled={busy === r.id}>
                          Approve
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
