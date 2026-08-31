'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';

export default function PrincipalTickets() {
  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Escalated Tickets', desc: 'Support tickets requiring principal attention.' }}>
      <TicketsView canCreate={false} canRespond={true} />
    </PortalShell>
  );
}
