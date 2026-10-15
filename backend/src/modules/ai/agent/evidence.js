import { getMcpTool } from '../mcp/registry.js';

/**
 * "Based on": the records behind an assistant answer.
 *
 * Every answer the assistant writes from data is followed by the source
 * records it used: which lookup, how many records, for which class or
 * person, for which dates, and a link to the page where they live. Built only
 * from the tool calls that actually ran and succeeded in this turn, so it can
 * never cite something the answer did not use. Reads the tool registry for
 * the module name only; it does not change any tool.
 */

const PAGE = {
  attendance: '/attendance', students: '/students', fees: '/fees', academics: '/exams', exams: '/exams', assignments: '/assignments',
  communication: '/announcements', announcements: '/announcements', facilities: '/facilities', welfare: '/safeguarding', requests: '/requests',
  analytics: '/analytics', profile: '/profile', seats: '/seats', operations: '/tasks', library: '/library', transport: '/fleet', timetable: '/timetable',
  leave: '/leave', hostel: '/hostel', medical: '/medical', tickets: '/tickets', calendar: '/calendar',
};

const TOOL_LABEL_PREFIX = /^(get|list|find|search|show|read|view|my)_/;
export const toolLabel = (name) => {
  const words = String(name ?? '').replace(TOOL_LABEL_PREFIX, '').replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'School records';
};

/** The number of records a result carries: its list length, or a declared total. */
function countOf(data) {
  if (Array.isArray(data)) return { count: data.length, noun: 'records' };
  if (!data || typeof data !== 'object') return null;
  for (const k of ['total', 'totalCount', 'count']) if (Number.isFinite(data[k])) return { count: data[k], noun: 'records' };
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return { count: v.length, noun: k.replace(/([A-Z])/g, ' $1').toLowerCase() };
  }
  return null;
}

const SUBJECT_KEYS = ['className', 'class', 'section', 'sectionName', 'studentName', 'student', 'name', 'grade'];
function subjectOf(args = {}, data = {}) {
  for (const src of [args, data]) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    for (const k of SUBJECT_KEYS) {
      const v = src[k];
      if (typeof v === 'string' && v.trim() && v.length <= 60) return v.trim();
      if (v && typeof v === 'object' && typeof v.name === 'string') return v.name;
    }
  }
  return null;
}

const fmt = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
function rangeOf(args = {}, data = {}) {
  const pick = (o, ks) => ks.map((k) => o?.[k]).find((v) => typeof v === 'string' && v);
  const from = pick(args, ['from', 'fromDate', 'startDate', 'since']) ?? pick(data, ['from', 'since']);
  const to = pick(args, ['to', 'toDate', 'endDate', 'until']) ?? pick(data, ['to', 'until']);
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `from ${fmt(from)}`;
  const day = pick(args, ['date', 'day']) ?? pick(data, ['date']);
  if (day) return fmt(day);
  const month = pick(args, ['month', 'period']) ?? pick(data, ['month']);
  if (month) return /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : month;
  return null;
}

/**
 * The evidence list for one turn: `calls` are `{ tool, args, result }` in the
 * order they ran. Writes and failed calls are not evidence.
 */
export function evidenceFor(calls = []) {
  const out = [];
  for (const c of calls) {
    const r = c?.result;
    if (!r?.success || r.action) continue;
    const data = r.data ?? null;
    const def = getMcpTool(c.tool);
    const counted = countOf(data);
    const subject = subjectOf(c.args, data && !Array.isArray(data) ? data : {});
    const range = rangeOf(c.args, data && !Array.isArray(data) ? data : {});
    const link = (data && !Array.isArray(data) && typeof data.link === 'string' && data.link.startsWith('/') ? data.link : null) ?? PAGE[def?.module] ?? null;
    const parts = [counted ? `${counted.count} ${counted.count === 1 ? counted.noun.replace(/s$/, '') : counted.noun}` : null, subject ? `for ${subject}` : null, range].filter(Boolean);
    out.push({ tool: c.tool, label: toolLabel(c.tool), module: def?.module ?? null, count: counted?.count ?? null, subject, range, link, text: `${toolLabel(c.tool)}${parts.length ? `: ${parts.join(', ')}` : ''}` });
  }
  return out;
}

/** One line for channels without a rich footer (and for the web reply's copy). */
export function evidenceLine(evidence = []) {
  return evidence.length ? `Based on: ${evidence.map((e) => e.text).join('; ')}.` : '';
}
