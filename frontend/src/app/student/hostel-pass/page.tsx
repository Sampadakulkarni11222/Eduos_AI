'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { HostelPassDto, HostelPassType } from '@/lib/types';

export default function StudentHostelPass() {
  const [passes, setPasses] = useState<HostelPassDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    passType: 'DAY_PASS' as HostelPassType,
    fromDate: '',
    toDate: '',
    reason: '',
    destination: '',
    emergencyContact: '',
  });

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

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fromDate || !form.toDate || !form.reason || !form.destination || !form.emergencyContact) {
      toast('Please fill in all required fields', 'error');
      return;
    }
    if (new Date(form.toDate) <= new Date(form.fromDate)) {
      toast('Return date/time must be after departure date/time', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await api.applyHostelPass({
        ...form,
        fromDate: new Date(form.fromDate).toISOString(),
        toDate: new Date(form.toDate).toISOString(),
      });
      toast('Hostel pass request submitted successfully!', 'success');
      setShowApplyModal(false);
      setForm({ passType: 'DAY_PASS', fromDate: '', toDate: '', reason: '', destination: '', emergencyContact: '' });
      loadPasses();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to submit hostel pass', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusTone = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'green';
      case 'RETURNED': return 'blue';
      case 'OUT': return 'red';
      case 'REJECTED': return 'red';
      case 'PENDING': return 'amber';
      default: return 'gray';
    }
  };

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Hostel Gate Pass', desc: 'Apply for hostel leave or day passes and track gate movement status.' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>My Hostel Passes</h2>
        </div>
        <Button onClick={() => setShowApplyModal(true)}>+ Apply for Pass</Button>
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {!loading && passes && passes.length === 0 && (
          <EmptyState title="No hostel passes" sub="You have not requested any hostel leave or gate passes yet." />
        )}
        {!loading && passes && passes.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Pass Type</th>
                <th>Departure (From)</th>
                <th>Return (To)</th>
                <th>Destination</th>
                <th>Parent Approval</th>
                <th>Warden Status</th>
                <th>Gate Movement</th>
              </tr>
            </thead>
            <tbody>
              {passes.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary" data-label="Pass Type">
                    {p.passType.replace('_', ' ')}
                    {p.isOverdue && (
                      <div style={{ marginTop: 4 }}>
                        <Pill tone="red">⚠️ Late Return ({p.overdueHours}h overdue)</Pill>
                      </div>
                    )}
                  </td>
                  <td data-label="Departure">{new Date(p.fromDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Return">{new Date(p.toDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td data-label="Destination">{p.destination}</td>
                  <td data-label="Parent Approval">
                    <Pill tone={p.parentApprovalStatus === 'APPROVED' ? 'green' : p.parentApprovalStatus === 'REJECTED' ? 'red' : p.parentApprovalStatus === 'NOT_REQUIRED' ? 'gray' : 'amber'}>
                      {p.parentApprovalStatus}
                    </Pill>
                  </td>
                  <td data-label="Warden Status">
                    <Pill tone={statusTone(p.status)}>
                      {p.status}
                    </Pill>
                  </td>
                  <td data-label="Gate Movement" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {p.actualExitTime && <div>Out: {new Date(p.actualExitTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}</div>}
                    {p.actualReturnTime && <div>Returned: {new Date(p.actualReturnTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}</div>}
                    {!p.actualExitTime && !p.actualReturnTime && <span>Not exited yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Apply Pass Modal */}
      {showApplyModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <div className="modal-title">Apply for Hostel Pass</div>
              <button className="modal-close" onClick={() => setShowApplyModal(false)}>×</button>
            </div>
            <form onSubmit={handleApply}>
              <div className="field-label">Pass Type *</div>
              <select className="field-input" value={form.passType} onChange={(e) => setForm({ ...form, passType: e.target.value as HostelPassType })}>
                <option value="DAY_PASS">Day Pass (Same Day)</option>
                <option value="NIGHT_OUT">Night Out</option>
                <option value="WEEKEND_PASS">Weekend Pass</option>
                <option value="HOME_LEAVE">Home Leave</option>
                <option value="EMERGENCY_PASS">Emergency Pass</option>
              </select>

              <div className="field-label">Departure Date & Time (From) *</div>
              <input className="field-input" type="datetime-local" required value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />

              <div className="field-label">Expected Return Date & Time (To) *</div>
              <input className="field-input" type="datetime-local" required value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />

              <div className="field-label">Destination Address *</div>
              <input className="field-input" required value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Home, 12 Park Avenue, City" />

              <div className="field-label">Emergency Contact Number *</div>
              <input className="field-input" required value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} placeholder="e.g. +91 9876543210" />

              <div className="field-label">Reason for Pass *</div>
              <textarea className="field-input" rows={3} required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Explain the reason for leaving hostel..." />

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setShowApplyModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
