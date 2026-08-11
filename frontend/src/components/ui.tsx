'use client';
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

export function StatCard({
  label, value, delta, deltaDir = 'flat',
}: {
  label: string; value: ReactNode; delta?: string; deltaDir?: 'up' | 'down' | 'flat';
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta && <div className={cx('stat-delta', deltaDir)}>{delta}</div>}
    </div>
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
/* ── Pagination control ──────────────────────────────────────────
   A stateless row showing "Showing X–Y of Z" with Prev/Next buttons.
   The parent holds the page index; this just fires callbacks.           */
export function Pagination({
  page, pageSize, total, onPage,
}: {
  page: number;       // 0-indexed
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderTop: '1px solid var(--hairline)', fontSize: 13,
      flexWrap: 'wrap', gap: 8,
    }}>
      <span style={{ color: 'var(--text-faint)' }}>
        Showing {from}–{to} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button small variant="soft" disabled={page === 0} onClick={() => onPage(page - 1)}>
          ← Prev
        </Button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          // Show pages around current page + first/last
          const p = i < 3 ? i : (i >= totalPages - 2 ? totalPages - (7 - i) : page - 1 + (i - 2));
          if (p < 0 || p >= totalPages) return null;
          return (
            <Button key={p} small variant={p === page ? 'accent' : 'soft'} onClick={() => onPage(p)}>
              {p + 1}
            </Button>
          );
        })}
        <Button small variant="soft" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
          Next →
        </Button>
      </div>
    </div>
  );
}

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
