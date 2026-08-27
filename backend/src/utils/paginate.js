import { logger } from './logger.js';

/**
 * Opt-in pagination for list endpoints, matching the shape
 * `student.service.js:list` already returns.
 *
 * Callers that pass `pageSize` get `{ items, total, page, pageSize, totalPages }`.
 * Callers that don't keep getting a bare array — so adding this to an existing
 * endpoint does not break its consumers — but the query is now capped instead
 * of unbounded. An unpaginated `.find()` over a collection that grows for the
 * life of the school will eventually return everything ever written, which is a
 * problem for the API, the network and the browser at the same time.
 *
 * Truncation is never silent: hitting the cap is logged with the query, so the
 * endpoint gets paginated properly before anyone is quietly missing rows.
 */

/** Absolute ceiling on one page, whatever the caller asks for. */
export const MAX_PAGE_SIZE = 200;
/** Cap applied when the caller does not paginate at all. */
export const UNPAGINATED_CAP = 500;

/**
 * @param {import('mongoose').Query} queryBuilder  A findable query, already filtered and sorted.
 * @param {import('mongoose').Model}  model        The model, for counting.
 * @param {object} filter                          The same filter the query was built with.
 * @param {object} [opts]
 * @param {number|string} [opts.page]
 * @param {number|string} [opts.pageSize]          Omit/0 for the legacy array response.
 * @param {string} [opts.label]                    Used in the truncation warning.
 */
export async function paginate(queryBuilder, model, filter, { page, pageSize, label = 'list' } = {}) {
  const requestedSize = Number.parseInt(pageSize, 10);
  const wantsPages = Number.isFinite(requestedSize) && requestedSize > 0;

  if (!wantsPages) {
    const items = await queryBuilder.limit(UNPAGINATED_CAP + 1);
    if (items.length > UNPAGINATED_CAP) {
      logger.warn(
        `${label}: more than ${UNPAGINATED_CAP} rows matched and the caller did not paginate — ` +
          `returning the first ${UNPAGINATED_CAP}. Filter: ${JSON.stringify(filter)}`
      );
      return items.slice(0, UNPAGINATED_CAP);
    }
    return items;
  }

  const size = Math.min(requestedSize, MAX_PAGE_SIZE);
  const total = await model.countDocuments(filter);
  const totalPages = Math.max(Math.ceil(total / size), 1);
  // Clamp an out-of-range page to the last real one rather than returning an
  // empty table, matching /students, /users and /fees.
  const current = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), totalPages);

  const items = await queryBuilder.skip((current - 1) * size).limit(size);
  return { items, total, page: current, pageSize: size, totalPages, nextCursor: null };
}

/**
 * Applies a DTO mapper to whichever shape `paginate()` returned, so a service
 * can paginate without branching on the response shape itself.
 */
export function mapPage(result, fn) {
  if (Array.isArray(result)) return result.map(fn);
  return { ...result, items: result.items.map(fn) };
}
