'use client';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, DateRangeFilter, EmptyState, FilterBar, Modal, SearchInput, Select, SkeletonRows, useToast } from '@/components/ui';
import { RequestFacts, STATUS_OPTIONS, StatusPill, fmtDate, fmtSize } from '@/components/document-requests/shared';
import { api, ApiError } from '@/lib/api';
import type { AdminDocumentRequestDto } from '@/lib/document-request-types';

/**
 * School office: student document requests and the documents issued for them.
 *
 * Two views of one list — every request, and the issued ones — with the same
 * detail panel, from which the office reviews, approves or rejects, and
 * uploads (or replaces) the official file. The workflow is identical for
 * every document type.
 */

type Tab = 'requests' | 'issued';
const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);
const emptyFilters = { q: '', status: '', documentTypeId: '', from: '', to: '' };

export default function AdminDocumentRequestsPage() {
  const [tab, setTab] = useState<Tab>('requests');
  const [filters, setFilters] = useState(emptyFilters);
  const [items, setItems] = useState<AdminDocumentRequestDto[] | null>(null);
  const [typeOptions, setTypeOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    api.documentRequests({
      q: filters.q.trim() || undefined,
      status: tab === 'requests' ? filters.status || undefined : undefined,
      documentTypeId: filters.documentTypeId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      issued: tab === 'issued',
    }).then(setItems).catch(() => setItems([]));
  }, [filters, tab]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce the search box
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api.documentTypes()
      .then((ts) => setTypeOptions(ts.map((t) => ({ value: t.id, label: t.name }))))
      .catch(() => setTypeOptions([]));
  }, []);

  const hasFilters = Object.values(filters).some(Boolean);
  const open = useMemo(() => items?.find((r) => r.id === openId) ?? null, [items, openId]);

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Document Requests', desc: 'Review student document requests and issue official documents.' }}>
      <div role="tablist" aria-label="Document views" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['requests', 'issued'] as Tab[]).map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? 'accent' : 'ghost'} small onClick={() => setTab(t)}>
            {t === 'requests' ? 'Document Requests' : 'Issued Documents'}
          </Button>
        ))}
      </div>

      <FilterBar actions={hasFilters ? <Button variant="ghost" small onClick={() => setFilters(emptyFilters)}>Clear filters</Button> : undefined}>
        <SearchInput label="Student" value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} placeholder="Name or admission no…" />
        <Select label="Document type" value={filters.documentTypeId} onChange={(documentTypeId) => setFilters((f) => ({ ...f, documentTypeId }))} options={typeOptions} placeholder="All types" />
        {tab === 'requests' && (
          <Select label="Status" value={filters.status} onChange={(status) => setFilters((f) => ({ ...f, status }))} options={STATUS_OPTIONS} placeholder="All statuses" />
        )}
        <DateRangeFilter label="Requested" from={filters.from} to={filters.to} onChange={({ from, to }) => setFilters((f) => ({ ...f, from, to }))} />
      </FilterBar>

      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && (
        <EmptyState
          title={tab === 'issued' ? 'No issued documents' : 'No document requests'}
          sub={hasFilters ? 'Try widening or clearing your filters.' : tab === 'issued' ? 'Documents you upload for approved requests appear here.' : 'Requests students make from their profile appear here.'}
        />
      )}
      {items && items.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th><th>Admission No</th><th>Class</th><th>Document</th>
                <th>{tab === 'issued' ? 'Issued' : 'Requested'}</th>{tab === 'issued' && <th>Version</th>}<th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Student">{r.student.name ?? '—'}</td>
                  <td data-label="Admission No">{r.student.admissionNo ?? '—'}</td>
                  <td data-label="Class">{r.student.className ?? '—'}</td>
                  <td data-label="Document">{r.documentTypeName}</td>
                  <td data-label={tab === 'issued' ? 'Issued' : 'Requested'}>{fmtDate(tab === 'issued' ? r.issuedAt : r.requestedAt)}</td>
                  {tab === 'issued' && <td data-label="Version">v{r.versions.length}</td>}
                  <td data-label="Status"><StatusPill status={r.status} /></td>
                  <td data-label="Actions"><Button variant="soft" small onClick={() => setOpenId(r.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {open && (
        <RequestDetail
          request={open}
          onClose={() => setOpenId(null)}
          onChanged={(next) => setItems((prev) => prev?.map((r) => (r.id === next.id ? next : r)) ?? prev)}
        />
      )}
    </PortalShell>
  );
}

function RequestDetail({ request: r, onClose, onChanged }: {
  request: AdminDocumentRequestDto; onClose: () => void; onChanged: (r: AdminDocumentRequestDto) => void;
}) {
  const [mode, setMode] = useState<'none' | 'approve' | 'reject' | 'upload'>('none');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const choose = (m: typeof mode) => { setMode(m); setText(''); setFile(null); setErr(null); };

  const run = async (fn: () => Promise<AdminDocumentRequestDto>, ok: string) => {
    setBusy(true); setErr(null);
    try {
      onChanged(await fn());
      toast(ok);
      setMode('none');
    } catch (e) { setErr(errText(e, 'Something went wrong.')); } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'approve') void run(() => api.approveDocumentRequest(r.id, text.trim() || undefined), 'Request approved.');
    if (mode === 'reject') {
      if (text.trim().length < 3) { setErr('Enter a rejection reason the student can act on.'); return; }
      void run(() => api.rejectDocumentRequest(r.id, text.trim()), 'Request rejected.');
    }
    if (mode === 'upload') {
      if (!file) { setErr('Choose the official document file.'); return; }
      void run(async () => {
        const uploaded = await api.uploadFile(file);
        return api.issueDocument(r.id, { fileUrl: uploaded.fileUrl, remarks: text.trim() || undefined });
      }, r.versions.length ? 'New version issued.' : 'Document issued — the student can now download it.');
    }
  };

  const decidable = r.status === 'PENDING' || r.status === 'UNDER_REVIEW';
  const issuable = r.status === 'APPROVED' || r.status === 'READY' || r.status === 'COMPLETED';

  return (
    <Modal title="Document Request" onClose={onClose} wide>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', gap: '6px 14px', fontSize: 13.5, margin: '0 0 10px' }}>
        <dt style={{ color: 'var(--text-2)' }}>Student</dt><dd style={{ margin: 0, fontWeight: 600 }}>{r.student.name ?? '—'}</dd>
        <dt style={{ color: 'var(--text-2)' }}>Student ID</dt><dd style={{ margin: 0 }}>{r.student.admissionNo ?? '—'}</dd>
        <dt style={{ color: 'var(--text-2)' }}>Class</dt><dd style={{ margin: 0 }}>{r.student.className ?? '—'}</dd>
      </dl>
      <RequestFacts r={r} />

      {r.versions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="field-label">Issued versions</div>
          <table className="data-table">
            <thead><tr><th>Version</th><th>File</th><th>Uploaded</th><th>By</th><th></th></tr></thead>
            <tbody>
              {[...r.versions].reverse().map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}{v.version === r.versions.length ? ' (current)' : ''}</td>
                  <td>{v.fileName} <span style={{ color: 'var(--text-2)', fontSize: 12 }}>({fmtSize(v.size)})</span>{v.remarks && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{v.remarks}</div>}</td>
                  <td>{fmtDate(v.uploadedAt)}</td>
                  <td>{v.uploadedBy ?? '—'}</td>
                  <td>
                    <Button variant="ghost" small onClick={() => api.openIssuedDocument(r.id, v.version).catch((e) => toast(errText(e, "Couldn't open the file."), 'error'))}>View</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {r.status === 'PENDING' && (
          <Button variant="soft" small disabled={busy} onClick={() => run(() => api.reviewDocumentRequest(r.id), 'Marked as under review.')}>Start review</Button>
        )}
        {decidable && <Button small disabled={busy} onClick={() => choose('approve')}>Approve</Button>}
        {decidable && <Button variant="ghost" small disabled={busy} onClick={() => choose('reject')}>Reject</Button>}
        {issuable && (
          <Button small disabled={busy} onClick={() => choose('upload')}>{r.versions.length ? 'Replace document' : 'Upload document'}</Button>
        )}
      </div>

      {mode !== 'none' && (
        <form onSubmit={submit} style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 14 }}>
          {mode === 'upload' && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{r.versions.length ? 'Upload a new version' : 'Upload Official Document'}</div>
              {r.versions.length > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}>
                  The current version is kept on record; the student will receive the new one.
                </p>
              )}
              <label className="field-label" htmlFor="docreq-file">File</label>
              <input id="docreq-file" className="field-input" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </>
          )}
          <label className="field-label" htmlFor="docreq-text" style={{ marginTop: 10, display: 'block' }}>
            {mode === 'reject' ? 'Rejection reason' : 'Remarks (optional)'}
          </label>
          <textarea id="docreq-text" className="field-input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
            required={mode === 'reject'} placeholder={mode === 'reject' ? 'Tell the student why, and what to do next' : ''} />
          {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Button type="submit" small disabled={busy}>
              {busy ? 'Saving…' : mode === 'approve' ? 'Approve Request' : mode === 'reject' ? 'Reject Request' : 'Upload & Issue Document'}
            </Button>
            <Button type="button" variant="ghost" small onClick={() => choose('none')} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
