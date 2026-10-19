// Ownership sweep: as a student and as a parent, call every GET route with
// another child's ids (in the query string and in the path) and flag any
// 2xx response that contains that child's data.
import fs from 'node:fs';
const B = process.env.API ?? 'http://127.0.0.1:5050/api/v1';
const H = (t) => ({ 'Content-Type': 'application/json', 'x-school-id': 'oakridge', ...(t ? { Authorization: `Bearer ${t}` } : {}) });
const routes = JSON.parse(fs.readFileSync(new URL('./qa-out/routes.json', import.meta.url))).filter((r) => r.method === 'GET');
const j = async (p, t) => { const r = await fetch(`${B}${p}`, { headers: H(t) }); return { status: r.status, text: await r.text() }; };
const fam = async (phone, tries = 8) => {
  const o = await (await fetch(`${B}/auth/otp/request`, { method: 'POST', headers: H(), body: JSON.stringify({ phone }) })).json();
  if (!o.data?.devOtp) { if (!tries) throw new Error(`OTP refused: ${JSON.stringify(o)}`); await new Promise((r) => setTimeout(r, 15000)); return fam(phone, tries - 1); }
  return (await (await fetch(`${B}/auth/otp/verify`, { method: 'POST', headers: H(), body: JSON.stringify({ phone, code: o.data.devOtp }) })).json()).data.accessToken;
};
const admin = (await (await fetch(`${B}/auth/login`, { method: 'POST', headers: H(), body: JSON.stringify({ email: 'admin@schoolerp.com', password: 'ChangeMe@123!' }) })).json()).data.accessToken;
const who = { STUDENT: await fam(process.env.QA_STUDENT ?? '+910000003021'), PARENT: await fam(process.env.QA_PARENT ?? '+910000004021') };

// The caller's own child, to exclude, and a victim in another class.
const me = JSON.parse((await j('/students/', who.STUDENT)).text).data[0];
const all = JSON.parse((await j('/students/?pageSize=200', admin)).text).data;
const list = all.items ?? all;
// Only a pupil with a current class: the demo data also has former students
// (the alumnus) with no section, and testing with one of them proves nothing
// about another class's records.
const sectionOf = (s) => s.enrollment?.sectionId ?? s.sectionId;
const victim = list.find((s) => s.id !== me.id && sectionOf(s) && sectionOf(s) !== sectionOf(me)) ?? list.find((s) => s.id !== me.id && sectionOf(s));
if (!victim) throw new Error('No other enrolled pupil to test with: seed the demo school first.');
const vDetail = JSON.parse((await j(`/students/${victim.id}`, admin)).text).data;
const v = {
  studentId: victim.id,
  enrollmentId: victim.enrollment?.id ?? vDetail?.enrollment?.id ?? vDetail?.enrollments?.[0]?.id,
  sectionId: victim.enrollment?.sectionId ?? vDetail?.enrollment?.sectionId,
  profileId: vDetail?.profileId ?? vDetail?.profile?.id,
  name: victim.name ?? `${victim.firstName} ${victim.lastName ?? ''}`.trim(),
  admissionNo: victim.admissionNo,
};
console.log('me', me.name, me.id, '| victim', JSON.stringify(v));
const markers = [v.studentId, v.enrollmentId, v.admissionNo, v.name].filter(Boolean).map(String);
const leaks = (text) => markers.filter((m) => text.includes(m));

const findings = [];
const params = Object.entries({ studentId: v.studentId, enrollmentId: v.enrollmentId, sectionId: v.sectionId, profileId: v.profileId, childId: v.studentId }).filter(([, x]) => x);
for (const r of routes) {
  if (/\/auth\/|health|observability/.test(r.path)) continue;
  const paths = [];
  if (r.path.includes(':')) {
    for (const [k, id] of params) paths.push([r.path.replace(/:[A-Za-z_]+/, id).replace(/:[A-Za-z_]+/g, id), `path=${k}`]);
  } else {
    paths.push([`${r.path}?${params.map(([k, x]) => `${k}=${x}`).join('&')}`, 'query ids']);
  }
  for (const [p, how] of paths) {
    for (const [role, t] of Object.entries(who)) {
      const res = await j(p.replace('/api/v1', ''), t);
      if (res.status < 300) {
        const hit = leaks(res.text);
        if (hit.length) findings.push({ role, route: `GET ${r.path}`, how, hit, sample: res.text.slice(0, 220) });
      }
    }
  }
}
fs.writeFileSync(new URL('./qa-out/ownership-results.json', import.meta.url), JSON.stringify(findings, null, 1));
const seen = new Set();
for (const f of findings) {
  const k = `${f.role} ${f.route} ${f.how}`;
  if (seen.has(k)) continue; seen.add(k);
  console.log(`LEAK? ${k} -> contains ${f.hit.join(', ')} :: ${f.sample.replace(/\s+/g, ' ').slice(0, 160)}`);
}
console.log(`${seen.size} route/role combinations returned the other child's data`);
