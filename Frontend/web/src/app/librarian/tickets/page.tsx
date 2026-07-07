'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';

export default function LibrarianTickets() {
  return (
    <PortalShell expectedSlug="librarian" topbar={{ title: 'Library Queries', desc: 'Support inquiries and book requests.' }}>
      <TicketsView canCreate={false} canRespond={true} />
    </PortalShell>
  );
}
