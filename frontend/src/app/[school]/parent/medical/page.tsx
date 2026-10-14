'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { MedicalRecordPanel } from '@/components/medical-record-panel';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

export default function ParentMedical() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => setKids([])); }, []);

  const kid = kids?.[active];

  return (
    <PortalShell expectedSlug="parent" topbar={{
      title: 'Medical Records',
      desc: kid ? `${kid.name} · health information` : 'Health information',
    }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : 'var(--card-bg)', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your wards to this number." />}

      {kid && (
        <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 12 }}>
          Keep this up to date so the school can help {kid.name.split(' ')[0]} in an emergency. Every change is recorded
          with your name. Only the school office can remove a medical record.
        </p>
      )}
      {kid && <MedicalRecordPanel studentId={kid.id} canManage canDelete={false} />}
    </PortalShell>
  );
}
