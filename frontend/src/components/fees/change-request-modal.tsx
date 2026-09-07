'use client';
import { FormEvent, useState } from 'react';
import { Button, DateField, rupees } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { PaymentReceiptDto } from '@/lib/types';

/**
 * Finance's route to changing a payment that has already been published.
 *
 * The form asks for the field, the new value and — always — a reason, because
 * the reason is what the admin actually decides on. The current value is shown
 * beside the box rather than being retyped: an admin reading this a week later
 * needs to see what the record said when the request was raised.
 */

const FIELDS: { value: string; label: string; kind: 'amount' | 'date' | 'text' | 'mode' }[] = [
  { value: 'amountPaise', label: 'Amount', kind: 'amount' },
  { value: 'paidOn', label: 'Payment date', kind: 'date' },
  { value: 'mode', label: 'Payment method', kind: 'mode' },
  { value: 'receiptNo', label: 'Receipt number', kind: 'text' },
  { value: 'notes', label: 'Notes', kind: 'text' },
  { value: 'instrument.number', label: 'Cheque / DD / transaction number', kind: 'text' },
  { value: 'instrument.bankName', label: 'Bank name', kind: 'text' },
  { value: 'instrument.instrumentDate', label: 'Cheque / DD / transfer date', kind: 'date' },
];

const MODES = ['CASH', 'CHEQUE', 'DD', 'BANK', 'GATEWAY'];

function currentValueOf(payment: PaymentReceiptDto, field: string): string {
  switch (field) {
    case 'amountPaise': return rupees(payment.amountPaise);
    case 'paidOn': return payment.paidOn ? new Date(payment.paidOn).toLocaleDateString('en-IN') : '—';
    case 'mode': return payment.mode;
    case 'receiptNo': return payment.receiptNo;
    case 'instrument.number': return payment.instrument?.number ?? '—';
    case 'instrument.bankName': return payment.instrument?.bankName ?? '—';
    case 'instrument.instrumentDate':
      return payment.instrument?.instrumentDate
        ? new Date(payment.instrument.instrumentDate).toLocaleDateString('en-IN')
        : '—';
    default: return '—';
  }
}

export function PaymentChangeRequestModal({
  payment, onClose, onDone,
}: {
  payment: PaymentReceiptDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const [field, setField] = useState(FIELDS[0].value);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const kind = FIELDS.find((f) => f.value === field)?.kind ?? 'text';

  const upload = async (file: File | undefined | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadFile(file);
      setProof({ url: res.fileUrl, name: res.filename });
    } catch (e) {
      setErr(errorMessage(e, 'Upload failed.'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || !reason.trim()) {
      setErr('A requested value and a reason are both required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.requestPaymentChange(payment.id, {
        field,
        // Amounts are keyed in rupees and stored in paise, like everywhere else.
        requestedValue: kind === 'amount' ? String(Math.round(parseFloat(value) * 100)) : value.trim(),
        reason: reason.trim(),
        documentUrl: proof?.url,
        documentName: proof?.name,
      });
      onDone();
    } catch (e) {
      setErr(errorMessage(e, 'Could not submit the change request.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">Request payment change</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12 }}>
          {payment.receiptNo} · {payment.studentName} · {rupees(payment.amountPaise)}.
          This payment is published, so the change is applied only if an administrator approves it.
        </p>

        <form onSubmit={submit}>
          <div className="field-label">Field to change *</div>
          <select className="field-input" value={field} onChange={(e) => { setField(e.target.value); setValue(''); }}>
            {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          <div className="field-label">Existing value</div>
          <input className="field-input" value={currentValueOf(payment, field)} readOnly disabled />

          <div className="field-label">Requested new value *</div>
          {kind === 'date' && (
            <DateField inputClassName="field-input" ariaLabel="Requested new value" required value={value} onChange={setValue} />
          )}
          {kind === 'mode' && (
            <select className="field-input" value={value} onChange={(e) => setValue(e.target.value)} required>
              <option value="">Select a method…</option>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {kind === 'amount' && (
            <input
              className="field-input" type="number" min="0.01" step="0.01" placeholder="Amount in ₹"
              value={value} onChange={(e) => setValue(e.target.value)} required
            />
          )}
          {kind === 'text' && (
            <input className="field-input" value={value} onChange={(e) => setValue(e.target.value)} required />
          )}

          <div className="field-label">Reason for change *</div>
          <textarea
            className="field-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why does this record need to change?" required
          />

          <div className="field-label">Supporting document (optional)</div>
          <input
            type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={(e) => void upload(e.target.files?.[0])}
            disabled={uploading}
            aria-label="Supporting document"
            style={{ display: 'block', fontSize: 13, width: '100%' }}
          />
          {uploading && <div className="pay-upload-status"><span className="spinner" style={{ width: 14, height: 14 }} /> Uploading…</div>}
          {proof && <div className="pay-upload-status" style={{ color: 'var(--green)', fontWeight: 600 }}>✓ {proof.name} attached</div>}

          {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }} role="alert">{err}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button type="submit" disabled={busy || uploading} style={{ flex: 1 }}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
