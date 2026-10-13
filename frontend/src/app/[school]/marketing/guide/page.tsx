'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function MarketingGuidePage() {
  return <GuidePage guide={GUIDES.marketing} />;
}
