'use client';
import { useState } from 'react';
import { Button, useToast } from '../ui';
import { api } from '@/lib/api';
import { toISODate } from '@/lib/timetable-dates';
import type { LeaveType } from '@/lib/types';

export function ApplyLeaveModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const today = toISODate(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [leaveType, setLeaveType] = useState<LeaveType>('CASUAL');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (toDate < fromDate) {
      toast('End date cannot be before start date.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.applyLeave({ leaveType, fromDate, toDate, reason: reason.trim() });
      toast('Leave application submitted.', 'success');
      onApplied();
    } catch (err: any) {
      toast(err.message || 'Could not submit the leave application.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Apply for Leave</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field-label">Leave Type *</div>
          <select className="field-input" value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
            <option value="CASUAL">Casual Leave</option>
            <option value="SICK">Sick Leave</option>
            <option value="PERSONAL">Personal Leave</option>
            <option value="DUTY">Duty Leave</option>
            <option value="OTHER">Other</option>
          </select>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">From Date *</div>
              <input className="field-input" type="date" required value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">To Date *</div>
              <input className="field-input" type="date" required value={toDate} onChange={(e) => setToDate(e.target.value)} />
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

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Application'}</Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
