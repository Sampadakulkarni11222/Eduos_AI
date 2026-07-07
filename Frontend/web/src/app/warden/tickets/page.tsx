'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';

export default function WardenTickets() {
  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Hostel Queries', desc: 'Manage support tickets and student inquiries.' }}>
      <TicketsView canCreate={false} canRespond={true} />
    </PortalShell>
  );
}
