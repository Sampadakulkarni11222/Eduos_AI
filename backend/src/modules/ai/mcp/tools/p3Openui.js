import { askDashboard } from '../../../genui/ask.service.js';
import * as panels from '../../../genui/panels.service.js';
import { GENUI_SURFACES } from '../../../../models/genUiPanel.model.js';
import { AI_ASSISTANT_PERMISSION } from '../../../../constants/permissions.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, rupees } from './_shared.js';

/**
 * "Ask your dashboard" through the assistant (generated panels).
 *
 *   build_dashboard_panel   "compare fee collection this year with last year by month" -- the
 *                           figures in words, and on the website the same generated panel the
 *                           Analytics page and dashboards show.
 *   list_pinned_panels      the panels the caller pinned.
 *   pin_dashboard_panel     pin a question to the Analytics page or the dashboard (confirmed).
 *   unpin_dashboard_panel   remove a pinned panel (confirmed).
 *
 * The figures come from askDashboard(), which reads the analytics workspace at
 * the caller's own scope or their own role dashboard -- the same sources and
 * rules as the screens. A pin is only the caller's own saved question.
 */

const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const question = { type: 'string', minLength: 3, maxLength: 300, description: 'What to show, in words, e.g. "attendance for 7B this term"' };
const surface = { type: 'string', enum: GENUI_SURFACES, description: 'analytics (the Analytics page) or dashboard (the home dashboard); default analytics' };

const figure = (v, unit) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'not available';
  if (unit === 'paise') return rupees(v);
  if (unit === 'percent') return `${Math.round(v * 10) / 10}%`;
  return v.toLocaleString('en-IN');
};

/** The panel's figures as one sentence per measure (WhatsApp and the text answer). */
function sentenceOf(built) {
  if (built.source === 'analytics' && Array.isArray(built.data)) {
    const p = built.plan;
    return built.data.map((d) => `${d.metric}: ${figure(d.current, d.unit)} (${p.period.label}${p.class ? `, ${p.class}` : ''})${p.comparison ? ` against ${figure(d.comparison, d.unit)} (${p.comparison.label.toLowerCase()})` : ''}.`).join(' ');
  }
  if (built.source === 'dashboard' && Array.isArray(built.data)) {
    return built.data.map((x) => (x.label !== undefined && 'value' in x ? `${x.label}: ${figure(x.value, x.unit)}.` : `${x.title}: ${(x.items?.length ?? x.points?.length ?? 0)} item(s).`)).join(' ');
  }
  return 'I could not find a figure for that in what you can see.';
}

async function pinnedNamed(ctx, words) {
  const all = [];
  for (const s of GENUI_SURFACES) all.push(...(await panels.list(ctx.actor, { surface: s })).items);
  const w = String(words ?? '').trim().toLowerCase();
  const hits = w ? all.filter((p) => p.title.toLowerCase().includes(w) || p.prompt.toLowerCase().includes(w)) : all;
  if (!hits.length) throw new AppError(w ? `You have no pinned panel matching "${words}".` : 'You have no pinned panels.', 404, [], 'NOT_FOUND');
  if (hits.length > 1) throw new AppError(`Which one — ${hits.map((p) => `"${p.title}"`).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  return hits[0];
}

export const openuiTools = {
  build_dashboard_panel: {
    module: 'Analytics', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'Builds a dashboard panel for a question in words — "compare fee collection this year with last year by month", "show attendance for 7B this term", "my child\'s homework" — from the analytics workspace (within the caller\'s own departments or classes) or the caller\'s own dashboard. Returns the figures with their period and comparison; the website shows them as a chart panel. Read-only.',
    inputSchema: closed({ question }, ['question']),
    permission: AI_ASSISTANT_PERMISSION,
    service: 'genui/ask.service.askDashboard()',
    async run(ctx, args) {
      const built = await askDashboard(ctx.actor, { prompt: args.question });
      const speak = sentenceOf(built);
      return ok({ title: built.title, source: built.source, plan: built.plan, figures: built.data ?? [], panel: built.ui ?? null }, { speak });
    },
  },

  list_pinned_panels: {
    module: 'Analytics', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The generated panels the caller has pinned to their Analytics page and dashboard. Read-only.',
    inputSchema: closed({}),
    permission: AI_ASSISTANT_PERMISSION,
    service: 'genui/panels.service.list()',
    async run(ctx) {
      const rows = [];
      for (const s of GENUI_SURFACES) rows.push(...(await panels.list(ctx.actor, { surface: s })).items.map((p) => ({ title: p.title, question: p.prompt, surface: p.surface })));
      return ok({ panels: rows, count: rows.length }, { speak: rows.length ? `Pinned panels: ${rows.map((r) => `"${r.title}" (${r.surface})`).join(', ')}.` : 'You have no pinned panels.' });
    },
  },

  pin_dashboard_panel: {
    module: 'Analytics', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Pins a question as a panel on the caller\'s own Analytics page or dashboard, rebuilt from live figures each time it is shown, e.g. "pin fee collection this year by month to my analytics". Only the caller sees it. Needs confirmation.',
    inputSchema: closed({ question, surface, title: { type: 'string', maxLength: 120 } }, ['question']),
    permission: AI_ASSISTANT_PERMISSION,
    service: 'genui/panels.service.pin()',
    summarise: (args) => `Pin "${args.title ?? args.question}" to your ${args.surface === 'dashboard' ? 'dashboard' : 'Analytics page'}`,
    async run(ctx, args) {
      const p = await panels.pin(ctx.actor, { surface: args.surface ?? 'analytics', prompt: args.question, title: args.title });
      return action({ type: 'panel_pinned', id: p.id, data: p, speak: `Pinned "${p.title}" to your ${p.surface === 'dashboard' ? 'dashboard' : 'Analytics page'}.` });
    },
  },

  unpin_dashboard_panel: {
    module: 'Analytics', operation: 'DELETE', risk: RISK.LOW, confirm: true,
    description: 'Removes one of the caller\'s pinned panels, named by its title or question. Needs confirmation.',
    inputSchema: closed({ title: { type: 'string', minLength: 2, maxLength: 120, description: 'Words from the panel\'s title or question' } }, ['title']),
    permission: AI_ASSISTANT_PERMISSION,
    service: 'genui/panels.service.unpin()',
    async prepare(ctx, args) {
      const p = await pinnedNamed(ctx, args.title);
      return { id: p.id, title: p.title, surface: p.surface };
    },
    summarise: (args, _a, p) => `Unpin "${p?.title ?? args.title}" from your ${p?.surface === 'dashboard' ? 'dashboard' : 'Analytics page'}`,
    async run(ctx, args, p) {
      const target = p ?? (await pinnedNamed(ctx, args.title));
      await panels.unpin(ctx.actor, target.id);
      return action({ type: 'panel_unpinned', id: target.id, speak: `Unpinned "${target.title}".` });
    },
  },
};
