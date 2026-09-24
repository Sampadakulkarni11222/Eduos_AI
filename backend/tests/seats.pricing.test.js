import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SeatPrice, SeatRequest, SeatLedgerEntry } from '../src/models/seat.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { env } from '../src/config/env.js';
import * as seats from '../src/modules/seats/seat.service.js';
import * as pricing from '../src/modules/seats/seatPrice.service.js';
import { quoteSeats, defaultUnitPricePaise } from '../src/modules/seats/seat.pricing.js';

/**
 * Per-seat charge management: School A at ₹100 a seat, School B at ₹120,
 * School C at ₹90.
 *
 * The rules that make that safe rather than merely possible:
 *
 *   the server prices it      the amount comes from the school's own rate, and
 *                             a figure in the request body is never read
 *   the request keeps it      every charge carries a snapshot, so repricing the
 *                             school changes nothing about what was quoted or
 *                             paid
 *   only the platform sets it `seats.pricing.manage` is Super-Admin-only
 *   one school, one price     a school sees and is charged its own, and cannot
 *                             reach another's
 *
 * Written against the services, like the seat suite it extends, because these
 * are rules about what may happen rather than about one route.
 */

const A = 'school-a';
const B = 'school-b';
const C = 'school-c';

const RUPEE = 100; // paise
const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91955${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function seedPerson({ roleKey, tenantId, displayName = 'Test person' }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get(roleKey);
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName,
    tenantId, tenantName: tenantId, status: 'ACTIVE',
  });
  return {
    profile,
    actor: {
      accountId: String(account._id), profileId: String(profile._id), displayName,
      roleKey, permissions: buildPermissionMap(role), tenantId,
    },
  };
}

let admins;
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

  await School.create({ slug: A, name: 'School A' });
  await School.create({ slug: B, name: 'School B' });
  await School.create({ slug: C, name: 'School C' });

  admins = {
    [A]: await seedPerson({ roleKey: 'ADMIN', tenantId: A, displayName: 'A admin' }),
    [B]: await seedPerson({ roleKey: 'ADMIN', tenantId: B, displayName: 'B admin' }),
    [C]: await seedPerson({ roleKey: 'ADMIN', tenantId: C, displayName: 'C admin' }),
  };

  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get('SUPER_ADMIN');
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName: 'Platform Owner', status: 'ACTIVE',
  });
  platform = {
    actor: {
      accountId: String(account._id), profileId: String(profile._id), displayName: 'Platform Owner',
      roleKey: 'SUPER_ADMIN', permissions: buildPermissionMap(role), tenantId: null,
    },
  };
});

afterEach(() => { env.PAYMENT_PROVIDER = savedProvider; });

const inSchool = (slug, fn) => runWithTenant(slug, fn);
const asPlatform = (fn) => runAcrossSchools(fn);

const setPrice = (slug, rupees, extra = {}) =>
  asPlatform(() => pricing.setSeatPrice(platform.actor, slug, { unitPricePaise: rupees * RUPEE, ...extra }));

/** A request raised by that school's own admin, at whatever it is priced. */
const request = (slug, seatCount) =>
  inSchool(slug, () => seats.createSeatRequest(admins[slug].actor, { seats: seatCount }));

/** Raise and pay, leaving a settled request with its price frozen on it. */
async function paidRequest(slug, seatCount) {
  const raised = await request(slug, seatCount);
  await inSchool(slug, () => seats.startSeatPayment(admins[slug].actor, raised.id));
  return inSchool(slug, () => seats.getSeatRequest(raised.id));
}

/* ── 1. Pricing CRUD ──────────────────────────────────────── */

