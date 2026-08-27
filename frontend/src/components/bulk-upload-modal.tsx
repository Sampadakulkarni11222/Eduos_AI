'use client';
import { ReactNode, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { BulkImportResult } from '@/lib/types';

/**
 * Generic "upload a CSV, get a per-row success/failure report back" modal.
 * Used for bulk-importing leads, bulk-assigning classes, and bulk-marking
 * attendance — each page supplies its own extra fields (section, date, …)
 * and the actual upload call; this component only owns the file picker,
 * template download, and results display.
 */
export function BulkUploadModal({
  title,
  description,
  templateHeaders,
  templateSampleRow,
  extraFields,
  canSubmit = true,
  onSubmit,
  onClose,
  onImported,
}: {
  title: string;
  description: string;
  templateHeaders: string[];
  templateSampleRow?: string[];
  extraFields?: ReactNode;
  canSubmit?: boolean;
  onSubmit: (file: File) => Promise<BulkImportResult>;
  onClose: () => void;
  onImported?: (result: BulkImportResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const downloadTemplate = () => {
    const rows = [templateHeaders.join(','), ...(templateSampleRow ? [templateSampleRow.join(',')] : [])];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async () => {
    if (!file) { setError('Please choose a CSV file.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await onSubmit(file);
      setResult(r);
      onImported?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 540 }}>
        <Card style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, fontWeight: 700 }}>{title}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1 }} aria-label="Close">×</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 0, marginBottom: 16 }}>{description}</p>

          {extraFields}

          <button
            type="button"
            onClick={downloadTemplate}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 14 }}
          >
            ⬇ Download CSV template
          </button>

          <div>
            <div className="field-label">CSV file *</div>
            <input
              className="field-input"
              type="file"
              accept=".csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }}
              style={{ width: '100%' }}
            />
          </div>

          {error && <p style={{ color: 'var(--red, #b52a2a)', fontSize: 13, marginTop: 12 }}>⚠ {error}</p>}

          {result && (
            <div style={{
              marginTop: 14, padding: 12, borderRadius: 8,
              background: result.failed > 0 ? '#fff7ed' : '#dcf5e7',
              border: `1px solid ${result.failed > 0 ? '#fcd9a8' : '#a3dbb8'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: result.failed > 0 ? '#92400e' : '#1a6636' }}>
                ✓ {result.imported} imported{result.failed > 0 ? `, ${result.failed} failed` : ''}
              </div>
              {result.errors.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', maxHeight: 160, overflowY: 'auto' }}>
                  {result.errors.map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Button variant="soft" onClick={onClose} disabled={busy} style={{ flex: 1 }}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <Button onClick={() => void submit()} disabled={busy || !file || !canSubmit} style={{ flex: 1 }}>
                {busy ? 'Uploading…' : 'Upload'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
