import { AppError } from '../../utils/AppError.js';
import { featureEnabled } from '../../utils/features.js';
import { shortCache } from '../../utils/shortCache.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { resolvePeriod, comparisonPeriod, change, buckets, localDate } from '../../utils/periods.js';
import { classFromText, classKey, classLabel as labelOfClass } from '../../utils/classNames.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { Term, Section } from '../../models/academics.model.js';
import { metrics as catalogueMetrics } from '../analytics/catalogue.js';
import { schoolCalendar, makeContext, evaluate, CURRENCY } from '../analytics/analytics.service.js';
import { resolveScope } from '../analytics/analytics.scope.js';
import { roleDashboard } from '../insights/dashboards.service.js';
import { el, toLang, safeHref } from './lang.js';
import { generatedUi } from './compose.js';

/**
 * "Ask your dashboard": a sentence -- "compare fee collection this year with
 * last year by month", "show attendance for 7B this term" -- answered with a
 * generated panel, through the same pipeline as the assistant's answers.
 *
 * The sentence is read by code (planQuery), never by a model: it picks a
 * period, a comparison, a bucket size, a class and the measures it names. The
 * figures then come from the services the screens use, with this person's own
 * scope:
 *
 *   1. the analytics workspace (analytics.workspace.read; the same metric
 *      definitions, periods and scope rules as the Analytics page), else
 *   2. their own role dashboard (/insights/dashboard: a teacher's classes, a
 *      parent's child, a finance desk's queue), matched by title.
 *
 * A class named outside the person's classes is refused the way the assistant
 * refuses it. Restricted data (health, safeguarding, payroll detail, camera)
 * is not in either source beyond what those screens already show.
 */

const MAX_PROMPT = 300;
const MAX_TREND_BUCKETS = 36;
const ASK_CACHE_MS = Number(process.env.GENUI_CACHE_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 30_000));

/* ── Reading the sentence ─────────────────────────────── */

const STOP = new Set(['show', 'me', 'the', 'a', 'an', 'for', 'of', 'in', 'and', 'with', 'this', 'that', 'last', 'by', 'vs', 'versus', 'compare', 'compared', 'to', 'my', 'our', 'is', 'are', 'what', 'how', 'year', 'month', 'week', 'term', 'quarter', 'today', 'previous', 'same', 'period', 'please', 'class', 'all', 'school', 'on', 'from', 'trend', 'chart', 'graph', 'panel', 'monthly', 'weekly', 'so', 'far']);

/** Words a person uses for what a metric or dashboard tile is called. */
const SYNONYMS = {
  fee: ['fee', 'fees'], fees: ['fee', 'fees'], collection: ['collection', 'collections'], collected: ['collection', 'collections', 'received'],
  payments: ['received', 'collection', 'paid'], dues: ['outstanding', 'overdue', 'pending'], due: ['outstanding', 'overdue', 'due'], pending: ['outstanding', 'pending'],
  overdue: ['overdue', 'outstanding'], outstanding: ['outstanding'], billing: ['billed'], billed: ['billed'], refunds: ['refunds'], concession: ['concessions'], concessions: ['concessions'],
  attendance: ['attendance'], present: ['attendance', 'present'], absent: ['attendance', 'absence', 'absent'], absence: ['absence', 'absent'],
  marks: ['exam', 'score', 'marks'], exam: ['exam', 'score'], exams: ['exam', 'score'], score: ['score', 'exam'], scores: ['score', 'exam'], grades: ['exam', 'score', 'grade'], results: ['exam', 'score', 'result'],
  homework: ['homework', 'assignment'], assignments: ['homework', 'assignment'], syllabus: ['syllabus'],
  admissions: ['enquiries', 'admission', 'enrolment', 'applicants'], enquiries: ['enquiries'], applications: ['application'], strength: ['roll', 'strength'], enrolment: ['roll', 'enrolment'], students: ['roll', 'students'],
  withdrawals: ['withdrawals'], waitlist: ['waitlist'], seats: ['seats'],
  budget: ['budget'], spend: ['budget', 'spent'], cost: ['cost'], staff: ['staff'], teachers: ['staff'], payroll: ['payroll'],
  library: ['library'], books: ['library', 'books'], hostel: ['hostel'], beds: ['hostel', 'beds'], transport: ['transport'], bus: ['transport'],
  maintenance: ['work orders'], repairs: ['work orders'], tasks: ['tasks'], licences: ['licences'], compliance: ['obligations', 'licences'],
  posts: ['posts'], newsroom: ['posts'], classes: ['online classes'], purchase: ['purchase'], suppliers: ['suppliers'], invoices: ['invoice'],
  timetable: ['timetable', 'schedule'], schedule: ['timetable', 'schedule'], leave: ['leave'], requests: ['requests'],
};

