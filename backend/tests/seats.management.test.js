import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SeatAccount, SeatRequest, SeatLedgerEntry } from '../src/models/seat.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { env } from '../src/config/env.js';
import * as seats from '../src/modules/seats/seat.service.js';
import * as users from '../src/modules/users/user.service.js';
import { quoteSeats } from '../src/modules/seats/seat.pricing.js';

/**
 * Seat management, and the approval a school's extra seats have to pass.
 *
 * The flow under test is the one the feature promises:
 *
 *   purchase → approved → used → available
 *     → request → server prices it → payment → PAID
 *     → Super Admin decides → only an approval releases the seats
 *
 * Written against the services rather than through HTTP, for the same reason
 * the other authorization suites are: these are rules about what may happen,
 * and a rule that only holds on one route is not a rule. The route guards are
 * covered separately, by running the real requirePermission middleware over the
 * real permission catalogue.
 */

const OAK = 'oakridge';
const RIVER = 'riverside';

const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91977${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

/** A signed-in person, shaped exactly as middleware/auth.js shapes req.actor. */
async function seedPerson({ roleKey, tenantId = OAK, displayName = 'Test person' }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get(roleKey);
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName,
    tenantId, tenantName: tenantId, status: 'ACTIVE',
  });
  return {
    profile,
    actor: {
      accountId: String(account._id),
      profileId: String(profile._id),
      displayName,
      roleKey,
      permissions: buildPermissionMap(role),
      tenantId,
    },
  };
}

/** The platform administrator: a real SUPER_ADMIN profile, belonging to no school. */
async function seedSuperAdmin() {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get('SUPER_ADMIN');
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName: 'Platform Owner', status: 'ACTIVE',
  });
  return {
    profile,
    actor: {
      accountId: String(account._id), profileId: String(profile._id),
      displayName: 'Platform Owner', roleKey: 'SUPER_ADMIN',
      permissions: buildPermissionMap(role), tenantId: null,
    },
  };
}

let oakAdmin;
let riverAdmin;
let platform;
const savedProvider = env.PAYMENT_PROVIDER;

beforeEach(async () => {
  env.PAYMENT_PROVIDER = 'sandbox';
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({
      key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.grants,
    }));
  }
  await School.create({ slug: OAK, name: 'Oakridge Academy' });
  await School.create({ slug: RIVER, name: 'Riverside School' });

  oakAdmin = await seedPerson({ roleKey: 'ADMIN', tenantId: OAK, displayName: 'Oakridge admin' });
  riverAdmin = await seedPerson({ roleKey: 'ADMIN', tenantId: RIVER, displayName: 'Riverside admin' });
  platform = await seedSuperAdmin();
});

afterEach(() => {
  env.PAYMENT_PROVIDER = savedProvider;
  vi.restoreAllMocks();
});

const inOak = (fn) => runWithTenant(OAK, fn);
const inRiver = (fn) => runWithTenant(RIVER, fn);
const platformRun = (fn) => runAcrossSchools(fn);

/** Sells a school seats the way the console does. */
const sell = (slug, count) => platformRun(() => seats.grantSeats(platform.actor, slug, { seats: count }));

/** The whole happy path up to "paid, undecided". */
async function paidRequest({ count = 10, slug = OAK } = {}) {
  const run = slug === OAK ? inOak : inRiver;
  const actor = slug === OAK ? oakAdmin.actor : riverAdmin.actor;
  const request = await run(() => seats.createSeatRequest(actor, { seats: count, reason: 'Growing' }));
  await run(() => seats.startSeatPayment(actor, request.id));
  return run(() => seats.getSeatRequest(request.id));
}

/* ── 1. The four numbers ──────────────────────────────────── */

