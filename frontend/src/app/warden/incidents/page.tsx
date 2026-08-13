'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type {
  HostelAllocationDto,
  IncidentDto,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '@/lib/types';

const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'BEHAVIOUR', label: 'Behaviour' },
  { value: 'BULLYING', label: 'Bullying' },
  { value: 'ATTENDANCE_RELATED', label: 'Attendance Related' },
  { value: 'PROPERTY_DAMAGE', label: 'Property Damage' },
  { value: 'SAFETY', label: 'Safety' },
  { value: 'OTHER', label: 'Other' },
];

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

interface HostelStudentOption {
  id: string;
  name: string;
  admissionNo: string;
}

const EMPTY_FORM = {
  studentId: '',
  date: today(),
  type: 'BEHAVIOUR' as IncidentType,
  severity: 'LOW' as IncidentSeverity,
  description: '',
  actionTaken: '',
};

export default function WardenIncidents() {
  const [hostelStudents, setHostelStudents] = useState<HostelStudentOption[] | null>(null);
  const [incidents, setIncidents] = useState<IncidentDto[] | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Warden sees hostel students; use allocations as student source
    api
      .hostelStudents()
      .then((allocations) => {
        const opts: HostelStudentOption[] = (allocations as HostelAllocationDto[])
          .filter((a) => a.status === 'ACTIVE' && a.studentId)
          .map((a) => ({
            id: a.studentId!._id,
            name: `${a.studentId!.firstName} ${a.studentId!.lastName ?? ''}`.trim(),
            admissionNo: a.studentId!.admissionNo,
          }));
        // Deduplicate by id
        const seen = new Set<string>();
        setHostelStudents(opts.filter((o) => seen.has(o.id) ? false : (seen.add(o.id), true)));
      })
      .catch(() => setHostelStudents([]));

    api.listIncidents().then(setIncidents).catch(() => setIncidents([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.studentId) { setError('Please select a student.'); return; }
    if (!form.description.trim()) { setError('Description is required.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        studentId: form.studentId,
        date: form.date,
        type: form.type,
        severity: form.severity,
        description: form.description.trim(),
        ...(form.actionTaken.trim() ? { actionTaken: form.actionTaken.trim() } : {}),
      };
      const created = await api.createIncident(payload);
      setIncidents((prev) => [created, ...(prev ?? [])]);
      setForm({ ...EMPTY_FORM });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit incident report.');
    } finally {
      setSubmitting(false);
    }
  }

  const loading = hostelStudents === null || incidents === null;

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Incidents', desc: 'Report and track disciplinary incidents for hostel students.' }}>

      {/* ── Report Form ── */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>File New Incident Report</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: '1 1 220px' }}>
              <div className="field-label">Hostel Student</div>
              <select
                className="field-input"
                value={form.studentId}
                onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}
                disabled={hostelStudents === null}
              >
                <option value="">-- Select student --</option>
                {(hostelStudents ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.admissionNo})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: '1 1 160px' }}>
              <div className="field-label">Date</div>
              <input
                type="date"
                className="field-input"
                value={form.date}
                max={today()}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>

            <div style={{ flex: '1 1 180px' }}>
              <div className="field-label">Type</div>
              <select
                className="field-input"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as IncidentType }))}
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: '1 1 140px' }}>
              <div className="field-label">Severity</div>
              <select
                className="field-input"
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as IncidentSeverity }))}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="field-label">Description <span style={{ color: 'var(--text-faint)' }}>(required)</span></div>
            <textarea
              className="field-input"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="Describe what happened..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="field-label">Action Taken <span style={{ color: 'var(--text-faint)' }}>(optional)</span></div>
            <textarea
              className="field-input"
              rows={2}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="E.g. Verbal warning, parent notified, room inspection…"
              value={form.actionTaken}
              onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value }))}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--error, #c0392b)', fontSize: 13, marginBottom: 10 }}>{error}</div>
          )}
          {success && (
            <div style={{ color: 'var(--success, #27ae60)', fontSize: 13, marginBottom: 10 }}>✓ Incident report submitted.</div>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Report'}
          </Button>
        </form>
      </Card>

      {/* ── Submitted Incidents Table ── */}
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>My Submitted Reports</div>
      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {!loading && incidents.length === 0 && (
          <EmptyState icon="⚑" title="No incidents reported yet" sub="Incidents you file will appear here." />
        )}
        {!loading && incidents.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Date</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id}>
                  <td className="cell-primary" data-label="Student">
                    {inc.studentName ?? '—'}
                    {inc.admissionNo && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>
                        {inc.admissionNo}
                      </span>
                    )}
                  </td>
                  <td data-label="Date">{inc.date ? inc.date.slice(0, 10) : '—'}</td>
                  <td data-label="Type">
                    {INCIDENT_TYPES.find((t) => t.value === inc.type)?.label ?? inc.type}
                  </td>
                  <td data-label="Severity">
                    <Pill tone={severityTone(inc.severity)}>
                      {inc.severity}
                    </Pill>
                  </td>
                  <td data-label="Description" style={{ maxWidth: 300 }}>
                    <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {inc.description}
                    </span>
                  </td>
                  <td data-label="Status">
                    <Pill tone={statusTone(inc.status)}>{statusLabel(inc.status)}</Pill>
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
