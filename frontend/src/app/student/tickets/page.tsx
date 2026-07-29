'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';

export default function StudentTickets() {
  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'Help & Support', desc: 'Raise a request with the school and track its progress.' }}
    >
      {/* Students raise and follow their own tickets; replying to others is
          staff-only, so canRespond stays false. */}
      <TicketsView canCreate canRespond={false} />
    </PortalShell>
  );
}