describe('the seat summary', () => {
  it('reports purchased, approved, used and available for the acting school', async () => {
    await sell(OAK, 100);
    const summary = await inOak(() => seats.getSeatSummary());

    expect(summary.purchasedSeats).toBe(100);
    expect(summary.approvedSeats).toBe(100);
    // The school's own admin holds one of them.
    expect(summary.usedSeats).toBe(1);
    expect(summary.availableSeats).toBe(99);
    expect(summary.awaitingApprovalSeats).toBe(0);
  });

  it('counts only the acting school\'s people', async () => {
    await sell(OAK, 50);
    await sell(RIVER, 50);
    await seedPerson({ roleKey: 'TEACHER', tenantId: RIVER, displayName: 'Riverside teacher' });

    expect((await inOak(() => seats.getSeatSummary())).usedSeats).toBe(1);
    expect((await inRiver(() => seats.getSeatSummary())).usedSeats).toBe(2);
  });

  it('never reports a negative number of available seats', async () => {
    await sell(OAK, 1);
    await seedPerson({ roleKey: 'TEACHER', tenantId: OAK });
    await seedPerson({ roleKey: 'TEACHER', tenantId: OAK });

    const summary = await inOak(() => seats.getSeatSummary());
    expect(summary.usedSeats).toBe(3);
    expect(summary.availableSeats).toBe(0);
  });

  it('does not provision a seat account merely by being read', async () => {
    // A school nobody has sold seats to is unlimited. If reading the summary
    // created an account at zero, that read would silently cap the school.
    await inOak(() => seats.getSeatSummary());
    expect(await SeatAccount.countDocuments({ tenantId: OAK })).toBe(0);
    await expect(inOak(() => seats.assertSeatAvailable())).resolves.toBeUndefined();
  });

  it('refuses to answer for a platform-level caller who has named no school', async () => {
    await expect(platformRun(() => seats.getSeatSummary())).rejects.toMatchObject({
      statusCode: 400, code: 'SCHOOL_REQUIRED',
    });
  });
});

/* ── 2. The server prices it ──────────────────────────────── */

