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
