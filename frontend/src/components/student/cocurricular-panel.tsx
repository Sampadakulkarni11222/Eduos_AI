'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fileHref } from '@/lib/api';
import type { CoCurricularActivityDto } from '@/lib/types';
import { Button, Card, DateField, EmptyState, Modal, Pill, Select, SkeletonRows, useToast } from '../ui';
import { OptionalDocumentInput, type AttachedDocument } from '../optional-document-input';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  APPROVED: 'green', PENDING: 'amber', REJECTED: 'red',
};

export const CATEGORY_OPTIONS = [
  { value: 'SPORTS', label: 'Sports' },
  { value: 'ARTS', label: 'Arts' },
  { value: 'MUSIC', label: 'Music' },
  { value: 'DANCE', label: 'Dance' },
  { value: 'DRAMA', label: 'Drama' },
  { value: 'LITERARY', label: 'Literary' },
  { value: 'SCIENCE', label: 'Science' },
  { value: 'SOCIAL_SERVICE', label: 'Social service' },
  { value: 'LEADERSHIP', label: 'Leadership' },
  { value: 'CLUB', label: 'Club' },
  { value: 'OTHER', label: 'Other' },
];

export const LEVEL_OPTIONS = [
  { value: 'SCHOOL', label: 'School' },
  { value: 'INTER_SCHOOL', label: 'Inter-school' },
  { value: 'DISTRICT', label: 'District' },
  { value: 'STATE', label: 'State' },
  { value: 'NATIONAL', label: 'National' },
  { value: 'INTERNATIONAL', label: 'International' },
  { value: 'OTHER', label: 'Other' },
];

export function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((c) => c.value === value)?.label ?? value;
}
export function levelLabel(value: string): string {
  return LEVEL_OPTIONS.find((l) => l.value === value)?.label ?? value;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Co-curricular achievements on the student's profile, and the requests behind
 * them.
 *
 * A student cannot add an approved record: everything they submit starts
 * PENDING and only their class teacher's approval moves it onto the profile.
 * Both halves are shown here — the approved record, and the requests still in
 * flight or turned down — because a request that was rejected two weeks ago
 * with no visible trace is how a student ends up submitting it again.
 */
export function CoCurricularPanel() {
  const [items, setItems] = useState<CoCurricularActivityDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const load = () => api.coCurricular().then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);

  const approved = items?.filter((i) => i.status === 'APPROVED') ?? [];
  const others = items?.filter((i) => i.status !== 'APPROVED') ?? [];

  return (
    <>
      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Co-curricular record</strong>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
              Activities and achievements verified by your class teacher.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>Request activity</Button>
        </div>

        {items === null && <div style={{ padding: 20 }}><SkeletonRows rows={2} /></div>}

        {items && items.length === 0 && (
          <EmptyState
            icon="◈"
            title="Nothing on your co-curricular record yet"
            sub="Request an activity and your class teacher will review it before it is added."
          />
        )}

        {approved.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Activity</th><th>Category</th><th>Level</th><th>Date</th><th>Achievement</th></tr>
            </thead>
            <tbody>
              {approved.map((a) => (
                <tr key={a.id}>
                  <td className="cell-primary" data-label="Activity">
                    {a.name}
                    {a.description && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{a.description}</div>}
                  </td>
                  <td data-label="Category"><Pill tone="blue">{categoryLabel(a.category)}</Pill></td>
                  <td data-label="Level">{levelLabel(a.level)}</td>
                  <td data-label="Date">{fmtDate(a.activityDate)}</td>
                  <td data-label="Achievement">
                    {a.achievement || '—'}
                    {a.documentUrl && (
                      <div>
                        <a href={fileHref(a.documentUrl)} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                          🗎 {a.documentName ?? 'Certificate'}
                        </a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {others.length > 0 && (
          <>
            <div style={{ padding: '14px 20px 6px', borderTop: approved.length ? '1px solid var(--hairline)' : undefined }}>
              <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>Requests</strong>
            </div>
            <table className="data-table data-table-cards">
              <thead>
                <tr><th>Activity</th><th>Requested</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {others.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-primary" data-label="Activity">
                      {a.name}
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                        {categoryLabel(a.category)} · {fmtDate(a.activityDate)}
                      </div>
                    </td>
                    <td data-label="Requested">{fmtDate(a.requestedAt)}</td>
                    <td data-label="Status">
                      <Pill tone={STATUS_TONE[a.status] ?? 'gray'}>{a.status}</Pill>
                      {a.status === 'REJECTED' && a.rejectionReason && (
                        <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4, maxWidth: 280 }}>
                          {a.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td data-label="">
                      {a.status === 'PENDING' && (
                        <Button
                          variant="ghost"
                          small
                          onClick={() => {
                            void api.withdrawCoCurricular(a.id)
                              .then(() => { toast('Request withdrawn.'); void load(); })
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
          </>
        )}
      </Card>

      {open && (
        <RequestActivityModal
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast('Sent to your class teacher for review.');
            void load();
          }}
        />
      )}
    </>
  );
}

function RequestActivityModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', category: 'SPORTS', level: 'SCHOOL',
    description: '', achievement: '', activityDate: '',
  });
  const [doc, setDoc] = useState<AttachedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.requestCoCurricular({
        ...form,
        description: form.description.trim() || undefined,
        achievement: form.achievement.trim() || undefined,
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
    <Modal title="Request a co-curricular activity" onClose={onClose} wide>
      <form onSubmit={submit}>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.55 }}>
          Your class teacher reviews this before it is added to your profile.
        </p>

        <label className="field-label" htmlFor="cc-name" style={{ display: 'block' }}>
          Activity name<span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>
        </label>
        <input
          id="cc-name"
          className="field-input"
          required
          maxLength={160}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Inter-school football tournament"
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 10, marginBottom: 12 }}>
          <Select
            label="Category"
            value={form.category}
            onChange={(category) => setForm({ ...form, category })}
            options={CATEGORY_OPTIONS}
          />
          <Select
            label="Level"
            value={form.level}
            onChange={(level) => setForm({ ...form, level })}
            options={LEVEL_OPTIONS}
          />
          <div className="filter-field">
            <label className="field-label" htmlFor="cc-date">
              Date<span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>
            </label>
            <DateField
              id="cc-date"
              required
              max={new Date().toISOString().slice(0, 10)}
              value={form.activityDate}
              onChange={(v) => setForm({ ...form, activityDate: v })}
            />
          </div>
        </div>

        <label className="field-label" htmlFor="cc-achievement" style={{ display: 'block' }}>
          Achievement / participation details
        </label>
        <input
          id="cc-achievement"
          className="field-input"
          maxLength={500}
          value={form.achievement}
          onChange={(e) => setForm({ ...form, achievement: e.target.value })}
          placeholder="e.g. Runner-up, or Participant"
        />

        <label className="field-label" htmlFor="cc-description" style={{ display: 'block' }}>Description</label>
        <textarea
          id="cc-description"
          className="field-input"
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What the activity involved."
        />

        <OptionalDocumentInput
          label="Supporting document"
          hint="Optional — a certificate or photo. You can submit without one."
          value={doc}
          onChange={setDoc}
          onBusyChange={setUploading}
        />

        {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || uploading}>{busy ? 'Sending…' : 'Send for review'}</Button>
        </div>
      </form>
    </Modal>
  );
}
