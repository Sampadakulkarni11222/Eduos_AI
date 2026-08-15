'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatCalendarDate } from '@/lib/timetable-dates';
import type { WardenDashboardDto } from '@/lib/types';

// ── Priority display helper ──────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  HIGH: 'var(--red)', MEDIUM: 'var(--amber)', LOW: 'var(--green)',
};
function PriorityDot({ priority }: { priority?: string | null }) {
  const p = (priority || 'NONE').toUpperCase();
  const color = PRIORITY_COLOR[p] ?? '#ccc';
  return (
    <span
      style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0, marginRight: 6 }}
      title={`Priority: ${p.toLowerCase()}`}
    />
  );
}

const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'green' | 'gray'> = {
  CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'green',
};

export default function WardenDashboard() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<WardenDashboardDto | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [err, setErr] = useState(false);

  const reloadData = () => {
    api.wardenDashboard().then((res) => { setData(res); setErr(false); }).catch(() => { setErr(true); setData(null); });
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Filter out test tickets and deduplicate leave requests
  const tickets = useMemo(() => {
    if (!data?.openTickets) return null;
    return data.openTickets.filter((t) => t.subject && !/test|asdf|sample|placeholder/i.test(t.subject));
  }, [data?.openTickets]);

  // Ticket status breakdown
  const ticketCounts = useMemo(() => {
    if (!tickets) return { total: 0, new: 0, open: 0, waiting: 0 };
    return {
      total: tickets.length,
      new: tickets.filter((t) => t.status === 'NEW').length,
      open: tickets.filter((t) => t.status === 'OPEN').length,
      waiting: tickets.filter((t) => t.status === 'WAITING').length,
    };
  }, [tickets]);

  // Clean & deduplicated leave applications
  const leaveRequests = useMemo(() => {
    if (!data?.leaveRequests) return null;
    const seen = new Set<string>();
    const list = data.leaveRequests.map((l) => ({
      ...l,
      studentName: (l.studentName && l.studentName !== '--') ? l.studentName : 'Student',
      admissionNo: (l.admissionNo && l.admissionNo !== '--') ? l.admissionNo : '—',
    }));

    return list.filter((l) => {
      const key = `${l.studentName}-${l.fromDate}-${l.toDate}-${l.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data?.leaveRequests]);

  const handleReviewLeave = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setActionBusy(id);
    try {
      await api.reviewLeave(id, status);
      toast(`Leave application ${status.toLowerCase()}.`);
      reloadData();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Could not ${status.toLowerCase()} leave.`, 'error');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <PortalShell
      expectedSlug="warden"
      topbar={{
        title: 'Hostel Overview',
        desc: 'Hostel facilities, student welfare & room allocations.',
      }}
    >
      {/* ── Stat cards: Occupancy & Hostel metrics ── */}
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard
          label="Total Occupancy"
          value={data ? `${data.hostelStudents} / ${data.totalCapacity}` : '—'}
          delta={data ? `${data.occupancyRate}% occupancy rate` : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Vacant Beds"
          value={data ? data.vacantBeds : '—'}
          delta={data ? `${data.occupiedRooms} beds allocated` : undefined}
          deltaDir="flat"
        />
        <StatCard label="Hostel Inquiries" value={data ? data.openInquiries : '—'} delta="open inquiries" deltaDir="flat" />
        <StatCard
          label="Maintenance Requests"
          value={data ? data.maintenanceRequests : '—'}
          delta={data && data.maintenanceRequests > 0 ? 'active issues' : 'none open'}
          deltaDir={data && data.maintenanceRequests > 0 ? 'down' : 'flat'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* Left: Tickets & Requests with Status Breakdown */}
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Hostel Tickets & Requests</strong>
              {tickets && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                  {ticketCounts.total} total · {ticketCounts.new} new · {ticketCounts.open} open · {ticketCounts.waiting} waiting
                </div>
              )}
            </div>
            <Button variant="soft" small onClick={() => router.push('/warden/tickets')}>View all</Button>
          </div>

          <div style={{ padding: tickets === null && !err ? 20 : 0 }}>
            {tickets === null && !err && <SkeletonRows rows={3} />}
            {err && <EmptyState title="Couldn't load tickets" sub="The server didn't respond. Reload the page to try again." />}
            {tickets !== null && !err && tickets.length === 0 && (
              <EmptyState title="No active requests" sub="All student tickets and maintenance requests are resolved." />
            )}
            {tickets?.slice(0, 5).map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <PriorityDot priority={t.priority} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2b)', marginTop: 1 }}>
                    Raised by: {t.raisedBy || 'Student'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <Pill tone={SEVERITY_TONE[t.severity?.toUpperCase() ?? 'MEDIUM'] ?? 'gray'}>{(t.severity ?? 'medium').toLowerCase()}</Pill>
                  <Pill tone={t.status === 'NEW' ? 'blue' : t.status === 'OPEN' ? 'amber' : 'gray'}>{t.status.toLowerCase()}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right Column: Pending Leave Applications + Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Leave Awaiting Approval with Approve/Reject inline actions */}
          <Card pad={false}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Leave Awaiting Approval</strong>
              {data !== null && data.pendingLeaveCount > 0 && (
                <Pill tone="amber">{data.pendingLeaveCount} pending</Pill>
              )}
            </div>

            <div style={{ padding: leaveRequests === null || leaveRequests.length === 0 ? 20 : 0 }}>
              {leaveRequests === null && <SkeletonRows rows={2} />}
              {leaveRequests !== null && leaveRequests.length === 0 && (
                <EmptyState title="Nothing pending" sub="No leave applications are awaiting a decision." />
              )}
              {leaveRequests?.slice(0, 5).map((l, i) => (
                <div key={l.id} style={{ padding: '12px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{l.studentName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-2b)', marginTop: 1 }}>
                        {formatCalendarDate(l.fromDate, { day: 'numeric', month: 'short' })} – {formatCalendarDate(l.toDate, { day: 'numeric', month: 'short' })}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, fontStyle: 'italic' }}>"{l.reason}"</div>
                    </div>
                    {/* Inline Approve & Reject Actions */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        disabled={actionBusy === l.id}
                        onClick={() => handleReviewLeave(l.id, 'APPROVED')}
                        style={{
                          background: '#E8F5EC', border: '1px solid #9ed4b3', color: '#1e5c38',
                          fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Approve
                      </button>
                      <button
                        disabled={actionBusy === l.id}
                        onClick={() => handleReviewLeave(l.id, 'REJECTED')}
                        style={{
                          background: '#FCE8E6', border: '1px solid #f0b4b4', color: '#a8322e',
                          fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Quick Actions Card with Prominent Emergency Lookup */}
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Quick Actions</strong>

            {/* Prominent Emergency Medical Lookup Banner */}
            <button
              onClick={() => router.push('/warden/medical')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '12px 16px', background: '#FCE8E6', border: '1.5px solid #F0B4B4',
                borderRadius: 10, color: '#A8322E', fontWeight: 700, fontSize: 13.5,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'transform .1s, background .15s',
                boxShadow: '0 2px 6px rgba(168,50,46,0.12)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9D5D3'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#FCE8E6'; }}
            >
              <span style={{ fontSize: 16 }}>🚨</span> Emergency Medical Lookup
            </button>

            <Button onClick={() => router.push('/warden/rooms')}>
              Manage Room Allocations
            </Button>
            <Button variant="soft" onClick={() => router.push('/warden/students')}>
              Hostel Students Directory
            </Button>
          </Card>
        </div>
      </div>
    </PortalShell>
  );
}
