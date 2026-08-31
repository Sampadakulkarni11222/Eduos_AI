'use client';
import { PortalShell } from '@/components/shell';
import { AiCreditsPanel } from '@/components/ai-credits-panel';

export default function StudentAiCredits() {
  return (
    <PortalShell
      expectedSlug="student"
      topbar={{
        title: 'AI Credits',
        desc: 'Your free monthly allowance for AI-written answers, and how to add more.',
      }}
    >
      <AiCreditsPanel portalSlug="student" />
    </PortalShell>
  );
}
