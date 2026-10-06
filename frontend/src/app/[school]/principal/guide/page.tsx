'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function PrincipalGuidePage() {
  return <GuidePage guide={GUIDES.principal} />;
}
