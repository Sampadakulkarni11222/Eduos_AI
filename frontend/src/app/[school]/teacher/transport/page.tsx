'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, Select } from '@/components/ui';
import { api } from '@/lib/api';
import type { SectionDto, TransportRosterRow } from '@/lib/types';

/**
 * Who goes home on which bus.
 *
 * A teacher holds no transport permission and cannot open the route
 * catalogue — and should not: this is not about managing routes. It is the
 * question asked at the last bell, about a whole class at once, which is why
 * the page is a class list rather than a route list. The server decides which
 * students appear; the section picker only narrows them.
 */
export default function TeacherTransportPage() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [rows, setRows] = useState<TransportRosterRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.mySections().then(setSections).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    setRows(null);
    setFailed(false);
    api.transportRoster(sectionId || undefined)
      .then(setRows)
      .catch(() => { setRows([]); setFailed(true); });
  }, [sectionId]);

  const riders = useMemo(() => rows?.filter((r) => r.status === 'ENROLLED').length ?? 0, [rows]);

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Transport',
      desc: 'Route, stop and vehicle for the students you teach.',
    }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          label="Class"
          hideLabel
          value={sectionId}
          onChange={setSectionId}
          options={[
            { value: '', label: 'All my classes' },
            ...(sections ?? []).map((s) => ({
              value: s.id,
              label: s.gradeName ? `${s.gradeName} - ${s.name}` : s.name,
            })),
          ]}
        />
        {rows && rows.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-2)' }}>
            {riders} of {rows.length} travel by school transport
          </span>
        )}
      </div>

      {rows === null && <Card><SkeletonRows rows={5} /></Card>}

      {rows !== null && rows.length === 0 && (
        <EmptyState
          title={failed ? 'Transport is unavailable' : 'No students to show'}
          sub={failed
            ? 'The transport service did not answer. Try again in a moment.'
            : 'Students appear here once they are enrolled in a class you teach.'}
        />
      )}

      {rows !== null && rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Roll</th><th>Student</th><th>Class</th>
                <th>Route</th><th>Vehicle</th><th>Pickup / drop</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td style={{ color: 'var(--text-faint)', width: 60 }} data-label="Roll">{r.rollNo ?? '—'}</td>
                  <td className="cell-primary" data-label="Student">
                    {r.studentName}
                    {r.admissionNo && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.admissionNo}</div>
                    )}
                  </td>
                  <td data-label="Class">{r.class ?? '—'}</td>
                  <td data-label="Route">{r.route?.name ?? '—'}</td>
                  <td data-label="Vehicle">{r.route?.vehicleNo ?? '—'}</td>
                  <td data-label="Pickup / drop">
                    {r.stop?.name ?? '—'}
                    {r.direction && r.direction !== 'BOTH' && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.direction.toLowerCase()} only</div>
                    )}
                  </td>
                  <td data-label="Status">
                    {/* A walker is a real answer, not a gap in the data. */}
                    <Pill tone={r.status === 'ENROLLED' ? 'green' : 'gray'}>
                      {r.status === 'ENROLLED' ? 'On a bus' : 'Own transport'}
                    </Pill>
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
