'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';
import { api } from '@/lib/api';

export default function ParentTimetable() {
  // With one child there is one class, so the grade/section pickers offered a
  // choice of one ("Class 5" / "A"). They are shown only when the family has
  // children in more than one class, where they are the way to switch.
  const [classCount, setClassCount] = useState<number | null>(null);
  useEffect(() => {
    api.students()
      .then((r) => setClassCount(new Set(r.items.map((k) => k.enrollment?.sectionId).filter(Boolean)).size))
      .catch(() => setClassCount(2));
  }, []);

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Timetable', desc: "Your child's weekly class schedule." }}>
      <TimetableCalendar scopeLabel="Your child's class" showClassPicker={classCount === null ? false : classCount > 1} />
    </PortalShell>
  );
}
