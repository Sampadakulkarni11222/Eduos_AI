'use client';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, cx } from './ui';

/** Mirrors ALLOWED_EXTENSIONS in the backend's uploads route. */
const ALLOWED_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md',
];
/** Mirrors UPLOAD_MAX_BYTES (15 MB). Checked here so a large file is refused
 *  before it is sent, not after a slow upload the server then rejects. */
const MAX_BYTES = 15 * 1024 * 1024;

export interface AttachedDocument {
  documentUrl: string;
  documentName: string;
}

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An optional supporting document on a student request form.
 *
 * Optional means optional: there is no hidden required input propping up the
 * form's native validation, `value` starts and may stay null, and the submit
 * button never waits on this control. The only state that blocks submission is
 * an upload still in flight, because sending the form then would save a
 * reference to a file that does not exist yet.
 *
 * The file is uploaded as soon as it is picked — the same two-step the profile
 * photo uses, since /uploads is generic storage that knows nothing about the
 * request it will end up attached to — and can be replaced or removed right up
 * until the form is submitted.
 */
export function OptionalDocumentInput({
  label = 'Supporting document',
  hint = 'Optional — PDF, image or document, up to 15 MB.',
  value,
  onChange,
  onBusyChange,
  disabled,
}: {
  label?: string;
  hint?: string;
  value: AttachedDocument | null;
  onChange: (value: AttachedDocument | null) => void;
  /** Lets the form disable its submit button while bytes are in flight. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setBusy = (busy: boolean) => {
    setUploading(busy);
    onBusyChange?.(busy);
  };

  const pick = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);

    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`${ext ? `.${ext} files` : 'That file type'} cannot be attached. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${humanSize(file.size)}. The limit is ${humanSize(MAX_BYTES)}.`);
      return;
    }

    setBusy(true);
    try {
      const res = await api.uploadFile(file);
      onChange({ documentUrl: res.fileUrl, documentName: res.filename ?? file.name });
    } catch (e) {
      onChange(null);
      setError(e instanceof ApiError ? e.message : 'Upload failed. You can submit without a document and add it later.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <span className="field-label" style={{ display: 'block' }}>
        {label} <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>(optional)</span>
      </span>

      {!value && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
            disabled={disabled || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so picking the same file again after an error still fires.
              e.target.value = '';
              void pick(file);
            }}
            className={cx('input')}
            style={{ width: '100%', padding: '8px 10px', fontSize: 12.5 }}
            aria-describedby="optional-doc-hint"
          />
          <div id="optional-doc-hint" style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 4 }}>{hint}</div>
        </>
      )}

      {uploading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--text-2b)' }}>
          <span className="spinner" style={{ width: 14, height: 14 }} /> Uploading…
        </div>
      )}

      {value && !uploading && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 4, padding: '9px 12px', borderRadius: 10,
            background: 'var(--field-bg, #fff)', border: '1px solid var(--input-border)',
          }}
        >
          <span aria-hidden="true">🗎</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>
            {value.documentName}
          </span>
          <Button type="button" variant="ghost" small onClick={() => inputRef.current?.click()} disabled={disabled}>
            Replace
          </Button>
          <Button type="button" variant="ghost" small onClick={remove} disabled={disabled}>
            Remove
          </Button>
          {/* Kept mounted so "Replace" has a picker to open. */}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void pick(file);
            }}
          />
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 6, fontSize: 12, color: 'var(--red)' }}>{error}</div>
      )}
    </div>
  );
}
