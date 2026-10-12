'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function TeacherGuidePage() {
  return <GuidePage guide={GUIDES.teacher} />;
}
