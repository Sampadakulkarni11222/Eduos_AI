import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The acting school, carried for the lifetime of a request.
 *
 * Every school-owned collection is filtered by this value (see tenantScope.js),
 * so isolation does not depend on ~300 individual queries each remembering to
 * add a `tenantId` clause — a query that forgets is filtered anyway, and a
 * document written without one is stamped on the way in.
 *
 * Three states, and the difference matters:
 *   { tenantId }   — scoped to one school. Everything a school-level role does.
 *   { bypass }     — deliberately cross-school. Only a Super Admin acting on
 *                    the platform (listing schools, seeding, migrations).
 *   no context     — outside a request: seeds, scripts, tests. Unfiltered, so
 *                    those tools keep working; they opt in with runWithTenant.
 */
const store = new AsyncLocalStorage();

/**
 * Runs `fn` with every school-owned query pinned to one school.
 *
 * The query has to be *executed* inside `fn`, not merely built there: a
 * Mongoose Query runs its hooks when it is awaited, so returning an unawaited
 * query hands the caller one that will execute outside the scope, unfiltered.
 * Both helpers await internally so `() => Model.find()` is safe either way;
 * an Express request needs no care here, since the whole handler chain runs
 * inside the scope.
 */
export const runWithTenant = (tenantId, fn) => store.run({ tenantId }, async () => fn());

/** Runs `fn` across every school. Reserved for platform-level work. */
export const runAcrossSchools = (fn) => store.run({ bypass: true }, async () => fn());

/** The acting school id, or null when unscoped/bypassed. */
export function currentTenantId() {
  const ctx = store.getStore();
  if (!ctx || ctx.bypass) return null;
  return ctx.tenantId ?? null;
}

/** True when a context is set and it names one school. */
export const isTenantScoped = () => currentTenantId() !== null;

/**
 * A `tenantId` clause for the collections that are deliberately NOT
 * plugin-scoped.
 *
 * Profile is the case this exists for. It cannot carry tenantScoped: signing
 * in, listing an account's profiles for the switcher, and selecting one all
 * have to see across schools, because one person may hold a profile in two of
 * them. But every *administrative* read of profiles — the user-management
 * table, a CSV import resolving a teacher — must still be confined to the
 * acting school. Spreading `currentTenantId()` checks over those call sites is
 * how one gets forgotten, so they all spread this instead.
 *
 * Returns `{}` when there is no school context (platform Super Admin, seeds,
 * scripts, tests), which leaves the caller's query exactly as it was.
 */
export function tenantFilter() {
  const tenantId = currentTenantId();
  return tenantId ? { tenantId } : {};
}

/**
 * The whole tenant context, as three distinguishable states.
 *
 * currentTenantId() collapses "no context" and "deliberately cross-school"
 * into the same null. That is the right answer for a query filter and the
 * wrong one for anybody who has to *re-establish* the context later. The MCP
 * server does exactly that: a tool call arrives over an in-process transport
 * and must run inside the same school the caller was in — not merely inside
 * something that happens to filter the same way.
 */
export function currentTenantState() {
  const ctx = store.getStore();
  if (!ctx) return { tenantId: null, bypass: false, scoped: false };
  if (ctx.bypass) return { tenantId: null, bypass: true, scoped: false };
  return { tenantId: ctx.tenantId ?? null, bypass: false, scoped: Boolean(ctx.tenantId) };
}

/**
 * Runs `fn` in a previously captured tenant state.
 *
 * The three states are not interchangeable: pinning a Super Admin to a school
 * they never chose is as wrong as letting a school-level actor run unscoped.
 */
export function runInTenantState(state, fn) {
  if (state?.bypass) return runAcrossSchools(fn);
  if (state?.tenantId) return runWithTenant(state.tenantId, fn);
  return Promise.resolve().then(fn);
}
