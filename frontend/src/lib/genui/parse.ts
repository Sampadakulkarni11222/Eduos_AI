/**
 * Reader for generated UI in the OpenUI Lang format (https://github.com/thesysdev/openui),
 * the read-only subset EduOS uses: statements, positional component calls,
 * strings, numbers, booleans, null, arrays, objects and references. $state,
 * Query()/Mutation() and @actions are not part of the subset and do not parse,
 * so a generated panel can never fetch, write or run anything.
 *
 * The server writes these programs (backend/src/modules/genui/lang.js, which
 * holds the same grammar); this side only reads them. Permissive like
 * OpenUI's own parser: a statement that does not parse is skipped and the rest
 * still renders.
 */

export interface UiElement { $el: string; args: UiValue[] }
export type UiValue = string | number | boolean | null | UiValue[] | { [k: string]: UiValue } | UiElement;

export const LIMITS = { source: 40_000, nodes: 600, depth: 10, statements: 120, array: 400 };

type Tok = { t: string; v?: string | number };
type Expr =
  | { k: 'lit'; v: string | number | boolean | null }
  | { k: 'arr'; v: Expr[] }
  | { k: 'obj'; v: Record<string, Expr> }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'ref'; name: string };

class ParseError extends Error {}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
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
      try { toks.push({ t: 'str', v: JSON.parse(`${raw}"`) as string }); } catch { throw new ParseError('Bad string'); }
      i = j + 1; continue;
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i, i + 40));
    if (num && (c === '-' || /\d|\./.test(c))) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 80));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new ParseError(`Unsupported character "${c}"`);
  }
  return toks;
}

function parseExpr(toks: Tok[], pos: { i: number }): Expr {
  const tk = toks[pos.i];
  if (!tk) throw new ParseError('Unexpected end');
  const list = (close: string): Expr[] => {
    const items: Expr[] = [];
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
  if (tk.t === 'str' || tk.t === 'num') { pos.i += 1; return { k: 'lit', v: tk.v as string | number }; }
  if (tk.t === '[') return { k: 'arr', v: list(']') };
  if (tk.t === '{') {
    pos.i += 1;
    const obj: Record<string, Expr> = Object.create(null);
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
    const name = String(tk.v);
    if (name === 'true' || name === 'false') return { k: 'lit', v: name === 'true' };
    if (name === 'null') return { k: 'lit', v: null };
    if (toks[pos.i]?.t === '(') return { k: 'call', name, args: list(')') };
    return { k: 'ref', name };
  }
  throw new ParseError(`Unexpected ${tk.t}`);
}

export interface ParseResult { root: UiValue | null; errors: string[] }

export function parseProgram(source: unknown): ParseResult {
  const errors: string[] = [];
  if (typeof source !== 'string' || !source.trim()) return { root: null, errors: ['empty'] };
  if (source.length > LIMITS.source) return { root: null, errors: ['too long'] };
  let toks: Tok[];
  try { toks = tokenize(source); } catch (e) { return { root: null, errors: [(e as Error).message] }; }

  const statements = new Map<string, Expr>();
  let first: string | null = null;
  let i = 0;
  while (i < toks.length) {
    if (toks[i].t === 'nl') { i += 1; continue; }
    let end = i; let depth = 0;
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
      const name = String(slice[0].v);
      if (!statements.has(name)) { statements.set(name, expr); first ??= name; }
      if (statements.size > LIMITS.statements) return { root: null, errors: ['too many statements'] };
    } catch (e) {
      errors.push(`${slice[0]?.v ?? '?'}: ${(e as Error).message}`);
    }
  }
  const rootName = statements.has('root') ? 'root' : first;
  if (!rootName) return { root: null, errors: [...errors, 'no root'] };

  let nodes = 0;
  const resolve = (expr: Expr, stack: string[], depth: number): UiValue => {
    nodes += 1;
    if (nodes > LIMITS.nodes) throw new ParseError('too many nodes');
    if (depth > LIMITS.depth) throw new ParseError('too deep');
    switch (expr.k) {
      case 'lit': return expr.v;
      case 'arr': return expr.v.map((x) => resolve(x, stack, depth + 1));
      case 'obj': {
        const out: Record<string, UiValue> = Object.create(null);
        for (const [k, x] of Object.entries(expr.v)) out[k] = resolve(x, stack, depth + 1);
        return out;
      }
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
    return { root: resolve(statements.get(rootName) as Expr, [rootName], 0), errors };
  } catch (e) {
    return { root: null, errors: [...errors, (e as Error).message] };
  }
}

export const isElement = (v: unknown): v is UiElement =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as UiElement).$el === 'string' && Array.isArray((v as UiElement).args);

/**
 * A link a panel may carry: a path in this app, or https on an allowlisted
 * host (NEXT_PUBLIC_GENUI_LINK_HOSTS, comma-separated; empty by default).
 */
export function safeHref(href: unknown): { internal: boolean; href: string } | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  // eslint-disable-next-line no-control-regex
  if (!h || h.length > 500 || /[\s\\\u0000-\u001f\u007f]/.test(h)) return null;
  if (h.startsWith('/')) return h.startsWith('//') ? null : { internal: true, href: h };
  try {
    const u = new URL(h);
    const allow = (process.env.NEXT_PUBLIC_GENUI_LINK_HOSTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (u.protocol !== 'https:' || u.username || u.password || !allow.includes(u.hostname.toLowerCase())) return null;
    return { internal: false, href: u.toString() };
  } catch {
    return null;
  }
}
