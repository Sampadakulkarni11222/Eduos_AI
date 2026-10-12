'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function SuperAdminGuidePage() {
  return <GuidePage guide={GUIDES['super-admin']} />;
}
