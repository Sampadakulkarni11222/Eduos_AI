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
  const toast = useToast();

  const load = () => api.invoices().then(setInvoices).catch(() => setInvoices([]));
  useEffect(() => { void load(); }, []);

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Payments', desc: 'Your fee invoices and balances — pay outstanding fees online.' }}>
      {invoices === null && <Card><SkeletonRows rows={3} /></Card>}
      {invoices?.length === 0 && <EmptyState title="No invoices" sub="Fee invoices for your children appear here." />}
      {invoices && invoices.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Invoice</th><th>Student</th><th>Total</th><th>Paid</th><th>Due Date</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invoices.map((i) => {
                const due = i.totalPaise - i.paidPaise;
                return (
                  <tr key={i.id}>
                    <td className="cell-primary" data-label="Invoice">{i.invoiceNo}</td><td data-label="Student">{i.studentName}</td>
                    <td data-label="Total">{rupees(i.totalPaise)}</td><td data-label="Paid">{rupees(i.paidPaise)}</td>
                    <td data-label="Due Date">{fmtDate(i.dueOn)}</td>
                    <td data-label="Status"><Pill tone={TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                    <td data-label="Actions">
                      {due > 0 && i.status !== 'CANCELLED' ? (
                        <Button small onClick={() => setPaying(i)}>Pay {rupees(due)}</Button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
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
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
            Payments are processed by the school's configured payment provider and recorded
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
