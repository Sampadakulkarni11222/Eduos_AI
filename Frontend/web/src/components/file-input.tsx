'use client';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Shared upload control: picks a local file, uploads it to the backend, and
 * reports the stored fileUrl. A "paste a link instead" fallback remains for
 * referencing externally-hosted files.
 */
export function FileOrUrlInput({
  value,
  onChange,
  required,
}: {
  value: { fileUrl: string; mimeType?: string };
  onChange: (v: { fileUrl: string; mimeType?: string; filename?: string }) => void;
  required?: boolean;
}) {
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined | null) => {
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const res = await api.uploadFile(file);
      setUploadedName(res.filename);
      onChange({ fileUrl: res.fileUrl, mimeType: res.mimeType, filename: res.filename });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed. Please try again.');
      setUploadedName(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button type="button" className={`btn btn-sm ${mode === 'file' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setMode('file')}>
          Upload file
        </button>
        <button type="button" className={`btn btn-sm ${mode === 'url' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setMode('url')}>
          Paste a link
        </button>
      </div>

      {mode === 'file' && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.zip,.mp3,.mp4"
            onChange={(e) => void pick(e.target.files?.[0])}
            disabled={uploading}
            style={{ display: 'block', fontSize: 13, width: '100%' }}
          />
          {uploading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--text-2b, #7a6a60)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} /> Uploading…
            </div>
          )}
          {!uploading && uploadedName && value.fileUrl && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: '#166534', fontWeight: 600 }}>
              ✓ {uploadedName} uploaded
            </div>
          )}
          {/* Hidden input keeps native form "required" validation working */}
          {required && <input type="text" value={value.fileUrl} required readOnly tabIndex={-1} aria-hidden style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} />}
        </div>
      )}

      {mode === 'url' && (
        <input
          className="field-input"
          type="url"
          required={required}
          value={value.fileUrl}
          onChange={(e) => onChange({ fileUrl: e.target.value })}
          placeholder="https://example.com/files/report.pdf"
        />
      )}

      {err && <div style={{ marginTop: 6, fontSize: 12.5, color: '#991b1b' }}>{err}</div>}
    </div>
  );
}
