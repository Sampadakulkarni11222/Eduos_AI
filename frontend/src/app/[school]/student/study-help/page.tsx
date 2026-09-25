'use client';
import { PortalShell } from '@/components/shell';
import { LearningBuddyPanel } from '@/components/study-help/learning-buddy-panel';

export default function StudentStudyHelp() {
  return (
    <PortalShell
      expectedSlug="student"
      topbar={{
        title: 'Study Help',
        desc: 'Explanations, worked examples, practice, quizzes and revision aids for your own subjects.',
      }}
    >
      <LearningBuddyPanel />
    </PortalShell>
  );
}
