'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api, ApiError } from '@/lib/api';
import type { GradeDto, SectionDto, SubjectDto, TermDto, OfferingDto, StaffAccountDto } from '@/lib/types';

type Tab = 'grades' | 'sections' | 'subjects' | 'offerings';

export default function ClassroomManagement() {
  const [activeTab, setActiveTab] = useState<Tab>('grades');
  const toast = useToast();

  const [grades, setGrades] = useState<GradeDto[] | null>(null);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);
  const [years, setYears] = useState<{ id: string; name: string; isCurrent: boolean }[]>([]);
  const [terms, setTerms] = useState<TermDto[] | null>(null);
  const [teachers, setTeachers] = useState<StaffAccountDto[] | null>(null);

  const loadGrades = () => api.listGrades().then(setGrades).catch(() => setGrades([]));
  const loadSections = () => api.allSections().then(setSections).catch(() => setSections([]));
  const loadSubjects = () => api.listSubjects().then(setSubjects).catch(() => setSubjects([]));
  const loadOfferings = () => api.listOfferings().then(setOfferings).catch(() => setOfferings([]));
  const loadTerms = () => api.listTerms().then(setTerms).catch(() => setTerms([]));

  useEffect(() => {
    loadGrades();
    loadSections();
    loadSubjects();
    loadOfferings();
    loadTerms();
    api.allAcademicYears().then(setYears).catch(() => setYears([]));
    api.listTeachers().then(setTeachers).catch(() => setTeachers([]));
  }, []);

  const yearNameById: Record<string, string> = Object.fromEntries(years.map((y) => [y.id, y.name]));

  // ── modals ──
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [gradeForm, setGradeForm] = useState({ name: '', level: '' });

  const [showSectionModal, setShowSectionModal] = useState(false);
  const [sectionForm, setSectionForm] = useState({ gradeId: '', name: '', classTeacherId: '' });

  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' });

  const [showOfferingModal, setShowOfferingModal] = useState(false);
  const [offeringForm, setOfferingForm] = useState({ sectionId: '', subjectId: '', termId: '', teacherId: '' });
  const [showTermForm, setShowTermForm] = useState(false);
  const [termForm, setTermForm] = useState({ academicYearId: '', name: '', startsOn: '', endsOn: '' });

  const [showBulkGrades, setShowBulkGrades] = useState(false);
  const [showBulkSections, setShowBulkSections] = useState(false);
  const [showBulkSubjects, setShowBulkSubjects] = useState(false);

  const createGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gradeForm.name || !gradeForm.level) return;
    try {
      await api.createGrade({ name: gradeForm.name, level: Number(gradeForm.level) });
      setShowGradeModal(false);
      setGradeForm({ name: '', level: '' });
      toast('Grade created.');
      loadGrades();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the grade.', 'error');
    }
  };

  const createSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionForm.gradeId || !sectionForm.name) return;
    try {
      await api.createSection({
        gradeId: sectionForm.gradeId,
        name: sectionForm.name,
        classTeacherId: sectionForm.classTeacherId || undefined,
      });
      setShowSectionModal(false);
      setSectionForm({ gradeId: '', name: '', classTeacherId: '' });
      toast('Classroom (section) created.');
      loadSections();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the section.', 'error');
    }
  };

  const createSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectForm.name) return;
    try {
      await api.createSubject({ name: subjectForm.name, code: subjectForm.code || undefined });
      setShowSubjectModal(false);
      setSubjectForm({ name: '', code: '' });
      toast('Subject created.');
      loadSubjects();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the subject.', 'error');
    }
  };

  const createTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termForm.academicYearId || !termForm.name || !termForm.startsOn || !termForm.endsOn) return;
    try {
      await api.createTerm(termForm);
      toast('Term created.');
      setTermForm({ academicYearId: '', name: '', startsOn: '', endsOn: '' });
      setShowTermForm(false);
      loadTerms();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the term.', 'error');
    }
  };

  const createOffering = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offeringForm.sectionId || !offeringForm.subjectId || !offeringForm.termId) return;
    try {
      await api.createOffering({
        sectionId: offeringForm.sectionId,
        subjectId: offeringForm.subjectId,
        termId: offeringForm.termId,
        teacherId: offeringForm.teacherId || undefined,
      });
      setShowOfferingModal(false);
      setOfferingForm({ sectionId: '', subjectId: '', termId: '', teacherId: '' });
      toast('Subject assigned to class.');
      loadOfferings();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the subject offering.', 'error');
    }
  };

  const teacherProfiles = (teachers ?? []).flatMap((u) =>
    u.profiles.filter((p) => p.role === 'TEACHER').map((p) => ({ profileId: p.profileId, displayName: p.displayName }))
  );

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Classroom Management', desc: 'Grades, sections, subjects, and subject-to-class assignments.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'grades' ? 'active' : ''}`} onClick={() => setActiveTab('grades')}>Grades</button>
        <button className={`chip-tab ${activeTab === 'sections' ? 'active' : ''}`} onClick={() => setActiveTab('sections')}>Sections (Classrooms)</button>
        <button className={`chip-tab ${activeTab === 'subjects' ? 'active' : ''}`} onClick={() => setActiveTab('subjects')}>Subjects</button>
        <button className={`chip-tab ${activeTab === 'offerings' ? 'active' : ''}`} onClick={() => setActiveTab('offerings')}>Subject Offerings</button>
      </div>

      {activeTab === 'grades' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
            <Button variant="soft" onClick={() => setShowBulkGrades(true)}>Bulk Upload</Button>
            <Button onClick={() => setShowGradeModal(true)}>+ Add Grade</Button>
          </div>
          <Card pad={false}>
            {grades === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {grades !== null && grades.length === 0 && (
              <EmptyState title="No grades yet" sub="Add your first grade (e.g. Class 1, Class 2) to start building the academic structure." />
            )}
            {grades && grades.length > 0 && (
              <table className="data-table data-table-cards">
                <thead><tr><th>Grade</th><th>Sort Level</th></tr></thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.id}>
                      <td className="cell-primary" data-label="Grade">{g.name}</td>
                      <td data-label="Sort Level">{g.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {activeTab === 'sections' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
            <Button variant="soft" onClick={() => setShowBulkSections(true)}>Bulk Upload</Button>
            <Button onClick={() => setShowSectionModal(true)}>+ Add Section</Button>
          </div>
          <Card pad={false}>
            {sections === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {sections !== null && sections.length === 0 && (
              <EmptyState title="No sections yet" sub="Add a grade first, then create sections (classrooms) within it." />
            )}
            {sections && sections.length > 0 && (
              <table className="data-table data-table-cards">
                <thead><tr><th>Class</th><th>Section</th><th>Class Teacher</th></tr></thead>
                <tbody>
                  {sections.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-primary" data-label="Class">{s.gradeName || '—'}</td>
                      <td data-label="Section">{s.name}</td>
                      <td data-label="Class Teacher">{s.classTeacher ?? <span style={{ color: 'var(--text-faint)' }}>Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {activeTab === 'subjects' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
            <Button variant="soft" onClick={() => setShowBulkSubjects(true)}>Bulk Upload</Button>
            <Button onClick={() => setShowSubjectModal(true)}>+ Add Subject</Button>
          </div>
          <Card pad={false}>
            {subjects === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {subjects !== null && subjects.length === 0 && (
              <EmptyState title="No subjects yet" sub="Add subjects (e.g. Mathematics, Science) to offer them to classes." />
            )}
            {subjects && subjects.length > 0 && (
              <table className="data-table data-table-cards">
                <thead><tr><th>Subject</th><th>Code</th></tr></thead>
                <tbody>
                  {subjects.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-primary" data-label="Subject">{s.name}</td>
                      <td data-label="Code">{s.code ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {activeTab === 'offerings' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <Button onClick={() => setShowOfferingModal(true)}>+ Assign Subject to Class</Button>
          </div>
          <Card pad={false}>
            {offerings === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {offerings !== null && offerings.length === 0 && (
              <EmptyState title="No subject offerings yet" sub="Assign a subject + teacher to a class section for a term." />
            )}
            {offerings && offerings.length > 0 && (
              <table className="data-table data-table-cards">
                <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th></tr></thead>
                <tbody>
                  {offerings.map((o) => (
                    <tr key={o.id}>
                      <td className="cell-primary" data-label="Class">{o.sectionName}</td>
                      <td data-label="Subject"><Pill tone="gray">{o.subject}</Pill></td>
                      <td data-label="Teacher">{o.teacherName ?? <span style={{ color: 'var(--text-faint)' }}>Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* Add Grade Modal */}
      {showGradeModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Grade</div>
              <button className="modal-close" onClick={() => setShowGradeModal(false)}>×</button>
            </div>
            <form onSubmit={createGrade}>
              <div className="field-label">Grade Name *</div>
              <input className="field-input" required value={gradeForm.name} onChange={(e) => setGradeForm({ ...gradeForm, name: e.target.value })} placeholder="e.g. Class 5" />

              <div className="field-label">Sort Level *</div>
              <input className="field-input" type="number" required value={gradeForm.level} onChange={(e) => setGradeForm({ ...gradeForm, level: e.target.value })} placeholder="e.g. 5" />
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>Controls display order — lower numbers appear first.</p>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Grade</Button>
                <Button variant="ghost" type="button" onClick={() => setShowGradeModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Section Modal */}
      {showSectionModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Section (Classroom)</div>
              <button className="modal-close" onClick={() => setShowSectionModal(false)}>×</button>
            </div>
            <form onSubmit={createSection}>
              <div className="field-label">Grade *</div>
              <select className="field-input" required value={sectionForm.gradeId} onChange={(e) => setSectionForm({ ...sectionForm, gradeId: e.target.value })}>
                <option value="">-- Choose Grade --</option>
                {grades?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {grades?.length === 0 && <p style={{ fontSize: 12, color: 'var(--amber, #b08020)', marginTop: 4 }}>Add a grade first.</p>}

              <div className="field-label">Section Name *</div>
              <input className="field-input" required value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} placeholder="e.g. A" />

              <div className="field-label">Class Teacher (optional)</div>
              <select className="field-input" value={sectionForm.classTeacherId} onChange={(e) => setSectionForm({ ...sectionForm, classTeacherId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {teacherProfiles.map((t) => <option key={t.profileId} value={t.profileId}>{t.displayName}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Section</Button>
                <Button variant="ghost" type="button" onClick={() => setShowSectionModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Subject Modal */}
      {showSubjectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Subject</div>
              <button className="modal-close" onClick={() => setShowSubjectModal(false)}>×</button>
            </div>
            <form onSubmit={createSubject}>
              <div className="field-label">Subject Name *</div>
              <input className="field-input" required value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="e.g. Mathematics" />

              <div className="field-label">Code (optional)</div>
              <input className="field-input" value={subjectForm.code} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })} placeholder="e.g. MATH" />

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Subject</Button>
                <Button variant="ghost" type="button" onClick={() => setShowSubjectModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Subject Offering Modal */}
      {showOfferingModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Assign Subject to Class</div>
              <button className="modal-close" onClick={() => setShowOfferingModal(false)}>×</button>
            </div>
            <form onSubmit={createOffering}>
              <div className="field-label">Section (Class) *</div>
              <select className="field-input" required value={offeringForm.sectionId} onChange={(e) => setOfferingForm({ ...offeringForm, sectionId: e.target.value })}>
                <option value="">-- Choose Section --</option>
                {sections?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} – {s.name}</option>)}
              </select>

              <div className="field-label">Subject *</div>
              <select className="field-input" required value={offeringForm.subjectId} onChange={(e) => setOfferingForm({ ...offeringForm, subjectId: e.target.value })}>
                <option value="">-- Choose Subject --</option>
                {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              <div className="field-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Term *</span>
                <button type="button" onClick={() => setShowTermForm((v) => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {showTermForm ? 'Cancel' : '+ New term'}
                </button>
              </div>
              <select className="field-input" required value={offeringForm.termId} onChange={(e) => setOfferingForm({ ...offeringForm, termId: e.target.value })}>
                <option value="">-- Choose Term --</option>
                {terms?.map((t) => <option key={t.id} value={t.id}>{t.name} ({yearNameById[t.academicYearId] ?? 'Year'})</option>)}
              </select>
              {terms?.length === 0 && !showTermForm && <p style={{ fontSize: 12, color: 'var(--amber, #b08020)', marginTop: 4 }}>No terms yet — click &quot;+ New term&quot; to create one.</p>}

              {showTermForm && (
                <div style={{ marginTop: 10, padding: 12, background: 'var(--surface-2, #f7f3ea)', borderRadius: 8 }}>
                  <div className="field-label">Academic Year *</div>
                  <select className="field-input" value={termForm.academicYearId} onChange={(e) => setTermForm({ ...termForm, academicYearId: e.target.value })}>
                    <option value="">-- Choose Year --</option>
                    {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>)}
                  </select>
                  <div className="field-label">Term Name *</div>
                  <input className="field-input" value={termForm.name} onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} placeholder="e.g. Term 1" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">Starts On *</div>
                      <input className="field-input" type="date" value={termForm.startsOn} onChange={(e) => setTermForm({ ...termForm, startsOn: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">Ends On *</div>
                      <input className="field-input" type="date" value={termForm.endsOn} onChange={(e) => setTermForm({ ...termForm, endsOn: e.target.value })} />
                    </div>
                  </div>
                  <Button type="button" small style={{ marginTop: 8 }} onClick={createTerm}>Create Term</Button>
                </div>
              )}

              <div className="field-label">Teacher (optional)</div>
              <select className="field-input" value={offeringForm.teacherId} onChange={(e) => setOfferingForm({ ...offeringForm, teacherId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {teacherProfiles.map((t) => <option key={t.profileId} value={t.profileId}>{t.displayName}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Assign Subject</Button>
                <Button variant="ghost" type="button" onClick={() => setShowOfferingModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showBulkGrades && (
        <BulkUploadModal
          title="Bulk upload grades"
          description="Upload a CSV to create many grades at once."
          templateHeaders={['name', 'level']}
          templateSampleRow={['Class 5', '5']}
          onSubmit={(file) => api.bulkCreateGrades(file)}
          onClose={() => setShowBulkGrades(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} grades.`, r.failed > 0 ? 'error' : 'success'); loadGrades(); }}
        />
      )}

      {showBulkSections && (
        <BulkUploadModal
          title="Bulk upload sections"
          description="Upload a CSV to create many sections (classrooms) at once. classTeacherPhone is optional."
          templateHeaders={['gradeName', 'name', 'classTeacherPhone']}
          templateSampleRow={['Class 5', 'A', '']}
          onSubmit={(file) => api.bulkCreateSections(file)}
          onClose={() => setShowBulkSections(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} sections.`, r.failed > 0 ? 'error' : 'success'); loadSections(); }}
        />
      )}

      {showBulkSubjects && (
        <BulkUploadModal
          title="Bulk upload subjects"
          description="Upload a CSV to create many subjects at once."
          templateHeaders={['name', 'code']}
          templateSampleRow={['Mathematics', 'MATH']}
          onSubmit={(file) => api.bulkCreateSubjects(file)}
          onClose={() => setShowBulkSubjects(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} subjects.`, r.failed > 0 ? 'error' : 'success'); loadSubjects(); }}
        />
      )}
    </PortalShell>
  );
}
