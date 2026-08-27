'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { AvailableElectiveDto, RegistrationStatus, SubjectRegistrationDto } from '@/lib/types';

const STATUS_TONE: Record<RegistrationStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  WITHDRAWN: 'gray',
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: 'Awaiting approval',
  APPROVED: 'Registered',
  REJECTED: 'Not approved',
  WITHDRAWN: 'Withdrawn',
};

/** "3 of 25 seats left", or "Open" when the elective is uncapped. */
function seatsLabel(e: AvailableElectiveDto): string {
  if (e.capacity == null) return 'Open · no seat limit';
  if (e.seatsLeft === 0) return `Full · ${e.capacity} of ${e.capacity} seats taken`;
  return `${e.seatsLeft} of ${e.capacity} seats left`;
}

function SeatBar({ e }: { e: AvailableElectiveDto }) {
  if (e.capacity == null) return null;
  const pct = Math.min(100, Math.round((e.seatsTaken / e.capacity) * 100));
  const tone = pct >= 100 ? 'var(--danger, #b3261e)' : pct >= 80 ? 'var(--warn, #a86500)' : 'var(--accent)';
  return (
    <div
      style={{ height: 4, borderRadius: 999, background: 'var(--hairline-2, rgba(0,0,0,.08))', overflow: 'hidden', marginTop: 8 }}
      role="progressbar"
      aria-valuenow={e.seatsTaken}
      aria-valuemin={0}
      aria-valuemax={e.capacity}
      aria-label={`${e.subjectName} seats filled`}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
    </div>
  );
}

export function ElectiveCatalog() {
  const [electives, setElectives] = useState<AvailableElectiveDto[] | null>(null);
  const [history, setHistory] = useState<SubjectRegistrationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Keyed by offering/registration id so only the row being acted on shows a
  // spinner, rather than freezing the whole list.
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [available, mine] = await Promise.all([api.availableElectives(), api.myRegistrations()]);
      setElectives(available);
      setHistory(mine);
      setError(null);
    } catch (err: unknown) {
      setElectives([]);
      setError(errorMessage(err, 'Could not load electives.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      toast(okMsg, 'success');
      await load();
    } catch (err: unknown) {
      toast(errorMessage(err, 'That did not work. Please try again.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (electives === null) return <Card><SkeletonRows rows={4} /></Card>;

  if (error) {
    return (
      <Card>
        <EmptyState icon="!" title="Electives unavailable" sub={error} />
      </Card>
    );
  }

  const decided = history.filter((r) => r.status === 'REJECTED' || r.status === 'WITHDRAWN');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Electives for your class</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 14 }}>
          Your core subjects are already on your timetable. Choose electives here — a teacher approves each request.
        </div>

        {electives.length === 0 ? (
          <EmptyState
            icon="◌"
            title="No electives on offer"
            sub="Your class has no elective subjects this term. Check back later or ask your class teacher."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {electives.map((e) => {
              // The `busyId !== null` guard is load-bearing: when nothing is in
              // flight busyId is null, and myRegistrationId is also null for
              // every elective the student has not registered for — so without
              // it, `null === null` marked all those rows busy and every
              // Register button read "Sending…" permanently.
              const busy = busyId !== null
                && (busyId === e.subjectOfferingId || busyId === e.myRegistrationId);
              const canWithdraw = e.myStatus === 'PENDING' || e.myStatus === 'APPROVED';
              // A rejected or withdrawn row is re-applicable, so it falls through
              // to the register button rather than showing a dead status chip.
              const canRegister = !canWithdraw && !e.isFull;
              return (
                <div
                  key={e.subjectOfferingId}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(0,0,0,.015)', border: '1px solid var(--hairline)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 200, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-1)' }}>
                        {e.subjectName}
                        {e.subjectCode && (
                          <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}> · {e.subjectCode}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 3 }}>
                        {[e.termName, e.teacherName].filter(Boolean).join(' · ') || 'Term not set'}
                      </div>
                      <div style={{ fontSize: 11.5, color: e.isFull ? 'var(--danger, #b3261e)' : 'var(--text-faint)', marginTop: 4 }}>
                        {seatsLabel(e)}
                      </div>
                      <SeatBar e={e} />
                      {e.myStatus === 'REJECTED' && e.myDecisionNote && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>
                          Reason given: {e.myDecisionNote}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {e.myStatus && <Pill tone={STATUS_TONE[e.myStatus]}>{STATUS_LABEL[e.myStatus]}</Pill>}
                      {canWithdraw && e.myRegistrationId && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => act(e.myRegistrationId!, () => api.withdrawRegistration(e.myRegistrationId!),
                            e.myStatus === 'APPROVED' ? 'Elective dropped.' : 'Request withdrawn.')}
                        >
                          {busy ? '…' : e.myStatus === 'APPROVED' ? 'Drop' : 'Withdraw'}
                        </Button>
                      )}
                      {canRegister && (
                        <Button
                          disabled={busy}
                          onClick={() => act(e.subjectOfferingId, () => api.registerForElective(e.subjectOfferingId), 'Request sent for approval.')}
                        >
                          {busy ? 'Sending…' : 'Register'}
                        </Button>
                      )}
                      {!canWithdraw && e.isFull && <Pill tone="gray">Full</Pill>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {decided.length > 0 && (
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Past requests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {decided.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-2b)' }}>
                  {r.subjectName ?? 'Subject removed'}
                  {r.termName ? ` · ${r.termName}` : ''}
                </span>
                <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
