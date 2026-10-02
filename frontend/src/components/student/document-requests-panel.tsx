'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { DocumentRequestDto, RequestableDocumentType } from '@/lib/document-request-types';
import { Button, Card, EmptyState, Modal, SkeletonRows, useToast } from '../ui';
import { FieldInput, RequestFacts, StatusPill, fmtDate, fmtSize } from '../document-requests/shared';

const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);

/**
 * Documents the student has asked the school for — Bonafide, Study, Fee
 * certificates or whatever the school has configured — and the issued files.
 *
 * Every type is handled the same way: the form asks the questions the school
 * configured on that type, and an issued file opens through the authorized
 * download endpoint, never through a stored link.
 */
export function DocumentRequestsPanel() {
  const [items, setItems] = useState<DocumentRequestDto[] | null>(null);
  const [types, setTypes] = useState<RequestableDocumentType[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();

  const load = () => api.myDocumentRequests().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void load();
    api.requestableDocumentTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  const open = items?.find((r) => r.id === openId) ?? null;

  const download = async (r: DocumentRequestDto) => {
    try {
      await api.openMyIssuedDocument(r.id);
      // The server completes a READY request once the file has been sent —
      // which can land just after the browser has the bytes, so a refetch here
      // could still read READY. Mirror the same rule locally instead.
      if (r.status === 'READY') {
        setItems((prev) => prev?.map((x) => (x.id === r.id ? { ...x, status: 'COMPLETED', completedAt: new Date().toISOString() } : x)) ?? prev);
      }
    } catch (e) {
      toast(errText(e, "Couldn't open this document."), 'error');
    }
  };

  return (
    <>
      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Document Requests</strong>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
              Certificates and letters requested from the school office. Issued documents can be downloaded here.
            </p>
          </div>
          <Button small onClick={() => setRequesting(true)} disabled={types.length === 0}
            title={types.length === 0 ? 'The school has not made any documents available to request yet' : undefined}>
            + Request a document
          </Button>
        </div>

        {items === null && <div style={{ padding: 16 }}><SkeletonRows rows={2} /></div>}
        {items?.length === 0 && (
          <EmptyState title="No document requests" sub={types.length ? 'Request a certificate or letter from the school office.' : 'No documents are available to request yet.'} />
        )}
        {items && items.length > 0 && (
          <table className="data-table data-table-cards">
            <thead><tr><th>Document</th><th>Requested on</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Document">{r.documentTypeName}</td>
                  <td data-label="Requested on">{fmtDate(r.requestedAt)}</td>
                  <td data-label="Status"><StatusPill status={r.status} /></td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="ghost" small onClick={() => setOpenId(r.id)}>Details</Button>
                      {r.document && <Button variant="soft" small onClick={() => download(r)}>Download</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {requesting && (
        <RequestForm
          types={types}
          onClose={() => setRequesting(false)}
          onCreated={() => { setRequesting(false); toast('Request submitted to the school office.'); void load(); }}
        />
      )}

      {open && (
        <Modal title="Document Request" onClose={() => setOpenId(null)} wide>
          <RequestFacts r={open} />
          {open.document && (
            <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--hairline)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{open.document.fileName}</div>
                <div style={{ color: 'var(--text-2)' }}>
                  Version {open.document.version} · {fmtSize(open.document.size)} · issued {fmtDate(open.document.uploadedAt)}
                </div>
              </div>
              <Button small onClick={() => download(open)}>Download Document</Button>
            </div>
          )}
          {open.status === 'PENDING' && (
            <div style={{ marginTop: 14 }}>
              <Button variant="ghost" small onClick={async () => {
                if (!window.confirm('Cancel this request?')) return;
                try { await api.cancelDocumentRequest(open.id); toast('Request cancelled.'); void load(); } catch (e) { toast(errText(e, 'Could not cancel.'), 'error'); }
              }}>Cancel request</Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function RequestForm({ types, onClose, onCreated }: { types: RequestableDocumentType[]; onClose: () => void; onCreated: () => void }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [purpose, setPurpose] = useState('');
  const [info, setInfo] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const type = types.find((t) => t.id === typeId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!type) { setErr('Choose a document.'); return; }
    if (!purpose.trim()) { setErr('Purpose is required.'); return; }
    const missing = type.fields.find((f) => f.required && !answers[f.key]?.trim());
    if (missing) { setErr(`${missing.label} is required.`); return; }
    setBusy(true); setErr(null);
    try {
      await api.createDocumentRequest({
        documentTypeId: type.id,
        purpose: purpose.trim(),
        additionalInformation: info.trim() || undefined,
        requiredBy: requiredBy || undefined,
        fields: Object.fromEntries(type.fields.map((f) => [f.key, answers[f.key] ?? ''])),
      });
      onCreated();
    } catch (e2) { setErr(errText(e2, 'Could not submit the request.')); } finally { setBusy(false); }
  };

  return (
    <Modal title="Request a Document" onClose={onClose} wide>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="docreq-type">Document type</label>
        <select id="docreq-type" className="field-input" value={typeId} onChange={(e) => { setTypeId(e.target.value); setAnswers({}); }} required>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {type?.description && <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{type.description}</p>}
        {type?.instructions && <p style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{type.instructions}</p>}

        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="docreq-purpose">Reason / purpose</label>
          <input id="docreq-purpose" className="field-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} required placeholder="e.g. Internship application" />
        </div>

        {type?.fields.map((f) => (
          <div key={f.key} style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor={`docreq-f-${f.key}`}>
              {f.label}{f.required && <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>}
            </label>
            <FieldInput id={`docreq-f-${f.key}`} field={f} value={answers[f.key] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} />
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="docreq-info">Additional information (optional)</label>
          <textarea id="docreq-info" className="field-input" rows={3} value={info} onChange={(e) => setInfo(e.target.value)} maxLength={2000} />
        </div>
        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <label className="field-label" htmlFor="docreq-by">Required by (optional)</label>
          <input id="docreq-by" className="field-input" type="date" value={requiredBy} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRequiredBy(e.target.value)} />
        </div>

        {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !type}>{busy ? 'Submitting…' : 'Submit Request'}</Button>
        </div>
      </form>
    </Modal>
  );
}
