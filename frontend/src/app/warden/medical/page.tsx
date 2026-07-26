'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { MedicalRecordPanel } from '@/components/medical-record-panel';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

export default function WardenMedical() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StudentListItem | null>(null);

  useEffect(() => { api.students().then((r) => setStudents(r.items)).catch(() => setStudents([])); }, []);

  const filtered = students?.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Medical Records', desc: 'Emergency student health logs (read-only).' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div>
          <input className="input" placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
          {students === null && <Card><SkeletonRows rows={5} /></Card>}
          {filtered.length === 0 && students !== null && <EmptyState icon="◌" title="No students" sub="No student matches found." />}
          <Card pad={false}>
            {filtered.map((s, i) => (
              <button key={s.id} onClick={() => setSelected(s)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none', background: selected?.id === s.id ? 'var(--accent-subtle, #f5ede0)' : 'transparent', cursor: 'pointer', border: 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13.5 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{s.enrollment?.class ?? 'No class'}</div>
              </button>
            ))}
          </Card>
        </div>

        <div>
          {!selected && <EmptyState icon="✚" title="Select a student" sub="Choose a student on the left to view their emergency health information." />}
          {selected && <MedicalRecordPanel studentId={selected.id} canManage={false} />}
        </div>
      </div>
    </PortalShell>
  );
}
