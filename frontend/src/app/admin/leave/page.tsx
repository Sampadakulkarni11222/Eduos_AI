'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Modal, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatCalendarDate } from '@/lib/timetable-dates';
import type { LeaveApplicationDto, LeaveStatus } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const fmt = (d: string) => formatCalendarDate(d);

export default function AdminLeaveManagementPage() {
  const [applications, setApplications] = useState<LeaveApplicationDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [selectedApp, setSelectedApp] = useState<LeaveApplicationDto | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const loadLeave = () => {
    api.listLeaveApplications({
      status: statusFilter || undefined,
      role: roleFilter || undefined,
    })
      .then(setApplications)
      .catch(() => setApplications([]));
  };

  useEffect(loadLeave, [statusFilter, roleFilter]);

  const handleReview = async () => {
    if (!selectedApp || !reviewAction) return;
    const appId = selectedApp.id || selectedApp._id;
    if (!appId) return;

    setBusy(true);
    try {
      await api.reviewLeaveApplication(appId, {
        status: reviewAction,
        remarks: remarks.trim() || undefined,
      });
      toast(`Leave application ${reviewAction.toLowerCase()}.`, 'success');
      setSelectedApp(null);
      setReviewAction(null);
      setRemarks('');
      loadLeave();
    } catch (err: any) {
      toast(err instanceof ApiError ? err.message : 'Failed to update leave status.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{
        title: 'Leave Management',
        desc: 'Review, approve, and manage leave requests for students and teachers.',
      }}
    >
      <Card pad={false}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Status:
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>

            <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Applicant Role:
              <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="">All Roles</option>
                <option value="STUDENT">Students</option>
                <option value="TEACHER">Teachers</option>
              </select>
            </label>
          </div>
        </div>

        {applications === null ? (
          <div style={{ padding: 20 }}>
            <SkeletonRows rows={6} />
          </div>
        ) : applications.length === 0 ? (
          <EmptyState
            icon="⊘"
            title="No leave applications found"
            sub="No leave applications match the selected status or role filters."
          />
        ) : (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Role / Class</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Reviewer / Remarks</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => {
                const key = a.id || a._id || String(Math.random());
                const name = a.applicantName || a.studentName || 'Applicant';
                const roleBadge = a.applicantRole === 'TEACHER' ? 'Teacher' : a.class ? `Student (${a.class})` : 'Student';

                return (
                  <tr key={key}>
                    <td className="cell-primary" data-label="Applicant">
                      {name}
                    </td>
                    <td data-label="Role / Class">{roleBadge}</td>
                    <td data-label="Type">
                      <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 4 }}>
                        {a.leaveType || 'CASUAL'}
                      </span>
                    </td>
                    <td data-label="Dates">
                      {fmt(a.fromDate)}
                      {a.fromDate !== a.toDate ? ` – ${fmt(a.toDate)}` : ''}
                    </td>
                    <td data-label="Reason" style={{ maxWidth: 220, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      {a.reason}
                    </td>
                    <td data-label="Status">
                      <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
                    </td>
                    <td data-label="Remarks" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {a.remarks ? (
                        <>
                          <strong>{a.reviewedByName || 'Reviewer'}:</strong> {a.remarks}
                        </>
                      ) : (
                        a.reviewedByName || '—'
                      )}
                    </td>
                    <td data-label="Actions">
                      {a.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button
                            small
                            onClick={() => {
                              setSelectedApp(a);
                              setReviewAction('APPROVED');
                              setRemarks('');
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            small
                            variant="ghost"
                            onClick={() => {
                              setSelectedApp(a);
                              setReviewAction('REJECTED');
                              setRemarks('');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Completed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selectedApp && reviewAction && (
        <Modal
          title={`${reviewAction === 'APPROVED' ? 'Approve' : 'Reject'} Leave Application`}
          onClose={() => {
            setSelectedApp(null);
            setReviewAction(null);
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 12 }}>
            Applicant: <strong>{selectedApp.applicantName || selectedApp.studentName}</strong> ({fmt(selectedApp.fromDate)} – {fmt(selectedApp.toDate)})
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
            Reason: <em>"{selectedApp.reason}"</em>
          </div>

          <div className="field-label">Reviewer Remarks (Optional)</div>
          <textarea
            className="field-input"
            rows={3}
            placeholder="Add notes or reason for approval/rejection…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSelectedApp(null);
                setReviewAction(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReview}
              disabled={busy}
              style={{
                background: reviewAction === 'REJECTED' ? 'var(--red, #e53e3e)' : undefined,
                borderColor: reviewAction === 'REJECTED' ? 'var(--red, #e53e3e)' : undefined,
              }}
            >
              {busy ? 'Saving…' : `Confirm ${reviewAction === 'APPROVED' ? 'Approval' : 'Rejection'}`}
            </Button>
          </div>
        </Modal>
      )}
    </PortalShell>
  );
}