describe('setting and managing a school\'s price', () => {
  it('sets a price for one school', async () => {
    const price = await setPrice(A, 100);

    expect(price).toMatchObject({
      tenantId: A, unitPricePaise: 100 * RUPEE, currency: 'INR', status: 'ACTIVE', effectiveTo: null,
    });
    expect(price.setBy).toBe('Platform Owner');
  });

  it('prices three schools differently and keeps each to its own', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);
    await setPrice(C, 90);

    const rates = await Promise.all([A, B, C].map((s) => pricing.resolveSeatPrice(s)));
    expect(rates.map((r) => r.unitPricePaise)).toEqual([100 * RUPEE, 120 * RUPEE, 90 * RUPEE]);
    expect(rates.every((r) => r.source === 'SCHOOL')).toBe(true);
  });

  it('falls back to the platform default for a school that has never been priced', async () => {
    const rate = await pricing.resolveSeatPrice(B);
    expect(rate).toMatchObject({ unitPricePaise: defaultUnitPricePaise(), source: 'PLATFORM_DEFAULT', seatPriceId: null });
  });

  it('updates a price by writing a new version and closing the old one', async () => {
    const first = await setPrice(A, 100);
    const second = await setPrice(A, 120);

    const history = await asPlatform(() => pricing.listSeatPrices(A));
    expect(history.map((h) => h.unitPricePaise)).toEqual([120 * RUPEE, 100 * RUPEE]);

    const closed = history.find((h) => h.id === first.id);
    // The old version is closed, not edited: it still says ₹100.
    expect(closed.unitPricePaise).toBe(100 * RUPEE);
    expect(closed.effectiveTo).toEqual(second.effectiveFrom);
    expect(closed.supersededByPriceId).toBe(second.id);

    expect((await pricing.resolveSeatPrice(A)).unitPricePaise).toBe(120 * RUPEE);
  });

  it('deactivates a price, which falls the school back to the platform default', async () => {
    const price = await setPrice(A, 100);
    expect((await pricing.resolveSeatPrice(A)).unitPricePaise).toBe(100 * RUPEE);

    const off = await asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' }));
    expect(off).toMatchObject({ status: 'INACTIVE', deactivatedBy: 'Platform Owner' });

    const rate = await pricing.resolveSeatPrice(A);
    expect(rate).toMatchObject({ unitPricePaise: defaultUnitPricePaise(), source: 'PLATFORM_DEFAULT' });
  });

  it('reactivates a deactivated price', async () => {
    const price = await setPrice(A, 100);
    await asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' }));
    await asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'ACTIVE' }));

    const rate = await pricing.resolveSeatPrice(A);
    expect(rate).toMatchObject({ unitPricePaise: 100 * RUPEE, source: 'SCHOOL' });
  });

  it('keeps the full history, superseded and deactivated versions included', async () => {
    const first = await setPrice(A, 100, { note: 'Launch rate' });
    await setPrice(A, 120, { note: 'Renewal' });
    await asPlatform(() => pricing.updateSeatPrice(platform.actor, first.id, { status: 'INACTIVE' }));

    const history = await asPlatform(() => pricing.listSeatPrices(A));
    expect(history).toHaveLength(2);
    expect(history.map((h) => [h.unitPricePaise, h.status, h.note])).toEqual([
      [120 * RUPEE, 'ACTIVE', 'Renewal'],
      [100 * RUPEE, 'INACTIVE', 'Launch rate'],
    ]);
  });

  it('lists every school with its current rate, including the unpriced ones', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);

    const rows = await asPlatform(() => pricing.listSchoolSeatPrices());
    expect(rows.map((r) => [r.tenantId, r.unitPricePaise, r.source])).toEqual([
      [A, 100 * RUPEE, 'SCHOOL'],
      [B, 120 * RUPEE, 'SCHOOL'],
      [C, defaultUnitPricePaise(), 'PLATFORM_DEFAULT'],
    ]);
  });

  it('refuses to price a school that does not exist', async () => {
    await expect(setPrice('no-such-school', 100)).rejects.toMatchObject({
      statusCode: 404, code: 'SCHOOL_NOT_FOUND',
    });
  });

  it('refuses an update that changes nothing', async () => {
    const price = await setPrice(A, 100);
    await expect(asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, {}))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

/* ── 2. Invalid values ────────────────────────────────────── */

describe('invalid prices are refused', () => {
  it.each([
    ['a negative price', -100, 'INVALID_SEAT_PRICE'],
    ['a fractional price', 100.5, 'INVALID_SEAT_PRICE'],
    ['a price that is not a number', 'free', 'INVALID_SEAT_PRICE'],
    ['an absurd price', 999_999_999, 'SEAT_PRICE_TOO_LARGE'],
  ])('refuses %s', async (_label, value, code) => {
    await expect(
      asPlatform(() => pricing.setSeatPrice(platform.actor, A, { unitPricePaise: value })),
    ).rejects.toMatchObject({ statusCode: 400, code });
    expect(await asPlatform(() => SeatPrice.countDocuments({}))).toBe(0);
  });

  it('refuses zero, because a zero-amount order cannot be raised with the gateway', async () => {
    // Not an arbitrary choice: createGatewayOrder() rejects a non-positive
    // amount, so a ₹0 price would produce a request nobody could ever pay.
    // Free seats have their own supported route — grantSeats().
    await expect(
      asPlatform(() => pricing.setSeatPrice(platform.actor, A, { unitPricePaise: 0 })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'ZERO_SEAT_PRICE' });
  });

  it('refuses a currency that is not an ISO code', async () => {
    await expect(setPrice(A, 100, { currency: 'rupees' })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_CURRENCY',
    });
  });

  it('refuses a price backdated before what has already been quoted', async () => {
    await expect(
      setPrice(A, 100, { effectiveFrom: new Date(Date.now() - 86_400_000) }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'EFFECTIVE_FROM_IN_PAST' });
  });

  it('refuses a status that is neither active nor inactive', async () => {
    const price = await setPrice(A, 100);
    await expect(
      asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'ARCHIVED' })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_SEAT_PRICE_STATUS' });
  });
});

