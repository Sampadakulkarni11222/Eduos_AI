'use client';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';

export default function StudentTimetable() {
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Timetable', desc: 'Your weekly class schedule.' }}>
      <TimetableCalendar scopeLabel="Your class timetable" />
    </PortalShell>
  );
}
