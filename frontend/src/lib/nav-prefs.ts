/**
 * The sidebar's per-person memory: shortcuts, recent pages, which spaces are
 * open and which show everything.
 *
 * Kept in localStorage, per school and profile, because it is a convenience
 * and not a record: every read and write is wrapped so a private window,
 * blocked storage or a corrupted value falls back to the role's defaults
 * instead of breaking the menu.
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const PREFIX = 'eduos.nav.v1';
export const MAX_SHORTCUTS = 8;
/** One more than is shown, so "recent" still has three after leaving out the page on screen. */
export const MAX_RECENT = 4;
export const RECENT_SHOWN = 3;

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Who the preferences belong to: one school, one profile. */
export const prefsScope = (school: string | null | undefined, profileId: string | null | undefined) =>
  `${school || '-'}:${profileId || '-'}`;

const keyOf = (scope: string, name: string) => `${PREFIX}:${scope}:${name}`;

function read<T>(storage: StorageLike | null, key: string, valid: (v: unknown) => v is T): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked: the menu keeps working for this visit */
  }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isBoolMap = (v: unknown): v is Record<string, boolean> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'boolean');

// ── Shortcuts ────────────────────────────────────────────────────────────

/**
 * The person's shortcuts, or the role's defaults until they change them.
 * Anything no longer in their menu (a permission removed, a page retired) is dropped.
 */
export function loadShortcuts(storage: StorageLike | null, scope: string, defaults: string[], visible: Set<string>): string[] {
  const stored = read(storage, keyOf(scope, 'shortcuts'), isStringArray);
  const list = stored ?? defaults;
  return [...new Set(list)].filter((h) => visible.has(h)).slice(0, MAX_SHORTCUTS);
}

export function saveShortcuts(storage: StorageLike | null, scope: string, list: string[]): void {
  write(storage, keyOf(scope, 'shortcuts'), list.slice(0, MAX_SHORTCUTS));
}

export function togglePin(list: string[], href: string): string[] {
  if (list.includes(href)) return list.filter((h) => h !== href);
  return [...list, href].slice(-MAX_SHORTCUTS);
}

export function moveShortcut(list: string[], href: string, dir: -1 | 1): string[] {
  const i = list.indexOf(href);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ── Recent pages ─────────────────────────────────────────────────────────

export function loadRecent(storage: StorageLike | null, scope: string): string[] {
  return (read(storage, keyOf(scope, 'recent'), isStringArray) ?? []).slice(0, MAX_RECENT);
}

/** Puts a page at the front of the recent list and returns the new list. */
export function recordRecent(storage: StorageLike | null, scope: string, href: string): string[] {
  const next = [href, ...loadRecent(storage, scope).filter((h) => h !== href)].slice(0, MAX_RECENT);
  write(storage, keyOf(scope, 'recent'), next);
  return next;
}

/** What "Recent" shows: not the page on screen, not a page already in shortcuts. */
export function recentToShow(recent: string[], current: string | null, shortcuts: string[], visible: Set<string>): string[] {
  return recent.filter((h) => h !== current && !shortcuts.includes(h) && visible.has(h)).slice(0, RECENT_SHOWN);
}

// ── Space open / show-all state ──────────────────────────────────────────

export function loadFlags(storage: StorageLike | null, scope: string, name: 'open' | 'showall'): Record<string, boolean> {
  return read(storage, keyOf(scope, name), isBoolMap) ?? {};
}

export function saveFlags(storage: StorageLike | null, scope: string, name: 'open' | 'showall', flags: Record<string, boolean>): void {
  write(storage, keyOf(scope, name), flags);
}
