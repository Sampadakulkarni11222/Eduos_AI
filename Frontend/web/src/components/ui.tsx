'use client';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';

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
