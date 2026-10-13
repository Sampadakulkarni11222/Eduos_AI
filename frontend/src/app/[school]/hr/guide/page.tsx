'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function HrGuidePage() {
  return <GuidePage guide={GUIDES.hr} />;
}
