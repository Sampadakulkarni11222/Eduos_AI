/**
 * Generated UI in the OpenUI Lang format (https://github.com/thesysdev/openui),
 * restricted to EduOS's own registered components.
 *
 * Why a format at all: an assistant answer or an "Ask your dashboard" panel is
 * described as a small program of component calls --
 *
 *   root = Panel("Fee collection", [kpi1, chart1, ev])
 *   kpi1 = MetricCompare("Net fee collections", 1250000, 1100000, "paise", "This year", "Last year")
 *   chart1 = LineChart("By month", ["Apr", "May"], [Series("This year", [1, 2])], "paise")
 *   ev = Evidence([Source("Analytics: Net fee collections, 42 records", "/analytics")])
 *
 * -- which our code writes from tool results (deterministically, no model),
 * or a configured model may write instead, limited to the components below and
 * to our data. The browser renders it with a registered component library;
 * anything not registered is dropped.
 *
 * This is the SUBSET of OpenUI Lang 1.0 that a read-only panel needs:
 * statements, positional component calls, strings, numbers, booleans, null,
 * arrays, objects and references. Deliberately absent: $state variables,
 * Query()/Mutation() tool calls, @actions, expressions. A program using them
 * does not parse here, so generated UI can never fetch, write or run anything.
 *
 * The component names and argument order are the contract with the frontend
 * library (frontend/src/lib/genui/library.tsx); a test pins both sides.
 */

/** Units every numeric component understands. */
export const UNITS = ['count', 'percent', 'paise', 'days'];
export const TONES = ['good', 'warn', 'bad', 'neutral'];
export const CALLOUT_TONES = ['info', 'good', 'warn', 'bad'];

/**
 * The registered components: name -> ordered arguments. `t` is a type hint for
 * the model prompt; validation of values happens in the browser (Zod) and in
 * validateProgram() below (names, arity, links).
 */
export const COMPONENTS = {
  Panel: { desc: 'The root container. children is a list of the components below.', args: [['title', 'string'], ['children', 'Component[]'], ['subtitle', 'string?']] },
  Kpi: { desc: 'One headline number.', args: [['label', 'string'], ['value', 'number|null'], ['unit', 'count|percent|paise|days?'], ['detail', 'string?'], ['tone', 'good|warn|bad|neutral?'], ['href', 'link?']] },
  MetricCompare: { desc: 'A number with the same number for a comparison period.', args: [['label', 'string'], ['current', 'number|null'], ['previous', 'number|null'], ['unit', 'unit?'], ['currentLabel', 'string?'], ['previousLabel', 'string?'], ['href', 'link?']] },
  LineChart: { desc: 'A trend. labels are the x axis; each Series has one value per label.', args: [['title', 'string'], ['labels', 'string[]'], ['series', 'Series[]'], ['unit', 'unit?'], ['href', 'link?']] },
  BarChart: { desc: 'Bars per label; one or two Series.', args: [['title', 'string'], ['labels', 'string[]'], ['series', 'Series[]'], ['unit', 'unit?'], ['href', 'link?']] },
  DonutChart: { desc: 'Parts of a whole.', args: [['title', 'string'], ['slices', 'Slice[]'], ['unit', 'unit?']] },
  Series: { desc: 'A named list of values (null = no data).', args: [['label', 'string'], ['values', '(number|null)[]']] },
  Slice: { desc: 'One part of a donut.', args: [['label', 'string'], ['value', 'number']] },
  Table: { desc: 'Rows of cells. units (optional) gives each column a unit.', args: [['title', 'string'], ['columns', 'string[]'], ['rows', '(string|number|null)[][]'], ['units', '(unit|null)[]?']] },
  RecordList: { desc: 'A list of records, each optionally linking to its page.', args: [['title', 'string'], ['items', 'Record[]']] },
  Record: { desc: 'One record in a RecordList.', args: [['text', 'string'], ['sub', 'string?'], ['href', 'link?'], ['badge', 'string?']] },
  Timeline: { desc: 'Dated events, oldest first.', args: [['title', 'string'], ['events', 'Event[]']] },
  Event: { desc: 'One timeline event; at is a date (YYYY-MM-DD or ISO).', args: [['at', 'string'], ['title', 'string'], ['note', 'string?']] },
  ActionCard: { desc: 'Suggests something the person may do. It never acts: it opens the assistant with `ask` pre-filled (which drafts and asks for confirmation) or opens `href`.', args: [['title', 'string'], ['detail', 'string?'], ['ask', 'string?'], ['href', 'link?']] },
  Callout: { desc: 'A short note.', args: [['tone', 'info|good|warn|bad'], ['text', 'string']] },
  Evidence: { desc: '"Based on": the records behind the panel.', args: [['items', 'Source[]']] },
  Source: { desc: 'One source record set.', args: [['text', 'string'], ['href', 'link?']] },
};

