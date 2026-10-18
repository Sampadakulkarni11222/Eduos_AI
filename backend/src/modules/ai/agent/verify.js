import { logger } from '../../../utils/logger.js';
import {
  NAME_SHAPE, COMMON, CLAIMS_A_DEED, RANK_CLAIM, MONTH_AFTER, locateNumber, locateText, sameFigure,
} from './grounding.js';
import { presentOf } from './present.js';

/**
 * The verification engine and answer-validation layer (p7).
 *
 * The owner's architecture ends in two steps after the tools: a VERIFICATION
 * ENGINE (exact calculations -- agent/calc.js -- and validation) and ANSWER
 * VALIDATION (verify results and provenance; reject unsupported answers).
 * This is that layer, run on EVERY final answer the agent gives from data
 * (runAgent calls applyVerification on the way out, on the website and on
 * WhatsApp alike):
 *
 *   1. Every figure, person's name and claimed action in the reply is looked
 *      for in what this turn's tools returned: the records themselves, the
 *      sentence the tool wrote from them, the draft summary the MCP server
 *      produced, or a calculation ledger entry (agent/calc.js) -- or in what
 *      the person typed. Each one found is stored with its PROVENANCE: which
 *      source, and where in it ("get_class_marks › subjects[0].averagePct",
 *      "calculation calc-3 (weighted_mean)").
 *   2. A model-written answer with anything unsupported is REJECTED and the
 *      deterministic answer, laid out by code from the same records, is used
 *      instead (and verified in its turn).
 *   3. A code-written answer is by construction made of tool output; if the
 *      check still finds something it cannot trace, that is a defect in a tool
 *      or in this matcher, so it is logged and flagged on the result
 *      (`verification.ok === false`) -- the harness asserts it never happens.
 *
 * It extends agent/grounding.js (same matching rules, so the composer's own
 * check and this one never disagree); it does not replace it.
 */

const MAX_PROVENANCE = 40;
/** Structural small numbers ("top 5", list numbering, "2 of 3") need no source. */
const STRUCTURAL_MAX = 12;
/** "18 Oct", "1 Oct 2026": a day of the month written beside its month. */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** The sources of one turn, from its MCP calls. */
function sourcesOf(calls, { message = '', texts = [] } = {}) {
  const sources = [];
  for (const call of calls ?? []) {
    const r = call?.result;
    if (!r) continue;
    if (r.success && r.data != null) {
      sources.push({ kind: 'tool', ref: call.tool, data: r.data });
      const ledger = Array.isArray(r.data?.calculations) ? r.data.calculations : [];
      for (const entry of ledger) sources.push({ kind: 'calculation', ref: entry.id, op: entry.op, value: entry.value, label: entry.label ?? null });
    }
    // What the tool itself wrote from its records (speak / view), and the
    // draft summary the server produced for a write.
    let toolText = '';
    try { toolText = presentOf(r, 'en') ?? ''; } catch { toolText = ''; }
    if (toolText) sources.push({ kind: 'tool-text', ref: call.tool, text: toolText });
    if (r.action?.summary) sources.push({ kind: 'draft', ref: call.tool, text: String(r.action.summary) });
    if (r.error?.message) sources.push({ kind: 'tool-text', ref: call.tool, text: String(r.error.message) });
    sources.push({ kind: 'request', ref: call.tool, data: call.args ?? {} });
  }
  if (message) sources.push({ kind: 'user', ref: 'message', text: String(message) });
  for (const t of texts) if (t) sources.push({ kind: 'text', ref: 'fixed', text: String(t) });
  return sources;
}

function findNumber(n, sources) {
  for (const s of sources) {
    if (s.kind === 'calculation' && s.value != null && sameFigure(n, Number(s.value))) return { kind: 'calculation', ref: s.ref, op: s.op, ...(s.label && { label: s.label }) };
  }
  for (const s of sources) {
    if (s.kind === 'tool' || s.kind === 'request') {
      const path = locateNumber(n, s.data);
      if (path) return { kind: s.kind, ref: s.ref, path };
    }
  }
  for (const s of sources) {
    if (s.text != null && locateNumber(n, s.text)) return { kind: s.kind, ref: s.ref };
  }
  return null;
}

