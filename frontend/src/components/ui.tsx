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

/* ── Filters ─────────────────────────────────────────────────────
   The controls the student portal filters with. They live here rather than
   being re-declared per page so a fix to dropdown sizing, keyboard labelling
   or theming lands everywhere at once — which is the whole reason the mobile
   alignment problem had to be fixed in one place. */

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A native `<select>`, styled.
 *
 * Native on purpose: on a phone the OS picker is a better control than
 * anything we could build — it cannot be clipped by an overflow container, it
 * scrolls a long list properly, and it is already accessible. What was wrong
 * was the styling of the *control*, and its width; `.select-field` handles
 * both.
 */
export function Select({
  label, value, onChange, options, placeholder, id, className, disabled, hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown as the first, empty-valued option — usually "All …". */
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Keeps the accessible name without printing a visible label. */
  hideLabel?: boolean;
}) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="filter-field">
      {!hideLabel && <label className="field-label" htmlFor={selectId}>{label}</label>}
      <select
        id={selectId}
        className={cx('input', 'select-field', className)}
        value={value}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/**
 * One search box over several columns.
 *
 * Deliberately not one input per column: a student looking for "chemistry"
 * does not know or care whether that word is the subject, the title or the
 * teacher's specialism. Pair it with `matchesSearch` below, which is where the
 * case-insensitive partial matching actually happens.
 */
