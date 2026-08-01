'use client';
import { PortalShell } from '@/components/shell';
import { TutorPanel } from '@/components/tutor-panel';

export default function StudentStudyHelp() {
  return (
    <PortalShell
      expectedSlug="student"
      topbar={{
        title: 'Study Help',
        desc: 'Explanations, practice questions and revision aids for your own subjects.',
      }}
    >
      <TutorPanel portalSlug="student" />
    </PortalShell>
  );
}