/* ── 3. Currency and effective dates ──────────────────────── */

describe('currency and effective dates', () => {
  it('stores a currency per school and carries it onto the request', async () => {
    await setPrice(A, 100, { currency: 'usd' });
    const raised = await request(A, 10);

    expect(raised.currency).toBe('USD');
    expect((await pricing.resolveSeatPrice(A)).currency).toBe('USD');
    // Schools priced in the default are unaffected.
    expect((await request(B, 10)).currency).toBe('INR');
  });

  it('defaults to INR when no currency is named', async () => {
    const price = await setPrice(A, 100);
    expect(price.currency).toBe('INR');
  });

  it('does not apply a future-dated price until it is effective', async () => {
    await setPrice(A, 100);
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await setPrice(A, 120, { effectiveFrom: soon });

    // Now: still the current rate.
    expect((await pricing.resolveSeatPrice(A)).unitPricePaise).toBe(100 * RUPEE);
    // At the scheduled instant: the new one.
    expect((await pricing.resolveSeatPrice(A, new Date(soon.getTime() + 1000))).unitPricePaise).toBe(120 * RUPEE);
  });

  it('prices a request at the rate in force when it is raised, not the scheduled one', async () => {
    await setPrice(A, 100);
    await setPrice(A, 120, { effectiveFrom: new Date(Date.now() + 60 * 60 * 1000) });

    expect((await request(A, 10)).unitPricePaise).toBe(100 * RUPEE);
  });
});

/* ── 4. The calculation ───────────────────────────────────── */

describe('the amount is additionalSeats × the school\'s own price', () => {
  it('multiplies the seat count by the school\'s rate', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);
    await setPrice(C, 90);

    for (const [slug, rupees] of [[A, 100], [B, 120], [C, 90]]) {
      const raised = await request(slug, 10);
      expect(raised.unitPricePaise, slug).toBe(rupees * RUPEE);
      expect(raised.amountPaise, slug).toBe(10 * rupees * RUPEE);
    }
  });

  it('applies the platform volume tiers on top of whatever the school pays', async () => {
    await setPrice(A, 100);
    const raised = await request(A, 100); // 5% over a hundred seats

    expect(raised.discountPct).toBe(5);
    expect(raised.amountPaise).toBe(quoteSeats(100, { unitPricePaise: 100 * RUPEE }).amountPaise);
    expect(raised.amountPaise).toBe(100 * 100 * RUPEE * 0.95);
  });

  it('ignores a price the caller sends and uses the school\'s', async () => {
    await setPrice(A, 100);
    const raised = await inSchool(A, () =>
      seats.createSeatRequest(admins[A].actor, {
        seats: 10,
        unitPricePaise: 1, amountPaise: 1, discountPct: 99, currency: 'XXX', // all ignored
      }),
    );

    expect(raised.unitPricePaise).toBe(100 * RUPEE);
    expect(raised.amountPaise).toBe(10 * 100 * RUPEE);
    expect(raised.currency).toBe('INR');
  });

  it('charges the gateway the amount it calculated', async () => {
    await setPrice(A, 120);
    const raised = await request(A, 10);
    const started = await inSchool(A, () => seats.startSeatPayment(admins[A].actor, raised.id));

    expect(started.amountPaise).toBe(10 * 120 * RUPEE);
  });
});

