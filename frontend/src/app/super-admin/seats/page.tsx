'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, EmptyState, Field, Input, Modal, Pill, SkeletonRows, StatCard, rupees, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { clearActingSchool } from '@/lib/acting-school';
import type { SeatSummaryDto, SeatRequestDto, SeatHistoryEntryDto, SeatRequestStatus } from '@/lib/types';

/**
 * Super Admin — seat management.
 *
 * Two halves, because the platform has two jobs here: selling a school its
 * seats, and deciding the extra seats a school has already paid for.
 *
 * The second is the one with a rule attached. A request can only be decided
 * once it is PAID, only once, and approving it is what releases the seats —
 * so the table shows payment state and request state as separate columns
 * rather than collapsing them into one word. Every one of those rules is
 * enforced by the backend (`seats.approve`, in SUPER_ADMIN_ONLY); this page
 * only avoids offering the button where the answer would be a 409.
 */

const STATUS_TONE: Record<SeatRequestStatus, 'green' | 'amber' | 'red' | 'gray'> = {
  PENDING_PAYMENT: 'gray',
  PAID: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export default function SuperAdminSeatsPage() {
  const [schools, setSchools] = useState<SeatSummaryDto[] | null>(null);
  const [requests, setRequests] = useState<SeatRequestDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<SeatHistoryEntryDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showSell, setShowSell] = useState(false);
  const [decide, setDecide] = useState<{ request: SeatRequestDto; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(false);
    // PortalShell drops the acting school on every platform page, but its
    // effect runs after this one — a parent's effects fire after its
    // children's. Left to that ordering the first fetch would still carry
    // `X-School-Id` from whichever school was last opened, and the request
    // list, which must span the platform, would come back as one school's.
    clearActingSchool();
    try {
      const [seatRows, requestRows] = await Promise.all([api.listSchoolSeats(), api.listSeatRequests()]);
      setSchools(seatRows);
      setRequests(requestRows);
      setSelected((cur) => cur ?? seatRows[0]?.tenantId ?? null);
    } catch {
      setErr(true);
      setSchools([]);
      setRequests([]);
    }
  }, []);

  const loadHistory = useCallback(async (tenantId: string) => {
    setHistory(null);
    try {
      setHistory(await api.schoolSeatHistory(tenantId));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) void loadHistory(selected); }, [selected, loadHistory]);

  const current = schools?.find((s) => s.tenantId === selected) ?? null;

  const totals = useMemo(() => {
    const rows = schools ?? [];
    return {
      approved: rows.reduce((n, s) => n + s.approvedSeats, 0),
      used: rows.reduce((n, s) => n + s.usedSeats, 0),
      waiting: rows.reduce((n, s) => n + s.awaitingApprovalSeats, 0),
      toDecide: (requests ?? []).filter((r) => r.status === 'PAID').length,
    };
  }, [schools, requests]);

  const submitDecision = async (note: string) => {
    if (!decide) return;
    setBusyId(decide.request.id);
    try {
      await api.decideSeatRequest(decide.request.id, { decision: decide.decision, note: note || undefined });
      toast(
        decide.decision === 'APPROVED'
          ? `${decide.request.seats} seats released to ${decide.request.tenantId}.`
          : `Request from ${decide.request.tenantId} rejected.`,
        'success',
      );
      setDecide(null);
      await load();
      if (selected) await loadHistory(selected);
    } catch (e) {
      // 409 on an unpaid or already-decided request, 403 on a school's own —
      // the server's message says which, and it is the honest one to show.
      toast(errorMessage(e, 'Could not record that decision.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'Seat Management',
        desc: 'Seats sold to each school, and the extra-seat requests waiting on a decision.',
        actions: <Button small disabled={!current} onClick={() => setShowSell(true)}>Sell seats</Button>,
      }}
    >
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Approved seats" value={totals.approved} />
        <StatCard label="Seats in use" value={totals.used} />
        <StatCard label="Paid, awaiting approval" value={totals.waiting} />
        <StatCard label="Requests to decide" value={totals.toDecide} />
      </div>

      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Extra-seat requests</strong>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
            Payment buys the seats; approval is what makes them usable. Only a paid request can be decided.
          </div>
        </div>
        {requests === null && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
        {err && <EmptyState title="Couldn't load seat requests" sub="Failed to fetch from the server." />}
        {requests !== null && !err && requests.length === 0 && (
          <EmptyState title="No requests" sub="No school has asked for extra seats yet." />
        )}
        {requests !== null && requests.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>School</th>
                <th>Seats</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Request</th>
                <th>Raised</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" style={{ fontWeight: 600 }} data-label="School">{r.tenantId}</td>
                  <td data-label="Seats">{r.seats}</td>
                  <td data-label="Amount">
                    <div>{rupees(r.amountPaise)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      {rupees(r.unitPricePaise)}/seat{r.discountPct > 0 ? ` · ${r.discountPct}% off` : ''}
                      {r.priceSource === 'PLATFORM_DEFAULT' ? ' · platform default' : ''}
                    </div>
                  </td>
                  <td data-label="Payment">
                    <Pill tone={r.paymentStatus === 'PAID' ? 'green' : r.paymentStatus === 'FAILED' ? 'red' : 'gray'}>
                      {label(r.paymentStatus)}
                    </Pill>
                    {r.receiptNo && (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{r.receiptNo}</div>
                    )}
                  </td>
                  <td data-label="Request">
                    <Pill tone={STATUS_TONE[r.status]}>{label(r.status)}</Pill>
                    {r.decidedBy && (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>by {r.decidedBy}</div>
                    )}
                  </td>
                  <td data-label="Raised">
                    <div>{when(r.createdAt)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{r.requestedBy ?? '—'}</div>
                  </td>
                  <td data-label="Actions">
                    {r.status === 'PAID' ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button small disabled={busyId === r.id} onClick={() => setDecide({ request: r, decision: 'APPROVED' })}>
                          Approve
                        </Button>
                        <Button variant="ghost" small disabled={busyId === r.id} onClick={() => setDecide({ request: r, decision: 'REJECTED' })}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {r.status === 'PENDING_PAYMENT' ? 'Awaiting payment' : `Already ${label(r.status)}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="console-split">
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Seats by school</strong>
          </div>
          {schools === null && <div style={{ padding: 18 }}><SkeletonRows rows={4} /></div>}
          {schools !== null && schools.length === 0 && !err && (
            <EmptyState title="No schools yet" sub="Register a school before selling it seats." />
          )}
          {schools?.map((s) => (
            <button
              key={s.tenantId}
              type="button"
              onClick={() => setSelected(s.tenantId)}
              aria-current={s.tenantId === selected ? 'true' : undefined}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 18px',
                border: 0, borderBottom: '1px solid var(--hairline)', cursor: 'pointer',
                background: s.tenantId === selected ? 'var(--surface-2, rgba(0,0,0,0.04))' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.tenantName ?? s.tenantId}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                {s.usedSeats} used · {s.availableSeats} free of {s.approvedSeats} approved
              </div>
              {s.unitPricePaise !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                  {rupees(s.unitPricePaise)}/seat
                  {s.priceSource === 'PLATFORM_DEFAULT' ? ' (platform default)' : ''}
                </div>
              )}
              {s.awaitingApprovalSeats > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                  {s.awaitingApprovalSeats} paid, awaiting approval
                </div>
              )}
              {!s.provisioned && (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>No seats sold — unlimited</div>
              )}
            </button>
          ))}
        </Card>

        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
              {current ? `Seat history — ${current.tenantName ?? current.tenantId}` : 'Seat history'}
            </strong>
          </div>
          {!current && <EmptyState title="Select a school" sub="Pick a school on the left to see its seat history." />}
          {current && history === null && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
          {current && history !== null && history.length === 0 && (
            <EmptyState title="Nothing yet" sub="No seats have moved for this school." />
          )}
          {current && history && history.length > 0 && <SeatHistoryTable rows={history} />}
        </Card>
      </div>

      {showSell && current && (
        <SellSeatsModal
          school={current}
          onClose={() => setShowSell(false)}
          onDone={async () => {
            setShowSell(false);
            await load();
            await loadHistory(current.tenantId);
          }}
        />
      )}

      {decide && (
        <DecisionModal
          request={decide.request}
          decision={decide.decision}
          busy={busyId === decide.request.id}
          onClose={() => setDecide(null)}
          onConfirm={submitDecision}
        />
      )}
    </PortalShell>
  );
}

// Not exported: a Next.js page module may only export `default` and the
// framework's own config keys, and nothing outside this page renders it.
/** The seat ledger, as the platform reads it. */
function SeatHistoryTable({ rows }: { rows: SeatHistoryEntryDto[] }) {
  return (
    <table className="data-table data-table-cards">
      <thead>
        <tr>
          <th>When</th>
          <th>Event</th>
          <th>Purchased</th>
          <th>Approved</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.id}>
            <td data-label="When">{when(h.at)}</td>
            <td className="cell-primary" data-label="Event">
              <div>{label(h.event)}</div>
              {h.note && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{h.note}</div>}
            </td>
            <td data-label="Purchased">
              {h.purchasedDelta !== 0 ? `${h.purchasedDelta > 0 ? '+' : ''}${h.purchasedDelta} → ` : ''}
              {h.purchasedAfter}
            </td>
            <td data-label="Approved">
              {h.approvedDelta !== 0 ? `${h.approvedDelta > 0 ? '+' : ''}${h.approvedDelta} → ` : ''}
              {h.approvedAfter}
            </td>
            <td data-label="By">{h.actor ?? 'System'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SellSeatsModal({
  school, onClose, onDone,
}: { school: SeatSummaryDto; onClose: () => void; onDone: () => Promise<void> }) {
  const [seats, setSeats] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    const count = Number(seats);
    if (!Number.isInteger(count) || count === 0) {
      toast('Enter a whole number of seats. A negative number corrects an overcount.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.grantSchoolSeats(school.tenantId, {
        seats: count,
        note: note || undefined,
        event: count > 0 ? 'PURCHASE' : 'ADJUSTMENT',
      });
      toast(`${school.tenantName ?? school.tenantId} now has ${school.approvedSeats + count} approved seats.`, 'success');
      await onDone();
    } catch (e) {
      toast(errorMessage(e, 'Could not change this school’s seats.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Sell seats — ${school.tenantName ?? school.tenantId}`}
      onClose={onClose}
      footer={<Button disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Apply'}</Button>}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
        Seats sold here are purchased and approved together — you are the person who would otherwise approve them.
        Extra seats a school asks for later go through payment and a separate decision.
      </p>
      <Field label="Seats" hint="A negative number corrects an overcount.">
        <Input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" placeholder="200" />
      </Field>
      <Field label="Note" hint="Optional. Recorded in the seat history.">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual contract renewal" />
      </Field>
    </Modal>
  );
}

function DecisionModal({
  request, decision, busy, onClose, onConfirm,
}: {
  request: SeatRequestDto;
  decision: 'APPROVED' | 'REJECTED';
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const approving = decision === 'APPROVED';

  return (
    <Modal
      title={approving ? 'Approve extra seats' : 'Reject extra seats'}
      onClose={onClose}
      footer={
        <Button disabled={busy} onClick={() => void onConfirm(note)}>
          {busy ? 'Recording…' : approving ? 'Approve and release' : 'Reject'}
        </Button>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
        {request.tenantId} paid {rupees(request.amountPaise)} for {request.seats} seats
        {request.receiptNo ? ` (receipt ${request.receiptNo})` : ''}.{' '}
        {approving
          ? 'Approving releases them for use straight away.'
          : 'Rejecting leaves the seats unusable; the payment is not refunded here.'}
      </p>
      {request.reason && (
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Reason given: {request.reason}</p>
      )}
      <Field label="Note" hint="Optional. Recorded on the request and in the seat history.">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Growth plan agreed" />
      </Field>
    </Modal>
  );
}
