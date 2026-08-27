'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { RegistrationStatus, SubjectRegistrationDto } from '@/lib/types';

const STATUS_TONE: Record<RegistrationStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'gray',
};

const TABS: Array<{ key: RegistrationStatus | 'ALL'; label: string }> = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Staff queue for elective registration requests. Mounted in both the admin and
 * teacher portals; the backend narrows a teacher to their own sections, so the
 * same component is safe in both places without a role check here.
 */
export function RegistrationReview() {
  const [tab, setTab] = useState<RegistrationStatus | 'ALL'>('PENDING');
  const [rows, setRows] = useState<SubjectRegistrationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Rejection asks for a reason, so the row expands into a note field rather
  // than rejecting silently — the student sees this text on their catalogue.
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const toast = useToast();

  const load = useCallback(async (status: RegistrationStatus | 'ALL') => {
    setRows(null);
    try {
      setRows(await api.registrationsForReview(status));
      setError(null);
    } catch (err: unknown) {
      setRows([]);
      setError(errorMessage(err, 'Could not load registrations.'));
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const decide = async (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => {
    setBusyId(id);
    try {
      await api.decideRegistration(id, status, reason);
      toast(status === 'APPROVED' ? 'Registration approved.' : 'Registration rejected.', 'success');
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
            ? 'No elective registrations are waiting for a decision.'
            : 'No registrations match this filter.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const busy = busyId === r.id;
            return (
              <div
                key={r.id}
                style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,.015)', border: '1px solid var(--hairline)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-1)' }}>
                      {r.studentName ?? 'Unknown student'}
                      {r.admissionNo && (
                        <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}> · {r.admissionNo}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 3 }}>
                      wants <strong>{r.subjectName ?? 'a removed subject'}</strong>
                      {r.termName ? ` · ${r.termName}` : ''}
                      {r.teacherName ? ` · ${r.teacherName}` : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                      Requested {fmt(r.requestedAt)}
                      {r.decidedAt && r.decidedBy ? ` · decided by ${r.decidedBy} on ${fmt(r.decidedAt)}` : ''}
                    </div>
                    {r.decisionNote && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                        Note: {r.decisionNote}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                    {r.status === 'PENDING' && (
                      <>
                        <Button disabled={busy} onClick={() => decide(r.id, 'APPROVED')}>
                          {busy ? '…' : 'Approve'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setNote(''); }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {rejecting === r.id && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className="field-input"
                      style={{ flex: 1, minWidth: 200 }}
                      placeholder="Reason (shown to the student, optional)"
                      value={note}
                      maxLength={500}
                      // The note field is revealed by pressing Reject, so focus
                      // belongs here.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void decide(r.id, 'REJECTED', note.trim() || undefined); }}
                    />
                    <Button disabled={busy} onClick={() => decide(r.id, 'REJECTED', note.trim() || undefined)}>
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
