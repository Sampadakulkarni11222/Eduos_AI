'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { MedicalRecordPanel } from '@/components/medical-record-panel';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { StudentListItem, SectionDto } from '@/lib/types';

export default function TeacherMedical() {
  const { me } = useAuth();
  const [allSections, setAllSections] = useState<SectionDto[] | null>(null);
  const [gradeName, setGradeName] = useState('');
  const [sectionId, setSectionId] = useState('');

  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [studentId, setStudentId] = useState('');

  useEffect(() => {
    // mySections() covers class-teacher AND subject-teacher sections, but
    // medical records are more sensitive than a subject roster — only this
    // teacher's own homeroom (class-teacher) section(s) should be browsable
    // here, so we filter down to classTeacherId === me below.
    api.mySections().then(setAllSections).catch(() => setAllSections([]));
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const sections = (allSections ?? []).filter((s) => s.classTeacherId === me?.profile?.id);
  const loading = allSections === null || students === null;
  const grades = [...new Set(sections.map((s) => s.gradeName))];
  const sectionsInGrade = sections.filter((s) => s.gradeName === gradeName);
  const studentsInSection = students?.filter((s) => s.enrollment?.sectionId === sectionId) ?? [];
  const selected = studentsInSection.find((s) => s.id === studentId) ?? null;

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Medical Records', desc: 'Student health information for your homeroom class only (read-only).' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: '1 1 220px', maxWidth: 280 }}>
          <div className="field-label">Class / Grade</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={gradeName}
            onChange={(e) => { setGradeName(e.target.value); setSectionId(''); setStudentId(''); }}
          >
            <option value="">-- Choose grade --</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        <div style={{ flex: '1 1 220px', maxWidth: 280 }}>
          <div className="field-label">Section</div>
          <select
            className="field-input"
            style={{ marginBottom: 0 }}
            value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setStudentId(''); }}
            disabled={!gradeName || sectionsInGrade.length === 0}
          >
            <option value="">-- Choose section --</option>
            {sectionsInGrade.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
            {studentsInSection.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && sections.length === 0 && (
        <EmptyState icon="◌" title="No homeroom class assigned" sub="Medical records are only visible to a section's class teacher — you'll see this once you're assigned one." />
      )}

      {!loading && sections.length > 0 && sectionId && studentsInSection.length === 0 && (
        <EmptyState icon="◌" title="No students in this section" sub="No students are currently enrolled in this class/section." />
      )}

      {!loading && sections.length > 0 && !selected && studentsInSection.length > 0 && (
        <EmptyState icon="✚" title="Select a student" sub="Choose a student above to view their health information." />
      )}

      {!loading && sections.length > 0 && !sectionId && (
        <EmptyState icon="✚" title="Select a class and student" sub="Choose a grade/section, then a student, to view their health information." />
      )}

      {selected && <MedicalRecordPanel studentId={selected.id} canManage={false} />}
    </PortalShell>
  );
}
