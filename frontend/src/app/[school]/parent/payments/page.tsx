'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, rupees, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { runCheckout, PaymentCancelled } from '@/lib/razorpay';
import type { InvoiceDto } from '@/lib/types';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red' };

export default function ParentPayments() {
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  // Online is the only method a family has, so when it is not configured the
  // action is hidden rather than offered and failed on click. The flag comes
  // from the fee summary the backend derives from PAYMENT_PROVIDER; it is not
  // a second copy of the setting, and it defaults to available so a failed
  // summary never hides a working Pay button.
  const [canPayOnline, setCanPayOnline] = useState(true);
  const toast = useToast();

  const load = () => api.invoices().then(setInvoices).catch(() => setInvoices([]));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    api.feeSummary()
      .then((s) => setCanPayOnline(s.onlinePaymentEnabled !== false))
      .catch(() => setCanPayOnline(true));
  }, []);

  const dueOf = (i: InvoiceDto) => i.totalPaise - i.paidPaise;
  const isPayable = (i: InvoiceDto) => dueOf(i) > 0 && i.status !== 'CANCELLED';

  // Outstanding invoices lead the page: a paid invoice is a record, an unpaid
  // one is a task. Both lists come from the same api.invoices() response.
  const outstanding = (invoices ?? []).filter(isPayable)
    .sort((a, b) => new Date(a.dueOn).getTime() - new Date(b.dueOn).getTime());
  const settled = (invoices ?? []).filter((i) => !isPayable(i));
  const outstandingTotalPaise = outstanding.reduce((sum, i) => sum + dueOf(i), 0);
  const overdueCount = outstanding.filter((i) => new Date(i.dueOn).getTime() < Date.now()).length;

  const invoiceTable = (rows: InvoiceDto[], withActions: boolean) => (
    <Card pad={false}>
      <table className="data-table data-table-cards">
        <thead>
          <tr>
            <th>Invoice</th><th>Student</th><th>Total</th><th>Paid</th><th>Due Date</th><th>Status</th>
            {withActions && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const due = dueOf(i);
            return (
              <tr key={i.id}>
                <td className="cell-primary" data-label="Invoice">{i.invoiceNo}</td><td data-label="Student">{i.studentName}</td>
                <td data-label="Total">{rupees(i.totalPaise)}</td><td data-label="Paid">{rupees(i.paidPaise)}</td>
                <td
                  data-label="Due Date"
                  style={withActions && new Date(i.dueOn).getTime() < Date.now() ? { color: 'var(--red)', fontWeight: 600 } : undefined}
                >
                  {fmtDate(i.dueOn)}
                </td>
                <td data-label="Status"><Pill tone={TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                {withActions && (
                  <td data-label="Actions">
                    {canPayOnline && due > 0 && i.status !== 'CANCELLED' ? (
                      <Button small onClick={() => setPaying(i)}>Pay {rupees(due)}</Button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Payments', desc: 'Your fee invoices and balances — pay outstanding fees online.' }}>
      {invoices === null && <Card><SkeletonRows rows={3} /></Card>}
      {invoices?.length === 0 && <EmptyState title="No invoices" sub="Fee invoices for your children appear here." />}

      {invoices && invoices.length > 0 && (
        <>
          {/* Amount due, and the one action that clears it, above everything else. */}
          {outstanding.length > 0 && (
            <Card style={{ marginBottom: 18, borderColor: overdueCount > 0 ? '#fca5a5' : undefined }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)', fontWeight: 600 }}>Total outstanding</div>
                  <div style={{ fontFamily: 'Newsreader, serif', fontSize: 30, fontWeight: 600, color: 'var(--text-1b)', lineHeight: 1.1, marginTop: 4 }}>
                    {rupees(outstandingTotalPaise)}
                  </div>
                  <div style={{ fontSize: 12.5, color: overdueCount > 0 ? 'var(--red)' : 'var(--text-faint)', marginTop: 5, fontWeight: overdueCount > 0 ? 600 : 400 }}>
                    {outstanding.length} unpaid invoice{outstanding.length === 1 ? '' : 's'}
                    {overdueCount > 0 && ` · ${overdueCount} past due`}
                  </div>
                </div>
                {canPayOnline && (
                  <Button onClick={() => setPaying(outstanding[0])}>
                    Pay now · {rupees(dueOf(outstanding[0]))}
                  </Button>
                )}
              </div>
              {canPayOnline && (
                <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 12 }}>
                  Pay now opens the earliest-due invoice ({outstanding[0].invoiceNo}). Invoices are paid one at a time.
                </p>
              )}
            </Card>
          )}

          {outstanding.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>
                Pending invoices
              </div>
              <div style={{ marginBottom: settled.length > 0 ? 22 : 0 }}>{invoiceTable(outstanding, true)}</div>
            </>
          )}

          {settled.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>
                Paid &amp; closed invoices
              </div>
              {invoiceTable(settled, false)}
            </>
          )}
        </>
      )}

      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onPaid={(receiptNo, sandbox) => {
            setPaying(null);
            toast(`Payment successful — receipt ${receiptNo}${sandbox ? ' (sandbox)' : ''}.`);
            void load();
          }}
        />
      )}
    </PortalShell>
  );
}

