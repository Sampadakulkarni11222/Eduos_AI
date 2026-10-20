'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { opsApi } from '@/lib/ops-api';
import type { OfficialDocumentDto } from '@/lib/ops-types';

/**
 * An official document laid out for A4 paper: letterhead, reference and date,
 * addressee, subject, the figures, a declaration and signature blocks with
 * room for the seal. The browser prints it or saves it as a PDF; the principal
 * signs and stamps the paper and files it with the authority.
 */
const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN') : String(v));

export function OfficialDocument({ doc }: { doc: OfficialDocumentDto }) {
  const lh = doc.letterhead;
  return (
    <article className="od-page">
      {doc.watermark && <div className="od-watermark" aria-hidden="true">{doc.watermark}</div>}
      <header className="od-letterhead">
        <div className="od-name">{lh.name}</div>
        {lh.managedBy && <div className="od-line">{lh.managedBy}</div>}
        {lh.address && <div className="od-line">{lh.address}</div>}
        {lh.codes.length > 0 && <div className="od-line od-codes">{lh.codes.join('  ·  ')}</div>}
        {lh.contact.length > 0 && <div className="od-line">{lh.contact.join('  ·  ')}</div>}
      </header>
      {lh.missing.length > 0 && <p className="od-missing no-print">The letterhead has no {lh.missing.join(', ')}. Add it in Institution Profile before printing.</p>}

      <div className="od-meta">
        <div>Ref. No.: <b>{doc.refNo}</b>{doc.theirReference ? <><br />Your ref.: {doc.theirReference}</> : null}</div>
        <div>Date: <b>{doc.date}</b></div>
      </div>
      <div className="od-to">To,<br /><b>{doc.to}</b></div>
      <p className="od-subject"><b>Subject:</b> {doc.subject}{doc.period ? ` (period ${doc.period})` : ''}</p>
      {doc.confidential && <p className="od-confidential">CONFIDENTIAL</p>}

      {doc.kind === 'LETTER' ? (
        <div className="od-body">{(doc.body ?? '').split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
      ) : (
        <>
          <p>{doc.opening}</p>
          {(doc.sections ?? []).map((s, i) => (
            <section key={i} className="od-section">
              <h2>{s.title}</h2>
              {s.type === 'table' ? (
                <table className="od-table">
                  <thead><tr>{s.columns.map((c) => <th key={c.key} className={c.num ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                  <tbody>{s.rows.map((r, j) => <tr key={j} className={r.isTotal ? 'total' : undefined}>{s.columns.map((c) => <td key={c.key} className={c.num ? 'num' : undefined}>{cell(r[c.key])}</td>)}</tr>)}</tbody>
                </table>
              ) : (
                <table className="od-table od-facts"><tbody>{s.items.map(([k, v], j) => <tr key={j}><th scope="row">{k}</th><td>{cell(v)}</td></tr>)}</tbody></table>
              )}
              {s.note && <p className="od-note">{s.note}</p>}
            </section>
          ))}
          {(doc.sources ?? []).length > 0 && <p className="od-note">Source of figures: {doc.sources!.join('; ')}. Generated {doc.generatedAt}.</p>}
          <p className="od-declaration">{doc.declaration}</p>
        </>
      )}

      <footer className="od-signatures">
        {doc.signatories.map((s, i) => (
          <div key={i} className="od-sign">
            {s.seal && <div className="od-seal">Seal of the institution</div>}
            <div className="od-sign-line" />
            <div><b>{s.role}</b></div>
            <div className="od-small">Name: ____________________</div>
            <div className="od-small">Date: ____________________</div>
          </div>
        ))}
      </footer>
    </article>
  );
}

function PrintInner() {
  const params = useSearchParams();
  const kind = params?.get('kind') ?? '';
  const id = params?.get('id') ?? '';
  const [doc, setDoc] = useState<OfficialDocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !['return', 'letter'].includes(kind)) { setError('Nothing to print: open this page from a return or a letter.'); return; }
    (kind === 'return' ? opsApi.returnDocument(id) : opsApi.letterDocument(id))
      .then((d) => { setDoc(d); document.title = `${d.refNo} ${d.subject}`; })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the document.'));
  }, [kind, id]);
  if (error) return <p className="od-status" role="alert">{error}</p>;
  if (!doc) return <p className="od-status">Preparing the document…</p>;
  const errors = doc.findings?.errors ?? [];
  const warnings = doc.findings?.warnings ?? [];
  return (
    <div className="od-shell">
      <div className="od-toolbar no-print">
        <div>
          <b>{doc.kind === 'LETTER' ? 'Letter for signature' : 'Document for submission'}</b>
          <div className="od-small">{doc.filingNote}</div>
        </div>
        <button type="button" className="od-print" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      {(doc.watermark || errors.length > 0 || warnings.length > 0) && (
        <div className="od-checks no-print">
          {doc.watermark && <p><b>{doc.watermark}.</b> It prints with this mark until {doc.kind === 'LETTER' ? 'the principal approves the letter' : 'the return is approved for submission'}.</p>}
          {errors.length > 0 && <><b>Fix before submitting:</b><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
          {warnings.length > 0 && <><b>Check:</b><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
        </div>
      )}
      <OfficialDocument doc={doc} />
    </div>
  );
}

export function PrintDocumentPage() {
  return <Suspense fallback={<p className="od-status">Preparing the document…</p>}><PrintInner /></Suspense>;
}
