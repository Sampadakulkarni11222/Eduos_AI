/**
 * Argument validation for MCP tool calls.
 *
 * Deliberately a small validator for the JSON Schema subset the registry uses
 * (type / required / enum / pattern / bounds / items / no extra keys) rather
 * than another dependency: the schemas are ours, they are hand-written, and
 * the failure this exists to prevent is an argument written by a language
 * model reaching a Mongoose query in a shape nobody checked.
 *
 * It fails **closed**. An unknown property is an error rather than something
 * quietly ignored, because a model that invents `tenantId` or `status` is
 * telling you something, and dropping it silently hides both the attempt and
 * the fact that the answer will not be what the user asked for.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected, value) {
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return isPlainObject(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

/** Validates one value against one property rule. Returns [errors, coerced]. */
function checkValue(key, rule, raw) {
  const errors = [];

  // A model told "integer" still sends "20" now and then, and refusing that is
  // pedantry rather than safety — but only for the types whose string form is
  // unambiguous.
  let v = raw;
  if ((rule.type === 'integer' || rule.type === 'number') && typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) v = rule.type === 'integer' ? Math.trunc(n) : n;
  }
  if (rule.type === 'boolean' && (raw === 'true' || raw === 'false')) v = raw === 'true';

  if (rule.type && !typeMatches(rule.type, v)) {
    return [[`${key} must be a ${rule.type} (got ${typeOf(v)})`], undefined];
  }
  if (rule.enum && !rule.enum.includes(v)) {
    return [[`${key} must be one of: ${rule.enum.join(', ')}`], undefined];
  }
  if (rule.pattern && typeof v === 'string' && !new RegExp(rule.pattern).test(v)) {
    return [[`${key} is not in the expected format`], undefined];
  }
  if (typeof v === 'number') {
    if (rule.minimum !== undefined && v < rule.minimum) errors.push(`${key} must be at least ${rule.minimum}`);
    if (rule.maximum !== undefined && v > rule.maximum) errors.push(`${key} must be at most ${rule.maximum}`);
  }
  if (typeof v === 'string') {
    if (rule.maxLength !== undefined && v.length > rule.maxLength) errors.push(`${key} is too long (max ${rule.maxLength})`);
    if (rule.minLength !== undefined && v.length < rule.minLength) errors.push(`${key} is too short`);
  }
  if (Array.isArray(v)) {
    if (rule.minItems !== undefined && v.length < rule.minItems) errors.push(`${key} needs at least ${rule.minItems} item(s)`);
    if (rule.maxItems !== undefined && v.length > rule.maxItems) errors.push(`${key} may hold at most ${rule.maxItems} item(s)`);
    if (rule.items) {
      v.forEach((item, i) => {
        if (rule.items.type === 'object' && rule.items.properties) {
          const nested = validateArgs(rule.items, item);
          if (!nested.valid) errors.push(...nested.errors.map((e) => `${key}[${i}]: ${e}`));
        } else {
          const [itemErrors] = checkValue(`${key}[${i}]`, rule.items, item);
          errors.push(...itemErrors);
        }
      });
    }
  }
  if (isPlainObject(v) && rule.properties) {
    const nested = validateArgs(rule, v);
    if (!nested.valid) errors.push(...nested.errors.map((e) => `${key}.${e}`));
    else v = nested.value;
  }

  return [errors, v];
}

/**
 * @returns {{ valid: boolean, errors: string[], value: object }}
 *   `value` is the arguments with empty optional keys dropped and simple
 *   string→number coercion applied, so a tool sees "not given" rather than
 *   "given as nothing".
 */
export function validateArgs(schema, args) {
  const errors = [];
  const input = isPlainObject(args) ? args : {};

  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    return { valid: true, errors, value: input };
  }

  const properties = schema.properties;
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const key of required) {
    const v = input[key];
    const missing = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (missing) errors.push(`${key} is required`);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(properties, key)) errors.push(`${key} is not a parameter of this tool`);
    }
  }

  const value = {};
  for (const [key, rule] of Object.entries(properties)) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const [propErrors, coerced] = checkValue(key, rule, raw);
    if (propErrors.length) errors.push(...propErrors);
    else value[key] = coerced;
  }

  return { valid: errors.length === 0, errors, value };
}

/**
 * Narrows a free-form patch object to an explicit allow-list.
 *
 * This is the guard for the audit's first finding: `student.service.update()`
 * is `Object.assign(student, updates)`, so whatever reaches it is written.
 * Several other services (`ticket.update`) share the shape. Tools that patch a
 * record declare the fields a person may change through the assistant, and
 * everything else is refused **loudly** — an ignored field would mean telling
 * the user their change was made when it was not.
 *
 * @returns {{ ok: boolean, fields: object, rejected: string[] }}
 */
export function applyFieldAllowList(patch, allowed) {
  const fields = {};
  const rejected = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (allowed.includes(key)) fields[key] = value;
    else rejected.push(key);
  }
  return { ok: rejected.length === 0 && Object.keys(fields).length > 0, fields, rejected };
}
