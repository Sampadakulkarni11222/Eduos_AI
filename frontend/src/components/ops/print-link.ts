import { getActiveSchool } from '@/lib/school';

/** Where an official document prints: one page per school, outside the portal frame. */
export function printHref(kind: 'return' | 'letter', id: string): string {
  const fromUrl = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '';
  const school = fromUrl || getActiveSchool()?.slug || '';
  return `/${school}/print?kind=${kind}&id=${encodeURIComponent(id)}`;
}
