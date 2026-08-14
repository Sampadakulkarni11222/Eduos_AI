'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { TeacherLeaveApplicationDto, LeaveStatus } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const LEAVE_TYPE_LABELS: Record<string, string> = {
  CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', OTHER: 'Other',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dayCount(from: string, to: string) {
  return Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1);
}

export default function AdminStaffLeavePage() {
  const [applications, setApplications] = useState<TeacherLeaveApplicationDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [reviewing, setReviewing] = useState<{ app: TeacherLeaveApplicationDto; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => {
    setApplications(null);
    api.staffLeaveApplications(statusFilter || undefined)
      .then(setApplications)
      .catch(() => setApplications([]));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleReview = async () => {
    if (!reviewing) return;
    setBusy(true);
    try {
      await api.reviewStaffLeave(reviewing.app._id, {
        status: reviewing.action,
        remarks: remarks.trim() || undefined,
      });
      toast(
        reviewing.action === 'APPROVED'
          ? `Leave approved for ${reviewing.app.applicantName}.`
          : `Leave rejected for ${reviewing.app.applicantName}.`,
        'success'
      );
      setReviewing(null);
      setRemarks('');
      load();
    } catch (x: any) {
      toast(x?.message ?? 'Could not process review.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const pending = applications?.filter((a) => a.status === 'PENDING').length ?? 0;

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Staff Leave Applications',
      desc: 'Review and approve or reject staff leave requests.',
      actions: pending > 0 ? (
        <div style={{ background: 'var(--amber-bg, #fef3c7)', color: '#92400e', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
          {pending} pending
        </div>
      ) : undefined,
    }}>
      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s}
            className={`chip-tab${statusFilter === s ? ' active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === '' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {applications === null && <Card><SkeletonRows rows={6} /></Card>}
      {applications?.length === 0 && (
        <EmptyState
          title={statusFilter === 'PENDING' ? 'No pending requests' : 'No leave applications'}
          sub={statusFilter === 'PENDING' ? 'All staff applications have been reviewed.' : 'No applications match this filter.'}
        />
      )}

      {applications && applications.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Staff Member</th>
                <th>Role</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a._id}>
                  <td className="cell-primary" data-label="Staff Member">{a.applicantName}</td>
                  <td data-label="Role" style={{ fontSize: 12.5 }}>
                    <span style={{ textTransform: 'capitalize' }}>{a.role.toLowerCase()}</span>
                  </td>
                  <td data-label="Type" style={{ fontSize: 12.5 }}>
                    {LEAVE_TYPE_LABELS[a.leaveType] ?? a.leaveType}
                  </td>
                  <td data-label="From">{fmtDate(a.fromDate)}</td>
                  <td data-label="To">{fmtDate(a.toDate)}</td>
                  <td data-label="Days" style={{ fontWeight: 600, textAlign: 'center' }}>
                    {dayCount(a.fromDate, a.toDate)}
                  </td>
                  <td data-label="Reason" style={{ maxWidth: 200, fontSize: 12.5 }}>{a.reason}</td>
                  <td data-label="Applied" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                    {fmtDate(a.createdAt)}
                  </td>
                  <td data-label="Status">
                    <div>
                      <Pill tone={STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Pill>
                      {a.remarks && (
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }} title={a.remarks}>
                          {a.remarks.slice(0, 30)}{a.remarks.length > 30 ? 'ΓÇª' : ''}
                        </div>
                      )}
                    </div>
                  </td>
                  <td data-label="Actions">
                    {a.status === 'PENDING' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button small onClick={() => { setReviewing({ app: a, action: 'APPROVED' }); setRemarks(''); }}
                          style={{ background: 'var(--green)', color: '#fff', border: 'none' }}>
                          Approve
                        </Button>
                        <Button small variant="ghost" onClick={() => { setReviewing({ app: a, action: 'REJECTED' }); setRemarks(''); }}
                          style={{ color: 'var(--red)' }}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {a.reviewedAt ? fmtDate(a.reviewedAt) : 'ΓÇö'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Review confirmation modal */}
      {reviewing && (
        <div className="modal-overlay" onClick={() => setReviewing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">
                {reviewing.action === 'APPROVED' ? 'Approve leave?' : 'Reject leave?'}
              </div>
              <button className="modal-close" onClick={() => setReviewing(null)}>├ù</button>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 8 }}>
              <strong>{reviewing.app.applicantName}</strong> ({LEAVE_TYPE_LABELS[reviewing.app.leaveType] ?? reviewing.app.leaveType})
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              {fmtDate(reviewing.app.fromDate)} ΓÇô {fmtDate(reviewing.app.toDate)} ┬╖ {dayCount(reviewing.app.fromDate, reviewing.app.toDate)} day{dayCount(reviewing.app.fromDate, reviewing.app.toDate) !== 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14, fontStyle: 'italic' }}>
              "{reviewing.app.reason}"
            </p>
            <div className="field-label">Remarks (optional)</div>
            <textarea
              className="field-input"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={reviewing.action === 'APPROVED' ? 'e.g. Approved. Ensure class coverage.' : 'e.g. Please provide medical certificate.'}
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Button
                onClick={handleReview}
                disabled={busy}
                style={{
                  flex: 1,
                  background: reviewing.action === 'APPROVED' ? 'var(--green)' : 'var(--red)',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {busy ? 'SavingΓÇª' : reviewing.action === 'APPROVED' ? 'Approve' : 'Reject'}
              </Button>
              <Button variant="ghost" onClick={() => setReviewing(null)} disabled={busy} style={{ flex: 1 }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
