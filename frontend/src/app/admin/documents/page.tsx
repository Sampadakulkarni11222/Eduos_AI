'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { FileOrUrlInput } from '@/components/file-input';
import { ConfirmModal } from '@/components/confirm-modal';
import { api, ApiError } from '@/lib/api';
import type { DocumentDto, StudentListItem } from '@/lib/types';

export default function AdminDocuments() {
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentDto | null>(null);
  const toast = useToast();
  const [form, setForm] = useState({
    title: '', type: 'CUSTOM', fileUrl: '', mimeType: '', studentId: '', visibleToRoles: ['PARENT', 'STUDENT']
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
    setBusy(true);
    try {
      await api.createDocument({
        title: form.title,
        type: form.type,
        fileUrl: form.fileUrl,
        mimeType: form.mimeType || undefined,
        studentId: form.studentId || undefined,
        visibleToRoles: form.visibleToRoles,
      });
      setShowUploadModal(false);
      setForm({ title: '', type: 'CUSTOM', fileUrl: '', mimeType: '', studentId: '', visibleToRoles: ['PARENT', 'STUDENT'] });
      toast('Document published.');
      loadDocs();
    } catch (err) {
      toast('Could not create the document. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (d: DocumentDto) => {
    setOpeningId(d.id);
    try {
      await api.openDocumentFile(d.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't open this document.", 'error');
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDocument(id);
      toast('Document deleted.');
      setDeleteTarget(null);
      loadDocs();
    } catch (err) {
      toast('Could not delete the document.', 'error');
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
          <table className="data-table data-table-cards">
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
                  <td className="cell-primary" data-label="Title">
                    <button
                      onClick={() => openDoc(d)}
                      disabled={openingId === d.id}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', color: 'var(--blue)', font: 'inherit' }}
                    >
                      {openingId === d.id ? 'Opening…' : d.title}
                    </button>
                  </td>
                  <td data-label="Type"><Pill tone="blue">{d.type}</Pill></td>
                  <td data-label="Target Student">{d.studentName ?? 'All Students'}</td>
                  <td data-label="Visible To">
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.visibleToRoles.map((r) => (
                        <Pill key={r} tone="gray">{r}</Pill>
                      ))}
                    </div>
                  </td>
                  <td data-label="Issued Date">{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td data-label="Action">
                    <Button variant="ghost" small onClick={() => setDeleteTarget(d)} style={{ color: 'var(--red)' }}>Delete</Button>
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
                <option value="TC">Transfer Certificate (TC)</option>
                <option value="LETTER">Official Letter</option>
                <option value="CUSTOM">Custom Document</option>
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--text-2b)', marginTop: -8, marginBottom: 12 }}>
                ID cards aren&apos;t uploaded here — they&apos;re generated automatically from each student&apos;s record and can be viewed from their Documents page.
              </div>

              <div className="field-label">File *</div>
              <FileOrUrlInput
                required
                value={{ fileUrl: form.fileUrl, mimeType: form.mimeType }}
                onChange={(v) => setForm({ ...form, fileUrl: v.fileUrl, mimeType: v.mimeType ?? '' })}
              />

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
                <Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish Document'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowUploadModal(false)} disabled={busy}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete document?"
          body={`"${deleteTarget.title}" will be permanently deleted and will no longer be visible to parents or students.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </PortalShell>
  );
}
