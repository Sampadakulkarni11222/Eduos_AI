'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function StudentGuidePage() {
  return <GuidePage guide={GUIDES.student} />;
}
