'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function FinanceGuidePage() {
  return <GuidePage guide={GUIDES.finance} />;
}
