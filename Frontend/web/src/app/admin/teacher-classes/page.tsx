'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { OfferingDto, SectionDto } from '@/lib/types';

export default function AdminTeacherClasses() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.mySections().then(setSections).catch(() => setSections([]));
    api.myOfferings().then(setOfferings).catch(() => setOfferings([]));
  }, []);

  const bySectionId = new Map<string, OfferingDto[]>();
  offerings?.forEach((o) => {
    if (!bySectionId.has(o.sectionId)) bySectionId.set(o.sectionId, []);
    bySectionId.get(o.sectionId)!.push(o);
  });

  const filtered = sections?.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.gradeName.toLowerCase().includes(search.toLowerCase()),
  ) ?? [];

  const loading = sections === null || offerings === null;

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Teacher Class Assignments', desc: 'Sections and their subject offerings.' }}>
      <input className="input" placeholder="Search section or grade…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12, maxWidth: 280 }} />
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && sections!.length === 0 && <EmptyState title="No sections" sub="Create sections and assign teachers from the Classes & Sections module." />}
      {!loading && filtered.length === 0 && sections!.length > 0 && <EmptyState title="No match" sub="No sections match your search." />}
      {!loading && filtered.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Section</th><th>Grade</th><th>Subjects</th></tr></thead>
            <tbody>
              {filtered.map((s) => {
                const sectionOfferings = bySectionId.get(s.id) ?? [];
                return (
                  <tr key={s.id}>
                    <td className="cell-primary">{s.name}</td>
                    <td style={{ color: 'var(--text-faint)' }}>{s.gradeName}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {sectionOfferings.length > 0 ? sectionOfferings.map((o) => o.subject).join(', ') : <span style={{ color: 'var(--text-faint)' }}>None assigned</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
