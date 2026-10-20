// Reverse-engineering API sweep: every route found in the router, called as
// every identity with valid, invalid and hostile inputs. Finds 5xx crashes,
// unauthenticated access, family access to staff data, cross-school access,
// leaked internals and unbounded pages. Writes findings to sweep-results.json.
import fs from 'node:fs';
// Run against a THROWAWAY seeded instance with the rate limit lifted (RATE_LIMIT_MAX, RATE_LIMIT_AUTH_MAX): it sends
// thousands of requests, including writes with hostile bodies.
const B = process.env.API ?? 'http://127.0.0.1:5050/api/v1';
const SCHOOL = 'oakridge';
const routes = JSON.parse(fs.readFileSync(new URL('./qa-out/routes.json', import.meta.url)));
const only = process.argv[2]; // optional: 'get' or 'write'

const STAFF = {
  ADMIN: 'admin@schoolerp.com', PRINCIPAL: 'principal@schoolerp.com', TEACHER: 'teacher@schoolerp.com', FINANCE: 'finance@schoolerp.com',
  LIBRARIAN: 'librarian@schoolerp.com', WARDEN: 'warden@schoolerp.com', HR: 'hr@schoolerp.com', MARKETING: 'marketing@schoolerp.com',
  COMPLIANCE: 'compliance@schoolerp.com', TRUSTEE: 'trustee@schoolerp.com', SUPER_ADMIN: 'superadmin@schoolerp.com',
};
// Family sign-ins use OTP, which is throttled per number: pick numbers not used in the last few minutes.
const FAMILY = { STUDENT: process.env.QA_STUDENT ?? '+910000003020', PARENT: process.env.QA_PARENT ?? '+910000004020', ALUMNUS: '+910000000033' };
const H = (token, school = SCHOOL) => ({ 'Content-Type': 'application/json', 'x-school-id': school, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function login(key) {
  if (FAMILY[key]) {
    const o = await (await fetch(`${B}/auth/otp/request`, { method: 'POST', headers: H(), body: JSON.stringify({ phone: FAMILY[key] }) })).json();
    const r = await (await fetch(`${B}/auth/otp/verify`, { method: 'POST', headers: H(), body: JSON.stringify({ phone: FAMILY[key], code: o.data?.devOtp }) })).json();
    return r.data?.accessToken ?? null;
  }
  const r = await (await fetch(`${B}/auth/login`, { method: 'POST', headers: H(), body: JSON.stringify({ email: STAFF[key], password: 'ChangeMe@123!' }) })).json();
  return r.data?.accessToken ?? null;
}

const PUBLIC = [/^\/api\/v1\/health/, /^\/api\/v1\/auth\//, /^\/api\/v1\/schools\/public\//, /\/public(\/|$)/, /webhook/i, /^\/api\/v1\/payments\/razorpay\/webhook/];
const FAKE_ID = '6a0000000000000000000001';
const fill = (path, id) => path.replace(/:[A-Za-z_]+/g, id);
const findings = [];
const timings = [];
const leakRe = /(\n\s+at [\w.<>]+ \(|node_modules|E11000|Cast to ObjectId failed|MongoServerError|ValidationError: |ReferenceError|TypeError: )/;

async function call(method, path, token, { body, school, raw } = {}) {
  const t0 = performance.now();
  let res; let text = '';
  try {
    res = await fetch(`${B.replace(/\/api\/v1$/, '')}${path}`, { method, headers: H(token, school), body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    text = await res.text();
  } catch (e) { return { status: 0, text: String(e), ms: performance.now() - t0 }; }
  return { status: res.status, text, ms: performance.now() - t0 };
}
function note(kind, r, who, method, path, input, extra = '') {
  findings.push({ kind, who, method, path, input, status: r.status, extra, body: r.text.slice(0, 300) });
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

const tokens = { ANON: null };
for (const k of [...Object.keys(STAFF), ...Object.keys(FAMILY)]) tokens[k] = await login(k);
console.log('logged in:', Object.entries(tokens).filter(([, t]) => t).map(([k]) => k).join(' '));

const isPublic = (p) => PUBLIC.some((re) => re.test(p));
const gets = routes.filter((r) => r.method === 'GET');
const writes = routes.filter((r) => r.method !== 'GET' && !/\/auth\/(logout|refresh)/.test(r.path));

if (only !== 'write') {
  // 1. Every GET as every identity, with a well-formed but unknown id.
  const jobs = gets.flatMap((r) => Object.keys(tokens).map((who) => ({ r, who })));
  await pool(jobs, 10, async ({ r, who }) => {
    const path = fill(r.path, FAKE_ID);
    const res = await call('GET', path, tokens[who]);
    timings.push({ path: r.path, who, ms: res.ms, status: res.status, bytes: res.text.length });
    if (res.status >= 500) note('5xx', res, who, 'GET', path, 'none');
    if (who === 'ANON' && res.status < 300 && !isPublic(r.path)) note('anonymous-access', res, who, 'GET', path, 'none');
    if (leakRe.test(res.text)) note('internal-leak', res, who, 'GET', path, 'none');
    if (['STUDENT', 'PARENT', 'ALUMNUS'].includes(who) && res.status < 300 && !r.path.includes(':')) {
      note('family-200', res, who, 'GET', path, 'none', `bytes=${res.text.length}`);
    }
  });
  // 2. Hostile inputs on GET, as the administrator (widest access).
  const hostile = ['abc', '../../etc/passwd', '%24ne', 'null', '1e309'];
  const qs = '?page=-1&limit=100000&pageSize=100000&sort=__proto__&q[$ne]=x&search=.*(a%2B)%2B$&from=not-a-date&to=2026-13-45';
  await pool(gets, 8, async (r) => {
    for (const id of r.path.includes(':') ? hostile : []) {
      const path = fill(r.path, id);
      const res = await call('GET', path, tokens.ADMIN);
      if (res.status >= 500) note('5xx', res, 'ADMIN', 'GET', path, `id=${id}`);
      if (leakRe.test(res.text)) note('internal-leak', res, 'ADMIN', 'GET', path, `id=${id}`);
    }
    const path = fill(r.path, FAKE_ID) + qs;
    const res = await call('GET', path, tokens.ADMIN);
    if (res.status >= 500) note('5xx', res, 'ADMIN', 'GET', path, 'hostile query');
    if (leakRe.test(res.text)) note('internal-leak', res, 'ADMIN', 'GET', path, 'hostile query');
    if (res.status < 300 && res.text.length > 2_000_000) note('unbounded-page', res, 'ADMIN', 'GET', path, 'limit=100000', `bytes=${res.text.length}`);
  });
  // 3. Another school: an Oakridge principal asking as Riverside.
  await pool(gets.filter((r) => !isPublic(r.path)), 8, async (r) => {
    const res = await call('GET', fill(r.path, FAKE_ID), tokens.PRINCIPAL, { school: 'riverside' });
    if (res.status < 300) note('cross-school', res, 'PRINCIPAL@riverside', 'GET', r.path, 'x-school-id: riverside');
  });
}

if (only !== 'get') {
  // 4. Writes: anonymous must be refused; hostile bodies must never crash.
  const bodies = [
    ['empty', {}],
    ['operators', { id: { $ne: null }, email: { $gt: '' }, name: { $where: 'sleep(100)' }, status: { $in: ['x'] }, amountPaise: '1e309', date: 'not-a-date' }],
    ['types', { title: 12, name: ['a'], amountPaise: -5, items: 'x', topics: { a: 1 }, startsAt: 123, sectionIds: [FAKE_ID, 'bad'] }],
    ['xss', { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>', url: 'javascript:alert(1)', name: 'a'.repeat(200_000) }],
    ['proto', JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}')],
  ];
  await pool(writes, 6, async (r) => {
    const path = fill(r.path, FAKE_ID);
    const anon = await call(r.method, path, null, { body: {} });
    if (anon.status < 300 && !isPublic(r.path)) note('anonymous-write', anon, 'ANON', r.method, path, '{}');
    for (const [label, body] of bodies) {
      const res = await call(r.method, path, tokens.ADMIN, { body });
      if (res.status >= 500) note('5xx', res, 'ADMIN', r.method, path, label);
      if (leakRe.test(res.text)) note('internal-leak', res, 'ADMIN', r.method, path, label);
    }
    const bad = await call(r.method, path, tokens.ADMIN, { raw: '{"broken json' });
    if (bad.status >= 500) note('5xx', bad, 'ADMIN', r.method, path, 'malformed JSON');
    // A student sending a write to a staff route should be refused, not crash.
    const stu = await call(r.method, path, tokens.STUDENT, { body: {} });
    if (stu.status >= 500) note('5xx', stu, 'STUDENT', r.method, path, '{}');
  });
}

fs.writeFileSync(new URL(`./qa-out/sweep-results${only ? `-${only}` : ''}.json`, import.meta.url), JSON.stringify({ findings, timings }, null, 1));
const by = findings.reduce((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {});
console.log('findings by kind:', by);
for (const kind of Object.keys(by)) {
  console.log(`\n== ${kind}`);
  const seen = new Set();
  for (const f of findings.filter((x) => x.kind === kind)) {
    const k = `${f.method} ${f.path.replace(/[0-9a-f]{24}/g, ':id')} ${f.input}`;
    if (seen.has(k)) continue; seen.add(k);
    console.log(`${f.status} ${f.who} ${k} ${f.extra} :: ${f.body.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
const slow = timings.filter((t) => t.status < 300).sort((a, b) => b.ms - a.ms).slice(0, 15);
console.log('\n== slowest successful GETs');
for (const t of slow) console.log(`${Math.round(t.ms)}ms ${t.who} ${t.path} ${t.bytes}B`);
