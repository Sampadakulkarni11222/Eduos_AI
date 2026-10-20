import { AppError } from '../../../../../utils/AppError.js';
import { featureEnabled } from '../../../../../utils/features.js';
import { FEATURES } from '../../../../../constants/features.js';
import { istYmd, istHm } from '../../../../ptm/relations.js';
import { ok, action } from '../../protocol.js';
import { RISK, summarise, dateStr, objectId } from '../_shared.js';

/**
 * Shared building blocks for the part-6 coverage tools (tools/p6/*.js).
 *
 * The coverage map (docs/erp-operations/ASSISTANT-COVERAGE-MAP.md) matched
 * every API route to the assistant tools that perform it; these files close
 * the routes that had none. Each tool is the route's own service call with
 * the route's own guard:
 *
 *   permission/minScope  the route's requirePermission (the scope the service
 *                        receives is the caller's scope for that key, exactly
 *                        what req.scope would be)
 *   need()/needAny()     the route's other guards (a second requirePermission,
 *                        requireAnyOf), checked before anything is read
 *   forRoles             the route's requireRole
 *   feature              the route's requireFeature
 *
 * Writes are drafts (`confirm`), described by `summarise`, and run only when
 * the same person confirms on the same channel; anything HIGH risk or landing
 * on other people's records is `affectsOthers` and so confirmed on the
 * website only (registry.confirmableOn). Decisions are `approverDecision`
 * tools: the approver states the decision (a required argument with no
 * default), it is HIGH risk and website-confirmed, and the service checks the
 * approver exactly as it does for the screen.
 */

export { RISK, ok, action, dateStr, objectId, AppError };

export const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
export const int = (min, max, description) => ({ type: 'integer', minimum: min, maximum: max, ...(description && { description }) });
export const num = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description && { description }) });
export const bool = (description) => ({ type: 'boolean', ...(description && { description }) });
export const oneOf = (values, description) => ({ type: 'string', enum: values, ...(description && { description }) });
export const list = (items, max = 50, description) => ({ type: 'array', items, maxItems: max, ...(description && { description }) });
export const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
export const HM = '^([01]\\d|2[0-3]):[0-5]\\d$';
export const hm = (description) => ({ type: 'string', pattern: HM, ...(description && { description }) });

export const ask = (message) => new AppError(message, 400, [], 'AGENT_NEEDS_INPUT');
export const notFound = (message) => new AppError(message, 404, [], 'NOT_FOUND');
export const forbidden = (message) => new AppError(message, 403, [], 'FORBIDDEN');

export const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? out?.rows ?? []);
export const lower = (s) => String(s ?? '').trim().toLowerCase();
export const words = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
export const day = (d) => (d ? istYmd(d) : null);
export const time = (d) => (d ? istHm(d) : null);
export const idOf = (r) => String(r?.id ?? r?._id ?? '');
export const todayIst = () => istYmd(new Date());
export const istAt = (date, hhmm = '00:00') => new Date(`${date}T${hhmm}:00+05:30`);
export const stripTitle = (s) => String(s ?? '').replace(/^\s*(?:the|mr|mrs|ms|miss|dr|sir|madam|mx|shri|smt)\.?\s+/i, '').trim();
export const excerpt = (s, n = 120) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** Whole rupees (or rupees and paise) as paise. */
export function paiseOf(amount, label = 'amount') {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(`${label} must be more than zero.`, 400);
  return Math.round(n * 100);
}

/** The route's other requirePermission guards. */
export function need(ctx, key, minScope = null) {
  const s = ctx.actor?.permissions?.[key];
  if (!s || (minScope === 'ALL' && s !== 'ALL')) throw new AppError(`Missing permission: ${key}${minScope === 'ALL' ? ' at school-wide scope' : ''}`, 403, [], 'FORBIDDEN');
  return s;
}

/** The route's requireAnyOf guard; returns the best scope (ALL beats OWN), like req.scope. */
export function needAny(ctx, grants) {
  let best = null;
  for (const [key, minScope] of grants) {
    const s = ctx.actor?.permissions?.[key];
    if (!s || (minScope === 'ALL' && s !== 'ALL')) continue;
    if (s === 'ALL') return 'ALL';
    best = best ?? s;
  }
  if (!best) throw new AppError(`Missing permission: one of ${grants.map(([k]) => k).join(', ')}`, 403, [], 'FORBIDDEN');
  return best;
}

