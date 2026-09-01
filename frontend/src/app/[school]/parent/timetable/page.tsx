'use client';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';

export default function ParentTimetable() {
  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Timetable', desc: "Your child's weekly class schedule." }}>
      <TimetableCalendar scopeLabel="Your child's class" />
    </PortalShell>
  );
}
