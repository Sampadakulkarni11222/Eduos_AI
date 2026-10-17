'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Pill, useToast } from '@/components/ui';
import { request } from '@/lib/api';
import type { AvailableRoutesDto, BookRequestDto, TransportRequestDto } from '@/lib/types';

/**
 * Part 4: a parent asks for a library book or a bus place for their own child.
 * The server checks the child is theirs (utils/familyStudent.js); these cards
 * only send the selected child's id.
 */
const qs = (o: Record<string, string>) => `?${new URLSearchParams(o).toString()}`;
const TONE: Record<string, 'amber' | 'green' | 'red' | 'gray'> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'gray' };
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** "Ask for it" on a catalogue row: sends a request for the selected child. */
export function AskBookButton({ studentId, bookId, firstName, disabled, onDone }: { studentId: string; bookId: string; firstName: string; disabled?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();
  return (
    <Button small variant="soft" disabled={busy || sent || disabled} onClick={() => void (async () => {
      setBusy(true);
      try { await request('/library/requests', { method: 'POST', body: JSON.stringify({ bookId, studentId }) }); setSent(true); toast(`Request sent to the librarian for ${firstName}`, 'success'); onDone?.(); } catch (e) { toast(e instanceof Error ? e.message : 'That did not work.', 'error'); } finally { setBusy(false); }
    })()}>{sent ? 'Requested' : 'Ask for it'}</Button>
  );
}

/** The selected child's book requests, with Withdraw while pending. */
export function ChildBookRequests({ studentId, firstName, refreshKey = 0 }: { studentId: string; firstName: string; refreshKey?: number }) {
  const [mine, setMine] = useState<BookRequestDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Promise.resolve: a request helper that returns nothing (a test double) must not break the page.
  const load = () => Promise.resolve(request<BookRequestDto[]>(`/library/requests/mine${qs({ studentId })}`)).then((r) => setMine(Array.isArray(r) ? r : [])).catch(() => setMine([]));
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, refreshKey]);
  if (!mine?.length) return null;
  const cancel = async (id: string) => { setBusy(true); try { await request(`/library/requests/${id}/cancel`, { method: 'PATCH' }); await load(); } finally { setBusy(false); } };
  return (
    <Card pad={false} style={{ marginTop: 16 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Book requests for {firstName}</strong>
        <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 4 }}>The librarian decides; an approved request is issued to {firstName} at the library.</p>
      </div>
      <div style={{ padding: '10px 20px', display: 'grid', gap: 6 }}>
        {mine.slice(0, 10).map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{r.bookTitle} <Pill tone={TONE[r.status] ?? 'gray'}>{words(r.status)}</Pill></span>
            {r.status === 'PENDING' && <Button small variant="ghost" disabled={busy} onClick={() => void cancel(r.id)}>Withdraw</Button>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChildTransportRequest({ studentId, firstName }: { studentId: string; firstName: string }) {
  const [view, setView] = useState<AvailableRoutesDto | null>(null);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const load = () => Promise.resolve(request<AvailableRoutesDto>(`/transport/routes/available${qs({ studentId })}`)).then((v) => setView(v && Array.isArray(v.routes) ? v : null)).catch((e) => { setView(null); setError(e instanceof Error ? e.message : null); });
  useEffect(() => { setRouteId(''); setStopId(''); setError(null); void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);
  if (!view) return error ? <Card style={{ marginTop: 16 }}><p className="ops-error">⚠ {error}</p></Card> : null;
  const route = view.routes.find((r) => r.id === routeId);
  const send = async () => {
    setBusy(true); setError(null);
    try { await request<TransportRequestDto>('/transport/requests', { method: 'POST', body: JSON.stringify({ routeId, stopId, studentId }) }); toast(`Bus request sent for ${firstName}`, 'success'); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(false); }
  };
  const mine = view.myRequest;
  return (
    <Card style={{ marginTop: 16 }}>
      <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Ask for a bus place for {firstName}</strong>
      {mine && <p style={{ marginTop: 8 }}>Latest request: {mine.routeName} from {mine.stopName} <Pill tone={TONE[mine.status] ?? 'gray'}>{words(mine.status)}</Pill>{mine.status === 'PENDING' && <> <Button small variant="ghost" disabled={busy} onClick={() => void request(`/transport/requests/${mine.id}/cancel`, { method: 'PATCH' }).then(load)}>Withdraw</Button></>}</p>}
      {error && <p className="ops-error" role="alert">⚠ {error}</p>}
      {view.canRequest ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <select className="input" value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(''); }}><option value="">Route…</option>{view.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <select className="input" value={stopId} disabled={!route} onChange={(e) => setStopId(e.target.value)}><option value="">Stop…</option>{(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <Button disabled={busy || !routeId || !stopId} onClick={() => void send()}>Send request</Button>
        </div>
      ) : <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 6 }}>{firstName} already has a request or a place for this year.</p>}
      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>The school office decides; the fare is charged only once a place is granted.</p>
    </Card>
  );
}
