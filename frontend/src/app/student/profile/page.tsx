'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { IdCardPanel } from '@/components/id-card-action';
import { api } from '@/lib/api';
import type { StudentOverviewDto } from '@/lib/types';

const RELATION_LABEL: Record<string, string> = {
  FATHER: 'Father', MOTHER: 'Mother', GUARDIAN: 'Guardian',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Student profile: identity, enrolment, guardians and emergency contacts,
 * plus the live-generated ID card. Everything is read-only — corrections go
 * through the school office, which is also who owns the source data.
 */
export default function StudentProfile() {
  const [overview, setOverview] = useState<StudentOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    api
      .students()
      .then(async (r) => {
        const me = r.items[0];
        if (!me) return null;
        return api.studentOverview(me.id);
      })
      .then((o) => !stale && setOverview(o ?? null))
      .catch(() => !stale && setOverview(null))
      .finally(() => !stale && setLoading(false));
    return () => { stale = true; };
  }, []);

  const rows: Array<[string, string]> = overview
    ? [
        ['Admission number', overview.admissionNo || '—'],
        ['Class', overview.enrollment?.class ?? '—'],
        ['Roll number', overview.enrollment?.rollNo != null ? String(overview.enrollment.rollNo) : '—'],
        ['Date of birth', formatDate(overview.dob)],
        ['Gender', overview.gender ?? '—'],
        ['Address', overview.address ?? '—'],
      ]
    : [];

  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'My Profile', desc: 'Your school record, guardians and ID card.' }}
    >
      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && !overview && (
        <EmptyState
          title="No student record linked"
          sub="Contact the school office to link your student record to this login."
        />
      )}

      {!loading && overview && (
        <>
          <Card style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Avatar name={overview.name} className="profile-avatar-lg" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 22, fontWeight: 600, color: 'var(--text-1b)' }}>
                {overview.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{overview.enrollment?.class ?? 'Not enrolled'}</span>
                {overview.enrollment?.rollNo != null && <Pill tone="blue">Roll {overview.enrollment.rollNo}</Pill>}
                {overview.attendance && <Pill tone={overview.attendance.pctPresent >= 75 ? 'green' : 'amber'}>
                  {overview.attendance.pctPresent}% attendance
                </Pill>}
              </div>
            </div>
          </Card>

          <IdCardPanel studentId={overview.id} />

          <Card pad={false} style={{ marginBottom: 16 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>School record</strong>
            </div>
            <table className="data-table data-table-cards">
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td className="cell-primary" data-label="Field" style={{ width: '38%' }}>{label}</td>
                    <td data-label="Value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card pad={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Guardians &amp; emergency contacts</strong>
            </div>
            {overview.guardians.length === 0 ? (
              <EmptyState
                icon="◌"
                title="No guardians on record"
                sub="Ask the school office to add a parent or guardian to your record."
              />
            ) : (
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Name</th><th>Relation</th><th>Phone</th><th>Email</th></tr>
                </thead>
                <tbody>
                  {overview.guardians.map((g, i) => (
                    <tr key={`${g.name}-${i}`}>
                      <td className="cell-primary" data-label="Name">
                        <span className="row-flex">
                          {g.name}
                          {g.isPrimary && <Pill tone="green">Primary</Pill>}
                        </span>
                      </td>
                      <td data-label="Relation">{RELATION_LABEL[g.relation] ?? g.relation}</td>
                      <td data-label="Phone">{g.phone ? <a href={`tel:${g.phone}`}>{g.phone}</a> : '—'}</td>
                      <td data-label="Email">{g.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 14, lineHeight: 1.6 }}>
            Something wrong here? These details are maintained by the school office — raise a
            request from <strong>Help &amp; Support</strong> and they will correct it.
          </p>
        </>
      )}
    </PortalShell>
  );
}
