'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';
export default function AdminTickets() {
  return <PortalShell expectedSlug="admin" topbar={{ title: 'Tickets', desc: 'Manage and assign all support requests.' }}><TicketsView canCreate canRespond /></PortalShell>;
}
