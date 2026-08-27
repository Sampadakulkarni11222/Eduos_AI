'use client';
import Link from 'next/link';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export function cx(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(' ');
}

type BtnVariant = 'accent' | 'soft' | 'ghost' | 'whatsapp';
export function Button({
  variant = 'accent', small, className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean }) {
  return (
    <button
      className={cx('btn', `btn-${variant}`, small && 'btn-sm', className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} style={{ width: '100%' }} {...props} />;
}

export function Card({ children, className, pad = true, style }: { children: ReactNode; className?: string; pad?: boolean; style?: React.CSSProperties }) {
  return <div className={cx('card', pad && 'card-pad', className)} style={style}>{children}</div>;
}

/**
 * A stat tile. Passing `href` turns it into a real link to the detail view for
 * that number — a keyboard-focusable anchor, not a div with a click handler,
 * so it can be tabbed to and opened in a new tab. Without `href` the markup is
 * exactly as before, so the tiles in every other portal are unchanged.
 */
export function StatCard({
  label, value, delta, deltaDir = 'flat', href, hint,
}: {
  label: string; value: ReactNode; delta?: string; deltaDir?: 'up' | 'down' | 'flat';
  href?: string; hint?: string;
}) {
  const body = (
    <>
      <div className="stat-label">
        {label}
        {href && <span className="stat-link-arrow" aria-hidden="true">→</span>}
      </div>
      <div className="stat-value">{value}</div>
      {delta && <div className={cx('stat-delta', deltaDir)}>{delta}</div>}
    </>
  );

  if (!href) return <div className="stat-card">{body}</div>;

  return (
    <Link href={href} className="stat-card stat-card-link" aria-label={hint ? `${label}. ${hint}` : undefined}>
      {body}
    </Link>
  );
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'maroon'; children: ReactNode }) {
  return <span className={cx('pill', tone)}>{children}</span>;
}

export function EmptyState({ icon = '◌', title, sub, action }: { icon?: string; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-sub">{sub}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 44 }} />
      ))}
    </div>
  );
}

/** Initials avatar with a deterministic warm tint, matching the prototype. */
const AVATAR_TINTS = ['#7A1F2B', '#2c6049', '#4a5e8c', '#946312', '#43434c', '#8a2f3a'];
export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const safeName = name ?? '';
  const initials = safeName.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  const tint = AVATAR_TINTS[hash(safeName) % AVATAR_TINTS.length];
  return (
    <span className={cx('avatar', className)} style={{ background: tint + '22', color: tint }}>
      {initials || '?'}
    </span>
  );
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic per-subject color, used to color-code timetable calendar entries. */
const SUBJECT_TINTS = [
  '#2c6049', '#4a5e8c', '#946312', '#7A1F2B', '#0f4c5c',
  '#5f0f40', '#3d2f26', '#1f4a3a', '#54131b', '#2f3c5c',
];
export function subjectColor(name: string | null | undefined): { bg: string; text: string; dot: string } {
  const safeName = name ?? '';
  const tint = SUBJECT_TINTS[hash(safeName) % SUBJECT_TINTS.length];
  return { bg: tint + '1A', text: tint, dot: tint };
}

/* ── Toast notifications ─────────────────────────────────────────
   Lightweight success/error feedback for mutations, replacing alert(). */
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }

const ToastContext = createContext<{ toast: (text: string, kind?: ToastKind) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const palette: Record<ToastKind, { bg: string; border: string; color: string; icon: string }> = {
    success: { bg: 'rgba(240,253,244,0.97)', border: '#86efac', color: '#166534', icon: '✓' },
    error: { bg: 'rgba(254,242,242,0.97)', border: '#fca5a5', color: '#991b1b', icon: '⚠' },
    info: { bg: 'rgba(239,246,255,0.97)', border: '#93c5fd', color: '#1e40af', icon: 'ℹ' },
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }} aria-live="polite">
        {items.map((t) => {
          const p = palette[t.kind];
          return (
            <div key={t.id} role="status" style={{
              background: p.bg, border: `1px solid ${p.border}`, color: p.color,
              borderRadius: 12, padding: '11px 15px', fontSize: 13.5, fontWeight: 600,
              boxShadow: '0 6px 24px rgba(0,0,0,.12)', display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{ flexShrink: 0 }}>{p.icon}</span>
              <span style={{ lineHeight: 1.45 }}>{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx.toast;
}

/**
 * "Class 5 A" from a grade and section name.
 *
 * Section names are bare letters — every grade has an "A" — so showing one on
 * its own tells you nothing about which class it is. Falls back to whichever
 * part is present rather than rendering a stray separator.
 */
export function divisionLabel(
  gradeName: string | null | undefined,
  sectionName: string | null | undefined,
): string {
  return [gradeName, sectionName].map((p) => p?.trim()).filter(Boolean).join(' ') || '—';
}

export function rupees(paise: number | null | undefined): string {
  const safePaise = Number(paise) || 0;
  const amount = safePaise / 100;
  const hasDecimals = amount % 1 !== 0;
  return '₹' + amount.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/* ── Accessible form field ───────────────────────────────────────
   Associates a visible label with its control. The app previously had a
   single htmlFor in the whole codebase, so screen readers announced most
   inputs as an unnamed "edit text". Wrap any control:
     <Field label="Due date"><input type="date" … /></Field>            */
export function Field({
  label, hint, error, required, children, id,
}: {
  label: string; hint?: string; error?: string; required?: boolean;
  children: ReactNode; id?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: fieldId,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        required,
      })
    : children;

  return (
    <div style={{ marginBottom: 12 }}>
      <label className="field-label" htmlFor={fieldId} style={{ display: 'block' }}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {control}
      {hint && !error && (
        <div id={hintId} style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>{hint}</div>
      )}
      {error && (
        <div id={errorId} role="alert" style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 3 }}>{error}</div>
      )}
    </div>
  );
}

/* ── Accessible modal ────────────────────────────────────────────
   Dialog semantics, Escape to close, focus moved in on open and returned to
   the trigger on close, and focus kept inside while open. No modal in the app
   did any of this, so keyboard users could tab out into the page behind. */
export function Modal({
  title, onClose, children, footer, wide,
}: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []
      );

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={wide ? { width: 640 } : undefined}
      >
        <div className="modal-header">
          <span className="modal-title" id={titleId}>{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Spreadable props that make a non-interactive element behave like a button for
 * keyboard and screen-reader users.
 *
 * Preferred order is: use a real `<button>`; failing that, spread this. It
 * exists because ~40 call sites render clickable cards, table rows and calendar
 * cells as `<div onClick>`, which mouse users can operate and nobody else can.
 * Restructuring each one into a button changes layout (buttons carry their own
 * box model and reset styles); this does not.
 *
 * Enter and Space both activate, matching native button behaviour — Space is
 * intercepted to stop the page scrolling underneath.
 *
 *   <div {...clickable(() => open(row.id))} style={…}>…</div>
 */
export function clickable(onClick: () => void, opts: { label?: string; disabled?: boolean } = {}) {
  const { label, disabled = false } = opts;
  return {
    role: 'button' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    ...(label ? { 'aria-label': label } : {}),
    onClick: disabled ? undefined : onClick,
    onKeyDown: disabled
      ? undefined
      : (e: React.KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          // Only act on the element itself; a keypress inside a nested button or
          // input has already been handled by that control.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onClick();
        },
  };
}
