'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function ComplianceGuidePage() {
  return <GuidePage guide={GUIDES.compliance} />;
}
