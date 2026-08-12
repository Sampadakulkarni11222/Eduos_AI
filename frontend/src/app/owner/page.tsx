'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { GlobalSearchModal, useGlobalSearchShortcut } from '@/components/global-search';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { OwnerDashboardDto } from '@/lib/types';
import { humanAuditLabel } from '@/lib/audit-labels';

export default function OwnerDashboard() {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useGlobalSearchShortcut();

  // One scoped call instead of four (/students, /admissions/pipeline,
  // /fees/summary, /audit/logs) — the endpoint aggregates all of it in the
  // database, and the student count is now a real count rather than the length
  // of whatever page /students happened to return.
  const [data, setData] = useState<OwnerDashboardDto | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.ownerDashboard().then(setData).catch(() => setErr(true));
  }, []);

  const auditLogs = data?.recentAuditLogs ?? null;

  // Derive active CRM leads from admissionsSummary so the stat card and the
  // summary panel are always in agreement — no separate count can drift.
  const derivedLeads = useMemo(() => {
    if (!data?.admissionsSummary) return null;
    const EXCLUDED = new Set(['ENROLLED', 'LOST']);
    return data.admissionsSummary
      .filter(({ stage }) => !EXCLUDED.has(stage))
      .reduce((sum, { count }) => sum + count, 0);
  }, [data?.admissionsSummary]);

  // Quick-action definitions for the shortcut row
  const quickActions = [
    { label: 'Add Student',         icon: '🎒', href: '/admin/users' },
    { label: 'Record Payment',      icon: '₹',  href: '/admin/payments' },
    { label: 'New Announcement',    icon: '📢', href: '/admin/announcements' },
    { label: 'Admissions CRM',      icon: '◌',  href: '/owner/admissions' },
  ];

  return (
    <PortalShell
      expectedSlug="owner"
      topbar={{
        title: 'Dashboard',
        desc: 'Executive school intelligence & operations overview.',
        actions: (
          <button
            onClick={() => setSearchOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--hairline)',
              background: 'var(--card-bg, #fff)', cursor: 'pointer',
              fontSize: 13, color: 'var(--text-2b)', fontFamily: 'inherit',
              transition: 'border-color .15s, box-shadow .15s',
            }}
            title="Search students & staff (Ctrl+K)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Search…
            <kbd style={{
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
              background: 'var(--bg-wash, #f3f3f3)', border: '1px solid var(--hairline)',
              color: 'var(--text-faint)',
            }}>⌘K</kbd>
          </button>
        ),
      }}
    >
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* ── Stat Cards ── */}
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Students" value={data ? data.totalStudents : '—'} delta={err ? 'Could not load' : 'live'} deltaDir="flat" />
        <StatCard label="Active CRM Leads" value={derivedLeads ?? '—'} delta={data ? 'in pipeline' : undefined} deltaDir="flat" />
        <StatCard
          label="Fees Collected"
          value={data ? rupees(data.feesCollectedPaise) : '—'}
          delta={data ? `${data.collectionRate}% collection rate` : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Pending Fees"
          value={data ? rupees(data.pendingFeesPaise) : '—'}
          delta={data ? `${data.unpaidInvoices} unpaid invoices` : undefined}
          deltaDir={data && data.unpaidInvoices > 0 ? 'down' : 'flat'}
        />
      </div>

      {/* ── Quick Actions ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18,
      }}>
        {quickActions.map((qa) => (
          <button
            key={qa.href}
            onClick={() => router.push(qa.href)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 10,
              border: '1px solid var(--hairline)',
              background: 'var(--card-bg, #fff)',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 600,
              color: 'var(--text-1)',
              transition: 'border-color .15s, box-shadow .15s, transform .1s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.12)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--hairline)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <span style={{ fontSize: 16 }}>{qa.icon}</span>
            {qa.label}
          </button>
        ))}
      </div>

      {/* ── Audit + Admissions grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 18 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Audit Logs</strong>
            <Button variant="soft" small onClick={() => router.push('/owner/audit')}>View all</Button>
          </div>
          <div style={{ padding: auditLogs === null ? 20 : 0 }}>
            {auditLogs === null && <SkeletonRows rows={3} />}
            {auditLogs !== null && auditLogs.length === 0 && (
              <EmptyState title="No logs found" sub="System events will appear here." />
            )}
            {auditLogs?.slice(0, 5).map((log, i) => (
              <div key={log._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{humanAuditLabel(log.action)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                    Actor: {log.actorName || 'System'} · Channel: {log.channel}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {new Date(log.createdAt).toLocaleDateString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Admissions Summary</strong>
            <Button variant="soft" small onClick={() => router.push('/owner/admissions')}>CRM View</Button>
          </div>
          {data === null && <SkeletonRows rows={3} />}
          {data !== null && data.admissionsSummary.length === 0 && (
            <EmptyState title="No leads yet" sub="Admission enquiries will appear here." />
          )}
          {data !== null && data.admissionsSummary.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {data.admissionsSummary.map(({ stage, count }) => (
                <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{stage.replace('_', ' ').toLowerCase()}</span>
                  <Pill tone={count > 0 ? 'blue' : 'gray'}>{count} lead{count === 1 ? '' : 's'}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PortalShell>
  );
}
