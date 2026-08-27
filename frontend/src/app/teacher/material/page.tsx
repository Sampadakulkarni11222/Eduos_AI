'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Button, Pill, useToast } from '@/components/ui';
import { FileOrUrlInput } from '@/components/file-input';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto, SectionDto } from '@/lib/types';

export default function TeacherMaterial() {
  const [docs, setDocs] = useState<any[] | null>(null);
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editing, setEditing] = useState<DocumentDto | null>(null);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    fileUrl: '',
    mimeType: '',
    sectionId: '',
    visibleToRoles: ['PARENT', 'STUDENT'],
  });
  const [busy, setBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDocuments();
      setDocs(res.filter(d => d.type === 'CUSTOM'));
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
    api.mySections().then(setSections).catch(() => setSections([]));
  }, [loadDocs]);

  const sectionName = (id?: string | null) => {
    const s = sections.find((x) => x.id === id);
    return s ? `${s.gradeName} - ${s.name}` : null;
  };

  const filteredDocs = useMemo(() => {
    if (!docs) return docs;
    return docs.filter((d) => {
      if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (sectionFilter && d.sectionId !== sectionFilter) return false;
      return true;
    });
  }, [docs, search, sectionFilter]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.fileUrl || !form.sectionId) return;
    setBusy(true);

    const formBackup = { ...form };
    const backupDocs = docs;

    const optimisticDoc = {
      id: `optimistic-${Date.now()}`,
      title: form.title,
      type: 'CUSTOM',
      fileUrl: form.fileUrl,
      mimeType: form.mimeType || (form.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
      visibleToRoles: form.visibleToRoles,
      sectionId: form.sectionId,
      issuedAt: new Date().toISOString(),
      sending: true
    };

    setShowUploadModal(false);
    setForm({ title: '', fileUrl: '', mimeType: '', sectionId: '', visibleToRoles: ['PARENT', 'STUDENT'] });
    toast('Material upload started...');

    if (docs) {
      setDocs([optimisticDoc, ...docs]);
    } else {
      setDocs([optimisticDoc]);
    }

    try {
      await api.createDocument({
        title: formBackup.title,
        type: 'CUSTOM',
        fileUrl: formBackup.fileUrl,
        mimeType: formBackup.mimeType || (formBackup.fileUrl.endsWith('.pdf') ? 'application/pdf' : undefined),
        visibleToRoles: formBackup.visibleToRoles,
        sectionId: formBackup.sectionId,
      });
      toast('Material shared with your class.');
      await loadDocs();
    } catch {
      setDocs(backupDocs);
      setForm(formBackup);
      setShowUploadModal(true);
      toast('Could not upload the material. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !form.title) return;
    setBusy(true);
    try {
      await api.updateDocument(editing.id, {
        title: form.title,
        fileUrl: form.fileUrl,
        mimeType: form.mimeType || undefined,
        visibleToRoles: form.visibleToRoles,
        sectionId: form.sectionId || null,
      });
      toast('Material updated.');
      setEditing(null);
      await loadDocs();
    } catch {
      toast('Could not update the material.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (d: any) => {
    setForm({
      title: d.title,
      fileUrl: d.fileUrl,
      mimeType: d.mimeType || '',
      sectionId: d.sectionId || '',
      visibleToRoles: d.visibleToRoles,
    });
    setEditing(d);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this study material?')) return;
    const backupDocs = docs;
    if (docs) {
      setDocs(docs.filter(d => d.id !== id));
    }
    toast('Material deleted.');
    try {
      await api.deleteDocument(id);
      await loadDocs();
    } catch {
      setDocs(backupDocs);
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
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Course Material', desc: 'Study materials and resources for your classes.',
      actions: <Button onClick={() => setShowUploadModal(true)}>Upload Material</Button>,
    }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input search-input"
          style={{ maxWidth: 280 }}
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
          <option value="">All sections</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.gradeName} - {s.name}</option>)}
        </select>
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {!loading && filteredDocs?.length === 0 && (
          <EmptyState title="No course materials found" sub="Upload documents, PDFs, or links to share with your students." />
        )}
        {!loading && filteredDocs && filteredDocs.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Title</th>
                <th>Section</th>
                <th>File Link</th>
                <th>Visible To</th>
                <th>Uploaded At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((d) => (
                <tr key={d.id} style={{ opacity: d.sending ? 0.6 : 1 }}>
                  <td className="cell-primary" data-label="Title">
                    {d.title} {d.sending && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}> (Uploading...)</span>}
                  </td>
                  <td data-label="Section">{sectionName(d.sectionId) ?? '—'}</td>
                  <td data-label="File Link">
                    {d.sending ? (
                      <span style={{ color: 'var(--text-faint)' }}>Uploading...</span>
                    ) : (
                      <a href={fileHref(d.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                        View Resource
                      </a>
                    )}
                  </td>
                  <td data-label="Visible To">
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.visibleToRoles.map((role: string) => (
                        <Pill key={role} tone="gray">{role}</Pill>
                      ))}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Uploaded At">{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" small disabled={d.sending} onClick={() => openEdit(d)}>Edit</Button>
                      <Button variant="ghost" small disabled={d.sending} onClick={() => void handleDelete(d.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showUploadModal && (
        // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
        // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && (() => setShowUploadModal(false))()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Upload Course Material</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <form onSubmit={handleUpload}>
              <div className="field-label">Material Title *</div>
              <input className="field-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Class 5 Algebra Notes" />

              <div className="field-label">Section *</div>
              <select className="field-input" required value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">Select a section…</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.gradeName} - {s.name}</option>)}
              </select>

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

      {editing && (
        // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
        // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && (() => setEditing(null))()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Edit Course Material</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setEditing(null)}>×</button>
            </div>
            <form onSubmit={handleEditSave}>
              <div className="field-label">Material Title *</div>
              <input className="field-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />

              <div className="field-label">Section *</div>
              <select className="field-input" required value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">Select a section…</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.gradeName} - {s.name}</option>)}
              </select>

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
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
                <Button variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