/* ── 5. The snapshot ──────────────────────────────────────── */

describe('every request carries the price it was quoted', () => {
  it('records the rate, the currency and which version supplied them', async () => {
    const price = await setPrice(A, 100);
    const raised = await request(A, 10);

    expect(raised).toMatchObject({
      unitPricePaise: 100 * RUPEE,
      currency: 'INR',
      seatPriceId: price.id,
      priceSource: 'SCHOOL',
    });
    expect(raised.pricedAt).toBeTruthy();
  });

  it('records the platform default as the source when the school has no price', async () => {
    const raised = await request(B, 10);
    expect(raised).toMatchObject({ priceSource: 'PLATFORM_DEFAULT', seatPriceId: null });
    expect(raised.unitPricePaise).toBe(defaultUnitPricePaise());
  });

  it('carries the price onto the seat history when the payment settles', async () => {
    await setPrice(A, 120);
    await paidRequest(A, 10);

    const [entry] = await inSchool(A, () => seats.listSeatHistory({ limit: 1 }));
    expect(entry).toMatchObject({
      event: 'EXTRA_SEATS_PAID',
      unitPricePaise: 120 * RUPEE,
      currency: 'INR',
      amountPaise: 10 * 120 * RUPEE,
    });
  });

  it('carries the price onto the approval entry too', async () => {
    await setPrice(A, 120);
    const paid = await paidRequest(A, 10);
    await asPlatform(() => seats.decideSeatRequest(platform.actor, paid.id, { decision: 'APPROVED' }));

    const [entry] = await inSchool(A, () => seats.listSeatHistory({ limit: 1 }));
    expect(entry).toMatchObject({ event: 'EXTRA_SEATS_APPROVED', unitPricePaise: 120 * RUPEE });
  });
});

/* ── 6. History is not rewritten ──────────────────────────── */

describe('changing the price does not touch what was already charged', () => {
  it('leaves a paid request at the price it was paid at', async () => {
    await setPrice(A, 100);
    const paid = await paidRequest(A, 10);
    expect(paid.amountPaise).toBe(10 * 100 * RUPEE);

    await setPrice(A, 120);

    const after = await inSchool(A, () => seats.getSeatRequest(paid.id));
    expect(after.unitPricePaise).toBe(100 * RUPEE);
    expect(after.amountPaise).toBe(10 * 100 * RUPEE);
    expect(after.receiptNo).toBe(paid.receiptNo);
  });

  it('leaves an unpaid request at the price it was quoted, and charges that', async () => {
    await setPrice(A, 100);
    const raised = await request(A, 10);

    await setPrice(A, 120);

    // The admin was quoted ₹1,000 and is charged ₹1,000 — repricing the school
    // must not silently change the figure they agreed to.
    const started = await inSchool(A, () => seats.startSeatPayment(admins[A].actor, raised.id));
    expect(started.amountPaise).toBe(10 * 100 * RUPEE);
    expect((await inSchool(A, () => seats.getSeatRequest(raised.id))).unitPricePaise).toBe(100 * RUPEE);
  });

  it('prices the NEXT request at the new rate', async () => {
    await setPrice(A, 100);
    const before = await request(A, 10);
    await setPrice(A, 120);
    const after = await request(A, 10);

    expect(before.amountPaise).toBe(10 * 100 * RUPEE);
    expect(after.amountPaise).toBe(10 * 120 * RUPEE);
  });

  it('survives the version that priced it being deactivated', async () => {
    const price = await setPrice(A, 100);
    const paid = await paidRequest(A, 10);

    await asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' }));

    const after = await inSchool(A, () => seats.getSeatRequest(paid.id));
    expect(after.amountPaise).toBe(10 * 100 * RUPEE);
    expect(after.unitPricePaise).toBe(100 * RUPEE);
    // And the version itself is still readable, still saying what it charged.
    expect((await asPlatform(() => pricing.getSeatPrice(price.id))).unitPricePaise).toBe(100 * RUPEE);
  });

  it('leaves the seat history entries alone when the price changes', async () => {
    await setPrice(A, 100);
    await paidRequest(A, 10);
    const before = await inSchool(A, () => seats.listSeatHistory({}));

    await setPrice(A, 120);

    expect(await inSchool(A, () => seats.listSeatHistory({}))).toEqual(before);
  });
});

