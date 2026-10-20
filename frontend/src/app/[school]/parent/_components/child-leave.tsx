'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Pill, SkeletonRows, useToast } from '@/components/ui';
import { errorMessage, request } from '@/lib/api';
import { formatDate, humanizeLabel } from '../../student/_lib/format';

/**
 * Leave for a child, applied by the parent.
 *
 * Posts to the same /leave/apply the student uses, naming the child; the
 * server accepts only a child linked to this parent. Called through `request`
 * directly because the shared api.applyLeave() does not carry a studentId.
 */

interface ChildLeave {
  _id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  remarks?: string | null;
  studentId?: string | null;
  studentName?: string | null;
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function ChildLeave({ studentId, childName }: { studentId: string; childName: string }) {
  const toast = useToast();
  const today = toISO(new Date());
  const [items, setItems] = useState<ChildLeave[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    request<ChildLeave[] | { items: ChildLeave[] }>(`/leave/mine?studentId=${encodeURIComponent(studentId)}`)
      .then((r) => setItems(Array.isArray(r) ? r : r.items))
      .catch((e) => { setItems([]); setLoadError(errorMessage(e, 'Could not load leave applications.')); });
  }, [studentId]);

  useEffect(() => { setItems(null); load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (fromDate < today) { toast('Leave cannot be applied for a date in the past.', 'error'); return; }
    if (toDate < fromDate) { toast('End date cannot be before start date.', 'error'); return; }
    if (!reason.trim()) { toast('Please give a reason.', 'error'); return; }
    setBusy(true);
    try {
      await request('/leave/apply', { method: 'POST', body: JSON.stringify({ studentId, fromDate, toDate, reason: reason.trim() }) });
      toast(`Leave for ${childName} submitted to the class teacher.`, 'success');
      setOpen(false);
      setReason('');
      load();
    } catch (err) {
      toast(errorMessage(err, 'Could not submit the leave application.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Leave for {childName}</strong>
        <Button small onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Apply for leave'}</Button>
      </div>

      {open && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 140px' }}>
              <div className="field-label">From</div>
              <input className="input" type="date" min={today} value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
            </label>
            <label style={{ flex: '1 1 140px' }}>
              <div className="field-label">To</div>
              <input className="input" type="date" min={fromDate} value={toDate} onChange={(e) => setToDate(e.target.value)} required />
            </label>
          </div>
          <label>
            <div className="field-label">Reason</div>
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required placeholder="e.g. Fever, family function" />
          </label>
          <div><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</Button></div>
        </form>
      )}

      {items === null && <SkeletonRows rows={2} />}
      {loadError && <p role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{loadError}</p>}
      {items && !loadError && items.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No leave applications yet.</p>
      )}
      {items?.slice(0, 6).map((a, i) => (
        <div key={a._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--hairline)' : 'none', fontSize: 13 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>
              {formatDate(a.fromDate)}{a.toDate !== a.fromDate ? ` – ${formatDate(a.toDate)}` : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>{a.reason}{a.remarks ? ` · Teacher: ${a.remarks}` : ''}</div>
          </div>
          <Pill tone={a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{humanizeLabel(a.status)}</Pill>
        </div>
      ))}
    </Card>
  );
}
