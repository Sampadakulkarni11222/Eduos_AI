'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Button, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

export default function TeacherMaterial() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    fileUrl: '',
    visibleToRoles: ['PARENT', 'STUDENT'],
  });
  const [uploadType, setUploadType] = useState<'url' | 'file'>('url');
  const [busy, setBusy] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Read file as Base64 data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setForm({ ...form, fileUrl: event.target.result as string });
      }
    };
    reader.readAsDataURL(file);
  };

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
        mimeType: form.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'text/html',
        visibleToRoles: form.visibleToRoles,
      });
      setShowUploadModal(false);
      setUploadType('url');
      setForm({ title: '', fileUrl: '', visibleToRoles: ['PARENT', 'STUDENT'] });
      await loadDocs();
    } catch {
      alert('Error uploading document');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this study material?')) return;
    try {
      await api.deleteDocument(id);
      await loadDocs();
    } catch {
      alert('Error deleting document');
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
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
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

              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={uploadType === 'url'} onChange={() => setUploadType('url')} />
                  Provide Link
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={uploadType === 'file'} onChange={() => setUploadType('file')} />
                  Upload from Device
                </label>
              </div>

              {uploadType === 'url' ? (
                <>
                  <div className="field-label">Resource URL * (PDF/Document/Link)</div>
                  <input className="field-input" type="url" required value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} placeholder="https://example.com/notes.pdf" />
                </>
              ) : (
                <>
                  <div className="field-label">Select File *</div>
                  <input className="field-input" type="file" required onChange={handleFileSelect} accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" />
                </>
              )}

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