describe('the amount is the server\'s, not the caller\'s', () => {
  it('ignores any price the caller sends and computes its own', async () => {
    const request = await inOak(() =>
      seats.createSeatRequest(oakAdmin.actor, {
        seats: 10,
        amountPaise: 1, unitPricePaise: 1, discountPct: 99, // all ignored
      }),
    );

    const expected = quoteSeats(10);
    expect(request.amountPaise).toBe(expected.amountPaise);
    expect(request.unitPricePaise).toBe(expected.unitPricePaise);
    expect(request.discountPct).toBe(expected.discountPct);
    expect(request.amountPaise).toBe(10 * request.unitPricePaise);
  });

  it('applies the volume tiers by seat count alone', () => {
    expect(quoteSeats(10).discountPct).toBe(0);
    expect(quoteSeats(100).discountPct).toBe(5);
    expect(quoteSeats(500).discountPct).toBe(10);
    // The discount comes off the gross, rounded down.
    expect(quoteSeats(500).amountPaise).toBe(500 * quoteSeats(500).unitPricePaise * 0.9);
  });

  it.each([0, -5, 2.5, 'ten', null, 10_000])('refuses %s as a seat count', async (bad) => {
    await expect(inOak(() => seats.createSeatRequest(oakAdmin.actor, { seats: bad }))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('charges the gateway the amount it stored, not one supplied at payment time', async () => {
    const request = await inOak(() => seats.createSeatRequest(oakAdmin.actor, { seats: 10 }));
    const paid = await inOak(() => seats.startSeatPayment(oakAdmin.actor, request.id));
    expect(paid.amountPaise).toBe(request.amountPaise);
  });

  it('refuses to charge a request whose stored amount no longer follows from its seat count', async () => {
    const request = await inOak(() => seats.createSeatRequest(oakAdmin.actor, { seats: 10 }));
    // Tampered in the database, which is the only way this state can arise.
    await inOak(() => SeatRequest.updateOne({ _id: request.id }, { $set: { amountPaise: 1 } }));

    await expect(inOak(() => seats.startSeatPayment(oakAdmin.actor, request.id))).rejects.toMatchObject({
      statusCode: 409, code: 'SEAT_PRICE_MISMATCH',
    });
  });
});

/* ── 3. Payment buys seats; it does not release them ──────── */

describe('payment', () => {
  it('moves the request to PAID and increases purchased seats only', async () => {
    await sell(OAK, 100);
    const request = await paidRequest({ count: 10 });

    expect(request.status).toBe('PAID');
    expect(request.paymentStatus).toBe('PAID');
    expect(request.receiptNo).toMatch(/^SEAT-/);

    const summary = await inOak(() => seats.getSeatSummary());
    expect(summary.purchasedSeats).toBe(110);
    expect(summary.approvedSeats).toBe(100); // untouched by money
    expect(summary.awaitingApprovalSeats).toBe(10);
  });

  it('does not let the paid-for seats be used before approval', async () => {
    await sell(OAK, 2); // the admin holds one; one free
    await paidRequest({ count: 50 });

    await inOak(() => users.createUser({ roleKey: 'TEACHER', displayName: 'First hire', phone: nextPhone() }));
    // The 50 paid seats are purchased, not approved, so the school is full.
    await expect(
      inOak(() => users.createUser({ roleKey: 'TEACHER', displayName: 'Second hire', phone: nextPhone() })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'NO_SEATS_AVAILABLE' });
  });

  it('settles a repeated gateway delivery exactly once', async () => {
    await sell(OAK, 100);
    const request = await paidRequest({ count: 10 });
    const order = (await inOak(() => seats.getSeatRequest(request.id))).gatewayOrderRef;

    const again = await seats.settleSeatPayment({
      event: 'payment.captured', orderId: order, gatewayPaymentId: order,
      amountPaise: request.amountPaise, verifyWithGateway: false,
    });

    expect(again).toMatchObject({ handled: true, idempotent: true });
    const summary = await inOak(() => seats.getSeatSummary());
    expect(summary.purchasedSeats).toBe(110); // not 120
    expect(await inOak(() => SeatLedgerEntry.countDocuments({ event: 'EXTRA_SEATS_PAID' }))).toBe(1);
  });

  it('refuses a delivery whose amount is not the one we ordered, and buys nothing', async () => {
    await sell(OAK, 100);
    const request = await inOak(() => seats.createSeatRequest(oakAdmin.actor, { seats: 10 }));
    await inOak(() => SeatRequest.updateOne(
      { _id: request.id },
      { $set: { 'payment.gatewayOrderRef': 'order_forged', 'payment.status': 'INITIATED' } },
    ));

    const result = await seats.settleSeatPayment({
      event: 'payment.captured', orderId: 'order_forged', gatewayPaymentId: 'pay_1',
      amountPaise: 1, verifyWithGateway: false,
    });

    expect(result).toMatchObject({ handled: false, reason: 'AMOUNT_MISMATCH' });
    expect((await inOak(() => seats.getSeatSummary())).purchasedSeats).toBe(100);
    expect((await inOak(() => seats.getSeatRequest(request.id))).status).toBe('PENDING_PAYMENT');
  });

  it('ignores an event for an order it never issued', async () => {
    const result = await seats.settleSeatPayment({
      event: 'payment.captured', orderId: 'order_from_another_deployment',
      amountPaise: 500000, verifyWithGateway: false,
    });
    expect(result).toMatchObject({ handled: false, reason: 'No matching seat request' });
  });

  it('will not start a second payment for a request that is already paid', async () => {
    await sell(OAK, 100);
    const request = await paidRequest({ count: 10 });
    await expect(inOak(() => seats.startSeatPayment(oakAdmin.actor, request.id))).rejects.toMatchObject({
      statusCode: 409, code: 'SEAT_REQUEST_ALREADY_PAID',
    });
  });
});

/* ── 4. The Super Admin's decision ────────────────────────── */

describe('approval', () => {
  it('is what makes the seats usable', async () => {
    await sell(OAK, 2);
    const request = await paidRequest({ count: 50 });

    const decided = await platformRun(() =>
      seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED', note: 'Growth plan agreed' }),
    );
    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedBy).toBe('Platform Owner');

    const summary = await inOak(() => seats.getSeatSummary());
    expect(summary.approvedSeats).toBe(52);
    expect(summary.awaitingApprovalSeats).toBe(0);

    // And the school can now hire.
    await expect(
      inOak(() => users.createUser({ roleKey: 'TEACHER', displayName: 'New hire', phone: nextPhone() })),
    ).resolves.toBeTruthy();
  });

  it('refuses a request that has not been paid for', async () => {
    await sell(OAK, 10);
    const request = await inOak(() => seats.createSeatRequest(oakAdmin.actor, { seats: 5 }));

    await expect(
      platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SEAT_REQUEST_UNPAID' });

    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(10);
  });

  it.each(['APPROVED', 'REJECTED'])('refuses to process a request that was already %s', async (verdict) => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });
    await platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: verdict }));

    for (const second of ['APPROVED', 'REJECTED']) {
      await expect(
        platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: second })),
      ).rejects.toMatchObject({ statusCode: 409, code: 'SEAT_REQUEST_DECIDED' });
    }
    // One decision, one decision entry in the history — the payment entry
    // alongside it is the other half of the request's story, not a repeat.
    expect(
      await inOak(() =>
        SeatLedgerEntry.countDocuments({
          requestId: request.id,
          event: { $in: ['EXTRA_SEATS_APPROVED', 'EXTRA_SEATS_REJECTED'] },
        }),
      ),
    ).toBe(1);
    expect(await inOak(() => SeatLedgerEntry.countDocuments({ requestId: request.id }))).toBe(2);
  });

  it('rejects without changing any balance, and says so in the history', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });

    await platformRun(() =>
      seats.decideSeatRequest(platform.actor, request.id, { decision: 'REJECTED', note: 'Outside the contract' }),
    );

    const summary = await inOak(() => seats.getSeatSummary());
    // Still purchased — the money was taken and has not been refunded here.
    expect(summary.purchasedSeats).toBe(15);
    expect(summary.approvedSeats).toBe(10);

    const [latest] = await inOak(() => seats.listSeatHistory({ limit: 1 }));
    expect(latest).toMatchObject({ event: 'EXTRA_SEATS_REJECTED', approvedDelta: 0, note: 'Outside the contract' });
  });

  it('allocates the seats once when two approvals arrive together', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 40 });

    const results = await Promise.allSettled([
      platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED' })),
      platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(50); // not 90
  });

  it('refuses a decision by the school that raised the request', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });

    // A platform account that also holds a profile in the school. The
    // permission alone would let this through; the service will not.
    const selfApprover = {
      ...platform.actor,
      tenantId: OAK,
      permissions: { ...platform.actor.permissions, 'seats.approve': 'ALL' },
    };

    await expect(
      inOak(() => seats.decideSeatRequest(selfApprover, request.id, { decision: 'APPROVED' })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SEAT_SELF_APPROVAL' });
    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(10);
  });

  it('refuses a decision made from inside the school\'s own console', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });

    // A platform administrator who has opened Oakridge. The permission is
    // theirs; the vantage point is the school's, and that is what is refused.
    const insideTheSchool = { ...platform.actor, actingSchoolId: OAK };

    await expect(
      inOak(() => seats.decideSeatRequest(insideTheSchool, request.id, { decision: 'APPROVED' })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SEAT_SELF_APPROVAL' });
    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(10);
  });

  it('refuses a decision that is neither approval nor rejection', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });
    await expect(
      platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'MAYBE' })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DECISION' });
  });
});