function PayModal({ invoice, onClose, onPaid }: {
  invoice: InvoiceDto;
  onClose: () => void;
  onPaid: (receiptNo: string, sandbox: boolean) => void;
}) {
  const duePaise = invoice.totalPaise - invoice.paidPaise;
  const [amount, setAmount] = useState(String(duePaise / 100));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const amountPaise = Math.round(Number(amount) * 100);
      const res = await api.payOnline({ invoiceId: invoice.id, amountPaise });

      // A real gateway returns an order, not a receipt — the money has not
      // moved yet. The payer completes it in Razorpay's own modal, and only a
      // signed result counts as payment.
      if (res.requiresClientAction) {
        const result = await runCheckout(res, {
          name: 'School fees',
          description: `Invoice ${invoice.invoiceNo}`,
          notes: { invoiceNo: invoice.invoiceNo },
        });
        const confirmed = await api.verifyCheckout({
          orderId: result.razorpay_order_id,
          paymentId: result.razorpay_payment_id,
          signature: result.razorpay_signature,
        });
        onPaid(confirmed.receiptNo ?? '—', false);
        return;
      }

      onPaid(res.receiptNo, res.sandbox);
    } catch (x) {
      if (x instanceof PaymentCancelled) {
        setErr(x.message);
        setBusy(false);
        return;
      }
      if (x instanceof ApiError && x.code === 'PAYMENTS_DISABLED') {
        setErr('Online payments are not enabled for this school yet. Please pay at the school office.');
      } else {
        setErr(x instanceof ApiError ? x.message : 'Payment failed. You have not been charged — please try again.');
      }
      setBusy(false);
    }
  };

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Pay invoice {invoice.invoiceNo}</div>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form onSubmit={pay}>
          <div style={{ fontSize: 13, color: 'var(--text-2b)', marginBottom: 14, lineHeight: 1.6 }}>
            {invoice.studentName} · Total {rupees(invoice.totalPaise)} · Outstanding <strong style={{ color: 'var(--text-1)' }}>{rupees(duePaise)}</strong>
          </div>

          <div className="field-label">Amount to pay (₹)</div>
          <input
            className="field-input"
            type="number"
            min={1}
            max={duePaise / 100}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#991b1b' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy || !amount || Number(amount) <= 0}>
              {busy ? 'Processing…' : `Pay ${amount ? rupees(Math.round(Number(amount) * 100)) : ''}`}
            </Button>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 12, lineHeight: 1.5 }}>
            Payments are processed by the school&apos;s configured payment provider and recorded
            against this invoice immediately. A receipt number is issued on success.
          </p>
        </form>
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
