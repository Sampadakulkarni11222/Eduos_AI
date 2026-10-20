import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mongoose from 'mongoose';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';

/**
 * Demo completeness: runs the whole `npm run demo` seed (school data, demo
 * users, sample data for every section) into its own in-memory database, then
 * signs in as each of the thirteen portals' demo people and asks the API for
 * the screens they open first. Every one must come back with data, so a
 * change that leaves a portal looking empty in the demo fails here rather than
 * in front of the product owner.
 *
 * Slow on purpose (it seeds a 720-pupil school with a year and a half of
 * history); everything else in the suite uses small fixtures. Set
 * SKIP_DEMO_COMPLETENESS=1 to leave it out of a quick local run.
 */
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'eduos_demo_completeness';
const skip = process.env.SKIP_DEMO_COMPLETENESS === '1';

function demoUri() {
  // The suite's in-memory replica set (tests/setup.js), with a database of our own.
  const client = mongoose.connection.getClient();
  const { hosts, replicaSet } = client.options;
  const host = hosts.map((h) => `${h.host}:${h.port}`).join(',');
  return `mongodb://${host}/${DB}${replicaSet ? `?replicaSet=${replicaSet}` : ''}`;
}

function runSeed(file, uri) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_ENV: 'development', MONGO_URI: uri, MONGO_URI_ATLAS: '', LOG_LEVEL: 'warn', SEED_SCHOOL_SLUG: 'oakridge' };
    const child = spawn(process.execPath, [file], { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${file} exited with ${code}\n${out.slice(-3000)}`))));
  });
}

/** How many things a response carries: list length, or items/rows of a page. */
function sizeOf(body) {
  const d = body?.data !== undefined ? body.data : body;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === 'object') {
    for (const k of ['items', 'rows', 'results', 'children', 'metrics']) if (Array.isArray(d[k])) return d[k].length;
    return Object.keys(d).length ? 1 : 0;
  }
  return d ? 1 : 0;
}

// Who signs in, and the screens each portal opens first: [path, minimum number of things].
const PORTALS = {
  principal: ['principal@schoolerp.com', [['/tickets', 10], ['/tasks?view=mine&status=open', 2], ['/payroll/payslips/mine', 3], ['/staff/leave?view=mine', 1], ['/governance/actions', 2], ['/compliance/my/policies', 3], ['/budgets', 2], ['/payroll/runs', 4], ['/community/mentors?all=true', 2], ['/newsletter/alerts/sources', 1], ['/newsletter/alerts/items', 4], ['/exam-rooms/sittings', 2], ['/exam-rooms/rooms', 1], ['/exam-rooms/shifts', 2]]],
  admin: ['admin@schoolerp.com', [['/tickets', 10], ['/document-requests', 10], ['/registrations/review?status=PENDING', 10], ['/transport/routes', 4], ['/transport/requests/review?status=PENDING', 3], ['/accounts-export/fee-heads', 4], ['/academics/years', 2]]],
  teacher: ['teacher@schoolerp.com', [['/quizzes', 4], ['/leave?status=PENDING', 3], ['/registrations/review?status=PENDING', 5], ['/payroll/payslips/mine', 3], ['/compliance/my/policies', 3], ['/staff/leave?view=mine', 1], ['/teaching/lesson-plans', 4], ['/teaching/question-bank/scopes', 1], ['/teaching/papers', 1], ['/teaching/cpd', 1], ['/exam-rooms/sittings', 1]]],
  finance: ['finance@schoolerp.com', [['/payroll/runs', 4], ['/payroll/payslips/mine', 3], ['/budgets', 2], ['/accounts-export/fee-heads', 4], ['/compliance/my/policies', 3], ['/finance-reports/cash-close', 2], ['/finance-reports/ageing', 5]]],
  librarian: ['librarian@schoolerp.com', [['/library/requests/review?status=PENDING', 3], ['/library/books?resourceKind=NOTE', 5], ['/library/books?resourceKind=QUESTION_PAPER', 5], ['/tickets', 2], ['/tasks?view=mine&status=open', 2], ['/payroll/payslips/mine', 3], ['/approvals?mine=true', 2], ['/library/desk/holds', 1], ['/library/desk/challenges', 1], ['/library/desk/overdue', 1]]],
  warden: ['warden@schoolerp.com', [['/outpass?status=PENDING_WARDEN', 2], ['/tickets', 2], ['/payroll/payslips/mine', 3], ['/staff/leave?view=mine', 1], ['/approvals?mine=true', 2], ['/hostel/life/rollcalls', 1], ['/hostel/life/incidents?status=ALL', 2]]],
  hr: ['hr@schoolerp.com', [['/payroll/runs', 4], ['/payroll/payslips/mine', 3], ['/staff/leave?view=mine', 1], ['/tasks?view=mine&status=open', 1], ['/recruitment/vacancies', 3], ['/recruitment/candidates', 5], ['/exits', 1]]],
  // Part 4: the nurse's health room and watch list.
  nurse: ['nurse@schoolerp.com', [['/health/visits', 3], ['/health/stock', 3], ['/health-insights', 1]]],
  marketing: ['marketing@schoolerp.com', [['/approvals?mine=true', 2], ['/tasks?view=mine&status=open', 2], ['/payroll/payslips/mine', 3], ['/staff/leave?view=mine', 1], ['/admissions/followups/counsellors', 1]]],
  compliance: ['compliance@schoolerp.com', [['/approvals?mine=true', 5], ['/compliance/my/policies', 3], ['/payroll/payslips/mine', 3], ['/compliance/privacy/committees', 3], ['/compliance/privacy/requests?status=ALL', 3]]],
  trustee: ['trustee@schoolerp.com', [['/governance/actions', 2], ['/governance/meetings', 2], ['/budgets', 2]]],
  student: ['+910000003001', [['/quizzes', 4], ['/quizzes/my-attempts', 2], ['/library/books?resourceKind=NOTE', 5], ['/library/books?resourceKind=QUESTION_PAPER', 5], ['/tickets', 2], ['/registrations/mine', 1], ['/leave/mine', 1], ['/document-requests/mine', 1], ['/student-requests/cocurricular', 1], ['/community/mentors', 2], ['/community/mentoring', 1], ['/report-cards/published', 1], ['/support-plans/family', 1], ['/student-planner/me', 1], ['/alumni-services/opportunities', 1], ['/exam-rooms/my-exams', 1]]],
  parent: ['+910000004001', [['/fees/invoices', 4], ['/tickets', 2], ['/leave/mine', 1], ['/document-requests/mine', 1], ['/compliance/my/policies', 2], ['/report-cards/published', 1], ['/support-plans/family', 1], ['/students', 2], ['/exam-rooms/my-exams', 1]]],
  alumnus: ['+910000000033', [['/community/mentors', 2], ['/alumni-services/opportunities', 4], ['/alumni-services/documents', 1], ['/alumni-services/opportunities/mine', 1]]],
};

describe.skipIf(skip)('demo completeness: every portal has sample data', () => {
  let server; let base; let originalDb;

  beforeAll(async () => {
    const uri = demoUri();
    for (const file of ['src/seed/seed_school_data.js', 'src/seed/seed.js', 'src/seed/seed_operations.js']) {
      // eslint-disable-next-line no-await-in-loop
      const out = await runSeed(file, uri);
      if (file.endsWith('seed_operations.js')) {
        const failed = out.split('\n').filter((l) => l.includes('✘'));
        if (failed.length) throw new Error(`Seed sections failed:\n${failed.join('\n')}`);
      }
    }
    originalDb = mongoose.connection.name;
    await mongoose.disconnect();
    await mongoose.connect(uri);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', apiRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }, 900_000);

  afterAll(async () => {
    server?.close();
    await mongoose.connection.db?.dropDatabase().catch(() => {});
    if (originalDb) { const uri = demoUri().replace(`/${DB}`, `/${originalDb}`); await mongoose.disconnect(); await mongoose.connect(uri); }
  });

  // One test on purpose: the suite's afterEach clears every collection, so the seeded school only lives for one.
  it('signs in as each of the 13 portals and finds data on their key screens, and analytics can compare with last year', async () => {
    // The timetable is believable: no teacher in two rooms at once, and no one past 7 periods a day.
    const db = mongoose.connection.db;
    const teachers = new Map((await db.collection('subjectofferings').find({}, { projection: { teacherId: 1 } }).toArray()).map((o) => [String(o._id), String(o.teacherId)]));
    const at = new Map(); const daily = new Map();
    for (const slot of await db.collection('timetableslots').find({ subjectOfferingId: { $ne: null } }).toArray()) {
      const teacher = teachers.get(String(slot.subjectOfferingId));
      if (!teacher || teacher === 'undefined') continue;
      const key = `${slot.tenantId}|${teacher}|${slot.dayOfWeek}|${slot.periodNo}`;
      at.set(key, (at.get(key) ?? 0) + 1);
      const dayKey = `${slot.tenantId}|${teacher}|${slot.dayOfWeek}`;
      daily.set(dayKey, (daily.get(dayKey) ?? 0) + 1);
    }
    expect([...at].filter(([, n]) => n > 1), 'teachers double-booked').toEqual([]);
    expect([...daily].filter(([, n]) => n > 7), 'teachers over 7 periods a day').toEqual([]);

    const empty = [];
    for (const [portal, [who, checks]] of Object.entries(PORTALS)) {
      // eslint-disable-next-line no-await-in-loop
      const account = await Account.findOne(who.startsWith('+') ? { phoneE164: who } : { email: who }).lean();
      // eslint-disable-next-line no-await-in-loop
      const profile = account && await Profile.findOne({ accountId: account._id, deletedAt: null }).lean();
      if (!profile) { empty.push(`${portal}: no demo person (${who})`); continue; }
      const token = signAccessToken({ accountId: String(account._id), profileId: String(profile._id), door: null });
      for (const [url, min] of checks) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(base + url, { headers: { authorization: `Bearer ${token}` } });
        // eslint-disable-next-line no-await-in-loop
        const body = await res.json().catch(() => null);
        const n = res.ok ? sizeOf(body) : null;
        if (!res.ok || n < min) empty.push(`${portal} ${url}: ${res.ok ? `${n} (wanted at least ${min})` : `HTTP ${res.status} ${body?.message ?? ''}`}`);
      }
    }

    // Year-on-year: this summer term against the same months last year.
    const principal = await Profile.findOne({ accountId: (await Account.findOne({ email: 'principal@schoolerp.com' }).lean())._id }).lean();
    const token = signAccessToken({ accountId: String(principal.accountId), profileId: String(principal._id), door: null });
    const res = await fetch(`${base}/analytics/overview?from=2026-07-01&to=2026-09-30&compare=lastYear`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json();
    expect(res.status).toBe(200);
    for (const key of ['academics.attendance_rate', 'academics.exam_average', 'finance.net_collections', 'admissions.enquiries']) {
      const m = body.data.metrics.find((x) => x.key === key);
      if (!m?.change?.comparable) empty.push(`analytics ${key}: not comparable with last year (${m?.change?.reason ?? 'missing'})`);
    }

    expect(empty, `Screens with no sample data in the demo:\n${empty.join('\n')}`).toEqual([]);
  }, 300_000);
});
