'use client';
import { PortalShell } from '@/components/shell';
import { LibraryResourceShelf } from '@/components/library/resource-shelf';

export default function Page() {
  return (
    <PortalShell expectedSlug="librarian" topbar={{
      title: 'Library notes',
      desc: 'Filed by class, subject, academic year and language.',
    }}>
      <LibraryResourceShelf kind="NOTE" title="Library notes" canManage={true} />
    </PortalShell>
  );
}
