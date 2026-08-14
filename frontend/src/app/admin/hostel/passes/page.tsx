'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { HostelPassDto } from '@/lib/types';

export default function AdminHostelPasses() {
  const [passes, setPasses] = useState<HostelPassDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');

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

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Hostel Pass Audit & Movements', desc: 'Comprehensive audit log of student hostel leave, parent approvals, and gate movements.' }}>
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
          <EmptyState title="No hostel passes" sub="No hostel pass records match the selected filter." />
        )}
        {!loading && passes && passes.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Pass Type</th>
                <th>Departure (From)</th>
                <th>Expected Return</th>
                <th>Destination</th>
                <th>Parent Status</th>
                <th>Warden Status</th>
                <th>Actual Exit</th>
                <th>Actual Entry</th>
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
                  <td data-label="Destination">{p.destination}</td>
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
                  <td data-label="Actual Exit">{p.actualExitTime ? new Date(p.actualExitTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                  <td data-label="Actual Entry">{p.actualReturnTime ? new Date(p.actualReturnTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
