/**
 * Removes MongoDB query operators from what a client sends.
 *
 * Express parses `?enrollmentId[$ne]=x` into `{ enrollmentId: { $ne: 'x' } }`,
 * and a service that copies a query value into a filter then runs the
 * client's operator: a student asking for invoices with `$ne` received every
 * invoice in the school. No field of this API starts with `$`, so any such
 * key in the query string or the body (and prototype keys) is dropped before
 * a handler sees it, whatever the handler does with the value. Dotted keys are
 * kept: permission maps such as { "fees.read": "ALL" } are real input.
 */
const MAX_DEPTH = 20;

function clean(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = clean(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete value[key];
    } else {
      const child = value[key];
      const hadKeys = child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length > 0;
      value[key] = clean(child, depth + 1);
      // `?id[$ne]=x` leaves `id: {}` behind: drop the key rather than filter on an empty object.
      if (hadKeys && Object.keys(value[key]).length === 0) delete value[key];
    }
  }
  return value;
}

/** True when a query value is an object other than an array of plain values (an operator in disguise). */
export function hasOperators(value) {
  if (value === null || typeof value !== 'object') return false;
  return Object.keys(value).some((k) => k.startsWith('$') || hasOperators(value[k]));
}

export function stripOperators(req, _res, next) {
  if (req.query && typeof req.query === 'object') clean(req.query);
  if (req.body && typeof req.body === 'object') clean(req.body);
  next();
}

export { clean as stripOperatorKeys };
