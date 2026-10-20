'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function AlumnusGuidePage() {
  return <GuidePage guide={GUIDES.alumnus} />;
}
