'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function WardenGuidePage() {
  return <GuidePage guide={GUIDES.warden} />;
}
