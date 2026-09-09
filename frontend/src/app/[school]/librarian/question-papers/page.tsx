'use client';
import { PortalShell } from '@/components/shell';
import { LibraryResourceShelf } from '@/components/library/resource-shelf';

export default function Page() {
  return (
    <PortalShell expectedSlug="librarian" topbar={{
      title: 'Question papers',
      desc: 'Filed by class, subject, academic year and language.',
    }}>
      <LibraryResourceShelf kind="QUESTION_PAPER" title="Question papers" canManage={true} />
    </PortalShell>
  );
}
