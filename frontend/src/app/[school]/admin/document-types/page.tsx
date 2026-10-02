'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Modal, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { DocumentFieldKind, DocumentFileType, DocumentTypeDto, DocumentTypeInput } from '@/lib/document-request-types';

/**
 * The documents this school issues to students, configured as data: a new
 * certificate is a new row here, not a code change. Each type carries the
 * extra questions students are asked and the files the office may issue.
 */

const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);
const KINDS: Array<{ value: DocumentFieldKind; label: string }> = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Choice' },
];
const FILE_TYPES: Array<{ value: DocumentFileType; label: string }> = [
  { value: 'pdf', label: 'PDF' }, { value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' },
];

export default function AdminDocumentTypesPage() {
  const [items, setItems] = useState<DocumentTypeDto[] | null>(null);
  const [editing, setEditing] = useState<DocumentTypeDto | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api.documentTypes().then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);

  const addSuggested = async () => {
    setBusy(true);
    try {
      const r = await api.addSuggestedDocumentTypes();
      toast(r.created.length ? `Added ${r.created.length} document type${r.created.length === 1 ? '' : 's'}.` : 'All suggested types are already set up.');
      void load();
    } catch (e) { toast(errText(e, 'Could not add the suggested types.'), 'error'); } finally { setBusy(false); }
  };

  const toggle = async (t: DocumentTypeDto, patch: DocumentTypeInput, ok: string) => {
    try {
      const next = await api.updateDocumentType(t.id, patch);
      setItems((prev) => prev?.map((x) => (x.id === next.id ? next : x)) ?? prev);
      toast(ok);
    } catch (e) { toast(errText(e, 'Could not update.'), 'error'); }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Document Types',
      desc: 'Certificates and letters students can request from the school office.',
      actions: (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={addSuggested} disabled={busy}>Add Suggested Types</Button>
          <Button onClick={() => setEditing('new')}>+ New type</Button>
        </div>
      ),
    }}>
      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && (
        <EmptyState
          title="No document types yet"
          sub="Add the suggested certificates (Bonafide, Study, Fee and more) in one click, or create your own."
          action={<Button onClick={addSuggested} disabled={busy}>Add Suggested Types</Button>}
        />
      )}
      {items && items.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Document type</th><th>Questions</th><th>Files</th><th>Status</th><th>Students can request</th><th></th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="cell-primary" data-label="Document type">
                    {t.name}
                    {t.description && <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>{t.description}</div>}
                  </td>
                  <td data-label="Questions">{t.fields.length ? t.fields.map((f) => f.label).join(', ') : '—'}</td>
                  <td data-label="Files">{t.allowedFileTypes.map((x) => x.toUpperCase()).join(', ')} · ≤{t.maxFileSizeMb} MB</td>
                  <td data-label="Status"><Pill tone={t.isActive ? 'green' : 'gray'}>{t.isActive ? 'Active' : 'Inactive'}</Pill></td>
                  <td data-label="Students can request">{t.requestEnabled ? 'Yes' : 'No'}</td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="soft" small onClick={() => setEditing(t)}>Edit</Button>
                      <Button variant="ghost" small onClick={() => toggle(t, { isActive: !t.isActive }, t.isActive ? `${t.name} deactivated.` : `${t.name} activated.`)}>
                        {t.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <TypeForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            toast(`${t.name} saved.`);
            void load();
          }}
        />
      )}
    </PortalShell>
  );
}

type FieldDraft = { key?: string; label: string; kind: DocumentFieldKind; required: boolean; options: string };

function TypeForm({ initial, onClose, onSaved }: { initial: DocumentTypeDto | null; onClose: () => void; onSaved: (t: DocumentTypeDto) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [requestEnabled, setRequestEnabled] = useState(initial?.requestEnabled ?? true);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(String(initial?.maxFileSizeMb ?? 5));
  const [allowed, setAllowed] = useState<DocumentFileType[]>(initial?.allowedFileTypes ?? ['pdf']);
  const [fields, setFields] = useState<FieldDraft[]>(
    (initial?.fields ?? []).map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required, options: f.options.join(', ') })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setField = (i: number, patch: Partial<FieldDraft>) => setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (allowed.length === 0) { setErr('Allow at least one file type.'); return; }
    if (fields.some((f) => !f.label.trim())) { setErr('Every question needs a label.'); return; }
    setBusy(true); setErr(null);
    const body: DocumentTypeInput = {
      name: name.trim(), description, instructions, isActive, requestEnabled,
      maxFileSizeMb: Number(maxFileSizeMb),
      allowedFileTypes: allowed,
      fields: fields.map((f) => ({
        ...(f.key ? { key: f.key } : {}),
        label: f.label.trim(), kind: f.kind, required: f.required,
        options: f.kind === 'select' ? f.options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      })),
    };
    try {
      onSaved(initial ? await api.updateDocumentType(initial.id, body) : await api.createDocumentType(body));
    } catch (e2) { setErr(errText(e2, 'Could not save.')); } finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New document type'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="dt-name">Name</label>
        <input id="dt-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Internship Certificate" />
        <label className="field-label" htmlFor="dt-desc" style={{ marginTop: 10, display: 'block' }}>Description</label>
        <textarea id="dt-desc" className="field-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        <label className="field-label" htmlFor="dt-instr" style={{ marginTop: 10, display: 'block' }}>Instructions for students / processing notes</label>
        <textarea id="dt-instr" className="field-input" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} />

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13.5 }}>
          <label><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
          <label><input type="checkbox" checked={requestEnabled} onChange={(e) => setRequestEnabled(e.target.checked)} /> Students can request it</label>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 0' }}>
          <legend className="field-label">Files the office may issue</legend>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
            {FILE_TYPES.map((ft) => (
              <label key={ft.value}>
                <input type="checkbox" checked={allowed.includes(ft.value)}
                  onChange={(e) => setAllowed((prev) => (e.target.checked ? [...prev, ft.value] : prev.filter((x) => x !== ft.value)))} /> {ft.label}
              </label>
            ))}
            <label htmlFor="dt-size">Max size (MB)</label>
            <input id="dt-size" className="field-input" style={{ width: 80 }} type="number" min={1} max={15} value={maxFileSizeMb} onChange={(e) => setMaxFileSizeMb(e.target.value)} />
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: '14px 0 0' }}>
          <legend className="field-label">Questions students answer (besides purpose)</legend>
          {fields.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>None — students give a purpose and any additional information.</p>}
          {fields.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 2fr) minmax(110px, 1fr) auto auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="field-input" aria-label={`Question ${i + 1} label`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={80} placeholder="e.g. Company name" />
              <select className="field-input" aria-label={`Question ${i + 1} kind`} value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as DocumentFieldKind })}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>
              <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--red, #b52a2a)', cursor: 'pointer', fontSize: 16 }}>×</button>
              {f.kind === 'select' && (
                <input className="field-input" style={{ gridColumn: '1 / -1' }} aria-label={`Question ${i + 1} options`} value={f.options}
                  onChange={(e) => setField(i, { options: e.target.value })} placeholder="Options, separated by commas" />
              )}
            </div>
          ))}
          {fields.length < 20 && (
            <Button type="button" variant="ghost" small onClick={() => setFields((prev) => [...prev, { label: '', kind: 'text', required: false, options: '' }])}>+ Add question</Button>
          )}
        </fieldset>

        {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