/* ── 5. Tenant isolation ──────────────────────────────────── */

describe('a school cannot reach another school\'s seats', () => {
  it('cannot read the other school\'s requests', async () => {
    await sell(OAK, 10);
    await sell(RIVER, 10);
    const oakRequest = await paidRequest({ count: 5, slug: OAK });
    await paidRequest({ count: 7, slug: RIVER });

    const oakList = await inOak(() => seats.listSeatRequests({}));
    const riverList = await inRiver(() => seats.listSeatRequests({}));

    expect(oakList.map((r) => r.seats)).toEqual([5]);
    expect(riverList.map((r) => r.seats)).toEqual([7]);
    // Named directly, by a school it does not belong to.
    await expect(inRiver(() => seats.getSeatRequest(oakRequest.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cannot read the other school\'s seat history', async () => {
    await sell(OAK, 10);
    await sell(RIVER, 99);
    const history = await inOak(() => seats.listSeatHistory({}));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ tenantId: OAK, purchasedAfter: 10 });
  });

  it('cannot narrow a platform listing to a school it is not in', async () => {
    await sell(OAK, 10);
    await sell(RIVER, 10);
    await paidRequest({ count: 5, slug: OAK });
    await paidRequest({ count: 7, slug: RIVER });

    // `tenantId` is honoured only for a caller who is already unscoped.
    const spoofed = await inRiver(() => seats.listSeatRequests({ tenantId: OAK }));
    expect(spoofed.map((r) => r.seats)).toEqual([7]);

    const platformView = await platformRun(() => seats.listSeatRequests({ tenantId: OAK }));
    expect(platformView.map((r) => r.seats)).toEqual([5]);
  });

  it('stamps every seat record with the school that owns it', async () => {
    await sell(OAK, 10);
    await paidRequest({ count: 5, slug: OAK });

    const stray = await runAcrossSchools(async () => [
      ...(await SeatRequest.find({ tenantId: { $ne: OAK } }).lean()),
      ...(await SeatLedgerEntry.find({ tenantId: { $ne: OAK } }).lean()),
      ...(await SeatAccount.find({ tenantId: { $ne: OAK } }).lean()),
    ]);
    expect(stray).toEqual([]);
  });

  it('shows the platform every school at once', async () => {
    await sell(OAK, 10);
    await sell(RIVER, 20);
    const rows = await platformRun(() => seats.listSchoolSeatSummaries());
    expect(rows.map((r) => [r.tenantId, r.approvedSeats, r.usedSeats])).toEqual([
      [OAK, 10, 1],
      [RIVER, 20, 1],
    ]);
  });
});

/* ── 6. Who may do what ───────────────────────────────────── */

describe('the route guards', () => {
  const guard = (roleKey, permissionKey) => {
    const req = { actor: { roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) } };
    try {
      requirePermission(permissionKey, 'ALL')(req, {}, () => {});
      return 'ALLOW';
    } catch (err) {
      return `DENY ${err.statusCode}`;
    }
  };

  it('lets a School Admin read and request, and the platform decide', () => {
    expect(guard('ADMIN', 'seats.read')).toBe('ALLOW');
    expect(guard('ADMIN', 'seats.request')).toBe('ALLOW');
    expect(guard('SUPER_ADMIN', 'seats.approve')).toBe('ALLOW');
    expect(guard('SUPER_ADMIN', 'seats.manage')).toBe('ALLOW');
  });

  it('refuses a School Admin the approval and platform keys', () => {
    expect(guard('ADMIN', 'seats.approve')).toBe('DENY 403');
    expect(guard('ADMIN', 'seats.manage')).toBe('DENY 403');
    expect(SUPER_ADMIN_ONLY).toContain('seats.approve');
    expect(SUPER_ADMIN_ONLY).toContain('seats.manage');
  });

  it.each(['PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'])(
    '%s holds no seat permission at all',
    (roleKey) => {
      for (const key of ['seats.read', 'seats.request', 'seats.manage', 'seats.approve']) {
        expect(guard(roleKey, key), key).toBe('DENY 403');
      }
    },
  );
});

/* ── 7. History and audit ─────────────────────────────────── */

describe('the record of what happened', () => {
  it('writes a seat history entry for every movement, with the balance it produced', async () => {
    await sell(OAK, 100);
    const request = await paidRequest({ count: 20 });
    await platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED' }));

    const history = await inOak(() => seats.listSeatHistory({}));
    expect(history.map((h) => [h.event, h.purchasedAfter, h.approvedAfter])).toEqual([
      ['EXTRA_SEATS_APPROVED', 120, 120],
      ['EXTRA_SEATS_PAID', 120, 100],
      ['PURCHASE', 100, 100],
    ]);
  });

  it('audits the request, the payment and the decision', async () => {
    await sell(OAK, 10);
    const request = await paidRequest({ count: 5 });
    await platformRun(() => seats.decideSeatRequest(platform.actor, request.id, { decision: 'APPROVED' }));

    const actions = (await AuditLog.find().sort({ createdAt: 1 }).lean()).map((a) => a.action);
    for (const expected of ['seats.purchased', 'seats.request.created', 'seats.request.paid', 'seats.request.approved']) {
      expect(actions, expected).toContain(expected);
    }

    const decision = await AuditLog.findOne({ action: 'seats.request.approved' }).lean();
    expect(String(decision.actorProfileId)).toBe(platform.actor.profileId);
    expect(decision.after).toMatchObject({ tenantId: OAK, seats: 5, status: 'APPROVED' });
    expect(decision.before).toMatchObject({ status: 'PAID' });
  });
});

/* ── 8. Selling and correcting ────────────────────────────── */

describe('the platform\'s own seat movements', () => {
  it('sells base seats as purchased and approved in one movement', async () => {
    const summary = await sell(OAK, 250);
    expect(summary).toMatchObject({ purchasedSeats: 250, approvedSeats: 250, tenantName: 'Oakridge Academy' });
  });

  it('adds to a balance rather than replacing it', async () => {
    await sell(OAK, 100);
    await sell(OAK, 50);
    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(150);
  });

  it('refuses a correction that would take a school below zero', async () => {
    await sell(OAK, 10);
    await expect(sell(OAK, -20)).rejects.toMatchObject({ statusCode: 400, code: 'SEAT_BALANCE_NEGATIVE' });
  });

  it('refuses to sell seats to a school that does not exist', async () => {
    await expect(sell('no-such-school', 10)).rejects.toMatchObject({ statusCode: 404, code: 'SCHOOL_NOT_FOUND' });
  });

  it('keeps concurrent grants from clobbering one another', async () => {
    await Promise.all([sell(OAK, 10), sell(OAK, 10), sell(OAK, 10)]);
    expect((await inOak(() => seats.getSeatSummary())).approvedSeats).toBe(30);
  });
});
