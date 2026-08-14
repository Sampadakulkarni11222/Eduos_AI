'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { TeacherLeaveApplicationDto, LeaveStatus, LeaveType } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  EARNED: 'Earned',
  OTHER: 'Other',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dayCount(from: string, to: string) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export default function TeacherLeavePage() {
  const [applications, setApplications] = useState<TeacherLeaveApplicationDto[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const toast = useToast();

  const load = () => {
    api.myLeaveApplications()
      .then((data) => setApplications(data as unknown as TeacherLeaveApplicationDto[]))
      .catch(() => setApplications([]));
  };

  useEffect(() => { load(); }, []);

  const pending = applications?.filter((a) => a.status === 'PENDING').length ?? 0;

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'My Leave Applications',
      desc: 'Apply for leave and track your approval status.',
      actions: (
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Apply for leave'}
        </Button>
      ),
    }}>
      {showForm && (
        <ApplyLeaveForm
          onDone={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
          toast={toast}
        />
      )}

      {/* Summary chips */}
      {applications && applications.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--panel-bg)', border: '1px solid var(--hairline)', borderRadius: 20, padding: '5px 14px', fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{applications.length}</span> total
          </div>
          {pending > 0 && (
            <div style={{ background: 'var(--amber-bg, #fef3c7)', color: '#92400e', padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
              {pending} pending
            </div>
          )}
        </div>
      )}

      {applications === null && <Card><SkeletonRows rows={4} /></Card>}
      {applications?.length === 0 && !showForm && (
        <EmptyState
          title="No leave applications"
          sub="Use the button above to apply for leave. It will be reviewed by the principal or admin."
        />
      )}

      {applications && applications.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Applied On</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a._id}>
                  <td data-label="From">{fmtDate(a.fromDate)}</td>
                  <td data-label="To">{fmtDate(a.toDate)}</td>
                  <td data-label="Days" style={{ fontWeight: 600 }}>{dayCount(a.fromDate, a.toDate)}</td>
                  <td data-label="Type">
                    <span style={{ fontSize: 12, background: 'var(--panel-bg)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '2px 8px' }}>
                      {LEAVE_TYPE_LABELS[a.leaveType] ?? a.leaveType}
                    </span>
                  </td>
                  <td className="cell-primary" data-label="Reason">{a.reason}</td>
                  <td style={{ color: 'var(--text-faint)', fontSize: 12.5 }} data-label="Applied On">
                    {fmtDate(a.createdAt)}
                  </td>
                  <td data-label="Status">
                    <Pill tone={STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Pill>
                  </td>
                  <td data-label="Remarks" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    {a.remarks ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}

function ApplyLeaveForm({ onDone, onCancel, toast }: {
  onDone: () => void;
  onCancel: () => void;
  toast: (msg: string, kind?: 'success' | 'error') => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('CASUAL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setErr('Please enter a reason for leave.');
    if (toDate < fromDate) return setErr('End date cannot be before start date.');
    setBusy(true);
    setErr(null);
    try {
      await api.applyLeave({ fromDate, toDate, reason: reason.trim(), leaveType });
      toast('Leave application submitted successfully.', 'success');
      onDone();
    } catch (x: any) {
      setErr(x?.message ?? 'Could not submit. Please try again.');
      setBusy(false);
    }
  };

  const days = (() => {
    const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
    return Math.max(1, Math.round(ms / 86_400_000) + 1);
  })();

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 15, display: 'block', marginBottom: 14 }}>
          New Leave Application
        </strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="field-label">From date *</div>
            <input
              className="field-input" type="date" value={fromDate} min={today}
              onChange={(e) => { setFromDate(e.target.value); if (e.target.value > toDate) setToDate(e.target.value); }}
            />
          </div>
          <div>
            <div className="field-label">To date *</div>
            <input
              className="field-input" type="date" value={toDate} min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div>
            <div className="field-label">Leave type *</div>
            <select
              className="field-input"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            >
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="EARNED">Earned</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ background: 'var(--panel-bg)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{days}</span>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>day{days !== 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div className="field-label">Reason for leave *</div>
          <textarea
            className="field-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Family function, medical appointment…"
            style={{ resize: 'vertical' }}
            required
          />
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>⚠ {err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</Button>
          <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