/**
 * The plan for a sentence. Pure: no data is read here.
 * @returns {{ words: string[], preset: string, term: boolean, compare: string, bucket: string, classText: string|null, days: number }}
 */
export function planQuery(prompt) {
  const q = String(prompt ?? '').toLowerCase().slice(0, MAX_PROMPT);
  const has = (re) => re.test(q);
  let preset = 'month'; let term = false; let days = 30;
  if (has(/\b(this|current)\s+term\b|\bterm\b/)) { term = true; preset = 'term'; days = 90; }
  else if (has(/\bfinancial\s+year\b|\bfy\b/)) { preset = 'financialYear'; days = 365; }
  else if (has(/\b(this|current|academic)\s+year\b|\byear\s+to\s+date\b|\bytd\b|\bthis\s+session\b/)) { preset = 'academicYear'; days = 365; }
  else if (has(/\bquarter\b/)) { preset = 'quarter'; days = 90; }
  else if (has(/\b(this|current)\s+week\b|\bweek\b/)) { preset = 'week'; days = 7; }
  else if (has(/\btoday\b/)) { preset = 'today'; days = 1; }
  else if (has(/\byear\b/)) { preset = 'academicYear'; days = 365; }

  let compare = 'previous';
  if (has(/\blast\s+year\b|\bprevious\s+year\b|\byear\s+(before|earlier)\b|\bvs\.?\s+last\s+year\b|\byear[- ]on[- ]year\b|\byoy\b/)) compare = 'lastYear';
  else if (has(/\bno\s+comparison\b|\bwithout\s+comparison\b/)) compare = 'none';

  let bucket = 'auto';
  if (has(/\bby\s+month\b|\bmonthly\b|\bmonth[- ]by[- ]month\b|\beach\s+month\b/)) bucket = 'month';
  else if (has(/\bby\s+week\b|\bweekly\b|\beach\s+week\b/)) bucket = 'week';
  else if (has(/\bby\s+day\b|\bdaily\b|\beach\s+day\b/)) bucket = 'day';

  // "7B" / "7-B" / "Class 7 B": the bare run-together form is accepted here
  // because a dashboard question naming "7B" can only mean a class.
  const original = String(prompt ?? '').slice(0, MAX_PROMPT);
  const named = classFromText(original) ?? (/\b(\d{1,2})([a-h])\b/i.exec(original) ? classFromText(original, { lenient: true }) : null);
  const classText = named && !named.gradeOnly ? named.text : named?.gradeOnly ? named.text : null;

  const raw = q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+[a-h]?$/.test(w));
  // One group per word the person typed: a word counts once, however many of its synonyms match.
  const groups = [...new Set(raw)].map((w) => [...new Set([w, ...(SYNONYMS[w] ?? [])])]);
  const words = [...new Set(groups.flat())];
  return { words, groups, preset, term, compare, bucket, classText, days };
}

/** How well a title matches the sentence's words (0 = not at all). */
export function scoreText(words, ...texts) {
  const hay = texts.map((t) => String(t ?? '').toLowerCase());
  const groups = Array.isArray(words[0]) ? words : words.map((w) => [w]);
  let score = 0;
  for (const group of groups) {
    let best = 0;
    for (const w of group) {
      if (w.length < 3) continue;
      if (hay[0]?.includes(w)) best = Math.max(best, 3);
      else if (hay.slice(1).some((h) => h.includes(w))) best = Math.max(best, 1);
    }
    score += best;
  }
  return score;
}

/**
 * A class named in words, resolved at the person's own scope -- the same
 * three answers the assistant gives (utils/classNames.js matching): not found,
 * not one of yours (nothing about it disclosed), or which section of a grade.
 */
