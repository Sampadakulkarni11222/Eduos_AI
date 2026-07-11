'use client';
import { useEffect, useState } from 'react';
import { Card, EmptyState, Pill, SkeletonRows } from './ui';
import { api } from '@/lib/api';
import type { CalendarEventDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'maroon' | 'gray'> = {
  HOLIDAY: 'amber', EXAM: 'maroon', PTM: 'blue', SPORTS: 'green', EVENT: 'gray',
};

export function CalendarView() {
  const [events, setEvents] = useState<CalendarEventDto[] | null>(null);
  useEffect(() => {
    const from = new Date(); from.setMonth(from.getMonth() - 1);
    const to = new Date(); to.setMonth(to.getMonth() + 3);
    api.calendar(from.toISOString(), to.toISOString()).then(setEvents).catch(() => setEvents([]));
  }, []);

  if (events === null) return <Card><SkeletonRows rows={5} /></Card>;
  if (events.length === 0) return <EmptyState title="No events scheduled" sub="School events and holidays appear here." />;
  return (
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
  );
}
