'use client';
import { PortalShell } from '@/components/shell';
import { TimetableGrid } from '@/components/timetable-grid';
export default function TeacherTimetable() {
  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Timetable', desc: 'Weekly schedule for your sections.' }}>
      <TimetableGrid scopeLabel="Your weekly periods" />
    </PortalShell>
  );
}
