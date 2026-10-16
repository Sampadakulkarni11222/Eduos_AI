'use client';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { z } from 'zod';
import { usePortalHref } from '@/lib/school-path';
import { isElement, parseProgram, safeHref, type UiElement, type UiValue } from '@/lib/genui/parse';
import type { DashChartDto, DashPoint } from '@/lib/dashboard-api';
import { DashChart, fmtDash } from '@/components/ops/dash-charts';
import { EvidenceFooter } from '@/components/evidence-footer';

/**
 * The registered component library for generated UI (OpenUI Lang), and its
 * renderer.
 *
 * Only the components below render. Each call's positional arguments are
 * mapped to named props and validated with Zod before anything is drawn; a
 * call that is not registered or does not validate is dropped (and counted),
 * never shown raw. Nothing here renders HTML from a string: every value is a
 * React text node or goes through our own chart and kit components. Links are
 * only paths inside the app or allowlisted https hosts. An action card never
 * acts: it opens the assistant with a question pre-filled, and the
 * assistant's own draft-and-confirm flow does the rest.
 *
 * The names and argument order are the contract with the server
 * (backend/src/modules/genui/lang.js COMPONENTS).
 */

export interface GenUi { format: 'openui-lang'; version?: string; program: string; by?: 'code' | 'model' }

/** Fired by an ActionCard; the assistant opens with the text in its input (not sent). */
import { ASK_EVENT } from './ask-event';
export { ASK_EVENT };

const MAX = { text: 400, label: 120, cells: 200, rows: 200, cols: 8, points: 120 };
const str = (max: number) => z.string().transform((s) => s.slice(0, max));
const optStr = (max: number) => z.string().transform((s) => s.slice(0, max)).nullish().transform((v) => v ?? undefined);
const unit = z.enum(['count', 'percent', 'paise', 'days']).nullish().catch(null).transform((v) => v ?? 'count');
const tone = z.enum(['good', 'warn', 'bad', 'neutral']).nullish().catch(null).transform((v) => v ?? 'neutral');
const num = z.number().finite().nullable();
const href = z.unknown().transform((v) => safeHref(v) ?? undefined);

type Def = { args: string[]; schema: z.ZodTypeAny };

/** Leaf components that only appear inside another one. */
const LEAVES: Record<string, Def> = {
  Series: { args: ['label', 'values'], schema: z.object({ label: str(MAX.label), values: z.array(num.catch(null)).max(MAX.points) }) },
  Slice: { args: ['label', 'value'], schema: z.object({ label: str(MAX.label), value: z.number().finite().min(0) }) },
  Record: { args: ['text', 'sub', 'href', 'badge'], schema: z.object({ text: str(MAX.text), sub: optStr(MAX.text), href, badge: optStr(40) }) },
  Event: { args: ['at', 'title', 'note'], schema: z.object({ at: str(30), title: str(MAX.text), note: optStr(MAX.text) }) },
  Source: { args: ['text', 'href'], schema: z.object({ text: str(MAX.text), href }) },
};

/** Props of an element of a given leaf type, or null when it is anything else or invalid. */
function leafProps<T>(name: string, v: unknown): T | null {
  if (!isElement(v) || v.$el !== name || !LEAVES[name]) return null;
  return propsOf<T>(v, LEAVES[name]);
}
const children = <T,>(name: string, max: number) => z.array(z.unknown()).transform((arr) => arr.slice(0, max).map((x) => leafProps<T>(name, x)).filter((x): x is T => x !== null));

function propsOf<T>(el: UiElement, def: Def): T | null {
  if (el.args.length > def.args.length) return null;
  const obj: Record<string, unknown> = {};
  def.args.forEach((a, i) => { obj[a] = el.args[i] ?? undefined; });
  const parsed = def.schema.safeParse(obj);
  return parsed.success ? (parsed.data as T) : null;
}

type SeriesP = { label: string; values: Array<number | null> };
type SliceP = { label: string; value: number };
type RecordP = { text: string; sub?: string; href?: ReturnType<typeof safeHref>; badge?: string };
type EventP = { at: string; title: string; note?: string };
type SourceP = { text: string; href?: ReturnType<typeof safeHref> };

