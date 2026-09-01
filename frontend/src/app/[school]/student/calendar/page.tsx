'use client';
import { PortalShell } from '@/components/shell';
import { CalendarView } from '@/components/calendar-view';

export default function StudentCalendar() {
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Calendar & Events', desc: 'Upcoming holidays, exams and school events.' }}>
      <CalendarView />
    </PortalShell>
  );
}
