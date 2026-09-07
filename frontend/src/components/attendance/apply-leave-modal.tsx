'use client';
import { useState } from 'react';
import { Button, DateField, useToast } from '../ui';
import { OptionalDocumentInput, type AttachedDocument } from '../optional-document-input';
import { api, errorMessage } from '@/lib/api';
import { toISODate } from '@/lib/timetable-dates';

export function ApplyLeaveModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const today = toISODate(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<AttachedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Both are plain "YYYY-MM-DD" strings, so lexical comparison is calendar
    // comparison — no Date parsing, and so no timezone to shift the day.
    if (fromDate < today) {
      toast('Leave cannot be applied for a date in the past.', 'error');
      return;
    }
    if (toDate < fromDate) {
      toast('End date cannot be before start date.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.applyLeave({
        fromDate,
        toDate,
        reason: reason.trim(),
        // Optional throughout: null here is a complete application, and the
        // server treats it the same way.
        documentUrl: doc?.documentUrl ?? null,
        documentName: doc?.documentName ?? null,
      });
      toast('Leave application submitted.', 'success');
      onApplied();
    } catch (err: unknown) {
      toast(errorMessage(err, 'Could not submit the leave application.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Apply for Leave</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">From Date *</div>
              <DateField inputClassName="field-input" ariaLabel="From date" required min={today} value={fromDate} onChange={setFromDate} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">To Date *</div>
              <DateField inputClassName="field-input" ariaLabel="To date" required min={fromDate || today} value={toDate} onChange={setToDate} />
            </div>
          </div>

          <div className="field-label">Reason *</div>
          <textarea
            className="field-input"
            required
            rows={3}
            placeholder="e.g. Fever, family function, medical appointment…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />

          <OptionalDocumentInput
            label="Supporting document"
            hint="Optional — a medical certificate, for example. You can submit without one."
            value={doc}
            onChange={setDoc}
            onBusyChange={setUploading}
          />

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy || uploading}>{busy ? 'Submitting…' : 'Submit Application'}</Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
