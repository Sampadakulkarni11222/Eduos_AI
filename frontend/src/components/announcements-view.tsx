'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, EmptyState, SkeletonRows } from './ui';
import { api } from '@/lib/api';
import type { AnnouncementDto } from '@/lib/types';

export function AnnouncementsView({ canPublish }: { canPublish: boolean }) {
  const [items, setItems] = useState<AnnouncementDto[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const reload = () => api.announcements().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); }, []);

  return (
    <>
      {canPublish && (
        <div style={{ marginBottom: 16 }}>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New announcement'}</Button>
        </div>
      )}
      {showForm && <NewAnnouncement onDone={() => { setShowForm(false); void reload(); }} />}
      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && <EmptyState title="No announcements" sub="School notices appear here." />}
      {items && items.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((a) => (
            <Card key={a.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, color: 'var(--text-1b)' }}>{a.title}</strong>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
              <p style={{ marginTop: 6, fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{a.content}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function NewAnnouncement({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.createAnnouncement({ title, content, audience: { all: true } }); onDone(); }
    catch { setErr('Failed to post announcement. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field-label">Title</div>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="field-label">Content</div>
        <textarea className="field-input" rows={3} value={content} onChange={(e) => setContent(e.target.value)} required />
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Posting…' : 'Post to all classes'}</Button>
      </form>
    </Card>
  );
}
