'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { OfferingDto, SectionDto } from '@/lib/types';

export default function PrincipalStaff() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.mySections().then(setSections).catch(() => setSections([]));
    api.myOfferings().then(setOfferings).catch(() => setOfferings([]));
  }, []);

  const loading = sections === null || offerings === null;

  const sectionByName = new Map((sections ?? []).map((s) => [s.id, s.name]));

  const bySubject = new Map<string, { subject: string; sections: string[] }>();
  offerings?.forEach((o) => {
    const subj = o.subject || (o as any).subjectName || '';
    if (!subj) return;                          // skip offerings with no subject name
    if (!bySubject.has(subj)) bySubject.set(subj, { subject: subj, sections: [] });
    bySubject.get(subj)!.sections.push(sectionByName.get(o.sectionId) ?? o.sectionName ?? '');
  });

  const rows = [...bySubject.values()].filter((r) => r.subject.toLowerCase().includes(search.toLowerCase()));


  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Staff Directory', desc: 'Subject offerings across all sections.' }}>
      <input className="input" placeholder="Search by subject…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12, maxWidth: 300 }} />
      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && (sections!.length === 0 || offerings!.length === 0) && <EmptyState title="No data" sub="Staff directory will appear once sections and subject offerings are created." />}
      {!loading && rows.length === 0 && offerings!.length > 0 && <EmptyState title="No match" sub="No subjects match your search." />}
      {rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Subject</th><th>Sections</th><th style={{ textAlign: 'center' }}>Count</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="cell-primary" data-label="Subject">{r.subject}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }} data-label="Sections">{r.sections.join(', ')}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }} data-label="Count">{r.sections.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
