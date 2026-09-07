'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, rupees, useToast } from '../ui';
import { api, errorMessage, fileHref } from '@/lib/api';
import type { FeePlanDto, PaymentChangeRequestDto, PaymentHistoryDto, PaymentReceiptDto } from '@/lib/types';

/**
 * The admin's decision queue for everything Finance cannot finalize itself:
 * payments waiting to be published, requests to change payments that already
 * are, and installment plans waiting on review or approval.
 *
 * Each row carries the provenance the decision needs — who raised it, when,
 * what it would change from and to, and the reason given — because approving
 * something you have to open three screens to understand is how rubber-stamping
 * starts.
 */

const PLAN_STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  DRAFT: 'gray',
  PENDING_FINANCE_REVIEW: 'amber',
  FINANCE_REVIEWED: 'blue',
  PENDING_ADMIN_APPROVAL: 'amber',
  APPROVED: 'blue',
  PUBLISHED: 'green',
  REJECTED: 'red',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Asks for a reason before a rejection — a rejection without one is refused
 *  by the server anyway, and the person who has to act on it needs the why. */
function useReasonPrompt() {
  return useCallback((what: string) => {
    const reason = window.prompt(`Reason for rejecting this ${what}:`);
    return reason?.trim() ? reason.trim() : null;
  }, []);
}

