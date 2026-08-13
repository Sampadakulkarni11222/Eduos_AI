'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { IncidentDto, IncidentSeverity, IncidentStatus, IncidentType } from '@/lib/types';

const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'BEHAVIOUR', label: 'Behaviour' },
  { value: 'BULLYING', label: 'Bullying' },
  { value: 'ATTENDANCE_RELATED', label: 'Attendance Related' },
  { value: 'PROPERTY_DAMAGE', label: 'Property Damage' },
  { value: 'SAFETY', label: 'Safety' },
  { value: 'OTHER', label: 'Other' },
];

function severityTone(s: IncidentSeverity): 'green' | 'amber' | 'red' {
  return s === 'HIGH' ? 'red' : s === 'MEDIUM' ? 'amber' : 'green';
}
function statusTone(s: IncidentStatus): 'red' | 'amber' | 'green' {
  return s === 'OPEN' ? 'red' : s === 'REVIEWED' ? 'amber' : 'green';
}
function statusLabel(s: IncidentStatus) {
  return s === 'OPEN' ? 'Open' : s === 'REVIEWED' ? 'Reviewed' : 'Closed';
}

export default function AdminIncidents() {
  const [incidents, setIncidents] = useState<IncidentDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionTakenEdits, setActionTakenEdits] = useState<Record<string, string>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<{ id: string; msg: string } | null>(null);

  function load(status?: string) {
    api.listIncidents(status ? { status } : {})
      .then(setIncidents)
      .catch(() => setIncidents([]));
  }

  useEffect(() => { load(); }, []);

  async function handleStatusChange(inc: IncidentDto, newStatus: string) {
    setUpdating(inc.id);
    try {
      const updated = await api.updateIncident(inc.id, {
        status: newStatus,
        ...(actionTakenEdits[inc.id] !== undefined ? { actionTaken: actionTakenEdits[inc.id] } : {}),
      });
      setIncidents((prev) => prev?.map((i) => i.id === inc.id ? updated : i) ?? null);
      setFeedbackMsg({ id: inc.id, msg: 'Updated.' });
      setTimeout(() => setFeedbackMsg(null), 2500);
    } catch (err) {
      setFeedbackMsg({ id: inc.id, msg: err instanceof ApiError ? err.message : 'Update failed.' });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } finally {
      setUpdating(null);
    }
  }

  const filtered = (incidents ?? []).filter((i) =>
    statusFilter ? i.status === statusFilter : true
  );

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Incident Reports', desc: 'Review and manage all student incident and disciplinary reports.' }}>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <span className="field-label" style={{ marginRight: 8 }}>Filter by status:</span>
          <select
            className="field-input"
            style={{ width: 'auto', display: 'inline-block' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>
          {incidents !== null ? `${filtered.length} record${filtered.length !== 1 ? 's' : ''}` : ''}
        </div>
      </div>

      <Card pad={false}>
        {incidents === null && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {incidents !== null && filtered.length === 0 && (
          <EmptyState icon="⚑" title="No incident reports found" sub={statusFilter ? `No ${statusFilter.toLowerCase()} incidents.` : 'No incidents have been reported yet.'} />
        )}
        {incidents !== null && filtered.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Reported By</th>
                <th>Date</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Action Taken</th>
                <th>Status</th>
                <th>Update</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => (
                <tr key={inc.id}>
                  <td className="cell-primary" data-label="Student">
                    {inc.studentName ?? '—'}
                    {inc.admissionNo && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>{inc.admissionNo}</span>
                    )}
                  </td>
                  <td data-label="Reported By" style={{ color: 'var(--text-faint)', fontSize: 13 }}>
                    {inc.reportedByName ?? '—'}
                  </td>
                  <td data-label="Date">{inc.date ? inc.date.slice(0, 10) : '—'}</td>
                  <td data-label="Type">{INCIDENT_TYPES.find((t) => t.value === inc.type)?.label ?? inc.type}</td>
                  <td data-label="Severity">
                    <Pill tone={severityTone(inc.severity)}>{inc.severity}</Pill>
                  </td>
                  <td data-label="Description" style={{ maxWidth: 220 }}>
                    <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {inc.description}
                    </span>
                  </td>
                  <td data-label="Action Taken" style={{ minWidth: 160 }}>
                    <textarea
                      className="field-input"
                      rows={2}
                      style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 12, marginBottom: 0 }}
                      placeholder="Add / edit action taken…"
                      defaultValue={inc.actionTaken ?? ''}
                      onChange={(e) => setActionTakenEdits((prev) => ({ ...prev, [inc.id]: e.target.value }))}
                    />
                  </td>
                  <td data-label="Status">
                    <Pill tone={statusTone(inc.status)}>{statusLabel(inc.status)}</Pill>
                    {feedbackMsg?.id === inc.id && (
                      <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-faint)' }}>{feedbackMsg.msg}</div>
                    )}
                  </td>
                  <td data-label="Update">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {inc.status !== 'REVIEWED' && (
                        <Button
                          small
                          variant="soft"
                          disabled={updating === inc.id}
                          onClick={() => handleStatusChange(inc, 'REVIEWED')}
                        >
                          Mark Reviewed
                        </Button>
                      )}
                      {inc.status !== 'CLOSED' && (
                        <Button
                          small
                          variant="soft"
                          disabled={updating === inc.id}
                          onClick={() => handleStatusChange(inc, 'CLOSED')}
                        >
                          Close
                        </Button>
                      )}
                      {inc.status === 'CLOSED' && actionTakenEdits[inc.id] !== undefined && (
                        <Button
                          small
                          variant="soft"
                          disabled={updating === inc.id}
                          onClick={() => handleStatusChange(inc, inc.status)}
                        >
                          Save Notes
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
    </PortalShell>
  );
}
