'use client';
import { PortalShell } from '@/components/shell';
import { TicketsView } from '@/components/tickets-view';
export default function TeacherTickets() {
  return <PortalShell expectedSlug="teacher" topbar={{ title: 'Parent Queries', desc: 'Questions routed to you from parents.' }}><TicketsView canCreate={false} canRespond /></PortalShell>;
}
