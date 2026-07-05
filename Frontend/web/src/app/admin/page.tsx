'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AnnouncementDto, StudentListItem, TicketDto } from '@/lib/types';

export default function AdminDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const first = me?.profile?.displayName?.split(' ')[0];
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [tickets, setTickets] = useState<TicketDto[] | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementDto[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.students().then((r) => setStudents(r.items)).catch(() => setErr(true));
    api.tickets().then(setTickets).catch(() => setTickets([]));
    api.announcements().then(setAnnouncements).catch(() => setAnnouncements([]));
  }, []);

  const openTickets = tickets?.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED') ?? [];

  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{
        title: 'Dashboard',
        desc: 'School operations at a glance — ' + today(),
        actions: <AskEduOS />,
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Students" value={students ? students.length : '—'} delta={err ? 'Could not load' : students ? 'live' : undefined} deltaDir="flat" />
        <StatCard label="Open Tickets" value={tickets ? openTickets.length : '—'} delta={tickets ? 'live' : undefined} deltaDir={openTickets.length > 5 ? 'down' : 'flat'} />
        <StatCard
          label="Announcements"
          value={announcements ? announcements.length : '—'}
          delta={announcements ? 'total published' : undefined}
          deltaDir="flat"
        />
        <StatCard label="Admissions Pipeline" value="—" delta="see CRM" deltaDir="flat" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 18 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Open Tickets</strong>
            <Button variant="soft" small onClick={() => router.push('/admin/tickets')}>View all</Button>
          </div>
          <div style={{ padding: tickets === null ? 20 : 0 }}>
            {tickets === null && <SkeletonRows rows={3} />}
            {tickets !== null && openTickets.length === 0 && (
              <EmptyState title="No open tickets" sub="All caught up! New support requests appear here." />
            )}
            {openTickets.slice(0, 5).map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{t.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                    {t.raisedBy || 'Unknown'} · {t.routedToRoleKey ? `Routed to ${t.routedToRoleKey.toLowerCase()}` : 'Unrouted'}
                  </div>
                </div>
                <Pill tone={t.status === 'NEW' ? 'blue' : t.status === 'OPEN' ? 'amber' : 'gray'}>{t.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Announcements</strong>
            <Button variant="soft" small onClick={() => router.push('/admin/announcements')}>View all</Button>
          </div>
          {announcements === null && <SkeletonRows rows={3} />}
          {announcements !== null && announcements.length === 0 && (
            <EmptyState title="No announcements yet" sub="Publish a notice to see it here." />
          )}
          {announcements?.slice(0, 3).map((a) => (
            <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {a.author ? ` · ${a.author}` : ''}
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Students</strong>
          <Button variant="soft" small onClick={() => router.push('/admin/student-classes')}>View all</Button>
        </div>
        <div style={{ padding: students === null ? 20 : 0 }}>
          {students === null && !err && <SkeletonRows rows={4} />}
          {err && <EmptyState title="Couldn't load" sub="The server didn't respond. Reload to try again." />}
          {students && students.length === 0 && <EmptyState title="No students yet" sub="Students appear here once enrollments are created." />}
          {students && students.length > 0 && (
            <table className="data-table">
              <thead><tr><th>Student</th><th>Class</th><th>Roll</th><th>Admission No.</th></tr></thead>
              <tbody>
                {students.slice(0, 6).map((s) => (
                  <tr key={s.id}>
                    <td className="cell-primary">{s.name}</td>
                    <td>{s.enrollment?.class ?? '—'}</td>
                    <td>{s.enrollment?.rollNo ?? '—'}</td>
                    <td style={{ color: 'var(--text-faint)' }}>{s.admissionNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </PortalShell>
  );
}

function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
