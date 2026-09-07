'use client';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '../ui';
import { api, errorMessage, fileHref } from '@/lib/api';
import type { CoCurricularActivityDto, ProfileEditRequestDto, StudentRequestStatus } from '@/lib/types';
import { categoryLabel, levelLabel } from '../student/cocurricular-panel';

const STATUS_TONE: Record<StudentRequestStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red',
};

const TABS: Array<{ key: StudentRequestStatus | 'ALL'; label: string }> = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

interface ReviewRow {
  id: string;
  studentName: string | null;
  admissionNo: string | null;
  class?: string | null;
  status: StudentRequestStatus;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  documentUrl: string | null;
  documentName: string | null;
}

/**
 * The class teacher's decision queue, shared by both kinds of student request.
 *
 * Which requests appear is decided entirely by the server: `cocurricular.review`
 * and `profile.edit.review` at OWN scope resolve to the sections the signed-in
 * teacher is the *class teacher* of, not merely teaches in. So this component
 * carries no role check of its own and cannot be pointed at another teacher's
 * students.
 *
 * Rejection requires a reason. It is not a nicety: without one a student is
 * told no with no idea whether to correct something and resubmit or let it go,
 * and the server refuses a rejection that carries no reason for exactly that
 * reason.
 */
function ReviewQueue<T extends ReviewRow>({
  emptyTitle,
  emptySub,
  load,
  decide,
  renderDetail,
}: {
  emptyTitle: string;
  emptySub: string;
  load: (status: StudentRequestStatus | 'ALL') => Promise<T[]>;
  decide: (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => Promise<unknown>;
  renderDetail: (row: T) => ReactNode;
}) {
  const [tab, setTab] = useState<StudentRequestStatus | 'ALL'>('PENDING');
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

  const refresh = useCallback(async (status: StudentRequestStatus | 'ALL') => {
    setRows(null);
    try {
      setRows(await load(status));
      setError(null);
    } catch (err: unknown) {
      setRows([]);
      setError(errorMessage(err, 'Could not load the queue.'));
    }
  }, [load]);

  useEffect(() => { void refresh(tab); }, [tab, refresh]);

  const apply = async (id: string, status: 'APPROVED' | 'REJECTED', why?: string) => {
    if (status === 'REJECTED' && !why?.trim()) {
      toast('Give a reason so the student knows what to do next.', 'error');
      return;
    }
    setBusyId(id);
    try {
      await decide(id, status, why?.trim() || undefined);
      toast(status === 'APPROVED' ? 'Approved.' : 'Rejected.', 'success');
      setRejecting(null);
      setReason('');
      await refresh(tab);
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
        <EmptyState icon="◌" title={tab === 'PENDING' ? emptyTitle : 'Nothing here'} sub={tab === 'PENDING' ? emptySub : 'No requests match this filter.'} />
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
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-1)' }}>
                      {r.studentName ?? 'Unknown student'}
                      {r.admissionNo && <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}> · {r.admissionNo}</span>}
                      {r.class && <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}> · {r.class}</span>}
                    </div>

                    <div style={{ marginTop: 5 }}>{renderDetail(r)}</div>

                    {r.documentUrl && (
                      <a
                        href={fileHref(r.documentUrl)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}
                      >
                        🗎 {r.documentName ?? 'Supporting document'}
                      </a>
                    )}

                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 5 }}>
                      Requested {fmt(r.requestedAt)}
                      {r.reviewedAt && r.reviewedBy ? ` · decided by ${r.reviewedBy} on ${fmt(r.reviewedAt)}` : ''}
                    </div>
                    {r.rejectionReason && (
                      <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>
                        Reason: {r.rejectionReason}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                    {r.status === 'PENDING' && (
                      <>
                        <Button disabled={busy} onClick={() => apply(r.id, 'APPROVED')}>
                          {busy ? '…' : 'Approve'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setReason(''); }}
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
                      style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
                      placeholder="Reason (required — the student sees this)"
                      value={reason}
                      maxLength={500}
                      // Revealed by pressing Reject, so focus belongs here.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      onChange={(e) => setReason(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void apply(r.id, 'REJECTED', reason); }}
                    />
                    <Button disabled={busy || !reason.trim()} onClick={() => apply(r.id, 'REJECTED', reason)}>
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

/** Co-curricular achievements a student has asked to have added. */
export function CoCurricularReview() {
  return (
    <ReviewQueue<CoCurricularActivityDto>
      emptyTitle="Nothing waiting"
      emptySub="No co-curricular requests are waiting for a decision."
      load={(status) => api.coCurricularForReview(status)}
      decide={(id, status, reason) => api.decideCoCurricular(id, status, reason)}
      renderDetail={(r) => (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{r.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 2 }}>
            {categoryLabel(r.category)} · {levelLabel(r.level)} · {fmt(r.activityDate)}
            {r.achievement ? ` · ${r.achievement}` : ''}
          </div>
          {r.description && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{r.description}</div>
          )}
        </>
      )}
    />
  );
}

/** Profile corrections a student has asked for, shown as an old → new diff. */
export function ProfileEditReview() {
  return (
    <ReviewQueue<ProfileEditRequestDto>
      emptyTitle="Nothing waiting"
      emptySub="No profile corrections are waiting for a decision."
      load={(status) => api.profileEditsForReview(status)}
      decide={(id, status, reason) => api.decideProfileEdit(id, status, reason)}
      renderDetail={(r) => (
        <>
          {r.changes.map((c) => (
            <div key={c.field} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text-1)' }}>{c.label}:</strong>{' '}
              <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{c.oldValue || '—'}</span>
              {' → '}
              <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{c.newValue || '—'}</span>
            </div>
          ))}
          {r.note && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>Student’s note: {r.note}</div>
          )}
        </>
      )}
    />
  );
}
