'use client';
import { PortalShell } from '@/components/shell';
import { ElectiveCatalog } from '@/components/registrations/elective-catalog';

export default function StudentSubjects() {
  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'Subject Registration', desc: 'Choose your elective subjects and track approval.' }}
    >
      <ElectiveCatalog />
    </PortalShell>
  );
}
