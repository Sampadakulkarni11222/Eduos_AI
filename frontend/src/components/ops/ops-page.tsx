'use client';
import { Suspense, type ReactNode } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, SkeletonRows } from '@/components/ui';

/**
 * The page frame for an operations screen in any portal: the role's shell,
 * plus the Suspense boundary the views need because they read the query
 * string (deep links such as `?id=` from notifications).
 */
export function OpsPage({ portal, title, desc, children }: { portal: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <PortalShell expectedSlug={portal} topbar={{ title, desc }}>
      <Suspense fallback={<Card><SkeletonRows rows={4} /></Card>}>{children}</Suspense>
    </PortalShell>
  );
}
