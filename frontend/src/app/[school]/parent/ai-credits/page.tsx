'use client';
import { PortalShell } from '@/components/shell';
import { AiCreditsPanel } from '@/components/ai-credits-panel';

export default function ParentAiCredits() {
  return (
    <PortalShell
      expectedSlug="parent"
      topbar={{
        title: 'AI Credits',
        desc: 'Your free monthly allowance for AI-written answers, and how to add more.',
      }}
    >
      <AiCreditsPanel portalSlug="parent" />
    </PortalShell>
  );
}