const chartSchema = z.object({ title: str(MAX.label), labels: z.array(z.union([z.string(), z.number()]).transform(String)).max(MAX.points), series: children<SeriesP>('Series', 2), unit, href });

const kpiS = z.object({ label: str(MAX.label), value: num, unit, detail: optStr(MAX.text), tone, href });
const cmpS = z.object({ label: str(MAX.label), current: num, previous: num, unit, currentLabel: optStr(MAX.label), previousLabel: optStr(MAX.label), href });
const donutS = z.object({ title: str(MAX.label), slices: children<SliceP>('Slice', 24), unit });
const tableS = z.object({
  title: str(MAX.label),
  columns: z.array(str(MAX.label)).min(1).max(MAX.cols),
  rows: z.array(z.array(z.union([z.string().transform((s) => s.slice(0, MAX.cells)), z.number().finite(), z.null()]).catch(null)).max(MAX.cols)).max(MAX.rows),
  units: z.array(z.enum(['count', 'percent', 'paise', 'days']).nullable().catch(null)).max(MAX.cols).nullish().transform((v) => v ?? []),
});
const listS = z.object({ title: str(MAX.label), items: children<RecordP>('Record', MAX.rows) });
const tlS = z.object({ title: str(MAX.label), events: children<EventP>('Event', 60) });
const actionS = z.object({ title: str(MAX.label), detail: optStr(MAX.text), ask: optStr(300), href });
const calloutS = z.object({ tone: z.enum(['info', 'good', 'warn', 'bad']).catch('info'), text: str(MAX.text) });
const evS = z.object({ items: children<SourceP>('Source', 12) });

/** The blocks a Panel may hold. */
export const BLOCKS: Record<string, Def> = {
  Kpi: { args: ['label', 'value', 'unit', 'detail', 'tone', 'href'], schema: kpiS },
  MetricCompare: { args: ['label', 'current', 'previous', 'unit', 'currentLabel', 'previousLabel', 'href'], schema: cmpS },
  LineChart: { args: ['title', 'labels', 'series', 'unit', 'href'], schema: chartSchema },
  BarChart: { args: ['title', 'labels', 'series', 'unit', 'href'], schema: chartSchema },
  DonutChart: { args: ['title', 'slices', 'unit'], schema: donutS },
  Table: { args: ['title', 'columns', 'rows', 'units'], schema: tableS },
  RecordList: { args: ['title', 'items'], schema: listS },
  Timeline: { args: ['title', 'events'], schema: tlS },
  ActionCard: { args: ['title', 'detail', 'ask', 'href'], schema: actionS },
  Callout: { args: ['tone', 'text'], schema: calloutS },
  Evidence: { args: ['items'], schema: evS },
};
const PANEL: Def = { args: ['title', 'children', 'subtitle'], schema: z.object({ title: str(MAX.label), children: z.array(z.unknown()).max(40), subtitle: optStr(MAX.label) }) };

/** Every registered component name (kept equal to the server's list by a test). */
export const REGISTERED = ['Panel', ...Object.keys(BLOCKS), ...Object.keys(LEAVES)];

/* ── rendering ─────────────────────────────────────────── */

function useLink() {
  const portal = usePortalHref();
  return function renderLink(h: ReturnType<typeof safeHref> | undefined, body: ReactNode, className?: string) {
    if (!h) return <span className={className}>{body}</span>;
    return h.internal
      ? <Link href={portal(h.href)} className={className}>{body}</Link>
      : <a href={h.href} className={className} target="_blank" rel="noopener noreferrer nofollow">{body}</a>;
  };
}

function chartDto(type: DashChartDto['type'], p: z.infer<typeof chartSchema>, key: string): DashChartDto {
  const [main, cmp] = p.series;
  const points: DashPoint[] = p.labels.map((label, i) => ({ label, value: main?.values[i] ?? null }));
  return {
    key, title: p.title, type, unit: p.unit as DashChartDto['unit'], link: p.href?.internal ? p.href.href : null, definition: '', points,
    compare: cmp ? { label: cmp.label, points: p.labels.map((label, i) => ({ label, value: cmp.values[i] ?? null })) } : null,
    status: 'OK', emptyText: 'No figures for this period.',
  };
}

