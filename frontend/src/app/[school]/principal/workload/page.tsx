'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { TeacherWorkloadView } from '@/components/leadership/teacher-workload';
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

  const byGrade = new Map<string, { grade: string; sections: SectionDto[]; totalOfferings: number }>();
  sections?.forEach((s) => {
    if (!byGrade.has(s.gradeName)) byGrade.set(s.gradeName, { grade: s.gradeName, sections: [], totalOfferings: 0 });
    byGrade.get(s.gradeName)!.sections.push(s);
  });
  offerings?.forEach((o) => {
    for (const rec of byGrade.values()) {
      if (rec.sections.some((s) => s.id === o.sectionId)) { rec.totalOfferings++; break; }
    }
  });

  // Numeric order: "Class 5" before "Class 10".
  const rows = [...byGrade.values()].sort((a, b) => a.grade.localeCompare(b.grade, 'en', { numeric: true }));

  const totalSections = sections?.length ?? 0;
  const totalOfferings = offerings?.length ?? 0;

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Teacher Workload', desc: 'Periods a week per teacher from the timetable, cover and leave, and how classes and subjects are spread.' }}>
      <TeacherWorkloadView />
      <h2 className="lead-subhead">Classes and subject offerings</h2>
      <div className="lead-tiles">
        {[
          { label: 'Total Grades', value: rows.length },
          { label: 'Total Sections', value: totalSections },
          { label: 'Total Offerings', value: totalOfferings },
        ].map((s) => (
          <div key={s.label} className="lead-tile">
            <div className="lead-tile-value">{s.value}</div>
            <div className="lead-tile-label">{s.label}</div>
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
