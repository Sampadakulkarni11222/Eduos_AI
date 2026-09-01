'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import type { NotificationDto } from '@/lib/types';
import { Spinner, cx } from './ui';

const POLL_MS = 60_000;

const TYPE_ICON: Record<string, string> = {
  ANNOUNCEMENT: '◍', ASSIGNMENT: '✎', MARKS: '◉', ATTENDANCE: '☱',
  FEES: '₹', LIBRARY: '▢', TICKET: '✉', LEAVE: '⊘', SYSTEM: '◌',
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Topbar notification bell + inbox panel.
 *
 * The badge polls on an interval rather than holding a socket open — the
 * backend has no realtime channel, and a minute of latency is the right
 * trade for not adding one just for a counter.
 */
export function NotificationBell({ portalSlug }: { portalSlug: string }) {
  const link = useSchoolHref();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const r = await api.unreadNotificationCount();
      setUnread(r.unreadCount);
    } catch {
      /* a failed badge poll is not worth surfacing to the user */
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const t = setInterval(() => void refreshCount(), POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Load the list when the panel opens.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setItems(null);
    api
      .notifications({ limit: 15 })
      .then((page) => {
        if (stale) return;
        setItems(page.items);
        setUnread(page.unreadCount);
      })
      .catch(() => !stale && setItems([]));
    return () => { stale = true; };
  }, [open]);

  // Escape closes and returns focus to the trigger; outside click closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function openItem(n: NotificationDto) {
    if (!n.readAt) {
      setItems((prev) => prev?.map((i) => (i._id === n._id ? { ...i, readAt: new Date().toISOString() } : i)) ?? prev);
      setUnread((u) => Math.max(0, u - 1));
      try { await api.markNotificationsRead([n._id]); } catch { void refreshCount(); }
    }
    if (n.link) {
      setOpen(false);
      // Links are stored portal-relative ("/performance") so one notification
      // can serve a student and their parent, whose portals differ.
      router.push(n.link.startsWith('/') ? link(`/${portalSlug}${n.link}`) : n.link);
    }
  }

  async function markAll() {
    setItems((prev) => prev?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? prev);
    setUnread(0);
    try { await api.markAllNotificationsRead(); } catch { void refreshCount(); }
  }

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        ref={buttonRef}
        className="notif-bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {/* Screen readers get the count without needing to open the panel. */}
      <span className="sr-only" aria-live="polite">
        {unread > 0 ? `${unread} unread notifications` : ''}
      </span>

      {open && (
        <div ref={panelRef} className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-head">
            <span className="notif-panel-title">Notifications</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={() => void markAll()}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-list">
            {items === null ? (
              <div className="notif-loading"><Spinner /></div>
            ) : items.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon" aria-hidden="true">◌</div>
                <div className="notif-empty-title">You&apos;re all caught up</div>
                <div className="notif-empty-sub">New results, announcements and fee updates will appear here.</div>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n._id}
                  className={cx('notif-item', !n.readAt && 'unread')}
                  onClick={() => void openItem(n)}
                >
                  <span className="notif-item-icon" aria-hidden="true">{TYPE_ICON[n.type] ?? '◌'}</span>
                  <span className="notif-item-main">
                    <span className="notif-item-title">{n.title}</span>
                    {n.body && <span className="notif-item-body">{n.body}</span>}
                    <span className="notif-item-time">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="notif-dot" aria-label="Unread" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
