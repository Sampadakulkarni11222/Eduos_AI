'use client';
import { FormEvent, useRef, useState } from 'react';
import { Button, DateField, Pill, rupees } from '../ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { InvoiceDto } from '@/lib/types';

/**
 * Registering a payment against an invoice.
 *
 * The form is driven by the payment method: cash needs an amount and a date,
 * while cheque, DD and bank transfer each need their instrument's number, its
 * bank, its own date, and an image of it. Those four are marked * and blocked
 * here — and independently required by the server, which is what actually
 * enforces them. This form's job is to stop a cashier wasting a submission,
 * not to be the rule.
 *
 * Who may finalize is likewise the server's decision. Finance's submission
 * comes back `awaitingApproval`, and this modal says so rather than claiming
 * the payment is done.
 */

type Mode = 'CASH' | 'CHEQUE' | 'DD' | 'BANK';

/**
 * What each method calls its fields. One shape, three vocabularies — a cheque
 * has a cheque number, a transfer has a UTR, and showing a cashier the wrong
 * word is how the wrong number ends up in the box.
 */
const METHOD_FIELDS: Record<Mode, null | { number: string; bank: string; date: string; proof: string; hint: string }> = {
  CASH: null,
  CHEQUE: {
    number: 'Cheque number', bank: 'Bank name', date: 'Cheque date', proof: 'Cheque image',
    hint: 'A photo or scan of the cheque is required.',
  },
  DD: {
    number: 'DD number', bank: 'Bank name', date: 'DD date', proof: 'DD image',
    hint: 'A photo or scan of the demand draft is required.',
  },
  BANK: {
    number: 'Transaction / UTR number', bank: 'Bank name', date: 'Transfer date', proof: 'Transfer proof',
    hint: 'The bank receipt or transfer screenshot is required.',
  },
};

const PROOF_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const PROOF_MAX_BYTES = 10 * 1024 * 1024;