export async function resolveClass(actor, permScope, text) {
  const key = classKey(text);
  if (!key) return null;
  const all = (await Section.find().select('_id name gradeId').populate('gradeId', 'name').lean())
    .map((s) => ({ sectionId: String(s._id), label: labelOfClass(s.gradeId?.name, s.name) }));
  const matches = all.filter((s) => classKey(s.label) === key)
    .concat(all.filter((s) => classKey(s.label) !== key && classKey(s.label).split(' ')[0] === key));
  if (!matches.length) throw new AppError(`I could not find a class called "${String(text).trim()}".`, 404, [], 'CLASS_NOT_FOUND');
  const allowed = permScope === 'ALL' ? null : actor.roleKey === 'TEACHER' ? (await getTeacherSectionIds(actor.profileId)).map(String) : [];
  const mine = matches.filter((s) => allowed === null || allowed.includes(s.sectionId));
  if (!mine.length) throw new AppError(`${matches.length === 1 ? matches[0].label : String(text).trim()} is not one of your classes.`, 403, [], 'CLASS_OUT_OF_SCOPE');
  if (mine.length > 1) throw new AppError(`Which one — ${mine.map((s) => s.label).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  return mine[0];
}

/* ── Source 1: the analytics workspace ────────────────── */

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bucketLabel = (b) => {
  const m = /^(\d{4})-(\d{2})$/.exec(b.label);
  if (m) return `${SHORT[Number(m[2]) - 1]} ${m[1].slice(2)}`;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.label);
  return d ? `${Number(d[3])} ${SHORT[Number(d[2]) - 1]}` : b.label;
};

async function seriesOf(m, ctx, list) {
  if (typeof m.series === 'function') return m.series(ctx, list);
  const out = [];
  for (const b of list) {
    // eslint-disable-next-line no-await-in-loop -- buckets share the request memo
    out.push((await evaluate(m, { ...ctx, period: b })).value);
  }
  return out;
}

const ymd = (d) => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;

/** The period a plan names: a preset, or the current term from the school's calendar. */
async function periodFor(plan, calendar, now) {
  const opts = { tz: calendar.tz, academicYearStartMonth: calendar.academicYearStartMonth, financialYearStartMonth: calendar.financialYearStartMonth, now };
  if (plan.term) {
    const term = await Term.findOne({ startsOn: { $lte: now }, endsOn: { $gte: now } }).lean();
    if (term) {
      const today = ymd(localDate(now, calendar.tz));
      const from = term.startsOn.toISOString().slice(0, 10);
      const to = term.endsOn.toISOString().slice(0, 10) < today ? term.endsOn.toISOString().slice(0, 10) : today;
      return { period: { ...resolvePeriod({ ...opts, preset: 'custom', from, to }), label: `${term.name} (so far)` }, note: null };
    }
    return { period: resolvePeriod({ ...opts, preset: 'quarter' }), note: 'No term is set for today in the school calendar, so this quarter is shown instead.' };
  }
  return { period: resolvePeriod({ ...opts, preset: plan.preset }), note: null };
}

async function analyticsPanel(actor, plan, prompt, now) {
  const permScope = actor.permissions?.['analytics.workspace.read'];
  if (!permScope || !(await featureEnabled('analytics'))) return null;
  let scope;
  try { scope = await resolveScope(actor, permScope); } catch { return null; }

  const candidates = catalogueMetrics({ departments: scope.departments })
    .map((m) => ({ m, score: scoreText(plan.groups, m.label, m.key.replace(/[._]/g, ' '), m.department) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.m.headline)) - Number(Boolean(a.m.headline)));
  if (!candidates.length) return null;
  const top = candidates[0].score;
  const chosen = candidates.filter((x) => x.score === top).slice(0, 3).map((x) => x.m);

  const notes = [];
  let classLabel = null;
  if (plan.classText) {
    try {
      const section = await resolveClass(actor, permScope, plan.classText);
      if (section) { scope = { ...scope, sectionIds: [section.sectionId] }; classLabel = section.label; }
    } catch (err) {
      return { refusal: err.message };
    }
  }

  const calendar = await schoolCalendar();
  const { period, note: periodNote } = await periodFor(plan, calendar, now);
  if (periodNote) notes.push(periodNote);
  const comparison = comparisonPeriod(period, { mode: plan.compare });
  const memo = new Map();
  const ctx = makeContext({ period, scope, calendar, now, memo });
  const cmpCtx = comparison ? makeContext({ period: comparison, scope, calendar, now, memo }) : null;

  const children = []; const sources = []; const data = [];
  for (const m of chosen) {
    /* eslint-disable no-await-in-loop -- metrics share the request memo */
    const cur = await evaluate(m, ctx);
    const cmp = cmpCtx ? await evaluate(m, cmpCtx) : null;
    const delta = cmp ? change(cur.value, cmp.value) : null;
    const unit = ['count', 'percent', 'paise', 'days'].includes(m.unit) ? m.unit : 'count';
    const link = safeHref(m.link) ?? '/analytics';
    children.push(cmp
      ? el('MetricCompare', m.label, cur.value, cmp.value, unit, period.label, comparison.label, link)
      : el('Kpi', m.label, cur.value, unit, cur.note ?? undefined, undefined, link));
    if (classLabel && !m.scopeAware) notes.push(`${m.label} is a whole-school figure; it cannot be narrowed to ${classLabel}.`);
    if (cur.coverage === 'NONE' || cur.coverage === 'PARTIAL' || cur.coverage === 'ERROR') notes.push(`${m.label}: ${cur.note ?? 'not available for this period'}`);

    const list = buckets(period, plan.bucket === 'auto' ? 'auto' : plan.bucket);
    let trend = null; let cmpTrend = null;
    if (!m.currentOnly && list.length >= 2 && list.length <= MAX_TREND_BUCKETS) {
      trend = await seriesOf(m, ctx, list);
      if (cmpCtx) {
        const cmpList = buckets(comparison, list[0].unit);
        if (cmpList.length <= MAX_TREND_BUCKETS) cmpTrend = await seriesOf(m, cmpCtx, cmpList);
      }
      const labels = list.map(bucketLabel);
      const series = [el('Series', period.label, trend.map((v) => (Number.isFinite(v) ? v : null)))];
      if (cmpTrend) series.push(el('Series', comparison.label, labels.map((_, i) => (Number.isFinite(cmpTrend[i]) ? cmpTrend[i] : null))));
      const per = list[0].unit === 'month' ? 'by month' : list[0].unit === 'week' ? 'by week' : 'by day';
      children.push(el(list[0].unit === 'day' && unit !== 'percent' ? 'BarChart' : 'LineChart', `${m.label} ${per}`, labels, series, unit, link));
    }
    /* eslint-enable no-await-in-loop */
    sources.push(el('Source', `Analytics: ${m.label} · ${cur.records ?? 0} record${cur.records === 1 ? '' : 's'} · ${period.from} to ${period.to}${classLabel ? ` · ${classLabel}` : ''}`, link));
    data.push({ metric: m.label, unit, currency: unit === 'paise' ? CURRENCY : null, current: cur.value, comparison: cmp?.value ?? null, change: delta, records: cur.records, trend, comparisonTrend: cmpTrend });
  }
  for (const n of [...new Set(notes)].slice(0, 4)) children.push(el('Callout', 'info', n));
  if (chosen.some((m) => m.department === 'finance' && /outstanding/.test(m.key))) {
    children.push(el('ActionCard', 'Remind families with overdue fees', 'The assistant drafts the reminder and shows it to you before anything is sent.', 'Draft a fee reminder for overdue invoices'));
  }
  children.push(el('Evidence', sources));

  const title = chosen.length === 1 ? chosen[0].label : chosen.map((m) => m.label).join(', ');
  const subtitle = [period.label, comparison ? `compared with ${comparison.label.toLowerCase()}` : null, classLabel].filter(Boolean).join(' · ');
  return {
    source: 'analytics', title, data,
    fallback: toLang(el('Panel', title, children, subtitle)),
    plan: { period: { from: period.from, to: period.to, label: period.label }, comparison: comparison ? { from: comparison.from, to: comparison.to, label: comparison.label } : null, metrics: chosen.map((m) => m.key), class: classLabel },
  };
}

/* ── Source 2: the person's own dashboard ─────────────── */

const DASH_UNITS = ['count', 'percent', 'paise', 'days'];
const unitOk = (u) => (DASH_UNITS.includes(u) ? u : 'count');
const toneOk = (t) => (['good', 'warn', 'bad', 'neutral'].includes(t) ? t : undefined);

function chartBlock(c) {
  const unit = unitOk(c.unit);
  const link = safeHref(c.link) ?? undefined;
  if (c.type === 'donut') return el('DonutChart', c.title, (c.points ?? []).map((p) => el('Slice', String(p.label), Number.isFinite(p.value) ? p.value : 0)), unit);
  const labels = (c.points ?? []).map((p) => String(p.label));
  const series = [el('Series', c.compare ? 'This period' : c.title, (c.points ?? []).map((p) => (Number.isFinite(p.value) ? p.value : null)))];
  if (c.compare?.points) series.push(el('Series', c.compare.label ?? 'Comparison', labels.map((_, i) => (Number.isFinite(c.compare.points[i]?.value) ? c.compare.points[i].value : null))));
  return el(c.type === 'line' ? 'LineChart' : 'BarChart', c.title, labels, series, unit, link);
}

async function dashboardPanel(actor, plan, child) {
  const d = await roleDashboard(actor, { days: plan.days, child });
  if (!d?.view) return null;
  const scored = [
    ...d.kpis.map((k) => ({ kind: 'kpi', item: k, score: scoreText(plan.groups, k.label, k.detail) })),
    ...d.charts.map((c) => ({ kind: 'chart', item: c, score: scoreText(plan.groups, c.title, c.definition) })),
    ...d.lists.map((l) => ({ kind: 'list', item: l, score: scoreText(plan.groups, l.title, l.empty) })),
  ].filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { source: 'dashboard', suggestions: [...d.charts.map((c) => c.title), ...d.lists.map((l) => l.title), ...d.kpis.map((k) => k.label)].slice(0, 8) };
  const pick = scored.filter((x) => x.score >= scored[0].score - 1).slice(0, 4);

  const children = []; const sources = [];
  for (const { kind, item } of pick) {
    if (kind === 'kpi') children.push(el('Kpi', item.label, Number.isFinite(item.value) ? item.value : null, unitOk(item.unit), item.detail ?? undefined, toneOk(item.tone), safeHref(item.link) ?? undefined));
    if (kind === 'chart') children.push(chartBlock(item));
    if (kind === 'list') {
      children.push(item.items.length
        ? el('RecordList', item.title, item.items.slice(0, 30).map((i) => el('Record', String(i.text), i.sub ?? undefined, safeHref(i.link ?? i.href) ?? undefined, i.badge ?? undefined)))
        : el('Callout', 'info', `${item.title}: ${item.empty}`));
    }
    sources.push(el('Source', `${d.title ?? 'My dashboard'}: ${item.title ?? item.label}`, safeHref(item.link) ?? undefined));
  }
  if (plan.classText) children.push(el('Callout', 'info', 'Your dashboard already shows only your own classes and records; a class filter applies on the Analytics page.'));
  children.push(el('Evidence', sources));
  const title = pick.length === 1 ? (pick[0].item.title ?? pick[0].item.label) : (d.title ?? 'My dashboard');
  const sub = [d.child?.name, `last ${d.period?.days ?? plan.days} days`].filter(Boolean).join(' · ');
  return {
    source: 'dashboard', title, data: pick.map((x) => x.item),
    fallback: toLang(el('Panel', title, children, sub)),
    plan: { days: d.period?.days ?? plan.days, items: pick.map((x) => x.item.key) },
  };
}

/* ── The answer ───────────────────────────────────────── */

function notFound(prompt, suggestions = [], refusal = null) {
  const children = [el('Callout', refusal ? 'warn' : 'info', refusal ?? `I could not find a figure for "${String(prompt).slice(0, 120)}" in what you can see.`)];
  if (suggestions.length) children.push(el('RecordList', 'You can ask about', suggestions.map((s) => el('Record', s))));
  return { source: 'none', title: 'No matching figures', data: null, fallback: toLang(el('Panel', 'No matching figures', children)), plan: null };
}

/**
 * POST /genui/ask -- one generated panel for a sentence.
 * @returns {{ title, source, plan, ui: { format, version, program, by } }}
 */
export async function askDashboard(actor, { prompt, child = null } = {}, { now = new Date() } = {}) {
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, MAX_PROMPT) : '';
  if (!text) throw new AppError('Type what you want to see, e.g. "fee collection this year by month".', 400, [], 'PROMPT_REQUIRED');
  if (child !== null && !/^[a-f0-9]{24}$/i.test(String(child))) throw new AppError('child must be a student id', 400, [], 'BAD_CHILD');
  const plan = planQuery(text);
  const key = ['genui', currentTenantId(), actor.profileId, actor.roleKey, child ?? '', text.toLowerCase()].join('|');
  return shortCache(key, ASK_CACHE_MS, async () => {
    let built = await analyticsPanel(actor, plan, text, now);
    if (built?.refusal) built = notFound(text, [], built.refusal);
    if (!built) {
      const dash = await dashboardPanel(actor, plan, child);
      built = dash?.fallback ? dash : notFound(text, dash?.suggestions ?? []);
    }
    const ui = await generatedUi({ message: text, data: built.data, fallback: built.fallback, lang: 'en' });
    return { title: built.title, source: built.source, plan: built.plan, ui };
  });
}
