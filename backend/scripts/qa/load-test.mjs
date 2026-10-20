// Load test: virtual users of each role hit the pages they open most, in
// stages of rising concurrency. Reports throughput, latency percentiles and
// errors per stage and the slowest endpoints. (k6-style stages, in Node.)
import fs from 'node:fs';
fs.mkdirSync(new URL('./qa-out/', import.meta.url), { recursive: true });
const B = process.env.API ?? 'http://127.0.0.1:5050/api/v1';
const STAGES = (process.env.STAGES ?? '10,25,50,100').split(',').map(Number);
const SECONDS = Number(process.env.SECONDS ?? 25);
const H = (t) => ({ 'Content-Type': 'application/json', 'x-school-id': 'oakridge', ...(t ? { Authorization: `Bearer ${t}` } : {}) });
const login = async (email) => (await (await fetch(`${B}/auth/login`, { method: 'POST', headers: H(), body: JSON.stringify({ email, password: 'ChangeMe@123!' }) })).json()).data.accessToken;
const fam = async (phone) => {
  for (let i = 0; i < 10; i++) {
    const o = await (await fetch(`${B}/auth/otp/request`, { method: 'POST', headers: H(), body: JSON.stringify({ phone }) })).json();
    if (o.data?.devOtp) return (await (await fetch(`${B}/auth/otp/verify`, { method: 'POST', headers: H(), body: JSON.stringify({ phone, code: o.data.devOtp }) })).json()).data.accessToken;
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`no OTP for ${phone}`);
};

// What each kind of user opens, weighted by how many of them there are in a school.
const PERSONAS = [
  { who: 'STUDENT', weight: 40, token: () => fam('+910000003012'), paths: ['/auth/me', '/dashboard/student', '/timetable/', '/attendance/summary', '/assignments/', '/fees/invoices', '/notifications/unread-count', '/syllabus/', '/community/feed', '/lectures/'] },
  { who: 'PARENT', weight: 30, token: () => fam('+910000004012'), paths: ['/auth/me', '/dashboard/parent', '/fees/overview', '/attendance/summary', '/exams/report-card', '/notifications/', '/calendar/'] },
  { who: 'TEACHER', weight: 20, token: () => login('teacher@schoolerp.com'), paths: ['/auth/me', '/dashboard/teacher', '/academics/sections/mine', '/timetable/', '/syllabus/', '/assignments/', '/campus/map', '/insights/pulse'] },
  { who: 'PRINCIPAL', weight: 5, token: () => login('principal@schoolerp.com'), paths: ['/insights/home', '/insights/pulse', '/approvals/inbox', '/campus/map', '/syllabus/', '/compliance/overview'] },
  { who: 'ADMIN', weight: 5, token: () => login('admin@schoolerp.com'), paths: ['/dashboard/admin', '/students/?pageSize=50', '/fees/invoices?pageSize=50', '/fees/summary', '/campus/map', '/approvals/inbox'] },
];
for (const p of PERSONAS) p.t = await p.token();
const pick = () => { let r = Math.random() * 100; for (const p of PERSONAS) { if ((r -= p.weight) <= 0) return p; } return PERSONAS[0]; };
const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);

const report = [];
const perPath = new Map();
for (const vus of STAGES) {
  const lat = []; let errors = 0; let done = 0; const codes = {};
  const until = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: vus }, async () => {
    while (Date.now() < until) {
      const p = pick();
      const path = p.paths[Math.floor(Math.random() * p.paths.length)];
      const t0 = performance.now();
      try {
        const r = await fetch(`${B}${path}`, { headers: H(p.t) });
        await r.arrayBuffer();
        codes[r.status] = (codes[r.status] ?? 0) + 1;
        if (r.status >= 400) errors += 1;
      } catch { errors += 1; codes.NET = (codes.NET ?? 0) + 1; }
      const ms = performance.now() - t0;
      lat.push(ms); done += 1;
      const k = `${p.who} ${path.split('?')[0]}`;
      const e = perPath.get(k) ?? []; e.push(ms); perPath.set(k, e);
    }
  }));
  lat.sort((a, b) => a - b);
  const row = { vus, requests: done, rps: +(done / SECONDS).toFixed(1), p50: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)), p99: Math.round(pct(lat, 0.99)), max: Math.round(lat.at(-1) ?? 0), errorRate: +((errors / Math.max(done, 1)) * 100).toFixed(2), codes };
  report.push(row);
  console.log(JSON.stringify(row));
}
const slow = [...perPath.entries()].map(([k, v]) => { v.sort((a, b) => a - b); return { k, n: v.length, p50: Math.round(pct(v, 0.5)), p95: Math.round(pct(v, 0.95)) }; }).sort((a, b) => b.p95 - a.p95).slice(0, 12);
console.log('\nslowest endpoints (all stages):');
for (const s of slow) console.log(`${String(s.p95).padStart(6)}ms p95  ${String(s.p50).padStart(5)}ms p50  n=${s.n}  ${s.k}`);
fs.writeFileSync(new URL('./qa-out/load-results.json', import.meta.url), JSON.stringify({ report, slow }, null, 1));