const Req = () => <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function RecordPaymentModal({
  invoice, onClose, onDone,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onDone: (result: { receiptNo: string; awaitingApproval: boolean }) => void;
}) {
  const remaining = invoice.totalPaise - invoice.paidPaise;

  const [amount, setAmount] = useState(String(remaining / 100));
  const [mode, setMode] = useState<Mode>('CASH');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [notes, setNotes] = useState('');

  const [number, setNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [instrumentDate, setInstrumentDate] = useState('');
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = METHOD_FIELDS[mode];
  const amountPaise = Math.round(parseFloat(amount || '0') * 100);

  const upload = async (file: File | undefined | null) => {
    if (!file) return;
    setUploadError(null);
    if (file.size > PROOF_MAX_BYTES) {
      setUploadError('That file is larger than 10 MB. Please upload a smaller scan or photo.');
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      setUploadError('Proof must be a PDF or an image (png, jpg, webp).');
      return;
    }
    setUploading(true);
    try {
      const res = await api.uploadFile(file);
      setProof({ url: res.fileUrl, name: res.filename });
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'Upload failed. Please try again.');
      setProof(null);
    } finally {
      setUploading(false);
    }
  };

  /** The same checks the server runs, so the cashier hears about them sooner. */
  const validate = (): string[] => {
    const missing: string[] = [];
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) missing.push('A payment amount');
    if (amountPaise > remaining) missing.push(`An amount no greater than the ${rupees(remaining)} outstanding`);
    if (!paidOn) missing.push('The payment date');
    if (fields) {
      if (!number.trim()) missing.push(fields.number);
      if (!bankName.trim()) missing.push(fields.bank);
      if (!instrumentDate) missing.push(fields.date);
      if (!proof?.url) missing.push(fields.proof);
    }
    return missing;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = validate();
    setFieldErrors(missing);
    if (missing.length) return;

    setBusy(true);
    setErr(null);
    try {
      const res = await api.recordPayment({
        invoiceId: invoice.id,
        amountPaise,
        mode,
        paidOn,
        notes: notes.trim() || undefined,
        instrument: fields
          ? {
            number: number.trim(),
            bankName: bankName.trim(),
            instrumentDate,
            proofUrl: proof!.url,
            proofName: proof!.name,
          }
          : undefined,
      });
      onDone({ receiptNo: res.receiptNo, awaitingApproval: res.awaitingApproval === true });
    } catch (e: unknown) {
      // The server names the specific failure — the outstanding balance, or
      // exactly which instrument fields are missing — better than we could.
      const known = e instanceof ApiError && [
        'PAYMENT_EXCEEDS_BALANCE', 'INVOICE_CANCELLED', 'INVALID_AMOUNT', 'INVALID_PAYMENT_MODE',
        'PAYMENT_DETAILS_INCOMPLETE', 'PAYMENT_PROOF_INVALID', 'INVALID_PAYMENT_DATE',
      ].includes(e.code);
      setErr(known ? (e as ApiError).message : errorMessage(e, 'Could not record payment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title">Record payment</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
          {invoice.invoiceNo} · {invoice.studentName}
          {invoice.academicYearName ? ` · ${invoice.academicYearName}` : ''}
          {' · '}balance <strong>{rupees(remaining)}</strong>
        </p>

        <form onSubmit={submit}>
          <div className="pay-form-grid">
            <div>
              <div className="field-label">Amount (₹)<Req /></div>
              <input
                className="field-input"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="field-label">Payment date<Req /></div>
              <DateField
                inputClassName="field-input"
                ariaLabel="Payment date"
                required
                max={todayIso()}
                value={paidOn}
                onChange={setPaidOn}
              />
            </div>
          </div>

          <div className="field-label">Payment method<Req /></div>
          <select
            className="field-input"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setFieldErrors([]);
            }}
            aria-label="Payment method"
          >
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="DD">DD / Demand Draft</option>
            <option value="BANK">Bank transfer</option>
          </select>

          {fields && (
            <div className="pay-instrument">
              <div className="pay-instrument-hint">{fields.hint}</div>
              <div className="pay-form-grid">
                <div>
                  <div className="field-label">{fields.number}<Req /></div>
                  <input className="field-input" value={number} onChange={(e) => setNumber(e.target.value)} required />
                </div>
                <div>
                  <div className="field-label">{fields.bank}<Req /></div>
                  <input className="field-input" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
                </div>
              </div>

              <div className="field-label">{fields.date}<Req /></div>
              <DateField
                inputClassName="field-input"
                ariaLabel={fields.date}
                required
                value={instrumentDate}
                onChange={setInstrumentDate}
              />

              <div className="field-label">{fields.proof}<Req /></div>
              <input
                ref={fileRef}
                type="file"
                accept={PROOF_ACCEPT}
                onChange={(e) => void upload(e.target.files?.[0])}
                disabled={uploading}
                aria-label={fields.proof}
                style={{ display: 'block', fontSize: 13, width: '100%', marginBottom: 6 }}
              />
              {uploading && (
                <div className="pay-upload-status">
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Uploading…
                </div>
              )}
              {!uploading && proof && (
                <div className="pay-upload-status" style={{ color: 'var(--green)', fontWeight: 600 }}>
                  ✓ {proof.name} attached
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setProof(null); if (fileRef.current) fileRef.current.value = ''; }}
                  >
                    Replace
                  </button>
                </div>
              )}
              {uploadError && <p style={{ color: 'var(--red)', fontSize: 12.5, margin: '4px 0 0' }}>{uploadError}</p>}
            </div>
          )}

          <div className="field-label">Notes (optional)</div>
          <input
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. collected at the front office"
          />

          {fieldErrors.length > 0 && (
            <div className="pay-error" role="alert">
              <strong>Still needed:</strong>
              <ul style={{ margin: '4px 0 0 16px' }}>
                {fieldErrors.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          )}
          {err && <p style={{ color: 'var(--red)', fontSize: 13, margin: '10px 0' }} role="alert">{err}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Button type="submit" disabled={busy || uploading} style={{ flex: 1 }}>
              {busy ? 'Recording…' : 'Record payment'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Confirmation shown after a successful registration. */
export function PaymentRecordedNotice({
  receiptNo, awaitingApproval, onClose,
}: {
  receiptNo: string;
  awaitingApproval: boolean;
  onClose: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>{awaitingApproval ? '🕐' : '✅'}</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>
          {awaitingApproval ? 'Sent for admin approval' : 'Payment published'}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          {awaitingApproval
            ? 'The payment has been recorded with its proof. It is not counted against the invoice, and the family will not see it, until an administrator approves it.'
            : 'The payment has been recorded and credited to the invoice.'}
        </p>
        <div style={{ marginBottom: 16 }}>
          <Pill tone={awaitingApproval ? 'amber' : 'green'}>Receipt {receiptNo}</Pill>
        </div>
        <Button onClick={onClose} className="btn-block">Done</Button>
      </div>
    </div>
  );
}