export const COMPONENT_NAMES = Object.keys(COMPONENTS);

/** Hard limits: a program larger than this is refused outright. */
export const LIMITS = { source: 40_000, nodes: 600, depth: 10, statements: 120, string: 2_000, array: 400 };

/* ── Links ─────────────────────────────────────────────── */

/**
 * A link generated UI may carry: a path inside this app ("/fees?tab=overdue"),
 * or an https URL on an allowlisted host. Everything else (javascript:, data:,
 * protocol-relative "//host", backslashes, control characters) is refused.
 */
export function safeHref(href, { allowHosts = [] } = {}) {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (!h || h.length > 500 || /[\s\\\u0000-\u001f\u007f]/.test(h)) return null;
  if (h.startsWith('/')) return h.startsWith('//') ? null : h;
  try {
    const u = new URL(h);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return allowHosts.map((x) => String(x).toLowerCase()).includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ── Writing programs ──────────────────────────────────── */

/** A component call; `undefined` trailing arguments are dropped. */
export const el = (name, ...args) => {
  if (!COMPONENTS[name]) throw new Error(`Unregistered component ${name}`);
  return { $el: name, args };
};

function literal(v, out) {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > LIMITS.string ? `${v.slice(0, LIMITS.string - 1)}…` : v);
  if (Array.isArray(v)) return `[${v.map((x) => literal(x, out)).join(', ')}]`;
  if (v.$ref) return v.$ref;
  if (v.$el) return call(v, out);
  return `{${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : JSON.stringify(k)}: ${literal(x, out)}`).join(', ')}}`;
}

function call(node, out) {
  const args = [...node.args];
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return `${node.$el}(${args.map((a) => literal(a, out)).join(', ')})`;
}

/**
 * Serialises a tree to OpenUI Lang. The root's children become statements of
 * their own (c1, c2, ...) the way OpenUI streams them: the shell first, then
 * each block.
 */
export function toLang(root) {
  const lines = [];
  if (root?.$el === 'Panel' && Array.isArray(root.args[1])) {
    const refs = root.args[1].map((child, i) => {
      const name = `c${i + 1}`;
      lines.push(`${name} = ${literal(child, lines)}`);
      return { $ref: name };
    });
    return [`root = ${call({ $el: 'Panel', args: [root.args[0], refs, ...root.args.slice(2)] }, lines)}`, ...lines].join('\n');
  }
  return `root = ${literal(root, lines)}`;
}

/* ── Reading programs ──────────────────────────────────── */

class ParseError extends Error {}

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || c === ';') { toks.push({ t: 'nl' }); i += 1; continue; }
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if ('=()[]{},:'.includes(c)) { toks.push({ t: c }); i += 1; continue; }
    if (c === '"') {
      let j = i + 1; let raw = '"';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new ParseError('Unterminated string');
        if (src[j] === '\\') { raw += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        raw += src[j]; j += 1;
      }
      if (j >= src.length) throw new ParseError('Unterminated string');
      try { toks.push({ t: 'str', v: JSON.parse(`${raw}"`) }); } catch { throw new ParseError('Bad string'); }
      i = j + 1; continue;
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i, i + 40));
    if (num && (c === '-' || /\d|\./.test(c))) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 80));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    // $variables, @actions, operators and everything else are outside this subset.
    throw new ParseError(`Unsupported character "${c}"`);
  }
  return toks;
}

