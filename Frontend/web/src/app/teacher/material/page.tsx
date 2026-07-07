'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Button, Pill, useToast } from '@/components/ui';
import { FileOrUrlInput } from '@/components/file-input';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

export default function TeacherMaterial() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    fileUrl: '',
    mimeType: '',
    visibleToRoles: ['PARENT', 'STUDENT'],
  });
  const [busy, setBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDocuments();
      // Filter only custom documents for course materials
      setDocs(res.filter(d => d.type === 'CUSTOM'));
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.fileUrl) return;
    setBusy(true);
    try {
      await api.createDocument({
        title: form.title,
        type: 'CUSTOM',
        fileUrl: form.fileUrl,
        mimeType: form.mimeType || (form.fileUrl.endsWith('.pdf') ? 'application/pdf' : undefined),
        visibleToRoles: form.visibleToRoles,
      });
      setShowUploadModal(false);
      setForm({ title: '', fileUrl: '', mimeType: '', visibleToRoles: ['PARENT', 'STUDENT'] });
      toast('Material shared with your classes.');
      await loadDocs();
    } catch {
      toast('Could not upload the material. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this study material?')) return;
    try {
      await api.deleteDocument(id);
      toast('Material deleted.');
      await loadDocs();
    } catch {
      toast('Could not delete the material.', 'error');
    }
  };

  const handleRoleToggle = (role: string) => {
    setForm(prev => {
      const current = prev.visibleToRoles;
      if (current.includes(role)) {
        return { ...prev, visibleToRoles: current.filter(r => r !== role) };
      } else {
        return { ...prev, visibleToRoles: [...current, role] };
      }
    });
  };

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Course Material', desc: 'Study materials and resources for your classes.' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button onClick={() => setShowUploadModal(true)}>Upload Material</Button>
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {!loading && docs?.length === 0 && (
          <EmptyState title="No course materials yet" sub="Upload documents, PDFs, or links to share with your students." />
        )}
        {!loading && docs && docs.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>File Link</th>
                <th>Visible To</th>
                <th>Uploaded At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="cell-primary">{d.title}</td>
                  <td>
                    <a href={fileHref(d.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                      View Resource
                    </a>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.visibleToRoles.map((role) => (
                        <Pill key={role} tone="gray">{role}</Pill>
                      ))}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-faint)' }}>{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td>
                    <Button variant="ghost" small onClick={() => void handleDelete(d.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Upload Course Material</div>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <form onSubmit={handleUpload}>
              <div className="field-label">Material Title *</div>
              <input className="field-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Class 5 Algebra Notes" />

              <div className="field-label">Resource *</div>
              <FileOrUrlInput
                required
                value={{ fileUrl: form.fileUrl, mimeType: form.mimeType }}
                onChange={(v) => setForm({ ...form, fileUrl: v.fileUrl, mimeType: v.mimeType ?? '' })}
              />

              <div className="field-label">Visible To Roles</div>
              <div style={{ display: 'flex', gap: 16, margin: '8px 0 16px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={form.visibleToRoles.includes('STUDENT')} onChange={() => handleRoleToggle('STUDENT')} />
                  Student
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={form.visibleToRoles.includes('PARENT')} onChange={() => handleRoleToggle('PARENT')} />
                  Parent
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload Material'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowUploadModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
