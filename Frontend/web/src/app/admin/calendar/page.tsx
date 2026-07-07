'use client';
import { PortalShell } from '@/components/shell';
import { CalendarView } from '@/components/calendar-view';
export default function AdminCalendar() {
  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Calendar & Events', desc: 'School-wide events and holidays.' }}>
      <CalendarView />
    </PortalShell>
  );
}
