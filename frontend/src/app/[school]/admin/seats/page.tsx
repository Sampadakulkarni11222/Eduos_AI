'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, EmptyState, Field, Input, Modal, Pill, SkeletonRows, StatCard, rupees, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { runCheckout, PaymentCancelled } from '@/lib/razorpay';
import type { SeatSummaryDto, SeatRequestDto, SeatHistoryEntryDto, SeatRequestStatus } from '@/lib/types';

/**
 * School Admin — seats.
 *
 * The summary is four numbers and one sentence about the gap between two of
 * them: seats this school has *paid for* are not seats it can *use* until the
 * platform approves them. That is the single thing this screen exists to make
 * unmissable, because it is the state an administrator will otherwise read as a
 * bug ("we paid, where are our seats?").
 *
 * The price shown next to the seat box is a quote drawn from the price list the
 * server returned; the amount actually charged is calculated by the server when
 * the request is created, and again when the order is raised. Nothing here is
 * sent as a price.
 */

const STATUS_TONE: Record<SeatRequestStatus, 'green' | 'amber' | 'red' | 'gray'> = {
  PENDING_PAYMENT: 'gray',
  PAID: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** The client-side quote, mirroring the server's price list exactly. */
function quote(seats: number, price: SeatSummaryDto['priceList']) {
  if (!price || !Number.isInteger(seats) || seats <= 0) return null;
  const gross = seats * price.unitPricePaise;
  const discountPct = [...price.tiers].sort((a, b) => b.minSeats - a.minSeats)
    .find((t) => seats >= t.minSeats)?.discountPct ?? 0;
  return { amountPaise: gross - Math.floor((gross * discountPct) / 100), discountPct };
}

export default function AdminSeatsPage() {
  const [summary, setSummary] = useState<SeatSummaryDto | null>(null);
  const [requests, setRequests] = useState<SeatRequestDto[] | null>(null);
  const [history, setHistory] = useState<SeatHistoryEntryDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(false);
    try {
      const [s, r, h] = await Promise.all([api.seatSummary(), api.listSeatRequests(), api.seatHistory()]);
      setSummary(s);
      setRequests(r);
      setHistory(h);
    } catch {
      setErr(true);
      setRequests([]);
      setHistory([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Pays for a request.
   *
   * With a real gateway the server hands back an order and the payer completes
   * it in Checkout; the signed result goes back to the server, which settles it
   * through the same path the webhook uses. With the sandbox the server settles
   * on the spot and there is nothing to open. Either way the request becomes
   * PAID and *nothing is allocated* — approval is a separate act by the
   * platform.
   */
  const pay = async (request: SeatRequestDto) => {
    setPayingId(request.id);
    try {
      const order = await api.paySeatRequest(request.id);
      if (order.requiresClientAction) {
        const result = await runCheckout(order, {
          name: 'EduOS seats',
          description: `${order.seats} extra seats`,
          notes: { seatRequestId: request.id },
        });
        await api.verifySeatPayment({
          orderId: result.razorpay_order_id,
          paymentId: result.razorpay_payment_id,
          signature: result.razorpay_signature,
        });
      }
      toast('Payment received. The seats are waiting for platform approval.', 'success');
      await load();
    } catch (e) {
      if (e instanceof PaymentCancelled) toast(e.message, 'info');
      else toast(errorMessage(e, 'The payment could not be completed.'), 'error');
    } finally {
      setPayingId(null);
    }
  };

  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{
        title: 'Seats',
        desc: 'What this school has bought, what it can use, and how to ask for more.',
        actions: <Button small onClick={() => setShowRequest(true)}>Request extra seats</Button>,
      }}
    >
      {summary === null && !err && <Card><SkeletonRows rows={3} /></Card>}
      {err && <EmptyState title="Couldn't load seats" sub="Failed to fetch this school's seat position." />}

      {summary && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Purchased" value={summary.purchasedSeats} hint="Seats paid for" />
            <StatCard label="Approved" value={summary.approvedSeats} hint="Seats released for use" />
            <StatCard label="In use" value={summary.usedSeats} hint="Active people in this school" />
            <StatCard label="Available" value={summary.availableSeats} hint="Approved seats not yet taken" />
          </div>

          {summary.priceList && (
            <Card style={{ marginBottom: 16 }}>
              <strong>
                Extra seats cost {rupees(summary.priceList.unitPricePaise)} each for this school.
              </strong>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                {summary.priceList.source === 'SCHOOL'
                  ? 'This is your school’s agreed rate, set by the platform.'
                  : 'This is the platform’s standard rate.'}{' '}
                The amount for any request is calculated by the server at the rate in force when it is raised, and
                a request keeps that price even if the rate later changes.
              </div>
            </Card>
          )}

          {!summary.provisioned && (
            <Card style={{ marginBottom: 16 }}>
              <strong>No seat limit is set for this school.</strong>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                The platform has not sold this school seats, so nothing here caps how many people it may have.
              </div>
            </Card>
          )}

          {summary.awaitingApprovalSeats > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <strong>{summary.awaitingApprovalSeats} paid seats are waiting for platform approval.</strong>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                They cannot be used yet. Payment buys the seats; a Super Admin has to approve them before anyone
                can be added against them.
              </div>
            </Card>
          )}
        </>
      )}

      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Extra-seat requests</strong>
        </div>
        {requests === null && !err && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
        {requests !== null && requests.length === 0 && (
          <EmptyState title="No requests yet" sub="Ask the platform for extra seats when this school needs them." />
        )}
        {requests !== null && requests.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Raised</th>
                <th>Seats</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td data-label="Raised">
                    <div>{when(r.createdAt)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{r.requestedBy ?? '—'}</div>
                  </td>
                  <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Seats">{r.seats}</td>
                  <td data-label="Amount">
                    <div>{rupees(r.amountPaise)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      {rupees(r.unitPricePaise)}/seat{r.discountPct > 0 ? ` · ${r.discountPct}% off` : ''}
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
                  <td data-label="Status">
                    <Pill tone={STATUS_TONE[r.status]}>{label(r.status)}</Pill>
                    {r.status === 'PAID' && (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>awaiting platform approval</div>
                    )}
                    {r.decisionNote && (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{r.decisionNote}</div>
                    )}
                  </td>
                  <td data-label="Actions">
                    {r.status === 'PENDING_PAYMENT' ? (
                      <Button small disabled={payingId === r.id} onClick={() => void pay(r)}>
                        {payingId === r.id ? 'Paying…' : `Pay ${rupees(r.amountPaise)}`}
                      </Button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card pad={false}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Seat history</strong>
        </div>
        {history === null && !err && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
        {history !== null && history.length === 0 && (
          <EmptyState title="Nothing yet" sub="No seats have been bought or approved for this school." />
        )}
        {history !== null && history.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Purchased</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td data-label="When">{when(h.at)}</td>
                  <td className="cell-primary" data-label="Event">
                    <div>{label(h.event)}</div>
                    {h.note && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{h.note}</div>}
                  </td>
                  <td data-label="Purchased">{h.purchasedAfter}</td>
                  <td data-label="Approved">{h.approvedAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showRequest && (
        <RequestSeatsModal
          priceList={summary?.priceList}
          onClose={() => setShowRequest(false)}
          onCreated={async () => {
            setShowRequest(false);
            await load();
          }}
        />
      )}
    </PortalShell>
  );
}

function RequestSeatsModal({
  priceList, onClose, onCreated,
}: {
  priceList: SeatSummaryDto['priceList'];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [seats, setSeats] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const estimate = quote(Number(seats), priceList);

  const submit = async () => {
    const count = Number(seats);
    if (!Number.isInteger(count) || count <= 0) {
      toast('Enter a whole number of seats greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      // Only the count and the reason are sent. The server prices it.
      const created = await api.createSeatRequest({ seats: count, reason: reason || undefined });
      toast(`Requested ${created.seats} seats for ${rupees(created.amountPaise)}. Pay to send it for approval.`, 'success');
      await onCreated();
    } catch (e) {
      toast(errorMessage(e, 'Could not raise that request.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Request extra seats"
      onClose={onClose}
      footer={<Button disabled={busy} onClick={() => void submit()}>{busy ? 'Requesting…' : 'Request seats'}</Button>}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
        Raising a request allocates nothing. Pay for it, and the platform then approves or rejects it — only an
        approval makes the seats usable.
      </p>
      <Field
        label="Extra seats"
        required
        hint={priceList
          ? `${rupees(priceList.unitPricePaise)} per seat${priceList.source === 'SCHOOL' ? ' (your school’s agreed rate)' : ''}`
          : undefined}
      >
        <Input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" placeholder="25" />
      </Field>
      {estimate && (
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Estimated total <strong>{rupees(estimate.amountPaise)}</strong>
          {estimate.discountPct > 0 ? ` (${estimate.discountPct}% volume discount)` : ''}. The amount charged is
          calculated by the server when the request is raised.
        </p>
      )}
      <Field label="Reason" hint="Optional. Shown to the platform with the request.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two new sections in Class 6" />
      </Field>
    </Modal>
  );
}
