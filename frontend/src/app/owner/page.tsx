'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { OwnerDashboardDto } from '@/lib/types';

export default function OwnerDashboard() {
  const router = useRouter();
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

  return (
    <PortalShell
      expectedSlug="owner"
      topbar={{
        title: 'Dashboard',
        desc: 'Executive school intelligence & operations overview.',
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Students" value={data ? data.totalStudents : '—'} delta={err ? 'Could not load' : 'live'} deltaDir="flat" />
        <StatCard label="Active CRM Leads" value={data ? data.activeCRMLeads : '—'} delta={data ? 'in pipeline' : undefined} deltaDir="flat" />
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
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{log.action}</div>
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
