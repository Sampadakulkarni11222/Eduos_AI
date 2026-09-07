'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fileHref } from '@/lib/api';
import type { ProfileEditFieldDto, ProfileEditRequestDto, StudentOverviewDto } from '@/lib/types';
import { Button, Card, Modal, Pill, SkeletonRows, useToast } from '../ui';
import { OptionalDocumentInput, type AttachedDocument } from '../optional-document-input';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  APPROVED: 'green', PENDING: 'amber', REJECTED: 'red',
};

/** The current value of a field, in the same form the edit form uses. */
function currentValue(overview: StudentOverviewDto, field: string): string {
  switch (field) {
    case 'firstName': return overview.name.split(' ')[0] ?? '';
    case 'lastName': return overview.name.split(' ').slice(1).join(' ');
    case 'dob': return overview.dob ? new Date(overview.dob).toISOString().slice(0, 10) : '';
    case 'gender': return overview.gender ?? '';
    case 'address': return overview.address ?? '';
    default: return '';
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "Request edit" on the student profile, and the history of those requests.
 *
 * The student never writes to their own record. They submit a request holding
 * the old and the new value of each field they changed, and their class
 * teacher approves or rejects it — approval is the only thing that touches the
 * profile. Which fields may be asked about is decided by the server and
 * fetched, rather than being listed here, so the browser cannot widen it.
 */
export function ProfileEditRequestPanel({
  overview,
  onApprovedChange,
}: {
  overview: StudentOverviewDto;
  /** Called after a request is submitted, so the page can refresh its record. */
  onApprovedChange: () => void;
}) {
  const [fields, setFields] = useState<ProfileEditFieldDto[] | null>(null);
  const [requests, setRequests] = useState<ProfileEditRequestDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const load = () => {
    api.myProfileEditRequests().then(setRequests).catch(() => setRequests([]));
  };

  useEffect(() => {
    api.profileEditFields().then((r) => setFields(r.fields)).catch(() => setFields([]));
    load();
  }, []);

  const pending = requests?.find((r) => r.status === 'PENDING') ?? null;

  return (
    <>
      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: requests && requests.length > 0 ? '1px solid var(--hairline)' : undefined,
        }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Profile corrections</strong>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
              {pending
                ? 'You have a request awaiting your class teacher’s review.'
                : 'Spotted something wrong? Ask your class teacher to correct it — your record changes only once they approve.'}
            </p>
          </div>
          <Button onClick={() => setOpen(true)} disabled={!fields?.length || Boolean(pending)}>
            {pending ? 'Request pending' : 'Request Edit'}
          </Button>
        </div>

        {requests === null && <div style={{ padding: 20 }}><SkeletonRows rows={2} /></div>}

        {requests && requests.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Requested</th><th>Changes</th><th>Status</th><th>Reviewed</th><th></th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td data-label="Requested">{fmtDate(r.requestedAt)}</td>
                  <td className="cell-primary" data-label="Changes">
                    {r.changes.map((c) => (
                      <div key={c.field} style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                        <strong>{c.label}:</strong>{' '}
                        <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{c.oldValue || '—'}</span>
                        {' → '}
                        <span style={{ color: 'var(--text-1)' }}>{c.newValue || '—'}</span>
                      </div>
                    ))}
                    {r.documentUrl && (
                      <a
                        href={fileHref(r.documentUrl)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}
                      >
                        🗎 {r.documentName ?? 'Supporting document'}
                      </a>
                    )}
                  </td>
                  <td data-label="Status">
                    <Pill tone={STATUS_TONE[r.status] ?? 'gray'}>{r.status}</Pill>
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4, maxWidth: 260 }}>
                        {r.rejectionReason}
                      </div>
                    )}
                  </td>
                  <td data-label="Reviewed">
                    {r.reviewedAt ? fmtDate(r.reviewedAt) : '—'}
                    {r.reviewedBy && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.reviewedBy}</div>}
                  </td>
                  <td data-label="">
                    {r.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        small
                        onClick={() => {
                          void api.withdrawProfileEdit(r.id)
                            .then(() => { toast('Request withdrawn.'); load(); })
                            .catch((e) => toast(e instanceof ApiError ? e.message : 'Could not withdraw.', 'error'));
                        }}
                      >
                        Withdraw
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {open && fields && (
        <EditRequestModal
          fields={fields}
          overview={overview}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast('Request sent to your class teacher for review.');
            load();
            onApprovedChange();
          }}
        />
      )}
    </>
  );
}

function EditRequestModal({
  fields, overview, onClose, onDone,
}: {
  fields: ProfileEditFieldDto[];
  overview: StudentOverviewDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.field, currentValue(overview, f.field)])));
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<AttachedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changed = fields.filter((f) => values[f.field] !== currentValue(overview, f.field));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.requestProfileEdit({
        // Only the fields that actually differ — the server stores the diff,
        // and sending everything would file unchanged fields as "changes".
        changes: Object.fromEntries(changed.map((f) => [f.field, values[f.field]])),
        note: note.trim() || undefined,
        documentUrl: doc?.documentUrl ?? null,
        documentName: doc?.documentName ?? null,
      });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not submit your request. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Request a profile correction"
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.55 }}>
          Edit only what is wrong. Your class teacher sees both the current and the requested value,
          and your record is updated only if they approve.
        </p>

        {fields.map((f) => (
          <div key={f.field} style={{ marginBottom: 12 }}>
            <label className="field-label" htmlFor={`edit-${f.field}`} style={{ display: 'block' }}>
              {f.label}{f.required && <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>}
            </label>
            <input
              id={`edit-${f.field}`}
              className="field-input"
              type={f.type === 'date' ? 'date' : 'text'}
              value={values[f.field] ?? ''}
              required={f.required}
              max={f.type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f.field]: e.target.value }))}
              style={{ marginBottom: 2 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              Currently: {currentValue(overview, f.field) || '—'}
            </div>
          </div>
        ))}

        <label className="field-label" htmlFor="edit-note" style={{ display: 'block' }}>Reason for the change</label>
        <textarea
          id="edit-note"
          className="field-input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — helps your teacher decide."
        />

        <OptionalDocumentInput
          label="Supporting document"
          hint="Optional — e.g. a birth certificate or proof of address. You can submit without one."
          value={doc}
          onChange={setDoc}
          onBusyChange={setUploading}
        />

        {changed.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 8 }}>
            Nothing has been changed yet.
          </div>
        )}

        {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || uploading || changed.length === 0}>
            {busy ? 'Sending…' : `Send ${changed.length || ''} change${changed.length === 1 ? '' : 's'} for review`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
