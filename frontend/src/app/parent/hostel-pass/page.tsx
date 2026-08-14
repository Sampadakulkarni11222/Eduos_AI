'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { HostelPassDto } from '@/lib/types';

export default function ParentHostelPass() {
  const [passes, setPasses] = useState<HostelPassDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewingPass, setReviewingPass] = useState<HostelPassDto | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const loadPasses = () => {
    setLoading(true);
    api.listMyHostelPasses()
      .then(setPasses)
      .catch(() => setPasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPasses();
  }, []);

  const handleReview = async (status: 'APPROVED' | 'REJECTED') => {
    if (!reviewingPass) return;
    setSubmitting(true);
    try {
      await api.parentReviewHostelPass(reviewingPass.id, { status, remarks });
      toast(`Hostel pass ${status.toLowerCase()} successfully`, 'success');
      setReviewingPass(null);
      setRemarks('');
      loadPasses();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update pass approval', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Child Hostel Gate Pass', desc: 'Review and authorize hostel leave requests submitted by your children.' }}>
      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {!loading && passes && passes.length === 0 && (
          <EmptyState title="No hostel pass requests" sub="Your children have no active hostel pass requests." />
        )}
        {!loading && passes && passes.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Pass Type</th>
                <th>Departure (From)</th>
                <th>Return (To)</th>
                <th>Destination</th>
                <th>Reason</th>
                <th>Parent Approval</th>
                <th>Warden Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {passes.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary" data-label="Student">
                    <div>{p.studentName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{p.admissionNo}</div>
                  </td>
                  <td data-label="Pass Type">
                    {p.passType.replace('_', ' ')}
                    {p.isOverdue && (
                      <div style={{ marginTop: 4 }}>
                        <Pill tone="red">⚠️ Overdue Return</Pill>
                      </div>
                    )}
                  </td>
                  <td data-label="Departure">{new Date(p.fromDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Return">{new Date(p.toDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Destination">{p.destination}</td>
                  <td data-label="Reason">{p.reason}</td>
                  <td data-label="Parent Approval">
                    <Pill tone={p.parentApprovalStatus === 'APPROVED' ? 'green' : p.parentApprovalStatus === 'REJECTED' ? 'red' : p.parentApprovalStatus === 'NOT_REQUIRED' ? 'gray' : 'amber'}>
                      {p.parentApprovalStatus}
                    </Pill>
                  </td>
                  <td data-label="Warden Status">
                    <Pill tone={p.status === 'APPROVED' ? 'green' : p.status === 'RETURNED' ? 'blue' : p.status === 'OUT' ? 'red' : p.status === 'REJECTED' ? 'red' : 'amber'}>
                      {p.status}
                    </Pill>
                  </td>
                  <td data-label="Action">
                    {p.parentApprovalStatus === 'PENDING' && (
                      <Button variant="soft" small onClick={() => { setReviewingPass(p); setRemarks(''); }}>
                        Review
                      </Button>
                    )}
                    {p.parentApprovalStatus !== 'PENDING' && (
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Reviewed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Review Modal */}
      {reviewingPass && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <div className="modal-title">Parent Review - {reviewingPass.studentName}</div>
              <button className="modal-close" onClick={() => setReviewingPass(null)}>×</button>
            </div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-1)' }}>
              <div><strong>Pass Type:</strong> {reviewingPass.passType.replace('_', ' ')}</div>
              <div><strong>Destination:</strong> {reviewingPass.destination}</div>
              <div><strong>From:</strong> {new Date(reviewingPass.fromDate).toLocaleString('en-IN')}</div>
              <div><strong>To:</strong> {new Date(reviewingPass.toDate).toLocaleString('en-IN')}</div>
              <div><strong>Reason:</strong> {reviewingPass.reason}</div>
            </div>

            <div className="field-label">Parent Remarks (Optional)</div>
            <textarea className="field-input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add any comments or instructions..." />

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <Button style={{ background: '#10B981' }} disabled={submitting} onClick={() => handleReview('APPROVED')}>
                {submitting ? 'Updating…' : '✔ Approve Pass'}
              </Button>
              <Button variant="ghost" style={{ color: '#DC2626' }} disabled={submitting} onClick={() => handleReview('REJECTED')}>
                {submitting ? 'Updating…' : '✖ Reject Pass'}
              </Button>
              <Button variant="ghost" onClick={() => setReviewingPass(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
