'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { LeaveRequestDto, LeaveStatus } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red',
};

const TABS: Array<{ key: LeaveStatus | 'ALL'; label: string }> = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Staff queue for student leave requests. Mirrors RegistrationReview: the
 * backend narrows a teacher to the sections they teach, so the same
 * component is safe wherever it's mounted.
 */
export function LeaveReview() {
  const [tab, setTab] = useState<LeaveStatus | 'ALL'>('PENDING');
  const [rows, setRows] = useState<LeaveRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const toast = useToast();

  const load = useCallback(async (status: LeaveStatus | 'ALL') => {
    setRows(null);
    try {
      setRows(await api.leaveForReview(status));
      setError(null);
    } catch (err: unknown) {
      setRows([]);
      setError(errorMessage(err, 'Could not load leave requests.'));
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const decide = async (id: string, status: 'APPROVED' | 'REJECTED', remarks?: string) => {
    setBusyId(id);
    try {
      await api.decideLeave(id, status, remarks);
      toast(status === 'APPROVED' ? 'Leave approved.' : 'Leave rejected.', 'success');
      setRejecting(null);
      setNote('');
      await load(tab);
    } catch (err: unknown) {
      toast(errorMessage(err, 'Could not save that decision.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`chip-tab${tab === t.key ? ' active' : ''}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <EmptyState icon="!" title="Could not load the queue" sub={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="◌"
          title={tab === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
          sub={tab === 'PENDING'
            ? 'No leave requests are waiting for a decision.'
            : 'No leave requests match this filter.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const busy = busyId === r._id;
            return (
              <div
                key={r._id}
                style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,.015)', border: '1px solid var(--hairline)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-1)' }}>
                      {r.studentName}
                      {r.admissionNo && (
                        <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}> · {r.admissionNo}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 3 }}>
                      {fmt(r.fromDate)} – {fmt(r.toDate)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 3 }}>{r.reason}</div>
                    {r.remarks && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>Note: {r.remarks}</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                    {r.status === 'PENDING' && (
                      <>
                        <Button disabled={busy} onClick={() => decide(r._id, 'APPROVED')}>
                          {busy ? '…' : 'Approve'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => { setRejecting(rejecting === r._id ? null : r._id); setNote(''); }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {rejecting === r._id && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className="field-input"
                      style={{ flex: 1, minWidth: 200 }}
                      placeholder="Reason (optional)"
                      value={note}
                      maxLength={500}
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void decide(r._id, 'REJECTED', note.trim() || undefined); }}
                    />
                    <Button disabled={busy} onClick={() => decide(r._id, 'REJECTED', note.trim() || undefined)}>
                      {busy ? 'Saving…' : 'Confirm reject'}
                    </Button>
                    <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
