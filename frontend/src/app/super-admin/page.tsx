'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { SchoolDto } from '@/lib/types';

/**
 * Super Admin dashboard — the platform view: how many schools exist and how
 * many School Admins run them. Built from /schools alone, so no existing
 * dashboard endpoint or role gate changes.
 */
export default function SuperAdminDashboard() {
  const router = useRouter();
  const [schools, setSchools] = useState<SchoolDto[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.listSchools().then(setSchools).catch(() => { setErr(true); setSchools([]); });
  }, []);

  const totalAdmins = schools?.reduce((n, s) => n + s.adminCount, 0) ?? 0;
  const activeAdmins = schools?.reduce((n, s) => n + s.activeAdminCount, 0) ?? 0;
  const totalProfiles = schools?.reduce((n, s) => n + s.profileCount, 0) ?? 0;

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{ title: 'Dashboard', desc: 'Schools and School Admin accounts across the platform.' }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Schools" value={schools ? schools.length : '—'} delta={err ? 'Could not load' : 'live'} deltaDir="flat" />
        <StatCard label="School Admins" value={schools ? totalAdmins : '—'} delta={schools ? `${activeAdmins} active` : undefined} deltaDir="flat" />
        <StatCard label="Suspended / Inactive" value={schools ? totalAdmins - activeAdmins : '—'} deltaDir="flat" />
        <StatCard label="Total Profiles" value={schools ? totalProfiles : '—'} deltaDir="flat" />
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Schools</strong>
          <Button variant="soft" small onClick={() => router.push('/super-admin/schools')}>Manage</Button>
        </div>
        {schools === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {err && <EmptyState title="Couldn't load schools" sub="Failed to fetch the school list from the server." />}
        {schools !== null && !err && schools.length === 0 && (
          <EmptyState title="No schools yet" sub="Create the first school to get started." />
        )}
        {schools && schools.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>School</th>
                <th>School ID</th>
                <th>School Admins</th>
                <th>Profiles</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.tenantId}>
                  <td className="cell-primary" style={{ fontWeight: 600 }} data-label="School">{s.tenantName}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-faint)' }} data-label="School ID">{s.tenantId}</td>
                  <td data-label="School Admins">
                    <Pill tone={s.activeAdminCount > 0 ? 'green' : 'amber'}>
                      {s.activeAdminCount} active / {s.adminCount}
                    </Pill>
                  </td>
                  <td data-label="Profiles">{s.profileCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
