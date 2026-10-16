'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function NurseGuidePage() {
  return <GuidePage guide={GUIDES.nurse} />;
}
