'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { OfferingDto, SectionDto } from '@/lib/types';

export default function PrincipalWorkload() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);

  useEffect(() => {
    api.mySections().then(setSections).catch(() => setSections([]));
    api.myOfferings().then(setOfferings).catch(() => setOfferings([]));
  }, []);

  const loading = sections === null || offerings === null;
  const sectionByName = new Map((sections ?? []).map((s) => [s.id, s.name]));

  const byGrade = new Map<string, { grade: string; sections: SectionDto[]; totalOfferings: number }>();
  sections?.forEach((s) => {
    if (!byGrade.has(s.gradeName)) byGrade.set(s.gradeName, { grade: s.gradeName, sections: [], totalOfferings: 0 });
    byGrade.get(s.gradeName)!.sections.push(s);
  });
  offerings?.forEach((o) => {
    const secName = sectionByName.get(o.sectionId) ?? '';
    for (const rec of byGrade.values()) {
      if (rec.sections.some((s) => s.id === o.sectionId)) { rec.totalOfferings++; break; }
    }
  });

  const rows = [...byGrade.values()].sort((a, b) => a.grade.localeCompare(b.grade));

  const totalSections = sections?.length ?? 0;
  const totalOfferings = offerings?.length ?? 0;

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Teacher Workload', desc: 'Section and subject offering distribution across grades.' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { label: 'Total Grades', value: rows.length },
          { label: 'Total Sections', value: totalSections },
          { label: 'Total Offerings', value: totalOfferings },
        ].map((s) => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid var(--hairline)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {loading && <Card><SkeletonRows rows={5} /></Card>}
      {!loading && rows.length === 0 && <EmptyState title="No data" sub="Workload data appears once sections and offerings are configured." />}
      {rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Grade</th><th style={{ textAlign: 'center' }}>Sections</th><th style={{ textAlign: 'center' }}>Offerings</th><th>Section Names</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.grade}>
                  <td className="cell-primary" data-label="Grade">{r.grade}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }} data-label="Sections">{r.sections.length}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }} data-label="Offerings">{r.totalOfferings}</td>
                  {/* Rows are already one per grade, so the names only need
                      de-duplicating and ordering to stop reading as noise. */}
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }} data-label="Section Names">
                    {r.grade} — {[...new Set(r.sections.map((s) => s.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}
