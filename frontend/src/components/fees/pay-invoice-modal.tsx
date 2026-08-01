'use client';
import { FormEvent, useState } from 'react';
import { Button, Field, Modal, rupees } from '../ui';
import { api, ApiError } from '@/lib/api';
import { runCheckout, PaymentCancelled } from '@/lib/razorpay';
import type { InvoiceDto } from '@/lib/types';

export function PayInvoiceModal({ invoice, onClose, onPaid }: {
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
      // moved yet, and the payer completes it in Razorpay's own modal.
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
      } else if (x instanceof ApiError && x.code === 'PAYMENTS_DISABLED') {
        setErr('Online payments are not enabled for this school yet. Please pay at the school office.');
      } else {
        setErr(x instanceof ApiError ? x.message : 'Payment failed. You have not been charged — please try again.');
      }
      setBusy(false);
    }
  };

  return (
    <Modal title={`Pay invoice ${invoice.invoiceNo}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={pay}>
        <div style={{ fontSize: 13, color: 'var(--text-2b)', marginBottom: 14, lineHeight: 1.6 }}>
          Total {rupees(invoice.totalPaise)} · Outstanding <strong style={{ color: 'var(--text-1)' }}>{rupees(duePaise)}</strong>
        </div>

        <Field label="Amount to pay (₹)" required error={err ?? undefined}>
          <input
            className="field-input"
            type="number"
            min={1}
            max={duePaise / 100}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

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
    </Modal>
  );
}
