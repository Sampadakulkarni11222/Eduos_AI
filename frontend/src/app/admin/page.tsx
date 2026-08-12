'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { GlobalSearchModal, useGlobalSearchShortcut } from '@/components/global-search';

import { Button, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AdminDashboardDto } from '@/lib/types';

// ── Priority display helpers ──────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  HIGH: 'var(--red)', MEDIUM: 'var(--amber)', LOW: 'var(--green)',
};
function PriorityDot({ priority }: { priority?: string | null }) {
  const p = (priority || 'NONE').toUpperCase();
  const color = PRIORITY_COLOR[p] ?? '#ccc';
  return (
    <span
      style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0, marginRight: 7 }}
      title={p}
      aria-label={`Priority: ${p.toLowerCase()}`}
    />
  );
}

// ── Reporter fallback ─────────────────────────────────────────────────────────
const ROLE_FALLBACK: Record<string, string> = {
  PARENT: 'Parent', STUDENT: 'Student', TEACHER: 'Teacher',
  ADMIN: 'Admin office', PRINCIPAL: 'Principal', WARDEN: 'Warden',
  LIBRARIAN: 'Librarian', FINANCE: 'Finance',
};
function ticketReporter(t: { raisedByProfileId?: { displayName?: string } | null; routedToRoleKey?: string | null }): string {
  const name = t.raisedByProfileId?.displayName;
  if (name && name.trim()) return name.trim();
  const role = t.routedToRoleKey;
  if (role && ROLE_FALLBACK[role]) return ROLE_FALLBACK[role];
  return 'Support request';
}

// ── Stage display labels ──────────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', TOUR_SCHEDULED: 'Tour scheduled',
  APPLICATION: 'Application', ENROLLED: 'Enrolled', LOST: 'Lost',
};
const TERMINAL_STAGES = new Set(['ENROLLED', 'LOST']);

