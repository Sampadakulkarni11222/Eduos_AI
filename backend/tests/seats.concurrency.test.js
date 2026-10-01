import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { Student } from '../src/models/student.model.js';
import { SeatAccount, SeatLedgerEntry } from '../src/models/seat.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import * as seats from '../src/modules/seats/seat.service.js';
import * as users from '../src/modules/users/user.service.js';

/**
 * The last seat, contended.
 *
 * Seats in use are counted from profiles, so "is a seat free?" and "create the
 * user" used to be two separate steps: several creations arriving together each
 * counted the same profiles, each found the last seat free, and each created a
 * user — taking the school past the seats it had been approved for.
 *
 * Every test here launches creations at the same moment and asserts on what is
 * actually in the database afterwards, not only on what the calls returned:
 * exactly as many active profiles as approved seats, and no half-created
 * accounts left behind by the creations that lost.
 */

const OAK = 'oakridge';
const RIVER = 'riverside';

const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91988${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function seedPerson({ roleKey, tenantId, displayName }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const profile = await Profile.create({
    accountId: account._id, roleId: roleByKey.get(roleKey)._id, displayName,
    ...(tenantId ? { tenantId, tenantName: tenantId } : {}), status: 'ACTIVE',
  });
  return { accountId: String(account._id), profileId: String(profile._id), displayName };
}

let platform;
let oakAdmin;

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }
  await School.create({ slug: OAK, name: 'Oakridge Academy' });
  await School.create({ slug: RIVER, name: 'Riverside School' });
  platform = await seedPerson({ roleKey: 'SUPER_ADMIN', displayName: 'Platform Owner' });
  oakAdmin = await seedPerson({ roleKey: 'ADMIN', tenantId: OAK, displayName: 'Oakridge admin' });
});

const platformActor = () => ({ profileId: platform.profileId, displayName: 'Platform Owner', tenantId: null });
const sell = (slug, count) => runAcrossSchools(() => seats.grantSeats(platformActor(), slug, { seats: count }));
const inSchool = (slug, fn) => runWithTenant(slug, fn);

const activeProfiles = (slug) => Profile.countDocuments({ tenantId: slug, status: 'ACTIVE', deletedAt: null });

/** `n` teachers created at the same moment; returns the settled outcomes and the phones used. */
async function raceTeachers(slug, n, label = 'Racer') {
  const phones = Array.from({ length: n }, () => nextPhone());
  const outcomes = await Promise.allSettled(
    phones.map((phone, i) =>
      inSchool(slug, () => users.createUser({ roleKey: 'TEACHER', displayName: `${label} ${i + 1}`, phone }))),
  );
  return { outcomes, phones };
}

const fulfilled = (outcomes) => outcomes.filter((o) => o.status === 'fulfilled');
const rejected = (outcomes) => outcomes.filter((o) => o.status === 'rejected');

describe('the last free seat, under concurrent user creation', () => {
  it('is taken by exactly one of eight simultaneous creations', async () => {
    await sell(OAK, 3);
    await inSchool(OAK, () => users.createUser({ roleKey: 'TEACHER', displayName: 'Existing teacher', phone: nextPhone() }));
    // Approved 3; the admin and one teacher use 2; one seat is left.
    expect((await inSchool(OAK, () => seats.getSeatSummary())).availableSeats).toBe(1);

    const { outcomes, phones } = await raceTeachers(OAK, 8);

    expect(fulfilled(outcomes)).toHaveLength(1);
    expect(rejected(outcomes)).toHaveLength(7);
    for (const r of rejected(outcomes)) {
      expect(r.reason).toMatchObject({ statusCode: 409, code: 'NO_SEATS_AVAILABLE' });
    }

    // The database, not just the responses.
    expect(await activeProfiles(OAK)).toBe(3);
    expect((await inSchool(OAK, () => seats.getSeatSummary()))).toMatchObject({ approvedSeats: 3, usedSeats: 3, availableSeats: 0 });

    // The losers rolled back completely: only the winner's phone has an account.
    expect(await Account.countDocuments({ phoneE164: { $in: phones } })).toBe(1);
  });

  it('holds across repeated rounds: each new seat goes to exactly one racer', async () => {
    await sell(OAK, 1); // the admin's own seat; the school is full
    for (let round = 1; round <= 4; round += 1) {
      await sell(OAK, 1);
      const { outcomes } = await raceTeachers(OAK, 6, `Round ${round}`);
      expect(fulfilled(outcomes), `round ${round}`).toHaveLength(1);
      expect(await activeProfiles(OAK)).toBe(1 + round);
    }
    const account = await runAcrossSchools(() => SeatAccount.findOne({ tenantId: OAK }).lean());
    expect(await activeProfiles(OAK)).toBe(account.approvedSeats);
  });

  it('gives several free seats to exactly that many racers', async () => {
    await sell(OAK, 4); // admin + 3 free
    const { outcomes } = await raceTeachers(OAK, 10);
    expect(fulfilled(outcomes)).toHaveLength(3);
    expect(rejected(outcomes).every((r) => r.reason.code === 'NO_SEATS_AVAILABLE')).toBe(true);
    expect(await activeProfiles(OAK)).toBe(4);
  });

  it('refuses every racer when no seat is left', async () => {
    await sell(OAK, 1);
    const { outcomes, phones } = await raceTeachers(OAK, 5);
    expect(fulfilled(outcomes)).toHaveLength(0);
    expect(await Account.countDocuments({ phoneE164: { $in: phones } })).toBe(0);
  });
});

