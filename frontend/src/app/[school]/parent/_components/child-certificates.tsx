'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, errorMessage, request } from '@/lib/api';
import type { DocumentRequestDto, RequestableDocumentType } from '@/lib/document-request-types';
import { formatDate, humanizeLabel } from '../../student/_lib/format';

/**
 * Certificates (bonafide, character, transfer, fee…) requested by a parent for
 * a child. Uses the same /document-requests/mine endpoints as the student,
 * naming the child; the server accepts only a child linked to this parent.
 */

type ParentRequest = DocumentRequestDto & { studentId?: string; studentName?: string | null };

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PENDING: 'amber', UNDER_REVIEW: 'blue', APPROVED: 'blue', READY: 'green', COMPLETED: 'green', REJECTED: 'red', CANCELLED: 'gray',
};

export function ChildCertificates({ studentId, childName }: { studentId: string; childName: string }) {
  const toast = useToast();
  const [types, setTypes] = useState<RequestableDocumentType[] | null>(null);
  const [items, setItems] = useState<ParentRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    request<ParentRequest[]>(`/document-requests/mine?studentId=${encodeURIComponent(studentId)}`)
      .then(setItems)
      .catch((e) => { setItems([]); setLoadError(errorMessage(e, 'Could not load certificate requests.')); });
  }, [studentId]);

  useEffect(() => {
    api.requestableDocumentTypes().then(setTypes).catch(() => setTypes([]));
  }, []);
  useEffect(() => { setItems(null); load(); }, [load]);

  const type = types?.find((t) => t.id === typeId) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!type) { toast('Choose a certificate.', 'error'); return; }
    if (!purpose.trim()) { toast('Say what the certificate is for.', 'error'); return; }
    setBusy(true);
    try {
      await request('/document-requests/mine', {
        method: 'POST',
        body: JSON.stringify({ studentId, documentTypeId: type.id, purpose: purpose.trim(), fields }),
      });
      toast(`${type.name} requested for ${childName}.`, 'success');
      setTypeId(''); setPurpose(''); setFields({});
      load();
    } catch (err) {
      toast(errorMessage(err, 'Could not submit the request.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await request(`/document-requests/mine/${id}/cancel`, { method: 'POST' });
      toast('Request cancelled.');
      load();
    } catch (err) {
      toast(errorMessage(err, 'Could not cancel the request.'), 'error');
    }
  };

  const download = async (id: string) => {
    try { await api.openMyIssuedDocument(id); } catch (err) { toast(errorMessage(err, 'Could not open the document.'), 'error'); }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16, display: 'block', marginBottom: 10 }}>
        Request a certificate for {childName}
      </strong>

      {types === null && <SkeletonRows rows={2} />}
      {types && types.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>The school has not set up any certificates to request yet.</p>
      )}
      {types && types.length > 0 && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 200px' }}>
              <div className="field-label">Certificate</div>
              <select className="input" value={typeId} onChange={(e) => { setTypeId(e.target.value); setFields({}); }} required>
                <option value="">Choose…</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={{ flex: '2 1 240px' }}>
              <div className="field-label">Purpose</div>
              <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} required placeholder="e.g. Passport application" />
            </label>
          </div>
          {type?.instructions && <p style={{ fontSize: 12, color: 'var(--text-2b)' }}>{type.instructions}</p>}
          {type?.fields.map((f) => (
            <label key={f.key}>
              <div className="field-label">{f.label}{f.required ? ' *' : ''}</div>
              {f.kind === 'select' ? (
                <select className="input" value={fields[f.key] ?? ''} required={f.required} onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                  value={fields[f.key] ?? ''}
                  required={f.required}
                  onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          <div><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request'}</Button></div>
        </form>
      )}

      {items === null && <SkeletonRows rows={2} />}
      {loadError && <p role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{loadError}</p>}
      {items && items.length > 0 && items.slice(0, 8).map((r, i) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--hairline)' : '1px solid var(--hairline)', fontSize: 13 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{r.documentTypeName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
              Requested {formatDate(r.requestedAt)} · {r.purpose}
              {r.rejectionReason ? ` · Reason: ${r.rejectionReason}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <Pill tone={STATUS_TONE[r.status] ?? 'gray'}>{humanizeLabel(r.status)}</Pill>
            {r.status === 'PENDING' && <Button small variant="ghost" onClick={() => void cancel(r.id)}>Cancel</Button>}
            {(r.status === 'READY' || r.status === 'COMPLETED') && <Button small variant="soft" onClick={() => void download(r.id)}>Download</Button>}
          </div>
        </div>
      ))}
    </Card>
  );
}
