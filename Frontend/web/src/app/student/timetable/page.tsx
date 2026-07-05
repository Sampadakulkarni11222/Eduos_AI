'use client';
import { PortalShell } from '@/components/shell';
import { TimetableGrid } from '@/components/timetable-grid';

export default function StudentTimetable() {
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Timetable', desc: 'Your weekly class schedule.' }}>
      <TimetableGrid scopeLabel="Your class timetable" />
    </PortalShell>
  );
}
