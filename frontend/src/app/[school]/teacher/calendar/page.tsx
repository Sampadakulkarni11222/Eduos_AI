'use client';
import { PortalShell } from '@/components/shell';
import { CalendarView } from '@/components/calendar-view';

export default function TeacherCalendar() {
  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Calendar', desc: 'School events, exams, and holidays.' }}>
      <CalendarView />
    </PortalShell>
  );
}
