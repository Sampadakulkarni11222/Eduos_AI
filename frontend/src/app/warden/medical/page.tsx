'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { MedicalDto, StudentListItem } from '@/lib/types';

export default function WardenMedical() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StudentListItem | null>(null);
  const [rec, setRec] = useState<MedicalDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.students().then((r) => setStudents(r.items)).catch(() => setStudents([])); }, []);

  const filtered = students?.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  const select = (s: StudentListItem) => {
    setSelected(s); setRec(null); setLoading(true);
    api.medical(s.id).then(setRec).catch(() => setRec(null)).finally(() => setLoading(false));
  };

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: value ? 'var(--text-1)' : 'var(--text-faint)' }}>{value || 'Not recorded'}</div>
    </div>
  );

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Medical Records', desc: 'Emergency student health logs (read-only).' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div>
          <input className="input" placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
          {students === null && <Card><SkeletonRows rows={5} /></Card>}
          {filtered.length === 0 && students !== null && <EmptyState icon="◌" title="No students" sub="No student matches found." />}
          <Card pad={false}>
            {filtered.map((s, i) => (
              <button key={s.id} onClick={() => select(s)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none', background: selected?.id === s.id ? 'var(--accent-subtle, #f5ede0)' : 'transparent', cursor: 'pointer', border: 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13.5 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{s.enrollment?.class ?? 'No class'}</div>
              </button>
            ))}
          </Card>
        </div>

        <div>
          {!selected && <EmptyState icon="✚" title="Select a student" sub="Choose a student on the left to view their emergency health information." />}
          {loading && <Card><SkeletonRows rows={4} /></Card>}
          {!loading && selected && rec && (
            <>
              <Card style={{ marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Basic Info</strong>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
                  {field('Blood group', rec.bloodGroup)}
                  {field('Height', rec.heightCm ? `${rec.heightCm} cm` : null)}
                  {field('Weight', rec.weightKg ? `${rec.weightKg} kg` : null)}
                </div>
              </Card>
              <Card style={{ marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Emergency Contact</strong>
                <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
                  {rec.emergencyContact
                    ? `${rec.emergencyContact.name} (${rec.emergencyContact.relation}) · ${rec.emergencyContact.phone}`
                    : <span style={{ color: 'var(--text-faint)' }}>None recorded</span>}
                </div>
              </Card>
              <Card style={{ marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Allergies</strong>
                <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
                  {rec.allergies.length ? rec.allergies.join(', ') : <span style={{ color: 'var(--text-faint)' }}>None recorded</span>}
                </div>
              </Card>
              <Card>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Medications &amp; History</strong>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 13.5, color: 'var(--text-2)' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Medications</div>
                    {rec.medications.length ? rec.medications.join(', ') : <span style={{ color: 'var(--text-faint)' }}>None</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>History</div>
                    {rec.history || <span style={{ color: 'var(--text-faint)' }}>None</span>}
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