/** Parses one statement's expression from a token list. */
function parseExpr(toks, pos) {
  const tk = toks[pos.i];
  if (!tk) throw new ParseError('Unexpected end');
  const list = (close) => {
    const items = [];
    pos.i += 1;
    if (toks[pos.i]?.t === close) { pos.i += 1; return items; }
    for (;;) {
      items.push(parseExpr(toks, pos));
      if (items.length > LIMITS.array) throw new ParseError('List too long');
      const n = toks[pos.i];
      if (n?.t === ',') { pos.i += 1; if (toks[pos.i]?.t === close) { pos.i += 1; return items; } continue; }
      if (n?.t === close) { pos.i += 1; return items; }
      throw new ParseError(`Expected , or ${close}`);
    }
  };
  if (tk.t === 'str' || tk.t === 'num') { pos.i += 1; return { k: 'lit', v: tk.v }; }
  if (tk.t === '[') return { k: 'arr', v: list(']') };
  if (tk.t === '{') {
    pos.i += 1;
    const obj = {};
    if (toks[pos.i]?.t === '}') { pos.i += 1; return { k: 'obj', v: obj }; }
    for (;;) {
      const key = toks[pos.i];
      if (!key || (key.t !== 'id' && key.t !== 'str')) throw new ParseError('Expected a key');
      if (toks[pos.i + 1]?.t !== ':') throw new ParseError('Expected :');
      pos.i += 2;
      const k = String(key.v);
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new ParseError('Reserved key');
      obj[k] = parseExpr(toks, pos);
      const n = toks[pos.i];
      if (n?.t === ',') { pos.i += 1; if (toks[pos.i]?.t === '}') { pos.i += 1; break; } continue; }
      if (n?.t === '}') { pos.i += 1; break; }
      throw new ParseError('Expected , or }');
    }
    return { k: 'obj', v: obj };
  }
  if (tk.t === 'id') {
    pos.i += 1;
    if (tk.v === 'true' || tk.v === 'false') return { k: 'lit', v: tk.v === 'true' };
    if (tk.v === 'null') return { k: 'lit', v: null };
    if (toks[pos.i]?.t === '(') return { k: 'call', name: tk.v, args: list(')') };
    return { k: 'ref', name: tk.v };
  }
  throw new ParseError(`Unexpected ${tk.t}`);
}

/**
 * Parses a program into a resolved tree rooted at `root` (or the first
 * statement). Like OpenUI's parser it is permissive: a statement that does not
 * parse is skipped and reported, and the rest still renders.
 *
 * @returns {{ root: object|null, errors: string[] }} where nodes are
 *   `{ $el, args }` for calls and plain JS values otherwise.
 */
