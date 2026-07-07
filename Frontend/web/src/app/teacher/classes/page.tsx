'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

export default function MyClassesPage() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.students().then((r) => setStudents(r.items)).catch(() => { setErr(true); setStudents([]); }); }, []);

  // Group by class label — scope already limits to sections this teacher teaches.
  const byClass = (students ?? []).reduce<Record<string, StudentListItem[]>>((acc, s) => {
    const k = s.enrollment?.class ?? 'Unassigned';
    (acc[k] ??= []).push(s); return acc;
  }, {});

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'My Classes', desc: 'Sections you teach or class-teach.' }}>
      {students === null && !err && <Card><SkeletonRows rows={5} /></Card>}
      {err && <EmptyState title="Couldn't load classes" sub="Reload to try again." />}
      {students && students.length === 0 && <EmptyState title="No students assigned" sub="You'll see your sections here once classes are linked to you." />}
      {Object.entries(byClass).map(([cls, list]) => (
        <Card key={cls} style={{ marginBottom: 14 }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>{cls} <span style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: 'inherit' }}>· {list.length} students</span></strong>
          <table className="data-table" style={{ marginTop: 10 }}>
            <thead><tr><th>Student</th><th>Roll</th><th>Admission No.</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td><span className="row-flex"><Avatar name={s.name} /><span className="cell-primary">{s.name}</span></span></td>
                  <td>{s.enrollment?.rollNo ?? '—'}</td>
                  <td style={{ color: 'var(--text-faint)' }}>{s.admissionNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </PortalShell>
  );
}