/** ISO days (yyyy-mm-dd) any source mentions, for "18 Oct" style dates. */
function daysIn(sources) {
  const days = new Set();
  const visit = (v, depth = 0) => {
    if (v == null || depth > 8) return;
    if (typeof v === 'string') { for (const m of v.matchAll(/\b(\d{4})-(\d{2})-(\d{2})/g)) days.add(`${m[2]}-${m[3]}`); return; }
    if (v instanceof Date) { days.add(v.toISOString().slice(5, 10)); return; }
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    if (typeof v === 'object') Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  for (const s of sources) visit(s.data ?? s.text);
  return days;
}

function findName(name, sources) {
  for (const s of sources) {
    const where = s.data != null ? locateText(name, s.data) : (s.text?.toLowerCase().includes(name.toLowerCase()) ? '(text)' : null);
    if (where) return { kind: s.kind, ref: s.ref, ...(where !== '(text)' && { path: where }) };
  }
  // A name is traced when each of its words appears in what the tools returned
  // (a register lists "Sharma, Rahul"; a reply says "Rahul Sharma").
  const words = name.split(/\s+/);
  const hit = sources.find((s) => s.kind !== 'user' && words.every((w) => (s.data != null ? locateText(w, s.data) : s.text?.toLowerCase().includes(w.toLowerCase()))));
  return hit ? { kind: hit.kind, ref: hit.ref } : null;
}

/**
 * Checks one reply against the turn's sources.
 *
 * @returns {{ ok: boolean, checked: number, unsupported: string[], provenance: object[] }}
 */
export function verifyAnswer({ reply, calls = [], message = '', texts = [] } = {}) {
  const text = String(reply ?? '');
  const sources = sourcesOf(calls, { message, texts });
  const provenance = [];
  const unsupported = [];
  const days = daysIn(sources);
  let checked = 0;

  const flat = text.replace(/(\d),(\d)/g, '$1$2');
  for (const m of flat.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)) {
    const raw = m[1];
    const n = Number(raw);
    if (Number.isInteger(n) && n <= STRUCTURAL_MAX) continue;
    checked += 1;
    const after = flat.slice(m.index + raw.length);
    // A day of the month beside its month: grounded by a stored date within a day of it.
    const month = MONTH_AFTER.exec(after)?.[0]?.trim().slice(0, 3).toLowerCase();
    if (month && Number.isInteger(n) && n <= 31) {
      const mm = String(MONTHS[month] + 1).padStart(2, '0');
      const near = [n - 1, n, n + 1].some((d) => days.has(`${mm}-${String(d).padStart(2, '0')}`));
      if (near) { provenance.push({ fact: `${raw} ${month}`, kind: 'date', source: { kind: 'tool', ref: 'date' } }); continue; }
    }
    const found = findNumber(n, sources);
    if (found) provenance.push({ fact: raw, kind: 'number', source: found });
    else unsupported.push(`the figure ${raw}`);
  }

  for (const m of text.matchAll(NAME_SHAPE)) {
    const words = m.slice(1).filter(Boolean);
    if (words.some((w) => COMMON.has(w))) continue;
    checked += 1;
    const found = findName(m[0], sources);
    if (found) provenance.push({ fact: m[0], kind: 'name', source: found });
    else unsupported.push(`the name ${m[0]}`);
  }

  if (CLAIMS_A_DEED.test(text)) {
    checked += 1;
    const did = (calls ?? []).find((c) => c?.result?.action?.status === 'completed');
    if (did) provenance.push({ fact: CLAIMS_A_DEED.exec(text)[0], kind: 'action', source: { kind: 'tool', ref: did.tool, path: 'action' } });
    else unsupported.push('a claim that something was done');
  }
  const rank = RANK_CLAIM.exec(text);
  if (rank) {
    checked += 1;
    const inSource = sources.some((s) => s.kind !== 'user' && RANK_CLAIM.test(s.text ?? JSON.stringify(s.data ?? '')));
    if (!inSource) unsupported.push(`the rank "${rank[0]}"`);
  }

  return { ok: unsupported.length === 0, checked, unsupported, provenance: provenance.slice(0, MAX_PROVENANCE) };
}

/**
 * The validation step every final answer passes through (orchestrator.runAgent).
 *
 * Reads the turn's calls from the internal `_calls` field the planner attaches,
 * verifies the reply, falls back to the deterministic answer when a
 * model-written one is unsupported, and returns the result with `verification`
 * and `provenance` in place of the internal fields (which never reach a client
 * or the conversation memory).
 */
export function applyVerification(result, { message = '' } = {}) {
  if (!result || typeof result !== 'object') return result;
  const { _calls: calls, _deterministic: deterministic, _texts: texts, ...clean } = result;
  if (!Array.isArray(calls) || !calls.length) return clean;

  let verdict = verifyAnswer({ reply: clean.reply, calls, message, texts });
  let fallback = null;
  if (!verdict.ok && clean.modelWritten && typeof deterministic === 'string' && deterministic.trim()) {
    logger.warn(`Answer validation rejected a model-written reply (${verdict.unsupported.slice(0, 3).join(', ')}); using the deterministic answer`);
    clean.reply = deterministic;
    clean.modelWritten = false;
    fallback = 'deterministic';
    verdict = verifyAnswer({ reply: clean.reply, calls, message, texts });
  }
  if (!verdict.ok) {
    logger.warn(`Answer validation could not trace ${verdict.unsupported.slice(0, 5).join(', ')} in a code-written reply (tool: ${clean.tool ?? '?'})`);
  }
  return {
    ...clean,
    verification: { ok: verdict.ok, checked: verdict.checked, unsupported: verdict.unsupported, ...(fallback && { fallback }) },
    provenance: verdict.provenance,
  };
}
