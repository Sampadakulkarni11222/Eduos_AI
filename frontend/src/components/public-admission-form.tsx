'use client';
import { useEffect, useState } from 'react';
import { admissionPublicApi, PublicApiError, type AdmissionFormConfig, type ApplicationReceipt, type ApplicationStatus } from '@/lib/green-api';
import { attributionFromUrl, publicHeardFrom } from '@/lib/growth-api';

/**
 * The public online admission form, outside every portal: no sign-in, one per
 * school. It sends the application to the school's admissions team (as a new
 * enquiry), never takes a payment, and gives back a reference number. The
 * "Check status" tab shows the family their own application after a code is
 * sent to the phone number on it.
 *
 * The `website` input is a honeypot: hidden from people (and from screen
 * readers), so anything typed in it means a script filled the form.
 */
type Doc = { fileToken: string; name: string; kind: string };
const msg = (e: unknown) => (e instanceof PublicApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const KIND_LABEL: Record<string, string> = { BIRTH_CERTIFICATE: 'Birth certificate', PHOTO: 'Photograph', ADDRESS_PROOF: 'Address proof', PREVIOUS_REPORT: 'Previous report card', TRANSFER_CERTIFICATE: 'Transfer certificate', OTHER: 'Other document' };

function ApplyForm({ school, config }: { school: string; config: AdmissionFormConfig }) {
  const [f, setF] = useState<Record<string, string>>({ gradeApplying: config.grades[0] ?? '' });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docKind, setDocKind] = useState('BIRTH_CERTIFICATE');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ApplicationReceipt | null>(null);
  // Campaign attribution: the link's utm_* / short-link code, a promo code, and "How did you hear about us?".
  const [heardOptions, setHeardOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [heardFromId, setHeardFromId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  useEffect(() => { void publicHeardFrom(school).then(setHeardOptions); }, [school]);
  const set =(k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const maxMb = Math.round(config.files.maxBytes / 1024 / 1024);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!config.files.extensions.includes(ext)) { setError('Upload a PDF, JPG or PNG file.'); return; }
    if (file.size > config.files.maxBytes) { setError(`Each file can be at most ${maxMb} MB.`); return; }
    setUploading(true);
    try {
      const r = await admissionPublicApi.upload(school, file);
      setDocs((l) => [...l, { fileToken: r.fileToken, name: r.name, kind: docKind }]);
    } catch (e) { setError(msg(e)); } finally { setUploading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const attribution = { ...attributionFromUrl(window.location.search), ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}), ...(heardFromId ? { heardFromId } : {}) };
      setReceipt(await admissionPublicApi.submit(school, { ...f, consent, website, documents: docs.map(({ fileToken, kind }) => ({ fileToken, kind })), ...(Object.keys(attribution).length ? { attribution } : {}) }));
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };

  if (receipt) {
    return (
      <div className="adm-done" role="status">
        <h2>Application received</h2>
        <p>Your reference number is</p>
        <p className="adm-ref">{receipt.refNo}</p>
        <p>Keep it safe. With it and the phone number you gave, you can check the status on this page.</p>
        <p className="adm-note">No fee has been charged. The school will contact you about the next steps.</p>
        {receipt.acknowledgement.some((a) => a.status === 'SIMULATED') && <p className="adm-note">Confirmation messages are not set up for this school yet, so no SMS or email was sent. Please note your reference number now.</p>}
      </div>
    );
  }
  return (
    <form className="adm-form" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset><legend>The child</legend>
        <label>Full name *<input className="input" required value={f.childName ?? ''} onChange={set('childName')} maxLength={120} autoComplete="off" /></label>
        <div className="adm-grid">
          <label>Date of birth<input className="input" type="date" value={f.dateOfBirth ?? ''} onChange={set('dateOfBirth')} /></label>
          <label>Class applying for *
            <select className="input" value={f.gradeApplying ?? ''} onChange={set('gradeApplying')} required>
              {config.grades.length ? config.grades.map((g) => <option key={g} value={g}>{g}</option>) : <option value="">—</option>}
            </select>
          </label>
          <label>Gender<select className="input" value={f.gender ?? ''} onChange={set('gender')}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></select></label>
          <label>Previous school<input className="input" value={f.previousSchool ?? ''} onChange={set('previousSchool')} maxLength={160} /></label>
        </div>
      </fieldset>
      <fieldset><legend>Parent or guardian</legend>
        <div className="adm-grid">
          <label>Full name *<input className="input" required value={f.guardianName ?? ''} onChange={set('guardianName')} maxLength={120} autoComplete="name" /></label>
          <label>Relation<input className="input" value={f.relation ?? ''} onChange={set('relation')} maxLength={40} placeholder="Mother, father, guardian" /></label>
          <label>Mobile number *<input className="input" required inputMode="tel" value={f.phone ?? ''} onChange={set('phone')} autoComplete="tel" placeholder="+91 98765 43210" /></label>
          <label>Email<input className="input" type="email" value={f.email ?? ''} onChange={set('email')} autoComplete="email" /></label>
        </div>
        <label>Address<textarea className="input" rows={2} value={f.address ?? ''} onChange={set('address')} maxLength={500} /></label>
        <label>Anything the school should know<textarea className="input" rows={3} value={f.message ?? ''} onChange={set('message')} maxLength={2000} /></label>
        <div className="adm-grid">
          {heardOptions.length > 0 && <label>How did you hear about us?<select className="input" value={heardFromId} onChange={(e) => setHeardFromId(e.target.value)}><option value="">Prefer not to say</option>{heardOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
          <label>Promo code (if you have one)<input className="input" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} maxLength={40} autoComplete="off" /></label>
        </div>
      </fieldset>
      <fieldset><legend>Documents (optional)</legend>
        <p className="adm-note">PDF, JPG or PNG, up to {maxMb} MB each, at most {config.files.maxFiles} files.</p>
        <div className="adm-grid">
          <label>Document<select className="input" value={docKind} onChange={(e) => setDocKind(e.target.value)}>{config.documentKinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select></label>
          <label>File<input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading || docs.length >= config.files.maxFiles} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        {uploading && <p className="adm-note">Uploading…</p>}
        {docs.length > 0 && <ul className="adm-docs">{docs.map((d) => <li key={d.fileToken}>{KIND_LABEL[d.kind] ?? d.kind}: {d.name} <button type="button" className="adm-link" onClick={() => setDocs((l) => l.filter((x) => x.fileToken !== d.fileToken))}>Remove</button></li>)}</ul>}
      </fieldset>
      {/* Honeypot: hidden from people; bots fill it in. */}
      <div className="adm-hp" aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" /></label>
      </div>
      {config.captcha.required && <div className="adm-captcha" data-sitekey={config.captcha.siteKey ?? ''}>Complete the check below before sending.</div>}
      <label className="adm-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree that {config.school.name} may contact me about this application by phone, SMS or email.</label>
      <p className="adm-note">{config.notice}</p>
      {error && <p className="adm-error" role="alert">⚠ {error}</p>}
      <button type="submit" className="btn btn-accent" disabled={busy || uploading || !consent}>{busy ? 'Sending…' : 'Send application'}</button>
    </form>
  );
}

function StatusCheck({ school }: { school: string }) {
  const [refNo, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  if (status) {
    return (
      <div className="adm-done" role="status">
        <h2>{status.childName}</h2>
        <p className="adm-ref">{status.status}</p>
        <dl className="adm-kv">
          <div><dt>Reference</dt><dd>{status.refNo}</dd></div>
          <div><dt>Class applied for</dt><dd>{status.gradeApplying ?? '—'}</dd></div>
          <div><dt>Received</dt><dd>{new Date(status.submittedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}</dd></div>
          <div><dt>Documents</dt><dd>{status.documents.length ? status.documents.map((d) => d.name).join(', ') : 'None'}</dd></div>
        </dl>
        <button type="button" className="btn btn-soft" onClick={() => { setStatus(null); setCode(''); setSent(null); }}>Done</button>
      </div>
    );
  }
  return (
    <div className="adm-form">
      <div className="adm-grid">
        <label>Reference number<input className="input" value={refNo} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="APP/2026/0012" autoComplete="off" /></label>
        <label>Mobile number on the application<input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></label>
      </div>
      <button type="button" className="btn btn-soft" disabled={busy || !refNo || !phone} onClick={() => void act(async () => { const r = await admissionPublicApi.requestCode(school, { refNo, phone }); setSent(r.message); setDevOtp(r.devOtp ?? null); })}>Send me a code</button>
      {sent && <p className="adm-note">{sent}</p>}
      {devOtp && <p className="adm-note">Test environment: your code is <b>{devOtp}</b>.</p>}
      {sent && (
        <>
          <label>6-digit code<input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" /></label>
          <button type="button" className="btn btn-accent" disabled={busy || code.length !== 6} onClick={() => void act(async () => setStatus(await admissionPublicApi.status(school, { refNo, phone, code })))}>Show status</button>
        </>
      )}
      {error && <p className="adm-error" role="alert">⚠ {error}</p>}
    </div>
  );
}

export function PublicAdmissionForm({ school }: { school: string }) {
  const [config, setConfig] = useState<AdmissionFormConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'apply' | 'status'>('apply');
  useEffect(() => {
    let live = true;
    admissionPublicApi.form(school).then((c) => { if (live) setConfig(c); }).catch((e) => { if (live) setError(msg(e)); });
    return () => { live = false; };
  }, [school]);
  if (error) return <main className="adm-page"><div className="adm-card"><h1>Admission form</h1><p className="adm-error" role="alert">{error}</p></div></main>;
  if (!config) return <main className="adm-page"><div className="adm-card"><p>Loading…</p></div></main>;
  return (
    <main className="adm-page">
      <div className="adm-card">
        <header className="adm-head">
          <h1>{config.school.name}</h1>
          <p>Online admission application</p>
        </header>
        <div className="adm-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'apply'} className={tab === 'apply' ? 'is-on' : ''} onClick={() => setTab('apply')}>Apply</button>
          <button type="button" role="tab" aria-selected={tab === 'status'} className={tab === 'status' ? 'is-on' : ''} onClick={() => setTab('status')}>Check status</button>
        </div>
        {tab === 'apply' ? <ApplyForm school={school} config={config} /> : <StatusCheck school={school} />}
      </div>
    </main>
  );
}
