'use client';
import { PortalShell } from '@/components/shell';
import { TutorPanel } from '@/components/tutor-panel';

export default function ParentStudyHelp() {
  return (
    <PortalShell
      expectedSlug="parent"
      topbar={{
        title: 'Study Help',
        desc: "Explanations and revision aids for your child's subjects.",
      }}
    >
      <TutorPanel portalSlug="parent" />
    </PortalShell>
  );
}
