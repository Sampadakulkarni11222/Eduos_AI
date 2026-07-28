'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { MedicalRecordPanel } from '@/components/medical-record-panel';
import { api } from '@/lib/api';
import type { StudentListItem, SectionDto } from '@/lib/types';

export default function AdminMedical() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [sectionId, setSectionId] = useState('');

  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [studentId, setStudentId] = useState('');

  useEffect(() => {
    api.allSections().then(setSections).catch(() => setSections([]));
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const loading = sections === null || students === null;
  const studentsInSection = students?.filter((s) => s.enrollment?.sectionId === sectionId) ?? [];
  const selected = studentsInSection.find((s) => s.id === studentId) ?? null;

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Medical Records', desc: 'Create, update, or remove any student’s health record.' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: '1 1 220px', maxWidth: 280 }}>
          <div className="field-label">Class / Section</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setStudentId(''); }}
          >
            <option value="">-- Choose class / section --</option>
            {sections?.map((s) => (
              <option key={s.id} value={s.id}>{s.gradeName} – {s.name}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 220px', maxWidth: 280 }}>
          <div className="field-label">Student</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={!sectionId || studentsInSection.length === 0}
          >
            <option value="">-- Choose student --</option>
            {studentsInSection.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && sectionId && studentsInSection.length === 0 && (
        <EmptyState icon="◌" title="No students in this section" sub="No students are currently enrolled in this class/section." />
      )}

      {!loading && !selected && studentsInSection.length > 0 && (
        <EmptyState icon="✚" title="Select a student" sub="Choose a student above to view or edit their health record." />
      )}

      {!loading && !sectionId && (
        <EmptyState icon="✚" title="Select a class and student" sub="Choose a class/section, then a student, to view or edit their health record." />
      )}

      {selected && <MedicalRecordPanel studentId={selected.id} canManage />}
    </PortalShell>
  );
}