export function SearchInput({
  label = 'Search', value, onChange, placeholder, id, hideLabel,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  hideLabel?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="filter-field">
      {!hideLabel && <label className="field-label" htmlFor={inputId}>{label}</label>}
      <div className="search-wrap">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          id={inputId}
          type="search"
          className="input search-input"
          value={value}
          placeholder={placeholder ?? 'Search…'}
          aria-label={hideLabel ? label : undefined}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

/**
 * True when `query` appears in any of `haystacks`, case-insensitively and as a
 * partial match. An empty query matches everything, so a page can call this
 * unconditionally.
 */
export function matchesSearch(query: string, haystacks: Array<string | number | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h != null && String(h).toLowerCase().includes(q));
}

/* ===== Date picker ======================================================
 *
 * A themed calendar instead of `<input type="date">`. The native control's
 * popup is browser chrome: CSS cannot reach inside it, and `color-scheme` only
 * chooses between a white sheet and a near-black one — neither of which is the
 * parchment this app is built on. Owning the popup is the only way to make it
 * match the page.
 *
 * The value stays a plain `YYYY-MM-DD` string in and out, so every caller and
 * `withinDateRange` keep working unchanged, and no `Date` ever crosses a
 * timezone boundary: parsing and formatting both go through local Y/M/D parts.
 */
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `YYYY-MM-DD` for a local calendar day. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A local `Date` at noon, which no DST shift can push onto another day. */
function parseDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** What the trigger shows: the same dd-mm-yyyy order the native field used. */
function displayDay(value: string): string {
  const d = parseDay(value);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}` : '';
}

export function DateField({
  value, onChange, id, min, max, ariaLabel, className, inputClassName = 'input',
  required, disabled, placeholder = 'dd-mm-yyyy',
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  min?: string;
  max?: string;
  ariaLabel?: string;
  /** Extra classes on the wrapper. */
  className?: string;
  /** The field class of the surrounding form — `input` in filter bars,
   *  `field-input` inside modals. */
  inputClassName?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popId = `${useId()}-cal`;

  // The month on show. It follows the value while the popup is closed, so
  // reopening always lands on the selected date rather than where the user
  // last browsed to.
  const selected = parseDay(value);
  const [month, setMonth] = useState(() => selected ?? new Date());
  useEffect(() => {
    if (!open) setMonth(parseDay(value) ?? new Date());
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const today = isoDay(new Date());

  const pick = (iso: string) => { onChange(iso); setOpen(false); };
  const shiftMonth = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1, 12));

  return (
    <div className={cx('date-field', className)} ref={wrap}>
      {/* A real text input rather than a button, so `required` still takes
          part in native form validation. The value only ever comes from the
          calendar, so typing into it is inert. */}
      <input
        id={id}
        type="text"
        className={cx(inputClassName, 'date-field-trigger')}
        value={value ? displayDay(value) : ''}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${popId}`}
        autoComplete="off"
        inputMode="none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (e.key === 'Tab') return;
          e.preventDefault();
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') setOpen(true);
          if (e.key === 'Backspace' || e.key === 'Delete') onChange('');
        }}
        onMouseDown={() => { if (!disabled) setOpen((o) => !o); }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onChange={() => {}}
      />
      <span className="date-field-icon" aria-hidden="true">▦</span>
      {open && (
        <div className="date-pop" id={popId} role="dialog" aria-label={ariaLabel ?? 'Choose a date'}>
          <div className="date-pop-head">
            <button type="button" className="date-pop-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <div className="date-pop-month">{MONTHS[month.getMonth()]} {month.getFullYear()}</div>
            <button type="button" className="date-pop-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className="date-pop-grid" role="grid">
            {WEEKDAYS.map((w) => <span key={w} className="date-pop-dow">{w}</span>)}
            {days.map((d) => {
              const iso = isoDay(d);
              const disabled = (!!min && iso < min) || (!!max && iso > max);
              return (
                <button
                  key={iso}
                  type="button"
                  className={cx(
                    'date-pop-day',
                    d.getMonth() !== month.getMonth() && 'is-outside',
                    iso === value && 'is-selected',
                    iso === today && iso !== value && 'is-today',
                  )}
                  disabled={disabled}
                  aria-pressed={iso === value}
                  onClick={() => pick(iso)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="date-pop-link" onClick={() => pick('')}>Clear</button>
            <button type="button" className="date-pop-link" onClick={() => pick(today)}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A FROM/TO pair of dates.
 *
 * Both bounds are plain `YYYY-MM-DD` strings and stay that way: turning them
 * into `Date` objects here is what introduces the timezone bug, because
 * `new Date('2026-09-01')` is midnight *UTC*, which is the previous evening
 * for anyone west of Greenwich. Comparison happens on the strings via
 * `withinDateRange`, which is exact for every timezone.
 */
export function DateRangeFilter({
  label, from, to, onChange, id,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  id?: string;
}) {
  const auto = useId();
  const base = id ?? auto;
  return (
    <div className="filter-field filter-field--range">
      <span className="field-label">{label}</span>
      <div className="date-range">
        <label className="date-range-sep" htmlFor={`${base}-from`}>FROM</label>
        <DateField
          id={`${base}-from`}
          ariaLabel={`${label} from`}
          value={from}
          max={to || undefined}
          onChange={(next) => onChange({ from: next, to })}
        />
        <label className="date-range-sep" htmlFor={`${base}-to`}>TO</label>
        <DateField
          id={`${base}-to`}
          ariaLabel={`${label} to`}
          value={to}
          min={from || undefined}
          onChange={(next) => onChange({ from, to: next })}
        />
      </div>
    </div>
  );
}

/**
 * Whether an ISO timestamp falls inside a `YYYY-MM-DD` range, inclusive at
 * both ends.
 *
 * The instant is reduced to the calendar day it happened on *in the reader's
 * own timezone* and then compared as text. That is what makes a same-day range
 * work — from and to both being 2026-09-15 keeps everything due on the 15th,
 * where a naive `>= new Date(from) && <= new Date(to)` keeps only something
 * due at exactly midnight.
 */
export function withinDateRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** The wrapping row filters sit in. Grid, so nothing can overflow a phone. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="filter-bar">
      {children}
      {actions && <div className="filter-field" style={{ justifyContent: 'flex-end' }}>{actions}</div>}
    </div>
  );
}
