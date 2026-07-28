'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import type { CalendarEventDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'maroon' | 'gray'> = {
  HOLIDAY: 'amber', EXAM: 'maroon', PTM: 'blue', SPORTS: 'green', EVENT: 'gray',
};

export function CalendarView() {
  const [events, setEvents] = useState<CalendarEventDto[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const canManage = hasAccess(me?.profile?.role, 'calendar.manage');

  const load = useCallback(() => {
    const from = new Date(); from.setMonth(from.getMonth() - 1);
    const to = new Date(); to.setMonth(to.getMonth() + 3);
    return api.calendar(from.toISOString(), to.toISOString()).then(setEvents).catch(() => setEvents([]));
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ Add Event'}</Button>
        </div>
      )}
      {showForm && (
        <AddEventForm
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}

      {events === null && <Card><SkeletonRows rows={5} /></Card>}
      {events !== null && events.length === 0 && (
        <EmptyState title="No events scheduled" sub="School events and holidays appear here." />
      )}
      {events !== null && events.length > 0 && (
        <Card pad={false}>
          {events.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
              <div style={{ width: 52, textAlign: 'center' }}>
                <div style={{ fontFamily: 'Newsreader, serif', fontSize: 20, fontWeight: 600, color: 'var(--text-1b)' }}>{new Date(e.startsAt).getDate()}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{new Date(e.startsAt).toLocaleDateString('en-IN', { month: 'short' })}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{e.title}</div>
                {e.description && <div style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>{e.description}</div>}
              </div>
              <Pill tone={TYPE_TONE[e.type] ?? 'gray'}>{e.type.toLowerCase()}</Pill>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AddEventForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('EVENT');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title || !startsAt) return;
    setBusy(true);
    try {
      await api.createEvent({
        title,
        type,
        description: description || undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt || startsAt).toISOString(),
      });
      toast('Event added to the calendar.');
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not add the event.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div className="field-label">Title</div>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Annual Sports Day" />
          </div>
          <div>
            <div className="field-label">Type</div>
            <select className="field-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="EVENT">Event</option>
              <option value="HOLIDAY">Holiday</option>
              <option value="EXAM">Exam</option>
              <option value="PTM">PTM</option>
              <option value="SPORTS">Sports</option>
            </select>
          </div>
          <div>
            <div className="field-label">Starts</div>
            <input className="field-input" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </div>
          <div>
            <div className="field-label">Ends</div>
            <input className="field-input" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: -4 }}>
          <div className="field-label">Description (optional)</div>
          <input className="field-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note visible to everyone" />
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add event'}</Button>
      </form>
    </Card>
  );
}
