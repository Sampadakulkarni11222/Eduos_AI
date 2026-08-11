'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { HostelPassDto } from '@/lib/types';

export default function WardenPasses() {
  const [passes, setPasses] = useState<HostelPassDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const [reviewModalPass, setReviewModalPass] = useState<HostelPassDto | null>(null);
  const [remarks, setRemarks] = useState('');

  const toast = useToast();

  const loadPasses = () => {
    setLoading(true);
    api.listHostelPasses({ status: filterStatus || undefined })
      .then(setPasses)
      .catch(() => setPasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPasses();
  }, [filterStatus]);

  const handleWardenReview = async (status: 'APPROVED' | 'REJECTED') => {
    if (!reviewModalPass) return;
    setActioningId(reviewModalPass.id);
    try {
      await api.wardenReviewHostelPass(reviewModalPass.id, { status, remarks });
      toast(`Pass ${status.toLowerCase()} successfully`, 'success');
      setReviewModalPass(null);
      setRemarks('');
      loadPasses();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update pass', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleGateMovement = async (passId: string, action: 'EXIT' | 'ENTRY') => {
    if (!confirm(`Are you sure you want to mark student as ${action === 'EXIT' ? 'DEPARTED (OUT)' : 'RETURNED'}?`)) return;
    setActioningId(passId);
    try {
      await api.recordHostelMovement(passId, { action });
      toast(`Gate movement (${action}) recorded`, 'success');
      loadPasses();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to record gate movement', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const pendingCount = (passes ?? []).filter((p) => p.status === 'PENDING').length;
  const outCount = (passes ?? []).filter((p) => p.status === 'OUT').length;
  const overdueCount = (passes ?? []).filter((p) => p.isOverdue).length;

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Hostel Gate Pass Management', desc: 'Review student leave/pass applications, parent approvals, and record gate movements.' }}>
      {/* Top summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>Pending Review</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--text-1)' }}>{passes ? pendingCount : '—'}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>Students Currently OUT</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#D97706' }}>{passes ? outCount : '—'}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>Overdue Returns</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#DC2626' }}>{passes ? overdueCount : '—'}</div>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {['', 'PENDING', 'APPROVED', 'OUT', 'RETURNED', 'OVERDUE', 'REJECTED'].map((s) => (
          <button
            key={s}
            className={`chip-tab ${filterStatus === s ? 'active' : ''}`}
            onClick={() => setFilterStatus(s)}
          >
            {s === '' ? 'All Passes' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {!loading && passes && passes.length === 0 && (
          <EmptyState title="No hostel passes" sub="No hostel passes matched your filter criteria." />
        )}
        {!loading && passes && passes.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Pass Type</th>
                <th>Departure (From)</th>
                <th>Expected Return</th>
                <th>Destination / Contact</th>
                <th>Parent Status</th>
                <th>Warden Status</th>
                <th>Gate Timestamps</th>
                <th>Actions</th>
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
                        <Pill tone="red">⚠️ Overdue ({p.overdueHours}h)</Pill>
                      </div>
                    )}
                  </td>
                  <td data-label="Departure">{new Date(p.fromDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Expected Return">{new Date(p.toDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Destination / Contact">
                    <div>{p.destination}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>📞 {p.emergencyContact}</div>
                  </td>
                  <td data-label="Parent Status">
                    <Pill tone={p.parentApprovalStatus === 'APPROVED' ? 'green' : p.parentApprovalStatus === 'REJECTED' ? 'red' : p.parentApprovalStatus === 'NOT_REQUIRED' ? 'gray' : 'amber'}>
                      {p.parentApprovalStatus}
                    </Pill>
                  </td>
                  <td data-label="Warden Status">
                    <Pill tone={p.status === 'APPROVED' ? 'green' : p.status === 'RETURNED' ? 'blue' : p.status === 'OUT' ? 'red' : p.status === 'REJECTED' ? 'red' : 'amber'}>
                      {p.status}
                    </Pill>
                  </td>
                  <td data-label="Gate Timestamps" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {p.actualExitTime && <div>Exit: {new Date(p.actualExitTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}</div>}
                    {p.actualReturnTime && <div>Entry: {new Date(p.actualReturnTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}</div>}
                    {!p.actualExitTime && !p.actualReturnTime && <span>No gate activity</span>}
                  </td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {p.status === 'PENDING' && (
                        <Button
                          variant="soft"
                          small
                          onClick={() => { setReviewModalPass(p); setRemarks(''); }}
                          disabled={actioningId === p.id}
                        >
                          Review
                        </Button>
                      )}
                      {p.status === 'APPROVED' && (
                        <Button
                          variant="soft"
                          small
                          onClick={() => handleGateMovement(p.id, 'EXIT')}
                          disabled={actioningId === p.id}
                        >
                          Mark OUT
                        </Button>
                      )}
                      {p.status === 'OUT' && (
                        <Button
                          variant="soft"
                          small
                          onClick={() => handleGateMovement(p.id, 'ENTRY')}
                          disabled={actioningId === p.id}
                        >
                          Mark RETURNED
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Review Modal */}
      {reviewModalPass && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <div className="modal-title">Warden Review - {reviewModalPass.studentName}</div>
              <button className="modal-close" onClick={() => setReviewModalPass(null)}>×</button>
            </div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-1)' }}>
              <div><strong>Pass Type:</strong> {reviewModalPass.passType.replace('_', ' ')}</div>
              <div><strong>Destination:</strong> {reviewModalPass.destination}</div>
              <div><strong>From:</strong> {new Date(reviewModalPass.fromDate).toLocaleString('en-IN')}</div>
              <div><strong>To:</strong> {new Date(reviewModalPass.toDate).toLocaleString('en-IN')}</div>
              <div><strong>Reason:</strong> {reviewModalPass.reason}</div>
              <div style={{ marginTop: 8 }}>
                <strong>Parent Approval Status: </strong>
                <Pill tone={reviewModalPass.parentApprovalStatus === 'APPROVED' ? 'green' : reviewModalPass.parentApprovalStatus === 'REJECTED' ? 'red' : 'amber'}>
                  {reviewModalPass.parentApprovalStatus}
                </Pill>
              </div>
              {reviewModalPass.parentRemarks && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  <em>Parent Remarks: "{reviewModalPass.parentRemarks}"</em>
                </div>
              )}
            </div>

            <div className="field-label">Warden Remarks (Optional)</div>
            <textarea className="field-input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add review notes or gate pass instructions..." />

            {reviewModalPass.parentApprovalStatus === 'PENDING' && (
              <div style={{ padding: '8px 12px', background: '#FEF3C7', color: '#92400E', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
                ⚠️ Parent approval is currently PENDING. Pass cannot be approved until parent approves.
              </div>
            )}
            {reviewModalPass.parentApprovalStatus === 'REJECTED' && (
              <div style={{ padding: '8px 12px', background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
                ✖ Parent has REJECTED this pass request.
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <Button
                style={{ background: '#10B981' }}
                disabled={actioningId === reviewModalPass.id || reviewModalPass.parentApprovalStatus === 'PENDING' || reviewModalPass.parentApprovalStatus === 'REJECTED'}
                onClick={() => handleWardenReview('APPROVED')}
              >
                ✔ Approve Pass
              </Button>
              <Button
                variant="ghost"
                style={{ color: '#DC2626' }}
                disabled={actioningId === reviewModalPass.id}
                onClick={() => handleWardenReview('REJECTED')}
              >
                ✖ Reject Pass
              </Button>
              <Button variant="ghost" onClick={() => setReviewModalPass(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
