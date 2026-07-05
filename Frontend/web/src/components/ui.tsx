'use client';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

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

export function rupees(paise: number | null | undefined): string {
  const safePaise = Number(paise) || 0;
  const amount = safePaise / 100;
  const hasDecimals = amount % 1 !== 0;
  return '₹' + amount.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
