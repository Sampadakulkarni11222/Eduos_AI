'use client';
import { useState } from 'react';
import { Button, Card, EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { ErrorNote, Loadable, SectionCard, fmtDate, useAction, useLoad } from '@/components/ops/kit';
import { leadershipApi, type CertificatePreview, type IssuedCertificateRow, type OfficeFields } from '@/lib/leadership-api';

/**
 * Certificates from the student record, for the school office: the no-dues
 * check, the details only the office knows, a preview of what will print, and
 * generation (serial number, verification code, attached to the request as a
 * new version). A transfer or leaving certificate with dues open needs a
 * recorded reason. The office prints, signs and seals the PDF.
 */
const TC_FIELDS: Array<[keyof OfficeFields, string, string]> = [
  ['reasonForLeaving', 'Reason for leaving', "e.g. Parent's transfer"],
  ['leavingDate', 'Date the pupil left', 'dd/mm/yyyy'],
  ['lastExam', 'Last examination taken, with result', 'e.g. Class 7 annual exam, passed'],
  ['promotion', 'Qualified for promotion?', 'e.g. Yes, to Class 8'],
  ['subjects', 'Subjects studied', 'e.g. English, Hindi, Mathematics, Science, Social Science'],
  ['conduct', 'General conduct', 'Good'],
  ['activities', 'Games / activities', ''],
  ['concession', 'Fee concession, if any', 'None'],
  ['category', 'SC / ST / OBC (if applicable)', ''],
  ['remarks', 'Other remarks', ''],
];
const OTHER_FIELDS: Array<[keyof OfficeFields, string, string]> = [
  ['purpose', 'Purpose (printed on the certificate)', 'e.g. a passport application'],
  ['conduct', 'Conduct (character certificate)', 'Good'],
  ['remarks', 'Other remarks', ''],
];

export function CertificateGenerator({ requestId, documentTypeName, onDone, onCancel }: { requestId: string; documentTypeName: string; onDone: () => void; onCancel: () => void }) {
  const isTc = /transfer|leaving|migration/i.test(documentTypeName);
  const [fields, setFields] = useState<OfficeFields>({});
  const [preview, setPreview] = useState<CertificatePreview | null>(null);
  const clearance = useLoad(() => leadershipApi.clearance(requestId), [requestId]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const set = (k: keyof OfficeFields, v: string) => { setFields((f) => ({ ...f, [k]: v })); setPreview(null); };
  const duesOpen = Boolean(clearance.data && clearance.data.required && !clearance.data.clear);

  return (
    <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Generate from the records</div>
      <p className="ops-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Name, guardians, date of birth (in figures and words), first admission, last class, attendance and fee position come from the records. Add what only the office knows.</p>
      <Loadable state={clearance}>{(c) => (
        <SectionCard title={c.required ? 'No-dues check (required for this certificate)' : 'No-dues check (for information)'}>
          <ul className="lead-checks">{c.checks.map((x) => <li key={x.key}><span className={x.status === 'DUE' ? 'due' : 'clear'}>{x.status === 'DUE' ? 'DUE' : 'CLEAR'}</span><span><b>{x.label}</b>: {x.detail}</span></li>)}</ul>
        </SectionCard>
      )}</Loadable>
      <div className="ops-form-grid" style={{ marginTop: 10 }}>
        {(isTc ? TC_FIELDS : OTHER_FIELDS).map(([k, label, ph]) => (
          <label key={k} className="lead-filter"><span>{label}</span><input className="input" value={fields[k] ?? ''} placeholder={ph} maxLength={k === 'remarks' ? 500 : 300} onChange={(e) => set(k, e.target.value)} /></label>
        ))}
      </div>
      {duesOpen && (
        <label className="lead-filter" style={{ marginTop: 10 }}>
          <span>Dues are open. Reason to issue anyway (recorded on the register)</span>
          <textarea className="input" rows={2} maxLength={500} value={fields.overrideReason ?? ''} onChange={(e) => set('overrideReason', e.target.value)} placeholder="e.g. Trust waived the dues; letter on file" />
        </label>
      )}
      {preview && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{preview.title} — preview</div>
          {preview.body && <p style={{ fontSize: 13, lineHeight: 1.55 }}>{preview.body}</p>}
          {preview.rows.length > 0 && <div className="lead-cert-rows">{preview.rows.map(([l, v], i) => <div key={i}><span className="ops-muted">{i + 1}. {l}</span><b>{v}</b></div>)}</div>}
        </Card>
      )}
      <ErrorNote error={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button small variant="soft" disabled={busy} onClick={() => void run(async () => setPreview(await leadershipApi.previewCertificate(requestId, fields)))}>Preview</Button>
        <Button small disabled={busy || (duesOpen && (fields.overrideReason ?? '').trim().length < 10)} onClick={() => void run(async () => {
          const out = await leadershipApi.generateCertificate(requestId, fields);
          toast(`${out.title} ${out.serialNo} generated and attached. Print, sign and seal it.`, 'success');
          onDone();
        })}>Generate &amp; attach</Button>
        <Button small variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function CertificateRegister() {
  const state = useLoad(() => leadershipApi.certificateRegister(), []);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <SectionCard title="Check a certificate" sub="Type the verification code printed at the foot of a certificate the office generated.">
        <div className="lead-filters">
          <input className="input" value={code} maxLength={10} onChange={(e) => { setCode(e.target.value.toUpperCase()); setResult(null); }} placeholder="e.g. 3FA91C0B2D" aria-label="Verification code" />
          <Button small disabled={busy || code.trim().length !== 10} onClick={() => void run(async () => {
            const v = await leadershipApi.verifyCertificate(code.trim());
            setResult(v.valid ? `Valid: ${v.title} ${v.serialNo} for ${v.studentName}, issued ${fmtDate(v.issuedAt)}.` : (v.message ?? 'Not valid.'));
          })}>Check</Button>
        </div>
        {result && <p role="status" style={{ fontWeight: 600 }}>{result}</p>}
        <ErrorNote error={error} />
      </SectionCard>
      {state.loading && !state.data ? <Card><SkeletonRows rows={4} /></Card> : (
        <Loadable state={state}>{(rows: IssuedCertificateRow[]) => !rows.length ? <EmptyState title="No certificates generated yet" sub="Certificates generated from the records appear here with their serial numbers." /> : (
          <Card pad={false}>
            <div className="table-scroll"><table className="data-table data-table-cards">
              <thead><tr><th>Serial no.</th><th>Certificate</th><th>Student</th><th>Issued</th><th>By</th><th>Dues</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.id}>
                  <td className="cell-primary" data-label="Serial no.">{x.serialNo}</td>
                  <td data-label="Certificate">{x.title}</td>
                  <td data-label="Student">{x.studentName}{x.admissionNo ? <span className="ops-muted"> · {x.admissionNo}</span> : null}</td>
                  <td data-label="Issued">{fmtDate(x.issuedAt)}</td>
                  <td data-label="By">{x.issuedBy ?? '—'}</td>
                  <td data-label="Dues">{x.duesOpen ? <span title={x.overrideReason ?? ''} className="ops-flag-overdue">OPEN · reason recorded</span> : x.duesOpen === false ? 'Clear' : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}</Loadable>
      )}
    </div>
  );
}
