'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function ParentGuidePage() {
  return <GuidePage guide={GUIDES.parent} />;
}