export function parseProgram(source) {
  const errors = [];
  if (typeof source !== 'string' || !source.trim()) return { root: null, errors: ['empty'] };
  if (source.length > LIMITS.source) return { root: null, errors: ['too long'] };
  let toks;
  try { toks = tokenize(source); } catch (e) { return { root: null, errors: [e.message] }; }

  const statements = new Map();
  let first = null;
  let i = 0;
  while (i < toks.length) {
    if (toks[i].t === 'nl') { i += 1; continue; }
    let end = i;
    let depth = 0;
    while (end < toks.length && !(toks[end].t === 'nl' && depth === 0)) {
      if ('([{'.includes(toks[end].t)) depth += 1;
      if (')]}'.includes(toks[end].t)) depth -= 1;
      end += 1;
    }
    const slice = toks.slice(i, end);
    i = end;
    try {
      if (slice[0]?.t !== 'id' || slice[1]?.t !== '=') throw new ParseError('Expected name = value');
      const pos = { i: 2 };
      const expr = parseExpr(slice, pos);
      if (pos.i !== slice.length) throw new ParseError('Unexpected tokens after the value');
      if (!statements.has(slice[0].v)) {
        statements.set(slice[0].v, expr);
        first ??= slice[0].v;
      }
      if (statements.size > LIMITS.statements) return { root: null, errors: ['too many statements'] };
    } catch (e) {
      errors.push(`${slice[0]?.v ?? '?'}: ${e.message}`);
    }
  }
  const rootName = statements.has('root') ? 'root' : first;
  if (!rootName) return { root: null, errors: [...errors, 'no root'] };

  let nodes = 0;
  const resolve = (expr, stack, depth) => {
    nodes += 1;
    if (nodes > LIMITS.nodes) throw new ParseError('too many nodes');
    if (depth > LIMITS.depth) throw new ParseError('too deep');
    switch (expr.k) {
      case 'lit': return expr.v;
      case 'arr': return expr.v.map((x) => resolve(x, stack, depth + 1));
      case 'obj': return Object.fromEntries(Object.entries(expr.v).map(([k, x]) => [k, resolve(x, stack, depth + 1)]));
      case 'call': return { $el: expr.name, args: expr.args.map((x) => resolve(x, stack, depth + 1)) };
      case 'ref': {
        if (stack.includes(expr.name)) { errors.push(`cycle at ${expr.name}`); return null; }
        const target = statements.get(expr.name);
        if (!target) { errors.push(`unresolved ${expr.name}`); return null; }
        return resolve(target, [...stack, expr.name], depth + 1);
      }
      default: return null;
    }
  };
  try {
    return { root: resolve(statements.get(rootName), [rootName], 0), errors };
  } catch (e) {
    return { root: null, errors: [...errors, e.message] };
  }
}

/** Every component call, number and href in a resolved tree. */
export function walk(node, visit) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (node && typeof node === 'object') {
    if (node.$el) {
      visit.el?.(node);
      const spec = COMPONENTS[node.$el];
      node.args.forEach((a, i) => {
        if (spec?.args[i]?.[0] === 'href') visit.href?.(a);
        walk(a, visit);
      });
      return;
    }
    Object.values(node).forEach((v) => walk(v, visit));
    return;
  }
  if (typeof node === 'number') visit.num?.(node);
  if (typeof node === 'string') visit.str?.(node);
}

/**
 * The server-side gate on a program (used on model output before it leaves
 * the server): it must parse, use only registered components with no more
 * arguments than they take, and carry only safe links. Returns what it used,
 * so a caller can also check the numbers and links against its own data.
 */
export function validateProgram(source, { allowHosts = [] } = {}) {
  const { root, errors } = parseProgram(source);
  const problems = [...errors];
  const numbers = []; const hrefs = []; const names = [];
  if (!root) return { ok: false, errors: problems.length ? problems : ['no root'], numbers, hrefs, names };
  if (root.$el !== 'Panel') problems.push('root must be a Panel');
  walk(root, {
    el: (n) => {
      names.push(n.$el);
      const spec = COMPONENTS[n.$el];
      if (!spec) problems.push(`unknown component ${n.$el}`);
      else if (n.args.length > spec.args.length) problems.push(`${n.$el} takes ${spec.args.length} arguments`);
    },
    href: (h) => {
      if (h === null || h === undefined) return;
      if (!safeHref(h, { allowHosts })) problems.push(`unsafe link ${String(h).slice(0, 80)}`);
      else hrefs.push(h);
    },
    num: (x) => numbers.push(x),
  });
  return { ok: problems.length === 0, errors: problems, numbers, hrefs, names, root };
}

/** The component reference given to a model (OpenUI's prompt, our library). */
export function libraryPrompt() {
  return COMPONENT_NAMES.map((n) => `- ${n}(${COMPONENTS[n].args.map(([a, t]) => `${a}: ${t}`).join(', ')}) — ${COMPONENTS[n].desc}`).join('\n');
}
