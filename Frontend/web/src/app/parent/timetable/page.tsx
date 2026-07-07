'use client';
import { PortalShell } from '@/components/shell';
import { TimetableGrid } from '@/components/timetable-grid';

export default function ParentTimetable() {
  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Timetable', desc: "Your child's weekly class schedule." }}>
      <TimetableGrid scopeLabel="Your child's class" />
    </PortalShell>
  );
}
