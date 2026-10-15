import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import attendanceRoutes from '../src/modules/attendance/attendance.routes.js';
import { classCheckInRouter } from '../src/modules/safety/safety.routes.js';
import { offlineIdempotency } from '../src/middleware/idempotency.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { ClassCheckIn } from '../src/models/safety.model.js';
import { IdempotencyRecord } from '../src/models/idempotencyRecord.model.js';
import { routeKind } from '../src/middleware/idempotency.js';

/**
 * Offline queue replays: a write sent with an Idempotency-Key runs once; the
 * replay returns the first response and writes nothing; a key reused for a
 * different body is refused; and a queued attendance entry that someone else
 * changed after it was queued is not overwritten (server wins, reported back).
 */
let server; let base; let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // As routes/index.js mounts it: the middleware ahead of the module routers.
  const api = express.Router();
  api.use(offlineIdempotency);
  api.use('/attendance', attendanceRoutes);
  api.use('/class-check-ins', classCheckInRouter);
  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(async () => { s = await seedFamilySchool(); });

async function post(person, path, body, headers = {}) {
  const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  return { status: res.status, replayed: res.headers.get('idempotent-replayed') === 'true', body: await res.json() };
}

const register = (records) => ({ sectionId: String(s.sectionA._id), date: ymdIn(0), periodNo: null, records });

describe('idempotency keys on offline writes', () => {
  it('covers exactly the offline workflows', () => {
    expect(routeKind('POST', '/attendance/mark')).toBe('ATTENDANCE');
    expect(routeKind('POST', '/labs/stock/issue')).toBe('LAB_STOCK');
    expect(routeKind('POST', '/labs/stock/return')).toBe('LAB_STOCK');
    expect(routeKind('POST', '/checkpoints/scan')).toBe('CHECKPOINT_SCAN');
    expect(routeKind('POST', '/sustainability/sanitation/0123456789abcdef01234567/checks')).toBe('SANITATION_CHECK');
    expect(routeKind('POST', '/ptm/bookings/0123456789abcdef01234567/check-in')).toBe('PTM_CHECK_IN');
    expect(routeKind('POST', '/class-check-ins')).toBe('CLASS_CHECK_IN');
    expect(routeKind('GET', '/attendance/mark')).toBeNull();
    expect(routeKind('POST', '/fees/payments')).toBeNull();
  });

  it('replays an attendance write without writing twice, and refuses the key for a different body', async () => {
    const T = s.people.TEACHER;
    const body = register([{ enrollmentId: String(s.aman.enrollment._id), status: 'PRESENT' }]);
    const first = await post(T, '/attendance/mark', body, { 'Idempotency-Key': 'att-key-0001' });
    expect(first.status).toBeLessThan(300);
    expect(first.replayed).toBe(false);
    const row1 = await inOak(() => AttendanceRecord.findOne({ enrollmentId: s.aman.enrollment._id }).lean());
    const again = await post(T, '/attendance/mark', body, { 'Idempotency-Key': 'att-key-0001' });
    expect(again.status).toBe(first.status);
    expect(again.replayed).toBe(true);
    expect(again.body).toEqual(first.body);
    const row2 = await inOak(() => AttendanceRecord.findOne({ enrollmentId: s.aman.enrollment._id }).lean());
    expect(row2.updatedAt.getTime()).toBe(row1.updatedAt.getTime());
    expect(await inOak(() => AttendanceRecord.countDocuments({ enrollmentId: s.aman.enrollment._id }))).toBe(1);
    const reused = await post(T, '/attendance/mark', register([{ enrollmentId: String(s.aman.enrollment._id), status: 'ABSENT' }]), { 'Idempotency-Key': 'att-key-0001' });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await inOak(() => AttendanceRecord.findOne({ enrollmentId: s.aman.enrollment._id }).lean())).status).toBe('PRESENT');
    // Keys are per person: another teacher's identical key is a different record.
    expect(await inOak(() => IdempotencyRecord.countDocuments({ key: 'att-key-0001' }))).toBe(1);
  });

  it('keeps the server copy when someone else changed an entry after the write was queued', async () => {
    const queuedAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    // The administrator corrects Rahul to LATE after the teacher queued her register offline.
    const fix = await post(s.people.ADMIN, '/attendance/mark', register([{ enrollmentId: String(s.rahul.enrollment._id), status: 'LATE' }]));
    expect(fix.status).toBeLessThan(300);
    const queued = await post(s.people.TEACHER, '/attendance/mark', register([
      { enrollmentId: String(s.rahul.enrollment._id), status: 'ABSENT' },
      { enrollmentId: String(s.aman.enrollment._id), status: 'PRESENT' },
    ]), { 'Idempotency-Key': 'att-key-0002', 'X-Offline-Queued-At': queuedAt });
    expect(queued.status).toBeLessThan(300);
    expect(queued.body.conflicts).toEqual([expect.objectContaining({ enrollmentId: String(s.rahul.enrollment._id), yours: 'ABSENT', kept: 'LATE' })]);
    expect(queued.body.data.conflicts).toHaveLength(1);
    expect(queued.body.message).toMatch(/school copy was kept/);
    expect((await inOak(() => AttendanceRecord.findOne({ enrollmentId: s.rahul.enrollment._id }).lean())).status).toBe('LATE');
    expect((await inOak(() => AttendanceRecord.findOne({ enrollmentId: s.aman.enrollment._id }).lean())).status).toBe('PRESENT');
    // When every entry conflicts, nothing is written and the answer is a 409 the queue shows as a notice.
    const all = await post(s.people.TEACHER, '/attendance/mark', register([{ enrollmentId: String(s.rahul.enrollment._id), status: 'EXCUSED' }]), { 'Idempotency-Key': 'att-key-0003', 'X-Offline-Queued-At': queuedAt });
    expect(all.status).toBe(409);
    expect(all.body.error.code).toBe('OFFLINE_CONFLICT');
  });

  it('replays a class check-in as the first answer instead of "already checked in"', async () => {
    const body = { date: ymdIn(0), periodNo: 1 };
    const first = await post(s.people.TEACHER, '/class-check-ins', body, { 'Idempotency-Key': 'chk-key-0001' });
    expect(first.status).toBe(201);
    const again = await post(s.people.TEACHER, '/class-check-ins', body, { 'Idempotency-Key': 'chk-key-0001' });
    expect(again.status).toBe(201);
    expect(again.replayed).toBe(true);
    expect(await inOak(() => ClassCheckIn.countDocuments({}))).toBe(1);
    // Without a key the endpoint behaves exactly as before.
    const plain = await post(s.people.TEACHER, '/class-check-ins', body);
    expect(plain.status).toBe(409);
    expect(plain.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('rejects a malformed key', async () => {
    const res = await post(s.people.TEACHER, '/attendance/mark', register([]), { 'Idempotency-Key': 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_IDEMPOTENCY_KEY');
  });
});