export default function AdminDashboard() {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useGlobalSearchShortcut();
  const [data, setData] = useState<AdminDashboardDto | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.adminDashboard().then(setData).catch(() => setErr(true));
  }, []);

  // Reconcile pipeline: active = non-terminal stages only
  const activePipeline = useMemo(
    () => (data?.admissionsPipeline ?? []).filter((s) => s.stage && !TERMINAL_STAGES.has(s.stage) && s.count > 0),
    [data?.admissionsPipeline],
  );
  const terminalPipeline = useMemo(
    () => (data?.admissionsPipeline ?? []).filter((s) => TERMINAL_STAGES.has(s.stage) && s.count > 0),
    [data?.admissionsPipeline],
  );
  const pipelineTotal = useMemo(() => activePipeline.reduce((sum, s) => sum + s.count, 0), [activePipeline]);

  // Filter out test/blank tickets
  const cleanTickets = useMemo(
    () => (data?.recentTickets ?? []).filter((t) => t.subject && t.subject.trim().length > 0),
    [data?.recentTickets],
  );

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
        actions: (
          /* ── Global search (Fix #9) ── */
          <button
            onClick={() => setSearchOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--hairline)',
              background: 'var(--card-bg, #fff)', cursor: 'pointer',
              fontSize: 13, color: 'var(--text-2b)', fontFamily: 'inherit',
            }}
            title="Search students & staff (Ctrl+K)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Search…
            <kbd style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-wash, #f3f3f3)', border: '1px solid var(--hairline)', color: 'var(--text-faint)' }}>⌘K</kbd>
          </button>
        ),
      }}
    >
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {err && <EmptyState title="Couldn't load the dashboard" sub="The server didn't respond. Reload to try again." />}

      {!err && (
        <>
          {/* ── Stat row ── */}
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 16 }}>
            {statCard('Total Students', data ? data.totalStudents : '—', 'active enrolments', '/admin/student-classes')}
            {statCard('Open Tickets', data ? data.openTickets : '—', 'awaiting response', '/admin/tickets')}
            {statCard('Announcements', data ? data.announcementsCount : '—', 'total published', '/admin/announcements')}
            {statCard('Active Pipeline', data ? pipelineTotal : '—', 'leads in progress', '/admin/admissions')}
          </div>

          {/* ── Main 2-column grid ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, marginBottom: 14 }}>

            {/* Open Tickets (left) */}
            <Card pad={false}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Open Tickets</strong>
                <Button variant="soft" small onClick={() => router.push('/admin/tickets')}>View all</Button>
              </div>
              <div style={{ padding: data === null ? 16 : 0 }}>
                {data === null && <SkeletonRows rows={3} />}
                {data !== null && cleanTickets.length === 0 && (
                  <EmptyState title="No open tickets" sub="All caught up! New support requests appear here." />
                )}
                {cleanTickets.slice(0, 5).map((t, i) => (
                  <div key={t._id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    {/* Priority dot — Fix #5 */}
                    <span style={{ paddingTop: 4, flexShrink: 0 }}>
                      <PriorityDot priority={t.priority} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                      {/* Reporter — Fix #6 */}
                      <div style={{ fontSize: 11.5, color: 'var(--text-2b)', marginTop: 1 }}>
                        {ticketReporter(t)} · {t.routedToRoleKey ? `→ ${t.routedToRoleKey.toLowerCase()}` : 'Unrouted'}
                      </div>
                    </div>
                    <Pill tone={t.status === 'NEW' ? 'blue' : t.status === 'OPEN' ? 'amber' : 'gray'}>{t.status.toLowerCase()}</Pill>
                  </div>
                ))}
              </div>
            </Card>

            {/* Right column: Pipeline + Announcements stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Admissions Pipeline — Fix #7 & #8 */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Admissions Pipeline</strong>
                  <Button variant="soft" small onClick={() => router.push('/admin/admissions')}>Open CRM</Button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data !== null && activePipeline.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No active leads — add your first lead in the CRM.</p>
                )}
                {/* Active stages */}
                {activePipeline.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: terminalPipeline.length > 0 ? 8 : 0 }}>
                    {activePipeline.map((s) => (
                      <span key={s.stage} style={{ background: '#F3ECDC', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                        {STAGE_LABEL[s.stage] ?? s.stage.toLowerCase().replace(/_/g, ' ')} · {s.count}
                      </span>
                    ))}
                  </div>
                )}
                {/* Terminal stages (enrolled/lost) shown separately, muted — Fix #7 */}
                {terminalPipeline.length > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', borderTop: activePipeline.length > 0 ? '1px solid var(--hairline)' : 'none', paddingTop: activePipeline.length > 0 ? 6 : 0 }}>
                    {terminalPipeline.map((s) => `${s.count} ${(STAGE_LABEL[s.stage] ?? s.stage).toLowerCase()}`).join(' · ')}
                  </div>
                )}
              </Card>

              {/* Recent Announcements */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Announcements</strong>
                  <Button variant="soft" small onClick={() => router.push('/admin/announcements')}>View all</Button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data !== null && data.recentAnnouncements.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>
                )}
                {data?.recentAnnouncements.slice(0, 3).map((a, i) => (
                  <div key={a._id} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>

          {/* ── Recently Added Students — compact 3-row version (Fix #4) ── */}
          <Card pad={false}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Recently Added Students</strong>
              <Button variant="soft" small onClick={() => router.push('/admin/student-classes')}>View all</Button>
            </div>
            <div style={{ padding: data === null ? 16 : 0 }}>
              {data === null && <SkeletonRows rows={3} />}
              {data !== null && data.recentStudents.length === 0 && (
                <EmptyState title="No students yet" sub="Students appear here once enrollments are created." />
              )}
              {data && data.recentStudents.length > 0 && (
                <table className="data-table data-table-cards">
                  <thead><tr><th>Student</th><th>Admission No.</th><th>Added</th></tr></thead>
                  <tbody>
                    {/* Limit to 3 rows for compact dashboard (Fix #4) */}
                    {data.recentStudents.slice(0, 3).map((s) => (
                      <tr key={s._id}>
                        <td className="cell-primary" data-label="Student">{`${s.firstName} ${s.lastName ?? ''}`.trim()}</td>
                        <td style={{ color: 'var(--text-faint)' }} data-label="Admission No.">{s.admissionNo}</td>
                        <td data-label="Added">{new Date(s.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
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
