'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function TrusteeGuidePage() {
  return <GuidePage guide={GUIDES.trustee} />;
}
