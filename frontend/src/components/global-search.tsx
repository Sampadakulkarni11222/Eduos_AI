'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { UserDto } from '@/lib/types';

/**
 * Ctrl+K / ⌘K command-palette search for the Owner portal.
 *
 * Calls the existing `api.listUsers(search)` endpoint which already supports
 * a `search` query param on GET /users.  Results are grouped by role with
 * keyboard navigation support.
 */

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Students',
  TEACHER: 'Staff — Teacher',
  ADMIN: 'Staff — Admin',
  OWNER: 'Staff — Owner',
  PRINCIPAL: 'Staff — Principal',
  PARENT: 'Parents',
  FINANCE: 'Staff — Finance',
  LIBRARIAN: 'Staff — Librarian',
  WARDEN: 'Staff — Warden',
};

const ROLE_ICONS: Record<string, string> = {
  STUDENT: '🎒', TEACHER: '👩‍🏫', ADMIN: '🏛️', OWNER: '👑',
  PRINCIPAL: '🎓', PARENT: '👨‍👩‍👧', FINANCE: '💰', LIBRARIAN: '📚', WARDEN: '🔑',
};

export function GlobalSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setFocusIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Escape closes modal
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const search = useCallback((q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    api.listUsers(q.trim())
      .then((users) => { setResults(users); setFocusIdx(0); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const onInput = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const navigate = (user: UserDto) => {
    onClose();
    if (user.roleKey === 'STUDENT' && user.studentDetails?.id) {
      router.push(`/admin/users`);
    } else {
      router.push(`/admin/users`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[focusIdx]) { navigate(results[focusIdx]); }
  };

  if (!open) return null;

  // Group results by role
  const grouped: Record<string, UserDto[]> = {};
  results.forEach((u) => {
    const key = u.roleKey || 'OTHER';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(u);
  });

  let flatIdx = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        }}
      />
      {/* Modal */}
      <div style={{
        position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 9999,
        background: 'var(--card-bg, #fff)', borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        fontFamily: 'var(--font-body, Inter, system-ui, sans-serif)',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--hairline, #e5e5e5)',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2b, #888)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search students, staff, parents…"
            style={{
              flex: 1, border: 'none', outline: 'none', fontSize: 15,
              background: 'transparent', color: 'var(--text-1, #111)',
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            background: 'var(--bg-wash, #f3f3f3)', color: 'var(--text-faint, #999)',
            border: '1px solid var(--hairline, #e0e0e0)',
          }}>ESC</kbd>
        </div>

        {/* Results area */}
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 0' }}>
          {loading && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-faint, #999)', fontSize: 13 }}>
              Searching…
            </div>
          )}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-faint, #999)', fontSize: 13 }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {!loading && query.length < 2 && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-faint, #999)', fontSize: 13 }}>
              Type at least 2 characters to search
            </div>
          )}
          {!loading && Object.keys(grouped).map((role) => (
            <div key={role}>
              <div style={{
                padding: '8px 18px 4px', fontSize: 10.5, fontWeight: 700,
                letterSpacing: '.06em', textTransform: 'uppercase',
                color: 'var(--text-faint, #999)',
              }}>
                {ROLE_LABELS[role] || role}
              </div>
              {grouped[role].map((user) => {
                const idx = flatIdx++;
                const isFocused = idx === focusIdx;
                return (
                  <button
                    key={user.id}
                    onClick={() => navigate(user)}
                    onMouseEnter={() => setFocusIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                      padding: '10px 18px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: isFocused ? 'var(--accent-muted, rgba(99,102,241,0.08))' : 'transparent',
                      borderRadius: 0, fontFamily: 'inherit', transition: 'background .12s',
                    }}
                  >
                    <span style={{ fontSize: 18, width: 26, textAlign: 'center', flexShrink: 0 }}>
                      {ROLE_ICONS[user.roleKey] || '◉'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1, #111)', display: 'block' }}>
                        {user.displayName}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-faint, #999)' }}>
                        {user.phone}
                        {user.email ? ` · ${user.email}` : ''}
                        {user.studentDetails ? ` · ${user.studentDetails.admissionNo}` : ''}
                      </span>
                    </span>
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, color: 'var(--text-2b, #777)',
                      background: 'var(--bg-wash, #f3f3f3)', borderRadius: 6, padding: '2px 8px',
                      flexShrink: 0,
                    }}>
                      {user.roleKey}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 18px', borderTop: '1px solid var(--hairline, #e5e5e5)',
          display: 'flex', alignItems: 'center', gap: 14, fontSize: 11,
          color: 'var(--text-faint, #999)',
        }}>
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>ESC Close</span>
        </div>
      </div>
    </>
  );
}

/**
 * Hook that listens for Ctrl+K / ⌘K and toggles a boolean.
 * Returns [isOpen, setIsOpen] to wire the modal.
 */
export function useGlobalSearchShortcut(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return [open, setOpen];
}
