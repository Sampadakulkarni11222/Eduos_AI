'use client';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';

export default function AdminTimetable() {
  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Timetable', desc: 'Class-wise weekly period schedules.' }}>
      <TimetableCalendar scopeLabel="Sections" canEdit={true} />
    </PortalShell>
  );
}