function Block({ el, idx, onAsk }: { el: UiElement; idx: number; onAsk?: (text: string) => void }) {
  const link = useLink();
  const def = BLOCKS[el.$el];
  if (!def) return null;
  const p = propsOf<Record<string, never>>(el, def) as unknown as Record<string, unknown> | null;
  if (!p) return null;
  const key = `g${idx}`;
  switch (el.$el) {
    case 'Kpi': {
      const k = p as unknown as z.infer<typeof kpiS>;
      return (
        <div className={`kpi kpi-${k.tone} genui-kpi`}>
          {link(k.href, <><div className="kpi-label">{k.label}</div><div className={`kpi-value tone-${k.tone}`}>{fmtDash(k.unit, k.value)}</div></>, 'kpi-main')}
          {k.detail && <div className="genui-detail">{k.detail}</div>}
        </div>
      );
    }
    case 'MetricCompare': {
      const m = p as unknown as z.infer<typeof cmpS>;
      const diff = m.current !== null && m.previous !== null ? m.current - m.previous : null;
      const pct = diff !== null && m.previous ? Math.round((diff / Math.abs(m.previous)) * 1000) / 10 : null;
      return (
        <div className="kpi genui-kpi genui-compare">
          {link(m.href, <><div className="kpi-label">{m.label}</div><div className="kpi-value">{fmtDash(m.unit, m.current)}</div></>, 'kpi-main')}
          <div className="genui-detail">
            {m.currentLabel && <span>{m.currentLabel} · </span>}
            {diff !== null && diff !== 0 && <b className={diff > 0 ? 'genui-up' : 'genui-down'}>{diff > 0 ? '▲' : '▼'} {fmtDash(m.unit, Math.abs(diff))}{pct !== null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} </b>}
            <span>vs {fmtDash(m.unit, m.previous)}{m.previousLabel ? ` (${m.previousLabel.toLowerCase()})` : ''}</span>
          </div>
        </div>
      );
    }
    case 'LineChart': case 'BarChart':
      return <div className="genui-wide"><DashChart c={chartDto(el.$el === 'LineChart' ? 'line' : 'bar', p as unknown as z.infer<typeof chartSchema>, key)} /></div>;
    case 'DonutChart': {
      const d = p as unknown as z.infer<typeof donutS>;
      return <div className="genui-wide"><DashChart c={{ key, title: d.title, type: 'donut', unit: d.unit as DashChartDto['unit'], link: null, definition: '', points: d.slices.map((s) => ({ label: s.label, value: s.value })), status: 'OK', emptyText: 'Nothing to show.' }} /></div>;
    }
    case 'Table': {
      const t = p as unknown as z.infer<typeof tableS>;
      return (
        <div className="genui-wide an-table-wrap">
          <table className="an-table">
            <caption className="genui-caption">{t.title}</caption>
            <thead><tr>{t.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, i) => (
              <tr key={i}>{t.columns.map((_, j) => {
                const v = r[j] ?? null;
                const cell = typeof v === 'number' ? fmtDash(t.units[j] ?? 'count', v) : (v ?? '—');
                return j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    }
    case 'RecordList': {
      const l = p as unknown as z.infer<typeof listS>;
      return (
        <section className="genui-wide genui-list" aria-label={l.title}>
          <h4 className="genui-h">{l.title}</h4>
          {!l.items.length ? <p className="ops-muted">Nothing here.</p> : (
            <ul>{l.items.map((r, i) => <li key={i}>{link(r.href ?? undefined, <><span className="genui-rec">{r.text}</span>{r.sub && <span className="genui-sub">{r.sub}</span>}</>, 'genui-row')}{r.badge && <span className="pill gray">{r.badge}</span>}</li>)}</ul>
          )}
        </section>
      );
    }
    case 'Timeline': {
      const t = p as unknown as z.infer<typeof tlS>;
      return (
        <section className="genui-wide" aria-label={t.title}>
          <h4 className="genui-h">{t.title}</h4>
          <ol className="ops-timeline">{t.events.map((e, i) => (
            <li key={i}><span className="ops-tl-dot" aria-hidden="true" /><div><div className="ops-tl-head"><b>{e.title}</b></div><div className="ops-tl-meta">{e.at}</div>{e.note && <div className="ops-tl-note">{e.note}</div>}</div></li>
          ))}</ol>
        </section>
      );
    }
    case 'ActionCard': {
      const a = p as unknown as z.infer<typeof actionS>;
      return (
        <div className="genui-wide genui-action">
          <div><b>{a.title}</b>{a.detail && <p className="genui-sub">{a.detail}</p>}</div>
          <div className="genui-action-btns">
            {a.ask && <button type="button" className="btn btn-soft btn-sm" onClick={() => (onAsk ? onAsk(a.ask as string) : window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { text: a.ask } })))}>Draft with the assistant</button>}
            {a.href && link(a.href, 'Open', 'btn btn-soft btn-sm')}
          </div>
        </div>
      );
    }
    case 'Callout': {
      const c = p as unknown as z.infer<typeof calloutS>;
      return <div className={`genui-wide genui-callout is-${c.tone}`} role={c.tone === 'warn' || c.tone === 'bad' ? 'alert' : 'note'}>{c.text}</div>;
    }
    case 'Evidence': {
      const e = p as unknown as z.infer<typeof evS>;
      // Only internal links reach the evidence footer (it links within the portal).
      return <div className="genui-wide"><EvidenceFooter items={e.items.map((s) => ({ text: s.text, link: s.href?.internal ? s.href.href : null }))} /></div>;
    }
    default: return null;
  }
}

export interface RenderOutcome { rendered: number; dropped: number; errors: string[] }

/** Parses and checks a program: which blocks render, which are dropped. */
export function inspectProgram(program: string): { title: string; subtitle?: string; blocks: UiElement[]; outcome: RenderOutcome } | null {
  const { root, errors } = parseProgram(program);
  if (!isElement(root) || root.$el !== 'Panel') return null;
  const panel = propsOf<{ title: string; children: UiValue[]; subtitle?: string }>(root, PANEL);
  if (!panel) return null;
  const blocks: UiElement[] = []; let dropped = 0;
  for (const c of panel.children) {
    if (isElement(c) && BLOCKS[c.$el] && propsOf(c, BLOCKS[c.$el])) blocks.push(c);
    else dropped += 1;
  }
  return { title: panel.title, subtitle: panel.subtitle, blocks, outcome: { rendered: blocks.length, dropped, errors } };
}

/**
 * Renders a generated panel. Returns `fallback` (the plain-text answer) when
 * the program does not parse or nothing in it is a registered, valid block.
 */
export function GenUiPanel({ ui, fallback = null, onAsk, actions, compact = false }: { ui: GenUi | null | undefined; fallback?: ReactNode; onAsk?: (text: string) => void; actions?: ReactNode; compact?: boolean }) {
  const inspected = useMemo(() => (ui?.format === 'openui-lang' && typeof ui.program === 'string' ? inspectProgram(ui.program) : null), [ui]);
  if (!inspected || !inspected.blocks.length) return <>{fallback}</>;
  return (
    <section className={`genui-panel${compact ? ' is-compact' : ''}`} aria-label={inspected.title} data-genui-by={ui?.by ?? 'code'}>
      <div className="genui-head">
        <div>
          <h3 className="genui-title">{inspected.title}</h3>
          {inspected.subtitle && <p className="genui-subtitle">{inspected.subtitle}</p>}
        </div>
        {actions && <div className="genui-head-actions">{actions}</div>}
      </div>
      <div className="genui-grid">
        {inspected.blocks.map((b, i) => <Block key={i} el={b} idx={i} onAsk={onAsk} />)}
      </div>
    </section>
  );
}
