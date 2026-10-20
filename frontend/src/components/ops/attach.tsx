'use client';
import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Uploads one file (letter, receipt, evidence, photo) and reports `{ name, url }`.
 * The stored URL is an /uploads path; the API signs it whenever it is served.
 */
export function AttachUpload({ label = 'Attach a file', accept, onUploaded, hint }: { label?: string; accept?: string; hint?: string; onUploaded: (a: { name: string; url: string; mimeType: string }) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const pick = async (file: File | undefined | null) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.uploadFile(file);
      setLast(res.filename);
      onUploaded({ name: file.name, url: res.fileUrl, mimeType: res.mimeType });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} className="field-label" style={{ display: 'block' }}>{label}</label>
      <input id={id} type="file" accept={accept ?? '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt'} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} style={{ fontSize: 13 }} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <div id={`${id}-hint`} style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>{hint}</div>}
      {busy && <div className="ops-muted">Uploading…</div>}
      {!busy && last && <div style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>✓ {last} uploaded</div>}
      {err && <div role="alert" className="ops-error">⚠ {err}</div>}
    </div>
  );
}
