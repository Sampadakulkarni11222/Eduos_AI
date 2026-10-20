'use client';
import { useEffect, useState } from 'react';
import { dismissNotice, isOnline, listQueued, offlineNotices, onOfflineChange, syncQueue, type OfflineNotice } from '@/lib/offline-queue';

/**
 * "Offline, n changes waiting": shown on every portal page while the browser
 * is offline or the offline queue holds changes. Replays the queue when the
 * connection returns (and on "Send now"), and shows each conflict the server
 * resolved in its own favour, so nothing is silently overwritten either way.
 *
 * Registers the service worker (production builds only) that keeps the app
 * shell available offline; it never caches API responses.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [notes, setNotes] = useState<OfflineNotice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const q = await listQueued().catch(() => []);
      if (!alive) return;
      setOnline(isOnline());
      setWaiting(q.length);
      setNotes([...offlineNotices()]);
    };
    const sync = async () => { if (isOnline()) { await syncQueue().catch(() => undefined); } await refresh(); };
    void sync();
    const off = onOfflineChange(() => { void refresh(); });
    const back = () => { void sync(); };
    window.addEventListener('online', back);
    const timer = window.setInterval(() => { void sync(); }, 60_000);
    try {
      if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    } catch { /* not available */ }
    return () => { alive = false; off(); window.removeEventListener('online', back); window.clearInterval(timer); };
  }, []);

  if (online && !waiting && !notes.length) return null;
  return (
    <div className="offline-banner-wrap">
      {(!online || waiting > 0) && (
        <div className={`offline-banner ${online ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite">
          <span className="offline-dot" aria-hidden="true" />
          <span className="offline-text">
            {online ? 'Back online' : 'Offline'}{waiting ? `, ${waiting} change${waiting === 1 ? '' : 's'} waiting` : ''}
            {!online && <span className="offline-sub"> · attendance, lab issue/return, scans, sanitation and check-ins are saved on this device</span>}
          </span>
          {online && waiting > 0 && (
            <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => { setBusy(true); void syncQueue().finally(() => setBusy(false)); }}>{busy ? 'Sending…' : 'Send now'}</button>
          )}
        </div>
      )}
      {notes.map((n) => (
        <div key={n.id} className={`offline-notice tone-${n.tone}`} role="alert">
          <span><b>{n.label}:</b> {n.text}</span>
          <button type="button" className="offline-x" aria-label="Dismiss" onClick={() => dismissNotice(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