/* ── 7. Authorization ─────────────────────────────────────── */

describe('only the platform may set a price', () => {
  const guard = (roleKey, permissionKey) => {
    const req = { actor: { roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) } };
    try {
      requirePermission(permissionKey, 'ALL')(req, {}, () => {});
      return 'ALLOW';
    } catch (err) {
      return `DENY ${err.statusCode}`;
    }
  };

  it('gives the pricing key to SUPER_ADMIN alone', () => {
    expect(guard('SUPER_ADMIN', 'seats.pricing.manage')).toBe('ALLOW');
    expect(SUPER_ADMIN_ONLY).toContain('seats.pricing.manage');
  });

  it.each(['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN'])(
    '%s cannot change pricing',
    (roleKey) => {
      expect(guard(roleKey, 'seats.pricing.manage')).toBe('DENY 403');
    },
  );

  it('still lets a School Admin READ the rate it will be charged', () => {
    expect(guard('ADMIN', 'seats.read')).toBe('ALLOW');
  });

  it('no system role but SUPER_ADMIN is granted the pricing key', () => {
    const holders = SYSTEM_ROLES
      .filter((r) => r.grants.some((g) => g.key === 'seats.pricing.manage'))
      .map((r) => r.key);
    expect(holders).toEqual(['SUPER_ADMIN']);
  });
});

/* ── 8. School isolation ──────────────────────────────────── */

