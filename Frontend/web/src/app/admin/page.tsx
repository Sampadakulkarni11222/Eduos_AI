'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Button, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AdminDashboardDto } from '@/lib/types';

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboardDto | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.adminDashboard().then(setData).catch(() => setErr(true));
  }, []);

  const pipelineTotal = data?.admissionsPipeline
    .filter((s) => s.stage !== 'ENROLLED' && s.stage !== 'LOST')
    .reduce((sum, s) => sum + s.count, 0);

  const statCard = (label: string, value: React.ReactNode, sub: string | undefined, href: string) => (
    <button
      onClick={() => router.push(href)}
      className="stat-card"
      style={{ textAlign: 'left', cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
      title={`Open ${label}`}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-delta flat">{sub}</div>}
    </button>
  );

  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{
        title: 'Dashboard',
        desc: 'School operations at a glance — ' + today(),
        actions: <AskEduOS />,
      }}
    >
      {err && <EmptyState title="Couldn't load the dashboard" sub="The server didn't respond. Reload to try again." />}

      {!err && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            {statCard('Total Students', data ? data.totalStudents : '—', 'active enrolments', '/admin/student-classes')}
            {statCard('Open Tickets', data ? data.openTickets : '—', 'awaiting response', '/admin/tickets')}
            {statCard('Announcements', data ? data.announcementsCount : '—', 'total published', '/admin/announcements')}
            {statCard('Admissions Pipeline', data ? pipelineTotal : '—', 'active leads — open CRM', '/admin/admissions')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 18 }}>
            <Card pad={false}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Open Tickets</strong>
                <Button variant="soft" small onClick={() => router.push('/admin/tickets')}>View all</Button>
              </div>
              <div style={{ padding: data === null ? 20 : 0 }}>
                {data === null && <SkeletonRows rows={3} />}
                {data !== null && data.recentTickets.length === 0 && (
                  <EmptyState title="No open tickets" sub="All caught up! New support requests appear here." />
                )}
                {data?.recentTickets.slice(0, 5).map((t, i) => (
                  <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{t.subject}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                        {t.raisedByProfileId?.displayName || 'Unknown'} · {t.routedToRoleKey ? `Routed to ${t.routedToRoleKey.toLowerCase()}` : 'Unrouted'}
                      </div>
                    </div>
                    <Pill tone={t.status === 'NEW' ? 'blue' : t.status === 'OPEN' ? 'amber' : 'gray'}>{t.status.toLowerCase()}</Pill>
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Admissions Pipeline</strong>
                  <Button variant="soft" small onClick={() => router.push('/admin/admissions')}>Open CRM</Button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data !== null && data.admissionsPipeline.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No leads yet — add your first lead in the CRM.</p>
                )}
                {data && data.admissionsPipeline.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {data.admissionsPipeline.map((s) => (
                      <span key={s.stage} style={{ background: '#F3ECDC', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                        {s.stage.toLowerCase().replace(/_/g, ' ')} · {s.count}
                      </span>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Announcements</strong>
                  <Button variant="soft" small onClick={() => router.push('/admin/announcements')}>View all</Button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data !== null && data.recentAnnouncements.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet — publish a notice to see it here.</p>
                )}
                {data?.recentAnnouncements.slice(0, 3).map((a) => (
                  <div key={a._id} style={{ padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{a.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>

          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recently Added Students</strong>
              <Button variant="soft" small onClick={() => router.push('/admin/student-classes')}>View all</Button>
            </div>
            <div style={{ padding: data === null ? 20 : 0 }}>
              {data === null && <SkeletonRows rows={4} />}
              {data !== null && data.recentStudents.length === 0 && (
                <EmptyState title="No students yet" sub="Students appear here once enrollments are created." />
              )}
              {data && data.recentStudents.length > 0 && (
                <table className="data-table">
                  <thead><tr><th>Student</th><th>Admission No.</th><th>Added</th></tr></thead>
                  <tbody>
                    {data.recentStudents.map((s) => (
                      <tr key={s._id}>
                        <td className="cell-primary">{`${s.firstName} ${s.lastName ?? ''}`.trim()}</td>
                        <td style={{ color: 'var(--text-faint)' }}>{s.admissionNo}</td>
                        <td>{new Date(s.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </PortalShell>
  );
}

function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
