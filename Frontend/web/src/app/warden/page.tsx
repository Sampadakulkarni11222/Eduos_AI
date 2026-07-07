'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { HostelSummaryDto, TicketDto } from '@/lib/types';

export default function WardenDashboard() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketDto[] | null>(null);
  const [summary, setSummary] = useState<HostelSummaryDto | null>(null);

  useEffect(() => {
    api.tickets().then(setTickets).catch(() => setTickets([]));
    api.hostelSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  const openTickets = tickets?.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED') ?? [];

  return (
    <PortalShell
      expectedSlug="warden"
      topbar={{
        title: 'Hostel Overview',
        desc: 'Hostel facilities, student welfare & room allocations.',
        actions: <AskEduOS />,
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Rooms" value={summary ? summary.totalRooms : '—'} delta={summary ? 'registered rooms' : undefined} deltaDir="flat" />
        <StatCard
          label="Occupied Beds"
          value={summary ? `${summary.occupiedBeds} / ${summary.totalCapacity}` : '—'}
          delta={summary ? `${summary.occupancyRate}% occupancy rate` : undefined}
          deltaDir="flat"
        />
        <StatCard label="Hostel Inquiries" value={tickets ? openTickets.length : '—'} delta="routed to Warden" deltaDir="flat" />
        <StatCard label="Maintenance Requests" value={summary ? summary.maintenanceRequests : '—'} delta={summary && summary.maintenanceRequests > 0 ? 'active issues' : 'none open'} deltaDir={summary && summary.maintenanceRequests > 0 ? 'down' : 'flat'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Hostel Tickets & Requests</strong>
            <Button variant="soft" small onClick={() => router.push('/warden/tickets')}>View all</Button>
          </div>
          <div style={{ padding: tickets === null ? 20 : 0 }}>
            {tickets === null && <SkeletonRows rows={3} />}
            {tickets !== null && openTickets.length === 0 && (
              <EmptyState title="No active requests" sub="All student tickets are resolved." />
            )}
            {openTickets.slice(0, 5).map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{t.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                    Raised by: {t.raisedBy || 'Student'} · Status: {t.status.toLowerCase()}
                  </div>
                </div>
                <Pill tone={t.status === 'NEW' ? 'blue' : 'amber'}>{t.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Quick Actions</strong>
          <Button onClick={() => router.push('/warden/rooms')}>
            Manage Room Allocations
          </Button>
          <Button variant="soft" onClick={() => router.push('/warden/students')}>
            Hostel Students Directory
          </Button>
          <Button variant="ghost" onClick={() => router.push('/warden/medical')}>
            Emergency Medical Lookup
          </Button>
        </Card>
      </div>
    </PortalShell>
  );
}