export function PaymentApprovalsPanel({ canApprove }: { canApprove: boolean }) {
  const [payments, setPayments] = useState<PaymentReceiptDto[] | null>(null);
  const [requests, setRequests] = useState<PaymentChangeRequestDto[] | null>(null);
  const [plans, setPlans] = useState<FeePlanDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [history, setHistory] = useState<PaymentHistoryDto | null>(null);
  const toast = useToast();
  const askReason = useReasonPrompt();

  const load = useCallback(() => {
    api.pendingPayments({ pageSize: 50 })
      .then((r) => setPayments(r.items))
      .catch(() => setPayments([]));
    api.paymentChangeRequests('PENDING_ADMIN_APPROVAL')
      .then(setRequests)
      .catch(() => setRequests([]));
    api.feePlans()
      .then((all) => setPlans(all.filter((p) => p.status !== 'PUBLISHED')))
      .catch(() => setPlans([]));
  }, []);

  useEffect(load, [load]);

  const run = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await work();
      toast(done);
      load();
    } catch (e) {
      toast(errorMessage(e, 'That action could not be completed.'));
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = (payments?.length ?? 0) + (requests?.length ?? 0);

  return (
    <>
      <Card pad={false} style={{ marginBottom: 16 }}>
        <div className="approval-head">
          <div>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Payments awaiting approval</strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
              Recorded by Finance. Nothing here is counted against an invoice, or visible to the family,
              until it is approved.
            </div>
          </div>
          {pendingCount > 0 && <Pill tone="amber">{pendingCount} awaiting you</Pill>}
        </div>

        {payments === null && <div style={{ padding: 16 }}><SkeletonRows rows={3} /></div>}
        {payments?.length === 0 && (
          <div style={{ padding: '4px 20px 20px' }}>
            <EmptyState title="Nothing awaiting approval" sub="Payments Finance records will appear here for your decision." />
          </div>
        )}
        {payments && payments.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Receipt</th><th>Student</th><th>Amount</th><th>Method</th>
                <th>Paid on</th><th>Proof</th><th>Recorded</th><th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary" data-label="Receipt">
                    {p.receiptNo}
                    <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.invoiceNo}</div>
                  </td>
                  <td data-label="Student">{p.studentName}<div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.class}</div></td>
                  <td data-label="Amount"><strong>{rupees(p.amountPaise)}</strong></td>
                  <td data-label="Method">
                    <Pill tone="blue">{p.mode}</Pill>
                    {p.instrument?.number && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                        {p.instrument.number} · {p.instrument.bankName}
                      </div>
                    )}
                  </td>
                  <td data-label="Paid on">{p.paidOn ? new Date(p.paidOn).toLocaleDateString('en-IN') : '—'}</td>
                  <td data-label="Proof">
                    {p.instrument?.proofUrl
                      ? (
                        <a
                          href={fileHref(p.instrument.proofUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12.5 }}
                        >
                          View {p.instrument.proofName ?? 'proof'}
                        </a>
                      )
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                  <td data-label="Recorded" style={{ color: 'var(--text-faint)' }}>{fmt(p.createdAt)}</td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button small variant="ghost" onClick={() => api.paymentHistory(p.id).then(setHistory).catch(() => {})}>
                        History
                      </Button>
                      {canApprove && (
                        <>
                          <Button
                            small
                            disabled={busyId === p.id}
                            onClick={() => run(p.id, () => api.approvePayment(p.id), `Payment ${p.receiptNo} approved and published.`)}
                          >
                            Approve
                          </Button>
                          <Button
                            small
                            variant="soft"
                            disabled={busyId === p.id}
                            onClick={() => {
                              const reason = askReason('payment');
                              if (reason) run(p.id, () => api.rejectPayment(p.id, reason), `Payment ${p.receiptNo} rejected.`);
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card pad={false} style={{ marginBottom: 16 }}>
        <div className="approval-head">
          <div>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Change requests</strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
              Finance cannot edit a published payment. Approving a request here is what applies the change.
            </div>
          </div>
        </div>

        {requests === null && <div style={{ padding: 16 }}><SkeletonRows rows={2} /></div>}
        {requests?.length === 0 && (
          <div style={{ padding: '4px 20px 20px' }}>
            <EmptyState title="No change requests" sub="Requests to amend published payments appear here." />
          </div>
        )}
        {requests && requests.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Receipt</th><th>Field</th><th>From</th><th>To</th>
                <th>Reason</th><th>Requested by</th><th>Document</th><th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Receipt">{r.receiptNo}</td>
                  <td data-label="Field">{r.field}</td>
                  <td data-label="From"><span style={{ textDecoration: 'line-through', color: 'var(--text-faint)' }}>{r.currentValue ?? '—'}</span></td>
                  <td data-label="To"><strong>{r.requestedValue ?? '—'}</strong></td>
                  <td data-label="Reason">{r.reason}</td>
                  <td data-label="Requested by">
                    {r.requestedBy ?? '—'}
                    <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.requestedByRole} · {fmt(r.requestedAt)}</div>
                  </td>
                  <td data-label="Document">
                    {r.documentUrl
                      ? <a href={fileHref(r.documentUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12.5 }}>View</a>
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                  <td data-label="Actions">
                    {canApprove && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button
                          small
                          disabled={busyId === r.id}
                          onClick={() => run(r.id, () => api.decidePaymentChange(r.id, { approve: true }), 'Change approved and applied.')}
                        >
                          Approve
                        </Button>
                        <Button
                          small
                          variant="soft"
                          disabled={busyId === r.id}
                          onClick={() => {
                            const reason = askReason('change request');
                            if (reason) run(r.id, () => api.decidePaymentChange(r.id, { approve: false, reason }), 'Change request rejected.');
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card pad={false}>
        <div className="approval-head">
          <div>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Installment plans in the workflow</strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
              A plan bills nobody until it is approved and published — publishing is what raises its invoices.
            </div>
          </div>
        </div>

        {plans === null && <div style={{ padding: 16 }}><SkeletonRows rows={2} /></div>}
        {plans?.length === 0 && (
          <div style={{ padding: '4px 20px 20px' }}>
            <EmptyState title="No plans in progress" sub="Draft and submitted installment plans appear here." />
          </div>
        )}
        {plans && plans.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Plan</th><th>Year</th><th>Mode</th><th>Total</th><th>Schedule</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary" data-label="Plan">{p.name}</td>
                  <td data-label="Year">{p.academicYearName ?? '—'}</td>
                  <td data-label="Mode">{label(p.mode)}</td>
                  <td data-label="Total">{rupees(p.totalPaise)}</td>
                  <td data-label="Schedule">
                    {p.installments.map((i) => (
                      <div key={i.seq} style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                        {i.label ?? `Installment ${i.seq}`}: {rupees(i.amountPaise)} → {new Date(i.dueOn).toLocaleDateString('en-IN')}
                      </div>
                    ))}
                  </td>
                  <td data-label="Status"><Pill tone={PLAN_STATUS_TONE[p.status] ?? 'gray'}>{label(p.status)}</Pill></td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canApprove && p.status === 'PENDING_ADMIN_APPROVAL' && (
                        <>
                          <Button
                            small
                            disabled={busyId === p.id}
                            onClick={() => run(p.id, () => api.transitionFeePlan(p.id, 'approve'), 'Plan approved. Publish it to raise the invoices.')}
                          >
                            Approve
                          </Button>
                          <Button
                            small
                            variant="soft"
                            disabled={busyId === p.id}
                            onClick={() => {
                              const reason = askReason('plan');
                              if (reason) run(p.id, () => api.transitionFeePlan(p.id, 'reject', { reason }), 'Plan rejected.');
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {canApprove && p.status === 'APPROVED' && (
                        <Button
                          small
                          disabled={busyId === p.id}
                          onClick={() => run(p.id, () => api.publishFeePlan(p.id), 'Plan published — invoices raised.')}
                        >
                          Publish
                        </Button>
                      )}
                      {p.status === 'PENDING_FINANCE_REVIEW' && (
                        <Button
                          small
                          variant="soft"
                          disabled={busyId === p.id}
                          onClick={() => run(p.id, () => api.transitionFeePlan(p.id, 'review'), 'Marked as reviewed.')}
                        >
                          Mark reviewed
                        </Button>
                      )}
                      {p.status === 'FINANCE_REVIEWED' && (
                        <Button
                          small
                          variant="soft"
                          disabled={busyId === p.id}
                          onClick={() => run(p.id, () => api.transitionFeePlan(p.id, 'requestApproval'), 'Sent for admin approval.')}
                        >
                          Send for approval
                        </Button>
                      )}
                      {p.status === 'DRAFT' && (
                        <Button
                          small
                          variant="soft"
                          disabled={busyId === p.id}
                          onClick={() => run(p.id, () => api.transitionFeePlan(p.id, 'submit'), 'Submitted for finance review.')}
                        >
                          Submit
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {history && <PaymentHistoryModal history={history} onClose={() => setHistory(null)} />}
    </>
  );
}

/** The full provenance of one payment: every stamp and every value change. */
export function PaymentHistoryModal({ history, onClose }: { history: PaymentHistoryDto; onClose: () => void }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">Payment {history.receiptNo}</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <div className="audit-facts">
          <div><span>Amount</span><strong>{rupees(history.amountPaise)}</strong></div>
          <div><span>Method</span><strong>{history.mode}</strong></div>
          <div><span>State</span><strong>{label(history.recordStatus)}</strong></div>
          <div><span>Created by</span><strong>{history.createdBy ?? '—'} {history.createdByRole ? `(${history.createdByRole})` : ''}</strong></div>
          <div><span>Created</span><strong>{fmt(history.createdAt)}</strong></div>
          <div><span>Approved by</span><strong>{history.approvedBy ?? '—'}</strong></div>
          <div><span>Approved</span><strong>{fmt(history.approvedAt)}</strong></div>
          {history.rejectedBy && <div><span>Rejected by</span><strong>{history.rejectedBy}</strong></div>}
          {history.rejectionReason && <div><span>Rejection reason</span><strong>{history.rejectionReason}</strong></div>}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px', color: 'var(--text-1)' }}>Audit trail</div>
        {history.trail.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No entries yet.</p>}
        <ul className="audit-trail">
          {history.trail.map((e) => (
            <li key={e.id}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{label(e.action)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                {e.actor ?? 'system'} · {fmt(e.at)}
              </div>
              {(e.before || e.after) && (
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2, wordBreak: 'break-word' }}>
                  {e.before ? `from ${JSON.stringify(e.before)} ` : ''}
                  {e.after ? `to ${JSON.stringify(e.after)}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>

        {history.changeRequests.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px', color: 'var(--text-1)' }}>Change requests</div>
            <ul className="audit-trail">
              {history.changeRequests.map((r) => (
                <li key={r.id}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                    {r.field}: {r.currentValue ?? '—'} → {r.requestedValue ?? '—'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                    {label(r.status)} · {r.requestedBy ?? '—'} · {fmt(r.requestedAt)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{r.reason}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
