'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { DocumentDto, StudentListItem } from '@/lib/types';

export default function AdminDocuments() {
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [form, setForm] = useState({
    title: '', type: 'CUSTOM', fileUrl: '', studentId: '', visibleToRoles: ['PARENT', 'STUDENT']
  });

  const loadDocs = () => {
    api.listDocuments().then(setDocuments).catch(() => setDocuments([]));
  };

  useEffect(() => {
    loadDocs();
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.fileUrl) return;
    try {
      await api.createDocument({
        title: form.title,
        type: form.type,
        fileUrl: form.fileUrl,
        studentId: form.studentId || undefined,
        visibleToRoles: form.visibleToRoles,
      });
      setShowUploadModal(false);
      setForm({ title: '', type: 'CUSTOM', fileUrl: '', studentId: '', visibleToRoles: ['PARENT', 'STUDENT'] });
      loadDocs();
    } catch (err) {
      alert('Error creating document');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await api.deleteDocument(id);
      loadDocs();
    } catch (err) {
      alert('Error deleting document');
    }
  };

  const handleRoleToggle = (role: string) => {
    setForm((prev) => {
      const current = prev.visibleToRoles;
      const updated = current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role];
      return { ...prev, visibleToRoles: updated };
    });
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Document Management', desc: 'Publish, distribute, and manage certificates, reports, or letters.' }}>
      <div style={{ marginBottom: 16 }}>
        <Button onClick={() => setShowUploadModal(true)}>Upload Document</Button>
      </div>

      <Card pad={false}>
        {documents === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {documents !== null && documents.length === 0 && (
          <EmptyState title="No documents found" sub="Upload documents to share them with parents or students." />
        )}
        {documents && documents.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Target Student</th>
                <th>Visible To</th>
                <th>Issued Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="cell-primary">
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: 'var(--blue)' }}>
                      {d.title}
                    </a>
                  </td>
                  <td><Pill tone="blue">{d.type}</Pill></td>
                  <td>{d.studentName ?? 'All Students'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.visibleToRoles.map((r) => (
                        <Pill key={r} tone="gray">{r}</Pill>
                      ))}
                    </div>
                  </td>
                  <td>{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td>
                    <Button variant="ghost" small onClick={() => handleDelete(d.id)} style={{ color: 'var(--red)' }}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Upload Document Record</div>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateDocument}>
              <div className="field-label">Document Title *</div>
              <input className="field-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Aarav Tharian — Term 1 Report Card" />

              <div className="field-label">Document Type</div>
              <select className="field-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="REPORT_CARD">Report Card</option>
                <option value="ID_CARD">ID Card</option>
                <option value="TC">Transfer Certificate (TC)</option>
                <option value="LETTER">Official Letter</option>
                <option value="CUSTOM">Custom Document</option>
              </select>

              <div className="field-label">File Link / URL *</div>
              <input className="field-input" required type="url" value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} placeholder="e.g. https://example.com/files/report.pdf" />

              <div className="field-label">Linked Student (Optional)</div>
              <select className="field-input" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
                <option value="">-- Apply to All / Unlinked --</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.enrollment?.class ?? 'No Class'})</option>
                ))}
              </select>

              <div className="field-label" style={{ marginBottom: 8 }}>Audience Access Visibility</div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={form.visibleToRoles.includes('PARENT')} onChange={() => handleRoleToggle('PARENT')} />
                  Parents
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={form.visibleToRoles.includes('STUDENT')} onChange={() => handleRoleToggle('STUDENT')} />
                  Students
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Publish Document</Button>
                <Button variant="ghost" type="button" onClick={() => setShowUploadModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
