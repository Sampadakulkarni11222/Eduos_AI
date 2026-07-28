'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { GradeDto, SectionDto, OfferingDto } from '@/lib/types';

export default function AdminTeacherClasses() {
  const [grades, setGrades] = useState<GradeDto[] | null>(null);
  const [gradeId, setGradeId] = useState('');

  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');

  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);

  // Load grades once.
  useEffect(() => {
    api.listGrades().then((g) => {
      setGrades(g);
      if (g[0]) setGradeId(g[0].id);
    }).catch(() => setGrades([]));
  }, []);

  // Load sections whenever the selected grade changes.
  useEffect(() => {
    if (!gradeId) { setSections([]); setSectionId(''); return; }
    setSections(null);
    setSectionId('');
    api.allSections(gradeId)
      .then((secs) => {
        setSections(secs);
        if (secs[0]) setSectionId(secs[0].id);
      })
      .catch(() => setSections([]));
  }, [gradeId]);

  // Load subject offerings whenever the selected section changes.
  useEffect(() => {
    if (!sectionId) { setOfferings([]); return; }
    setOfferings(null);
    api.listOfferings({ sectionId })
      .then(setOfferings)
      .catch(() => setOfferings([]));
  }, [sectionId]);

  const selectedSection = sections?.find((s) => s.id === sectionId) ?? null;
  const loadingOfferings = offerings === null;

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Teacher Class Assignments', desc: 'Pick a grade and section to see its subjects and teachers.' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
          <div className="field-label">Grade</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value)}
          >
            {grades === null && <option>Loading…</option>}
            {grades !== null && grades.length === 0 && <option value="">No grades yet</option>}
            {grades?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
          <div className="field-label">Section</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!gradeId || sections === null || sections.length === 0}
          >
            {sections === null && <option>Loading…</option>}
            {sections !== null && sections.length === 0 && <option value="">No sections in this grade</option>}
            {sections?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {!gradeId && grades !== null && grades.length === 0 && (
        <EmptyState title="No grades yet" sub="Create grades and sections from Classroom Management." />
      )}

      {gradeId && sections !== null && sections.length === 0 && (
        <EmptyState title="No sections in this grade" sub="Add a section for this grade from Classroom Management." />
      )}

      {selectedSection && (
        <>
          <Card style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 2 }}>Class Teacher</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {selectedSection.classTeacher ?? <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontStyle: 'italic' }}>Unassigned</span>}
              </div>
            </div>
            <Pill tone="gray">{selectedSection.gradeName} – {selectedSection.name}</Pill>
          </Card>

          <Card pad={false}>
            {loadingOfferings && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {!loadingOfferings && offerings!.length === 0 && (
              <EmptyState title="No subjects assigned" sub="Assign subjects to this section from Classroom Management." />
            )}
            {!loadingOfferings && offerings!.length > 0 && (
              <table className="data-table data-table-cards">
                <thead><tr><th>Subject</th><th>Teacher</th></tr></thead>
                <tbody>
                  {offerings!.map((o) => (
                    <tr key={o.id}>
                      <td className="cell-primary" data-label="Subject">{o.subject}</td>
                      <td data-label="Teacher">
                        {o.teacherName ?? <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Unassigned</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}