describe('through the real HTTP route', () => {
  let server;
  let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', apiRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('lets exactly one of eight concurrent POST /users take the final seat', async () => {
    await sell(OAK, 2); // admin + 1 free
    const token = signAccessToken({ accountId: oakAdmin.accountId, profileId: oakAdmin.profileId, door: null });

    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      fetch(`${base}/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ roleKey: 'TEACHER', displayName: `HTTP racer ${i + 1}`, phone: nextPhone() }),
      }).then(async (r) => ({ status: r.status, body: await r.json() }))));

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    expect(responses.filter((r) => r.status === 409).every((r) => r.body.error?.code === 'NO_SEATS_AVAILABLE')).toBe(true);
    expect(await activeProfiles(OAK)).toBe(2);
  });
});

describe('rollback when creation fails part-way', () => {
  it('leaves no account or profile behind when the student record fails, and the seat stays free', async () => {
    await sell(OAK, 3); // admin + 2 free
    await inSchool(OAK, () => users.createUser({
      roleKey: 'STUDENT', displayName: 'First Student', phone: nextPhone(), admissionNo: 'ADM-DUP-1',
    }));

    const failingPhone = nextPhone();
    await expect(inSchool(OAK, () => users.createUser({
      roleKey: 'STUDENT', displayName: 'Second Student', phone: failingPhone, admissionNo: 'ADM-DUP-1',
    }))).rejects.toThrow();

    expect(await Account.countDocuments({ phoneE164: failingPhone })).toBe(0);
    expect(await activeProfiles(OAK)).toBe(2);
    expect(await inSchool(OAK, () => Student.countDocuments({ admissionNo: 'ADM-DUP-1' }))).toBe(1);

    // The failed attempt did not hold the seat.
    await expect(inSchool(OAK, () => users.createUser({
      roleKey: 'TEACHER', displayName: 'Takes the free seat', phone: nextPhone(),
    }))).resolves.toBeTruthy();
    expect(await activeProfiles(OAK)).toBe(3);
  });

  it('does not consume a seat for a creation refused for a duplicate profile', async () => {
    await sell(OAK, 2); // admin + 1 free
    const phone = nextPhone();
    await inSchool(OAK, () => users.createUser({ roleKey: 'TEACHER', displayName: 'Only teacher', phone }));
    await sell(OAK, 1);
    await expect(inSchool(OAK, () => users.createUser({ roleKey: 'TEACHER', displayName: 'Same again', phone })))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await activeProfiles(OAK)).toBe(2);
    expect((await inSchool(OAK, () => seats.getSeatSummary())).availableSeats).toBe(1);
  });
});

describe('what the fix must not change', () => {
  it('keeps a school with no seat account unlimited, even under concurrency, and provisions nothing', async () => {
    const { outcomes } = await raceTeachers(RIVER, 6);
    expect(fulfilled(outcomes)).toHaveLength(6);
    expect(await runAcrossSchools(() => SeatAccount.countDocuments({ tenantId: RIVER }))).toBe(0);
  });

  it('keeps one school\'s full seats from blocking another school', async () => {
    await sell(OAK, 1);   // full
    await sell(RIVER, 5); // 5 free, nobody in it yet
    const [oak, river] = await Promise.all([raceTeachers(OAK, 4), raceTeachers(RIVER, 4)]);
    expect(fulfilled(oak.outcomes)).toHaveLength(0);
    expect(fulfilled(river.outcomes)).toHaveLength(4);
  });

  it('still counts only approved seats: approval releases exactly the seats it approves', async () => {
    await sell(OAK, 1); // full
    const actor = { profileId: oakAdmin.profileId, displayName: 'Oakridge admin', tenantId: OAK };
    const request = await inSchool(OAK, () => seats.createSeatRequest(actor, { seats: 2 }));
    // Paid through the service's own settlement, as the gateway would.
    const { SeatRequest } = await import('../src/models/seat.model.js');
    await inSchool(OAK, () => SeatRequest.updateOne(
      { _id: request.id }, { $set: { 'payment.gatewayOrderRef': 'order_race', 'payment.status': 'INITIATED' } },
    ));
    await seats.settleSeatPayment({
      event: 'payment.captured', orderId: 'order_race', gatewayPaymentId: 'order_race',
      amountPaise: request.amountPaise, verifyWithGateway: false,
    });

    // Purchased, not approved: nobody gets in.
    expect(fulfilled((await raceTeachers(OAK, 4, 'Before approval')).outcomes)).toHaveLength(0);

    await runAcrossSchools(() => seats.decideSeatRequest(platformActor(), request.id, { decision: 'APPROVED' }));
    const after = await raceTeachers(OAK, 5, 'After approval');
    expect(fulfilled(after.outcomes)).toHaveLength(2);
    expect(await activeProfiles(OAK)).toBe(3);

    // The ledger saw purchase, payment and approval only — creating users writes no seat movement.
    const events = (await runAcrossSchools(() => SeatLedgerEntry.find({ tenantId: OAK }).lean())).map((e) => e.event).sort();
    expect(events).toEqual(['EXTRA_SEATS_APPROVED', 'EXTRA_SEATS_PAID', 'PURCHASE']);
  });

  it('leaves the seat counters untouched by user creation', async () => {
    await sell(OAK, 5);
    await raceTeachers(OAK, 3);
    const account = await runAcrossSchools(() => SeatAccount.findOne({ tenantId: OAK }).lean());
    expect(account).toMatchObject({ purchasedSeats: 5, approvedSeats: 5 });
    expect(account.reservationVersion).toBe(3);
  });
});
