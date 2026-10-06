'use client';
import { GuidePage } from '@/components/guide-layout';
import { GUIDES } from '@/lib/guides';

export default function LibrarianGuidePage() {
  return <GuidePage guide={GUIDES.librarian} />;
}
