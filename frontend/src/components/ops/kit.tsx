'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, Field, Modal, Pill, SkeletonRows, cx, rupees } from '@/components/ui';
import { errorMessage, fileHref } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import type { Attachment, HistoryEntry, KpiDto } from '@/lib/ops-types';

/**
 * Shared building blocks for the institution-operations screens. One status
 * vocabulary, one way of showing a number with its definition and freshness,
 * one way of asking for a reason — so every department screen reads alike.
 */

// ── formatting ─────────────────────────────────────────────────────────

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const money = (paise: number | null | undefined) => (paise === null || paise === undefined ? '—' : rupees(paise));
export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
/** `YYYY-MM-DD` for date inputs, in India time. */
export const isoDay = (d: Date = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const rupeesToPaise = (v: string) => Math.round(Number(String(v).replace(/,/g, '')) * 100);

// ── status ─────────────────────────────────────────────────────────────

type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'maroon';
const TONES: Record<string, Tone> = {
  APPROVED: 'green', CLEARED: 'green', CLOSED: 'gray', PUBLISHED: 'green', ACTIVE: 'green', VALID: 'green', DONE: 'green', COMPLETED: 'green',
  PAID: 'green', PAYMENT_CONFIRMED: 'green', ACCEPTED: 'green', ENROLLED: 'green', CONFIRMED: 'green', RESOLVED: 'green', APPLICABLE: 'blue', ACTIONED: 'green',
  SUBMITTED: 'blue', SCHEDULED: 'blue', IN_PROGRESS: 'blue', IN_REVIEW: 'blue', ASSIGNED: 'blue', LIVE: 'blue', PO_ISSUED: 'blue', OFFERED: 'blue', HELD: 'blue', DISPATCHED: 'blue', ACKNOWLEDGED: 'blue',
  PENDING: 'amber', PENDING_REVIEW: 'amber', AWAITING_APPROVAL: 'amber', AWAITING_DECISION: 'amber', IN_APPROVAL: 'amber', PENDING_APPROVAL: 'amber', REQUESTED: 'amber', UNDER_REVIEW: 'amber', EXPIRING: 'amber', RETURNED: 'amber', WAITLISTED: 'amber', HR_REVIEW: 'amber', RESUBMISSION_REQUIRED: 'amber', DRAFT: 'gray', PROPOSED: 'gray', NEW: 'amber', RECEIVED: 'amber', OPEN: 'amber', CALCULATED: 'amber', PLANNING: 'gray', INVITED: 'gray',
  REJECTED: 'red', NOT_CLEARED: 'red', EXPIRED: 'red', OVERDUE: 'red', FAILED: 'red', CANCELLED: 'gray', WITHDRAWN: 'gray', TAKEN_DOWN: 'red', BLOCKED: 'red', ADVERSE: 'red', DISPUTED: 'maroon', NOT_APPLICABLE: 'gray', SKIPPED_NO_CONSENT: 'gray', SIMULATED: 'gray',
};
export function StatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Pill tone="gray">—</Pill>;
  return <Pill tone={TONES[status] ?? 'gray'}>{label ?? humanize(status)}</Pill>;
}

// ── KPIs ───────────────────────────────────────────────────────────────

export function formatKpi(k: Pick<KpiDto, 'value' | 'unit' | 'status'>): string {
  if (k.status === 'NOT_APPLICABLE') return 'n/a';
  if (k.status === 'UNAVAILABLE' || k.value === null || k.value === undefined) return 'No data';
  if (k.unit === 'paise') return rupees(Number(k.value));
  if (k.unit === 'percent') return `${k.value}%`;
  if (k.unit === 'hours') return `${k.value} h`;
  if (k.unit === 'status') return humanize(String(k.value));
  return Number(k.value).toLocaleString('en-IN');
}

/**
 * A number with its meaning attached: the definition is one tap away, the
 * time it was computed is shown, and "No data" is never rendered as 0.
 */
export function Kpi({ k }: { k: KpiDto }) {
  const link = useSchoolHref();
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <div className="kpi-label">{k.label}</div>
      <div className={cx('kpi-value', `tone-${k.status === 'OK' ? k.tone : 'neutral'}`, k.status !== 'OK' && 'is-muted')}>{formatKpi(k)}</div>
    </>
  );
  return (
    <div className={cx('kpi', `kpi-${k.status === 'OK' ? k.tone : 'neutral'}`)}>
      {k.link ? <Link href={link(k.link)} className="kpi-main">{body}</Link> : <div className="kpi-main">{body}</div>}
      <button type="button" className="kpi-info" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`How "${k.label}" is calculated`}>i</button>
      {open && (
        <div className="kpi-def" role="note">
          <p>{k.definition}</p>
          <p className="kpi-meta">Source: {k.source} · computed {fmtDateTime(k.asOf)}{k.status !== 'OK' ? ` · ${humanize(k.status)}` : ''}</p>
        </div>
      )}
    </div>
  );
}

export function KpiGrid({ kpis }: { kpis: KpiDto[] }) {
  if (!kpis.length) return null;
  return <div className="kpi-grid">{kpis.map((k) => <Kpi key={k.key} k={k} />)}</div>;
}

