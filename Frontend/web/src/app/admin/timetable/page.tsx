'use client';
import { PortalShell } from '@/components/shell';
import { TimetableGrid } from '@/components/timetable-grid';

export default function AdminTimetable() {
  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Timetable', desc: 'Class-wise weekly period schedules.' }}>
      <TimetableGrid scopeLabel="Sections" canEdit={true} />
    </PortalShell>
  );
}
