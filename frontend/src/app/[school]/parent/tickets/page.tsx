'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';
export default function ParentTickets() {
  return <PortalShell expectedSlug="parent" topbar={{ title: 'Support', desc: 'Raise and track requests with the school.' }}><TicketsView canCreate canRespond /></PortalShell>;
}
