'use client';
import { PortalShell } from '@/components/shell';
import { AttendanceCalendar } from '@/components/attendance/attendance-calendar';

export default function StudentAttendance() {
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Attendance', desc: 'Your attendance calendar, trend, and leave applications.' }}>
      <AttendanceCalendar />
    </PortalShell>
  );
}