/** A small numeric tile when there is no server KPI definition to show. */
export function Tile({ label, value, tone = 'neutral', href }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral'; href?: string }) {
  const link = useSchoolHref();
  const body = (<><div className="kpi-label">{label}</div><div className={cx('kpi-value', `tone-${tone}`)}>{value}</div></>);
  return <div className={cx('kpi', `kpi-${tone}`)}>{href ? <Link href={link(href)} className="kpi-main">{body}</Link> : <div className="kpi-main">{body}</div>}</div>;
}

// ── layout ─────────────────────────────────────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ key: T; label: string; count?: number | null }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="ops-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={cx('ops-tab', value === t.key && 'is-on')} onClick={() => onChange(t.key)}>
          {t.label}{t.count ? <span className="ops-tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SectionCard({ title, actions, children, sub }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card className="ops-section">
      <div className="ops-section-head">
        <div><h2 className="ops-section-title">{title}</h2>{sub && <p className="ops-section-sub">{sub}</p>}</div>
        {actions && <div className="ops-section-actions">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function KeyValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="ops-kv">
      {rows.filter(([, v]) => v !== undefined).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>))}
    </dl>
  );
}

export function Timeline({ items }: { items?: HistoryEntry[] }) {
  if (!items?.length) return <p className="ops-muted">No history yet.</p>;
  return (
    <ol className="ops-timeline">
      {[...items].reverse().map((h, i) => (
        <li key={i}>
          <span className="ops-tl-dot" aria-hidden="true" />
          <div>
            <div className="ops-tl-head"><b>{humanize(h.action)}</b>{h.actorName && <> · {h.actorName}</>}</div>
            <div className="ops-tl-meta">{fmtDateTime(h.at)}{h.from && h.to ? ` · ${humanize(h.from)} → ${humanize(h.to)}` : ''}</div>
            {h.note && <div className="ops-tl-note">{h.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Attachments({ items }: { items?: Attachment[] }) {
  if (!items?.length) return <span className="ops-muted">None</span>;
  return (
    <ul className="ops-attachments">
      {items.map((a, i) => <li key={i}><a href={fileHref(a.url)} target="_blank" rel="noreferrer">📎 {a.name}</a></li>)}
    </ul>
  );
}

/** A labelled step indicator for a record's lifecycle (Vid 3's shipment tracker, for school records). */
export function Stepper({ steps, current, failed }: { steps: Array<{ key: string; label: string }>; current: string; failed?: boolean }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="ops-stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.key} className={cx(i < idx && 'is-done', i === idx && (failed ? 'is-failed' : 'is-current'))} aria-current={i === idx ? 'step' : undefined}>
          <span className="ops-step-dot">{i < idx ? '✓' : i + 1}</span>
          <span className="ops-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// ── data loading ───────────────────────────────────────────────────────

/** Loads data; `reload()` refreshes; errors are kept for display, never thrown at the page. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const out = await fn();
      if (mine === seq.current) { setData(out); setError(null); }
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err, 'Could not load.'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export function Loadable<T>({ state, children, empty }: { state: { data: T | null; error: string | null; loading: boolean }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (state.error) return <p className="ops-error" role="alert">⚠ {state.error}</p>;
  if (state.loading && state.data === null) return <Card><SkeletonRows rows={4} /></Card>;
  if (state.data === null) return <>{empty ?? null}</>;
  return <>{children(state.data)}</>;
}

export function useQueryParam(name: string): string | null {
  const params = useSearchParams();
  return params?.get(name) ?? null;
}

// ── actions ────────────────────────────────────────────────────────────

/**
 * Runs a mutation with a busy flag and inline error; prevents double submits.
 * Returns [run, busy, error, clearError].
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true); setError(null);
    try { return await fn(); } catch (err) { setError(errorMessage(err, 'That did not work.')); return undefined; } finally { lock.current = false; setBusy(false); }
  }, []);
  return { run, busy, error, clearError: () => setError(null) };
}

/** A small modal that asks for text (a reason, a reference) before acting. */
export function PromptModal({
  title, label, hint, required = true, multiline = true, confirmLabel = 'Confirm', danger, onSubmit, onClose, extra,
}: {
  title: string; label: string; hint?: string; required?: boolean; multiline?: boolean; confirmLabel?: string; danger?: boolean;
  onSubmit: (value: string) => Promise<unknown>; onClose: () => void; extra?: ReactNode;
}) {
  const [value, setValue] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button className={danger ? 'btn-danger' : undefined} disabled={busy || (required && !value.trim())} onClick={() => void run(async () => { await onSubmit(value.trim()); onClose(); })}>{busy ? 'Working…' : confirmLabel}</Button>
    </>}>
      {extra}
      <Field label={label} hint={hint} required={required}>
        {multiline ? <textarea className="input" rows={4} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
          : <input className="input" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />}
      </Field>
      {error && <p className="ops-error" role="alert">⚠ {error}</p>}
    </Modal>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="ops-error" role="alert">⚠ {error}</p> : null;
}

/** An honest label for where a number or a picture comes from. */
export function DataNote({ children }: { children: ReactNode }) {
  return <p className="ops-data-note"><span aria-hidden="true">ⓘ</span> {children}</p>;
}
