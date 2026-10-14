import type { Metadata } from 'next';
import { FindSchool } from '@/components/find-school';

export const metadata: Metadata = { title: 'Find your school' };

/**
 * The school finder, and the installed app's start page (see app/manifest.ts).
 *
 * A static route, so it wins over the `[school]` segment: no school can be
 * reached at this path, which is why `find-school` is also on the reserved
 * list in lib/school-lookup.ts.
 */
export default function FindSchoolPage() {
  return <FindSchool />;
}
