'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import { formatCalendarDate } from '@/lib/timetable-dates';
import type { WardenDashboardDto } from '@/lib/types';

export default function WardenDashboard() {
  // Links are written school-less; this adds the school in the URL.
  const link = useSchoolHref();
  const router = useRouter();
  // One scoped call instead of /tickets + /hostel/summary. Tickets now arrive
  // already filtered to open ones routed to the warden, rather than the page
  // pulling every ticket and filtering client-side.
  const [data, setData] = useState<WardenDashboardDto | null>(null);

  useEffect(() => {
    api.wardenDashboard().then(setData).catch(() => setData(null));
  }, []);

  const tickets = data?.openTickets ?? null;
  const leave = data?.leaveRequests ?? null;

  return (
    <PortalShell
      expectedSlug="warden"
      topbar={{
        title: 'Hostel Overview',
        desc: 'Hostel facilities, student welfare & room allocations.',
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Rooms" value={data ? data.occupiedRooms + data.vacantBeds : '—'} delta={data ? `${data.totalCapacity} beds` : undefined} deltaDir="flat" />
        <StatCard
          label="Occupied Beds"
          value={data ? `${data.hostelStudents} / ${data.totalCapacity}` : '—'}
          delta={data ? `${data.occupancyRate}% occupancy rate` : undefined}
          deltaDir="flat"
        />
        <StatCard label="Hostel Inquiries" value={data ? data.openInquiries : '—'} delta="open enquiries" deltaDir="flat" />
        <StatCard
          label="Maintenance Requests"
          value={data ? data.maintenanceRequests : '—'}
          delta={data && data.maintenanceRequests > 0 ? 'active issues' : 'none open'}
          deltaDir={data && data.maintenanceRequests > 0 ? 'down' : 'flat'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Hostel Tickets & Requests</strong>
            <Button variant="soft" small onClick={() => router.push(link('/warden/tickets'))}>View all</Button>
          </div>
          <div style={{ padding: tickets === null ? 20 : 0 }}>
            {tickets === null && <SkeletonRows rows={3} />}
            {tickets !== null && tickets.length === 0 && (
              <EmptyState title="No active requests" sub="All student tickets are resolved." />
            )}
            {tickets?.slice(0, 5).map((t, i) => (
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Leave Awaiting Approval</strong>
              {/* The list is capped, so show the real total — ten rows must not
                  look like "all of them" when there are forty. */}
              {data !== null && data.pendingLeaveCount > (leave?.length ?? 0) && (
                <Pill tone="amber">{data.pendingLeaveCount} pending</Pill>
              )}
            </div>
            <div style={{ padding: leave === null ? 20 : 0 }}>
              {leave === null && <SkeletonRows rows={2} />}
              {leave !== null && leave.length === 0 && (
                <EmptyState title="Nothing pending" sub="No leave applications are awaiting a decision." />
              )}
              {leave?.slice(0, 4).map((l, i) => (
                <div key={l.id} style={{ padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{l.studentName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2b)' }}>
                    {formatCalendarDate(l.fromDate, { day: 'numeric', month: 'numeric', year: 'numeric' })} – {formatCalendarDate(l.toDate, { day: 'numeric', month: 'numeric', year: 'numeric' })} · {l.reason}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Quick Actions</strong>
            <Button onClick={() => router.push(link('/warden/rooms'))}>
              Manage Room Allocations
            </Button>
            <Button variant="soft" onClick={() => router.push(link('/warden/students'))}>
              Hostel Students Directory
            </Button>
            <Button variant="ghost" onClick={() => router.push(link('/warden/medical'))}>
              Emergency Medical Lookup
            </Button>
          </Card>
        </div>
      </div>
    </PortalShell>
  );
}