describe('a school cannot reach another school\'s pricing', () => {
  it('sees only its own price', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);

    expect((await inSchool(A, () => seats.getSeatSummary())).priceList.unitPricePaise).toBe(100 * RUPEE);
    expect((await inSchool(B, () => seats.getSeatSummary())).priceList.unitPricePaise).toBe(120 * RUPEE);
  });

  it('sees only its own pricing history', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);
    await setPrice(B, 130);

    const fromA = await inSchool(A, () => pricing.listSeatPrices());
    expect(fromA.map((p) => p.tenantId)).toEqual([A]);

    // Naming another school from inside one is refused outright — and as a 404,
    // so it does not even confirm that the other school exists.
    await expect(inSchool(A, () => pricing.listSeatPrices(B))).rejects.toMatchObject({
      statusCode: 404, code: 'SCHOOL_NOT_FOUND',
    });
  });

  it('cannot read another school\'s price version by id', async () => {
    const bPrice = await setPrice(B, 120);
    await expect(inSchool(A, () => pricing.getSeatPrice(bPrice.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('stamps every price version with the school that owns it', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);

    const stray = await asPlatform(() => SeatPrice.find({ tenantId: { $nin: [A, B] } }).lean());
    expect(stray).toEqual([]);
    expect(await asPlatform(() => SeatPrice.countDocuments({ tenantId: A }))).toBe(1);
  });

  it('charges each school its own rate for the same number of seats', async () => {
    await setPrice(A, 100);
    await setPrice(B, 120);

    const [a, b] = [await request(A, 10), await request(B, 10)];
    expect(a.amountPaise).toBe(1000 * RUPEE);
    expect(b.amountPaise).toBe(1200 * RUPEE);
  });

  it('keeps one school\'s requests out of another\'s list after repricing', async () => {
    await setPrice(A, 100);
    await request(A, 10);
    await setPrice(B, 120);
    await request(B, 10);

    expect((await inSchool(A, () => seats.listSeatRequests({}))).map((r) => r.unitPricePaise)).toEqual([100 * RUPEE]);
    expect((await inSchool(B, () => seats.listSeatRequests({}))).map((r) => r.unitPricePaise)).toEqual([120 * RUPEE]);
  });
});

/* ── 9. Concurrent updates ────────────────────────────────── */

describe('concurrent price changes', () => {
  it('leaves exactly one price in force when two are set at once', async () => {
    await setPrice(A, 100);

    const results = await Promise.allSettled([setPrice(A, 120), setPrice(A, 130)]);
    const applied = results.filter((r) => r.status === 'fulfilled');

    // Both may land (at different instants) or one may lose the race — either
    // way the chain stays consistent and the school has ONE current rate.
    expect(applied.length).toBeGreaterThanOrEqual(1);

    const open = await asPlatform(() => SeatPrice.find({ tenantId: A, effectiveTo: null }).lean());
    expect(open).toHaveLength(1);

    const rate = await pricing.resolveSeatPrice(A);
    expect(open[0].unitPricePaise).toBe(rate.unitPricePaise);
    expect([120 * RUPEE, 130 * RUPEE]).toContain(rate.unitPricePaise);
  });

  it('reports a lost race as a conflict rather than writing a second live price', async () => {
    await setPrice(A, 100);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => setPrice(A, 110 + i)),
    );

    for (const failed of results.filter((r) => r.status === 'rejected')) {
      expect(failed.reason.code, failed.reason.message).toBe('SEAT_PRICE_CONFLICT');
      expect(failed.reason.statusCode).toBe(409);
    }
    expect(await asPlatform(() => SeatPrice.countDocuments({ tenantId: A, effectiveTo: null }))).toBe(1);
  });

  it('refuses a second version beginning at the very same instant', async () => {
    const at = new Date(Date.now() + 60 * 60 * 1000);
    await setPrice(A, 120, { effectiveFrom: at });

    await expect(setPrice(A, 130, { effectiveFrom: at })).rejects.toMatchObject({
      statusCode: 409, code: 'SEAT_PRICE_CONFLICT',
    });
  });

  it('applies one status change when two arrive together', async () => {
    const price = await setPrice(A, 100);
    const results = await Promise.allSettled([
      asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' })),
      asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('SEAT_PRICE_CONFLICT');
  });

  it('prices concurrent requests consistently while a reprice lands', async () => {
    await setPrice(A, 100);
    const [first, , second] = await Promise.all([request(A, 10), setPrice(A, 120), request(A, 10)]);

    // Whichever rate each request caught, the amount must follow from the unit
    // price stored beside it — never a mixture of the two.
    for (const r of [first, second]) {
      expect(r.amountPaise).toBe(r.seats * r.unitPricePaise);
      expect([100 * RUPEE, 120 * RUPEE]).toContain(r.unitPricePaise);
    }
  });
});

/* ── 10. The audit trail ──────────────────────────────────── */

describe('pricing decisions are audited', () => {
  it('records who set a price, and what it replaced', async () => {
    await setPrice(A, 100);
    await setPrice(A, 120, { note: 'Renewal' });

    const entries = await AuditLog.find({ action: 'seats.price.set' }).sort({ createdAt: 1 }).lean();
    expect(entries).toHaveLength(2);
    expect(String(entries[1].actorProfileId)).toBe(platform.actor.profileId);
    expect(entries[1].before).toMatchObject({ tenantId: A, unitPricePaise: 100 * RUPEE });
    expect(entries[1].after).toMatchObject({ tenantId: A, unitPricePaise: 120 * RUPEE, note: 'Renewal' });
  });

  it('records a deactivation', async () => {
    const price = await setPrice(A, 100);
    await asPlatform(() => pricing.updateSeatPrice(platform.actor, price.id, { status: 'INACTIVE' }));

    const entry = await AuditLog.findOne({ action: 'seats.price.deactivated' }).lean();
    expect(entry.before).toMatchObject({ status: 'ACTIVE' });
    expect(entry.after).toMatchObject({ status: 'INACTIVE', unitPricePaise: 100 * RUPEE });
  });

  it('records the price on the request it created', async () => {
    await setPrice(A, 120);
    await request(A, 10);

    const entry = await AuditLog.findOne({ action: 'seats.request.created' }).lean();
    expect(entry.after).toMatchObject({
      tenantId: A, unitPricePaise: 120 * RUPEE, currency: 'INR', priceSource: 'SCHOOL',
    });
  });
});
