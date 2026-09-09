'use client';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';

export default function StudentTimetable() {
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Timetable', desc: 'Your weekly class schedule.' }}>
      {/* No class picker: a student has exactly one class, so choosing it was
          a control with a single option. See TimetableCalendar. */}
      <TimetableCalendar scopeLabel="Your class timetable" showClassPicker={false} />
    </PortalShell>
  );
}
