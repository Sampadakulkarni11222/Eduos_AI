'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { usePermissions, getRequiredPermission } from '@/lib/permissions';
import { PORTALS } from '@/lib/portals';
import { withSchool } from '@/lib/school-path';
import { matchPages, resultHref, searchApi, type SearchGroup } from '@/lib/search-api';

/**
 * Universal search: a button in every portal's header, and Ctrl/Cmd+K.
 *
 * Pages come from this person's own menu (already limited by permission);
 * records come from /search, where the server searches only what this person
 * may see. A result opens the first page of this portal that shows it; a
 * result with no such page is listed without a link.
 */
type Row = { key: string; title: string; subtitle: string | null; href: string | null; group: string; icon?: string };

/** Fired by anything that wants the palette open, e.g. the sidebar's "Jump to…". */
export const OPEN_SEARCH_EVENT = 'eduos:open-search';
export function openUniversalSearch(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

export function UniversalSearch({ portalSlug, school }: { portalSlug: string; school: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);
  return (
    <>
      <button type="button" className="btn btn-soft btn-sm topbar-search" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" title="Search everything you can see (Ctrl+K)">
        <span aria-hidden="true">⌕</span><span className="topbar-search-text"> Search</span><kbd className="topbar-search-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>
      {/* Rendered on <body>: the header creates a containing block, which would trap a fixed overlay inside it. */}
      {open && typeof document !== 'undefined' && createPortal(<SearchPalette portalSlug={portalSlug} school={school} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SearchPalette({ portalSlug, school, onClose }: { portalSlug: string; school: string | null; onClose: () => void }) {
  const router = useRouter();
  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'limited'>('idle');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  // The menu as this person sees it.
  const nav = useMemo(() => (PORTALS[portalSlug]?.nav ?? []).map((g) => ({
    ...g, items: g.items.filter((it) => { const req = getRequiredPermission(it.href); return !req || hasAccess(me?.profile?.role, req); }),
  })), [portalSlug, hasAccess, me?.profile?.role]);
  const navHrefs = useMemo(() => new Set(nav.flatMap((g) => g.items.map((i) => i.href))), [nav]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setGroups([]); setState('idle'); return undefined; }
    let live = true;
    setState('loading');
    const t = setTimeout(() => {
      searchApi.search(text)
        .then((r) => { if (live) { setGroups(r.groups); setState('idle'); } })
        .catch((e: { status?: number }) => { if (live) { setGroups([]); setState(e?.status === 429 ? 'limited' : 'error'); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const rows: Row[] = useMemo(() => {
    const pages = matchPages(nav, q).map((p) => ({ key: `page:${p.href}`, title: p.label, subtitle: p.group.charAt(0) + p.group.slice(1).toLowerCase(), href: p.href, group: 'Pages', icon: p.icon }));
    const records = groups.flatMap((g) => g.items.map((it) => ({ key: `${g.type}:${it.id}`, title: it.title, subtitle: it.subtitle, href: resultHref(portalSlug, navHrefs, g.pages, it.params), group: g.label })));
    return [...pages, ...records];
  }, [nav, q, groups, portalSlug, navHrefs]);
  useEffect(() => { setActive(0); }, [rows.length]);

  const go = (r: Row | undefined) => {
    if (!r?.href) return;
    onClose();
    router.push(withSchool(school, r.href));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); go(rows[active]); }
    if (e.key === 'Tab') e.preventDefault(); // focus stays in the search box; arrows move through results
  };

  let lastGroup = '';
  const listId = 'usearch-list';
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="usearch-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="usearch" role="dialog" aria-modal="true" aria-label="Search">
        <div className="usearch-head">
          <span aria-hidden="true" className="usearch-glyph">⌕</span>
          <input
            ref={input} className="usearch-input" onKeyDown={onKeyDown} value={q} onChange={(e) => setQ(e.target.value)} maxLength={80}
            placeholder="Search pages, people, classes, notices, books…" aria-label="Search"
            role="combobox" aria-expanded={rows.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `usearch-${active}` : undefined}
          />
          <button type="button" className="usearch-close" onClick={onClose} aria-label="Close search">Esc</button>
        </div>
        <div className="usearch-body">
          {q.trim().length < 2 && <p className="usearch-note">Type at least 2 letters. You only see what your role allows: {isFamily(me?.profile?.role) ? 'your own child\'s records, their teachers and notices sent to you' : 'records within your access'}.</p>}
          {state === 'error' && <p className="usearch-note" role="alert">Search is not available right now. Pages from your menu are still listed.</p>}
          {state === 'limited' && <p className="usearch-note" role="alert">Too many searches in a short time. Wait a moment.</p>}
          {q.trim().length >= 2 && !rows.length && state !== 'loading' && <p className="usearch-note">Nothing found for “{q.trim()}”.</p>}
          <ul id={listId} role="listbox" aria-label="Results" className="usearch-list">
            {rows.map((r, i) => {
              const head = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              return (
                <li key={r.key} role="presentation">
                  {head && <div className="usearch-group" role="presentation">{head}</div>}
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the input handles the keys for the whole list */}
                  <div
                    id={`usearch-${i}`} role="option" tabIndex={-1} aria-selected={i === active} aria-disabled={!r.href}
                    className={`usearch-row${i === active ? ' is-active' : ''}${r.href ? '' : ' is-static'}`}
                    onMouseEnter={() => setActive(i)} onClick={() => go(r)}
                  >
                    <span className="usearch-icon" aria-hidden="true">{r.icon ?? '›'}</span>
                    <span className="usearch-text"><span className="usearch-title">{r.title}</span>{r.subtitle && <span className="usearch-sub">{r.subtitle}</span>}</span>
                    {!r.href && <span className="usearch-sub">No page for this in your menu</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {state === 'loading' && <p className="usearch-note" aria-live="polite">Searching…</p>}
        </div>
        <div className="usearch-foot" aria-hidden="true">↑ ↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}

const isFamily = (role?: string | null) => ['PARENT', 'STUDENT', 'ALUMNUS'].includes(role ?? '');
