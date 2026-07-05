'use client';
import { PortalShell } from '@/components/shell';
import { CalendarView } from '@/components/calendar-view';
export default function ParentCalendar() {
  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Calendar & Events', desc: 'Upcoming holidays, exams and school events.' }}>
      <CalendarView />
    </PortalShell>
  );
}