/** The scopes the caller holds for a set of keys (several services take this shape). */
export const scopesOf = (ctx, keys) => Object.fromEntries(keys.map((k) => [k, ctx.actor?.permissions?.[k] ?? null]).filter(([, v]) => v));

async function requireOn(key) {
  if (key && !(await featureEnabled(key))) {
    throw new AppError(`${FEATURES[key]?.label ?? key} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  }
}

/**
 * One record out of a list the caller is already entitled to, by reference,
 * id or name. An exact match wins, then a unique partial one; several are
 * asked about, none is a clear not-found. With no term and exactly one row,
 * that row is the answer.
 */
export function pick(rows, term, { label, nameOf = (r) => r.name ?? r.title, refOf = (r) => r.refNo ?? r.code, describe } = {}) {
  const pool = rowsOf(rows);
  const show = describe ?? ((r) => [refOf(r), nameOf(r)].filter(Boolean).join(' '));
  const wanted = lower(term);
  if (!wanted) {
    if (pool.length === 1) return pool[0];
    if (!pool.length) throw notFound(`There is no ${label} to act on.`);
    throw ask(`Which ${label}? ${pool.slice(0, 8).map(show).join('; ')}`);
  }
  const byId = pool.filter((r) => lower(idOf(r)) === wanted || lower(refOf(r)) === wanted);
  if (byId.length === 1) return byId[0];
  const exact = pool.filter((r) => lower(nameOf(r)) === wanted);
  if (exact.length === 1) return exact[0];
  const near = (exact.length ? exact : pool.filter((r) => lower(nameOf(r)).includes(wanted) || lower(refOf(r)).includes(wanted)));
  if (near.length === 1) return near[0];
  if (!near.length) throw notFound(`I could not find a ${label} matching "${String(term).trim()}".`);
  throw ask(`More than one ${label} matches "${String(term).trim()}": ${near.slice(0, 8).map(show).join('; ')}. Which one?`);
}

/** A whole list for the answer (never cut short; the channel pages it). */
export function listed(rows, render, { noun = 'item', extra = {}, speak } = {}) {
  const items = rowsOf(rows);
  const s = summarise(items, render);
  return ok({ total: items.length, items, ...extra }, { speak: speak ?? (items.length ? `${items.length} ${noun}${items.length === 1 ? '' : 's'}: ${s.list}.` : `No ${noun}s.`) });
}

/** One record for the answer. */
export const shown = (data, speak) => ok(data, { speak });

/** The completed-write envelope. */
export const did = (type, rec, speak) => action({ type, id: rec ? idOf(rec) || null : null, data: rec ?? null, speak });

/**
 * A tool, with the conventions filled in: GET is LOW risk and unconfirmed;
 * every write is confirmed and must summarise itself; a feature switch, when
 * named, is checked before anything is proposed or read; `guard(ctx)` runs the
 * route's extra checks first.
 */
export function tool(def) {
  const write = def.operation !== 'GET';
  const out = {
    risk: write ? RISK.MEDIUM : RISK.LOW,
    ...def,
    ...(write && { confirm: def.confirm ?? true }),
    inputSchema: def.inputSchema ?? closed({}),
  };
  const { run, prepare, guard, feature } = def;
  out.run = async function wrappedRun(ctx, args, prepared) {
    await requireOn(feature);
    if (guard) guard(ctx, args ?? {});
    const p = prepared ?? (prepare ? await prepare.call(this, ctx, args ?? {}) : undefined);
    return run.call(this, ctx, args ?? {}, p);
  };
  if (prepare) {
    out.prepare = async function wrappedPrepare(ctx, args) {
      await requireOn(feature);
      if (guard) guard(ctx, args ?? {});
      return prepare.call(this, ctx, args ?? {});
    };
  } else if (guard || feature) {
    // Refused before a draft is shown, not only at confirmation.
    out.prepare = async function guardOnly(ctx, args) {
      await requireOn(feature);
      if (guard) guard(ctx, args ?? {});
      return undefined;
    };
  }
  delete out.guard;
  return out;
}

/** The decision argument of an approver-confirmed tool: required, no default, the approver's own words. */
export const decisionArg = (values, who = 'the approver') => ({ type: 'string', enum: values, description: `${who}'s own decision, as they stated it. Never suggest or assume one.` });
