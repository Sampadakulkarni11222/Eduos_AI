import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SeatAccount, SeatLedgerEntry, SeatRequest } from '../src/models/seat.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { setDomainProbes } from '../src/modules/domains/domain.checks.js';
import { invalidateActiveHostCache } from '../src/modules/domains/domain.service.js';
import { corsOrigin } from '../src/modules/domains/domain.cors.js';
import * as seats from '../src/modules/seats/seat.service.js';

/**
 * Integration audit of the six platform features, end to end, over HTTP.
 *
 * Everything runs through the real API router, authentication, permission
 * middleware, tenancy, services and models. Two external systems are stood in
 * for, because neither can be reached from a test:
 *
 *   Razorpay  its REST API (order creation, payment lookup) is answered by a
 *             local stub at the fetch boundary. Webhook and Checkout
 *             signatures are real HMACs over the real bodies.
 *   DNS/TLS   answered through the domain probe seam (domain.checks.js).
 *
 * Schools are onboarded through POST /schools, exactly as the console does,
 * so the School Admins signing in below are the accounts that flow created.
 */

const A = 'abc-public';
const B = 'bright-future';

/* ── The stand-in gateway ─────────────────────────────────── */

const realFetch = globalThis.fetch;
let gateway;

function installGateway() {
  gateway = { orders: new Map(), payments: new Map(), seq: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (!href.startsWith(env.RAZORPAY_API_BASE)) return realFetch(url, init);
    const path = href.slice(env.RAZORPAY_API_BASE.length);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (init.method === 'POST' && path === '/orders') {
      const body = JSON.parse(init.body);
      const order = { id: `order_${++gateway.seq}`, amount: body.amount, currency: body.currency, receipt: body.receipt };
      gateway.orders.set(order.id, order);
      return json(order);
    }
    const payment = /^\/payments\/([^/]+)$/.exec(path);
    if (payment) {
      const p = gateway.payments.get(decodeURIComponent(payment[1]));
      return p ? json(p) : json({ error: { description: 'not found' } }, 404);
    }
    return json({ error: { description: `unstubbed ${path}` } }, 500);
  }
}

/** The payer completes checkout: the gateway now holds a captured payment for the order. */
function payAtGateway(orderId) {
  const order = gateway.orders.get(orderId);
  const id = `pay_${++gateway.seq}`;
  gateway.payments.set(id, { id, order_id: orderId, amount: order.amount, currency: order.currency, status: 'captured', method: 'upi' });
  return id;
}

/* ── HTTP ─────────────────────────────────────────────────── */

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const tokenFor = (who) => signAccessToken({ accountId: who.accountId, profileId: who.profileId, door: null });

async function call(who, method, path, body, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (who) h.authorization = `Bearer ${tokenFor(who)}`;
  const res = await realFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Delivers a webhook signed with the webhook secret over the exact bytes. */
async function webhook(orderId, paymentId, amount) {
  const raw = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
  });
  const signature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await realFetch(`${base}/fees/webhooks/razorpay`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, body: raw,
  });
  return { status: res.status, body: await res.json() };
}

const checkoutSignature = (orderId, paymentId) =>
  crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/* ── Fixture: a platform and two onboarded schools ────────── */

let platform;
let adminA;
let adminB;
const savedEnv = {};
let dns;
let phoneSeq = 0;
const phone = () => `+91977${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function onboard(slug, name, { seatsPurchased = 100, website } = {}) {
  const res = await call(platform, 'POST', '/schools', {
    tenantId: slug, tenantName: name, seats: seatsPurchased,
    admin: { displayName: `${name} Admin`, phone: phone(), ...(website ? { website } : {}) },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const admin = res.body.data.admins[0];
  return { accountId: admin.accountId, profileId: admin.profileId, tenantId: slug, response: res.body.data };
}

beforeEach(async () => {
  for (const key of ['PAYMENT_PROVIDER', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_API_BASE', 'PLATFORM_DOMAIN', 'DOMAIN_CNAME_TARGET', 'CORS_ORIGIN']) {
    savedEnv[key] = env[key];
  }
  Object.assign(env, {
    PAYMENT_PROVIDER: 'razorpay',
    RAZORPAY_KEY_ID: 'rzp_test_integration',
    RAZORPAY_KEY_SECRET: 'integration-key-secret',
    RAZORPAY_WEBHOOK_SECRET: 'integration-webhook-secret',
    RAZORPAY_API_BASE: 'https://gateway.integration.test/v1',
    PLATFORM_DOMAIN: 'eduos.integration-platform.com',
    DOMAIN_CNAME_TARGET: 'school-erp-frontend.onrender.com',
    CORS_ORIGIN: 'http://localhost:3000',
  });
  installGateway();
  dns = { txt: new Map(), address: new Map(), tls: new Map() };
  setDomainProbes({
    dns: {
      txt: async (h) => ({ found: dns.txt.get(h) ?? [] }),
      address: async (h) => ({ found: dns.address.get(h) ?? [] }),
      cname: async () => ({ found: [] }),
    },
    tls: async (h) => dns.tls.get(h) ?? { ok: false, error: 'ECONNREFUSED' },
  });
  invalidateActiveHostCache();

  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }
  const account = await Account.create({ phoneE164: phone(), status: 'ACTIVE' });
  const superRole = await Role.findOne({ key: 'SUPER_ADMIN' });
  const profile = await Profile.create({ accountId: account._id, roleId: superRole._id, displayName: 'Platform Owner', status: 'ACTIVE' });
  platform = { accountId: String(account._id), profileId: String(profile._id) };

  adminA = await onboard(A, 'ABC Public School', { website: 'https://www.abcpublicschool.com/' });
  adminB = await onboard(B, 'Bright Future Academy');
});

afterEach(() => {
  Object.assign(env, savedEnv);
  globalThis.fetch = realFetch;
  setDomainProbes();
  vi.restoreAllMocks();
});

/** School A raises a request for `n` seats, starts payment, and returns the request and order. */
async function raiseAndStartPayment(n, body = {}) {
  const created = await call(adminA, 'POST', '/seats/requests', { seats: n, reason: 'New sections', ...body });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const pay = await call(adminA, 'POST', `/seats/requests/${created.body.data.id}/pay`);
  expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  return { request: created.body.data, order: pay.body.data };
}

const summaryOf = async (who) => (await call(who, 'GET', '/seats/summary')).body.data;

/* ── FLOW 1 ───────────────────────────────────────────────── */

describe('FLOW 1: onboarding → School Admin profile → domain detected → Super Admin configuration', () => {
  it('detects the domain from the first School Admin\'s website and leaves it pending for the Super Admin', async () => {
    const admins = await call(platform, 'GET', `/schools/${A}/admins`);
    expect(admins.body.data[0].website).toBe('https://www.abcpublicschool.com/');

    const detail = await call(platform, 'GET', `/domains/schools/${A}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.profileDomain).toMatchObject({ status: 'FOUND', hostname: 'abcpublicschool.com', sync: 'IN_SYNC' });
    expect(detail.body.data.domain).toMatchObject({
      type: 'CUSTOM', hostname: 'abcpublicschool.com', source: 'PROFILE',
      verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false,
    });

    // A school onboarded without a website: "Not Provided", nothing configured.
    const other = await call(platform, 'GET', `/domains/schools/${B}`);
    expect(other.body.data.domain).toBeNull();
    expect(other.body.data.profileDomain.status).toBe('NOT_PROVIDED');

    const table = await call(platform, 'GET', '/domains/schools');
    const rowA = table.body.data.schools.find((s) => s.tenantId === A);
    expect(rowA).toMatchObject({ profileDomain: 'abcpublicschool.com', verificationStatus: 'PENDING', active: false });

    // The Super Admin can still take over manually.
    const manual = await call(platform, 'PUT', `/domains/schools/${B}/subdomain`, {});
    expect(manual.status).toBe(200);
    expect(manual.body.data.domain).toMatchObject({ hostname: `bright-future-academy.${env.PLATFORM_DOMAIN}`, source: 'MANUAL' });
  });
});

/* ── FLOW 2 ───────────────────────────────────────────────── */

describe('FLOW 2: purchase → purchased → approved → available', () => {
  it('reports the purchase as purchased and approved, with the admin occupying one seat', async () => {
    expect(adminA.response.seats).toMatchObject({ purchasedSeats: 100, approvedSeats: 100, usedSeats: 1, availableSeats: 99 });
    const summary = await summaryOf(adminA);
    expect(summary).toMatchObject({ purchasedSeats: 100, approvedSeats: 100, usedSeats: 1, availableSeats: 99, provisioned: true });

    const platformView = await call(platform, 'GET', '/seats/schools');
    const rowB = platformView.body.data.find((s) => s.tenantId === B);
    expect(rowB).toMatchObject({ purchasedSeats: 100, approvedSeats: 100, usedSeats: 1, availableSeats: 99 });
  });
});

/* ── FLOW 3 ───────────────────────────────────────────────── */

describe('FLOW 3: 50 extra seats — priced, paid, verified, approved', () => {
  it('goes the whole way, and only approval moves the approved seats', async () => {
    await call(platform, 'POST', `/seats/schools/${A}/price`, { unitPricePaise: 120_00 });

    // The client tries to set its own price. It is not read.
    const { request, order } = await raiseAndStartPayment(50, { amountPaise: 1, unitPricePaise: 1, discountPct: 99 });
    expect(request).toMatchObject({ seats: 50, unitPricePaise: 120_00, amountPaise: 50 * 120_00, priceSource: 'SCHOOL', status: 'PENDING_PAYMENT' });
    expect(order.amountPaise).toBe(600_000);
    expect(gateway.orders.get(order.orderId).amount).toBe(600_000); // what the gateway was actually asked for

    const paymentId = payAtGateway(order.orderId);
    const verified = await call(adminA, 'POST', '/seats/payments/verify', {
      orderId: order.orderId, paymentId, signature: checkoutSignature(order.orderId, paymentId),
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(await summaryOf(adminA)).toMatchObject({ purchasedSeats: 150, approvedSeats: 100, awaitingApprovalSeats: 50 });

    const approved = await call(platform, 'POST', `/seats/requests/${request.id}/decision`, { decision: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await summaryOf(adminA)).toMatchObject({ purchasedSeats: 150, approvedSeats: 150, usedSeats: 1, availableSeats: 149 });

    const history = (await call(adminA, 'GET', '/seats/history')).body.data.map((e) => e.event);
    expect(history).toEqual(['EXTRA_SEATS_APPROVED', 'EXTRA_SEATS_PAID', 'PURCHASE']);
    const audits = await AuditLog.find({ entityType: 'SeatRequest', entityId: request.id }).lean();
    expect(audits.map((a) => a.action).sort()).toEqual([
      'seats.request.approved', 'seats.request.created', 'seats.request.paid', 'seats.request.payment.initiated',
    ]);
  });

  it('settles through the signed webhook as well as through checkout verification, once', async () => {
    const { order } = await raiseAndStartPayment(50);
    const paymentId = payAtGateway(order.orderId);

    const results = await Promise.all([
      webhook(order.orderId, paymentId, order.amountPaise),
      webhook(order.orderId, paymentId, order.amountPaise),
      call(adminA, 'POST', '/seats/payments/verify', { orderId: order.orderId, paymentId, signature: checkoutSignature(order.orderId, paymentId) }),
      webhook(order.orderId, paymentId, order.amountPaise),
    ]);
    expect(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body))).toBe(true);
    expect((await summaryOf(adminA)).purchasedSeats).toBe(150);
    expect(await runAcrossSchools(() => SeatLedgerEntry.countDocuments({ event: 'EXTRA_SEATS_PAID' }))).toBe(1);
  });
});

/* ── FLOW 4 ───────────────────────────────────────────────── */

describe('FLOW 4: repricing School A leaves School B alone', () => {
  it('changes only School A\'s quote', async () => {
    const before = (await call(adminB, 'GET', '/seats/price')).body.data;
    const set = await call(platform, 'POST', `/seats/schools/${A}/price`, { unitPricePaise: 99_00, note: 'Negotiated' });
    expect(set.status).toBe(201);

    expect((await call(adminA, 'GET', '/seats/price')).body.data).toMatchObject({ unitPricePaise: 99_00, source: 'SCHOOL' });
    expect((await call(adminB, 'GET', '/seats/price')).body.data).toEqual(before);

    const quoteB = await call(adminB, 'POST', '/seats/requests', { seats: 10 });
    expect(quoteB.body.data).toMatchObject({ unitPricePaise: before.unitPricePaise, priceSource: 'PLATFORM_DEFAULT' });
  });
});

/* ── FLOW 5 & 6 ───────────────────────────────────────────── */

describe('FLOW 5: School A\'s theme does not reach School B', () => {
  it('themes A and leaves B as shipped, including for a spoofed school header', async () => {
    const saved = await call(platform, 'PUT', `/customization/schools/${A}`, {
      theme: { primaryColor: '#1f4a3a', secondaryColor: '#2c6049' },
      branding: { displayName: 'ABC Senior', logoUrl: '/uploads/abc-logo.png' },
    });
    expect(saved.status).toBe(200);

    const themeA = (await call(adminA, 'GET', '/customization/theme')).body.data;
    expect(themeA.cssVariables['--accent']).toBe('#1f4a3a');

    const themeB = (await call(adminB, 'GET', '/customization/theme')).body.data;
    expect(themeB.cssVariables).toEqual({});
    expect(themeB.branding.displayName).toBeNull();

    const spoofed = (await call(adminB, 'GET', `/customization/theme?schoolId=${A}`, undefined, { 'x-school-id': A })).body.data;
    expect(spoofed.tenantId).toBe(B);
    expect(spoofed.cssVariables).toEqual({});
  });
});

describe('FLOW 6: School A\'s dropdown values do not reach School B', () => {
  it('keeps each school\'s house list to itself', async () => {
    const houses = (...v) => ({ dropdowns: [{ key: 'house', label: 'House', options: v.map((x) => ({ value: x, label: x })) }] });
    await call(platform, 'PUT', `/customization/schools/${A}`, houses('Red', 'Blue', 'Green'));
    await call(platform, 'PUT', `/customization/schools/${B}`, houses('Alpha', 'Beta', 'Gamma'));

    await call(platform, 'PUT', `/customization/schools/${A}`, houses('Red', 'Blue', 'Green', 'Yellow'));

    const a = (await call(adminA, 'GET', '/customization/dropdowns/house')).body.data;
    const b = (await call(adminB, 'GET', '/customization/dropdowns/house', undefined, { 'x-school-id': A })).body.data;
    expect(a.options.map((o) => o.value)).toEqual(['Red', 'Blue', 'Green', 'Yellow']);
    expect(b.options.map((o) => o.value)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

/* ── FLOW 7 ───────────────────────────────────────────────── */

describe('FLOW 7: School A custom domain — configured, pending, verified, activated', () => {
  it('goes live only after DNS, a certificate and activation', async () => {
    const configured = await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'www.abcschool.com' });
    expect(configured.body.data.domain).toMatchObject({ verificationStatus: 'PENDING', active: false });
    const txt = configured.body.data.domain.dnsInstructions.records[0];

    // Pending: activation refused, nothing resolves, no CORS.
    expect((await call(platform, 'POST', `/domains/schools/${A}/activate`)).status).toBe(409);
    expect((await call(null, 'GET', '/domains/resolve?host=www.abcschool.com')).status).toBe(404);

    // Verification without the record fails; with it, succeeds.
    expect((await call(platform, 'POST', `/domains/schools/${A}/verify`)).body.data.outcome).toBe('FAILED');
    dns.txt.set(txt.name, [txt.value]);
    expect((await call(platform, 'POST', `/domains/schools/${A}/verify`)).body.data.outcome).toBe('VERIFIED');
    // Verified is still not live: no certificate yet.
    const noCert = await call(platform, 'POST', `/domains/schools/${A}/activate`);
    expect(noCert.status).toBe(409);
    expect(noCert.body.error.code).toBe('SSL_NOT_ACTIVE');

    dns.tls.set('www.abcschool.com', { ok: true, validTo: new Date('2027-06-01'), issuer: 'Test CA' });
    expect((await call(platform, 'POST', `/domains/schools/${A}/ssl-check`)).body.data.outcome).toBe('ACTIVE');
    const activated = await call(platform, 'POST', `/domains/schools/${A}/activate`);
    expect(activated.status).toBe(200);
    expect(activated.body.data.domain).toMatchObject({ verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE', active: true });

    expect((await call(null, 'GET', '/domains/resolve?host=www.abcschool.com')).body.data).toEqual({ slug: A, hostname: 'www.abcschool.com' });
    const cors = await new Promise((resolve) => corsOrigin('https://www.abcschool.com', (_e, ok) => resolve(ok)));
    expect(cors).toBe(true);
  });
});

/* ── Security ─────────────────────────────────────────────── */

describe('security: authority and school isolation', () => {
  it('forbids School Admins every Super Admin action', async () => {
    const { request, order } = await raiseAndStartPayment(10);
    const paymentId = payAtGateway(order.orderId);
    await webhook(order.orderId, paymentId, order.amountPaise);

    const attempts = [
      ['POST', `/seats/requests/${request.id}/decision`, { decision: 'APPROVED' }],
      ['POST', `/seats/schools/${A}/price`, { unitPricePaise: 1 }],
      ['POST', `/seats/schools/${A}`, { seats: 1000 }],
      ['GET', '/seats/schools'],
      ['PUT', `/customization/schools/${A}`, { theme: { primaryColor: '#000000' } }],
      ['DELETE', `/customization/schools/${A}`],
      ['PUT', `/domains/schools/${A}/custom`, { domain: 'evil.com' }],
      ['POST', `/domains/schools/${A}/activate`],
      ['POST', `/domains/schools/${A}/profile-domain/import`, {}],
      ['PATCH', `/schools/${A}/admins/${adminA.profileId}`, { website: 'evil.com' }],
      ['POST', '/schools', { tenantId: 'x-school', tenantName: 'X' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(adminA, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await summaryOf(adminA)).toMatchObject({ approvedSeats: 100, purchasedSeats: 110 });
    expect((await call(adminA, 'GET', '/seats/price')).body.data.source).toBe('PLATFORM_DEFAULT');
  });

  it('does not let a school reach another school by naming it', async () => {
    const created = await call(adminB, 'POST', '/seats/requests', { seats: 5 });
    const bRequest = created.body.data.id;

    const spoof = { 'x-school-id': B };
    expect((await call(adminA, 'GET', `/seats/summary?schoolId=${B}`, undefined, spoof)).body.data.tenantId).toBe(A);
    expect((await call(adminA, 'GET', `/seats/requests/${bRequest}`, undefined, spoof)).status).toBe(404);
    expect((await call(adminA, 'POST', `/seats/requests/${bRequest}/pay`, undefined, spoof)).status).toBe(404);
    expect((await call(adminA, 'GET', '/seats/requests', undefined, spoof)).body.data.some((r) => r.id === bRequest)).toBe(false);
    expect((await call(adminA, 'GET', `/seats/requests?tenantId=${B}`)).body.data.some((r) => r.tenantId === B)).toBe(false);
    expect((await call(adminA, 'GET', '/domains/mine', undefined, spoof)).body.data.tenantId).toBe(A);
    expect((await call(adminA, 'POST', '/seats/requests', { seats: 5, tenantId: B }, spoof)).body.data.tenantId).toBe(A);
  });

  it('does not let a school confirm another school\'s payment', async () => {
    const createdB = await call(adminB, 'POST', '/seats/requests', { seats: 5 });
    const payB = await call(adminB, 'POST', `/seats/requests/${createdB.body.data.id}/pay`);
    const paymentId = payAtGateway(payB.body.data.orderId);
    const res = await call(adminA, 'POST', '/seats/payments/verify', {
      orderId: payB.body.data.orderId, paymentId, signature: checkoutSignature(payB.body.data.orderId, paymentId),
    });
    expect(res.status).toBe(404);
    expect((await summaryOf(adminB)).purchasedSeats).toBe(100);
  });
});

describe('security: money', () => {
  it('refuses to approve an unpaid request', async () => {
    const { request } = await raiseAndStartPayment(20);
    const res = await call(platform, 'POST', `/seats/requests/${request.id}/decision`, { decision: 'APPROVED' });
    expect(res.status).toBe(409);
    expect((await summaryOf(adminA)).approvedSeats).toBe(100);
  });

  it('refuses a webhook with a forged signature', async () => {
    const { order } = await raiseAndStartPayment(20);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: order.orderId, amount: order.amountPaise } } } });
    const res = await realFetch(`${base}/fees/webhooks/razorpay`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' }, body: raw,
    });
    expect(res.status).toBe(401);
    expect((await summaryOf(adminA)).purchasedSeats).toBe(100);
  });

  it('refuses a correctly signed webhook claiming a different amount', async () => {
    const { order } = await raiseAndStartPayment(20);
    const paymentId = payAtGateway(order.orderId);
    const res = await webhook(order.orderId, paymentId, 1);
    expect(res.body.data).toMatchObject({ handled: false, reason: 'AMOUNT_MISMATCH' });
    expect((await summaryOf(adminA)).purchasedSeats).toBe(100);
  });

  it('allocates once for concurrent duplicate approvals', async () => {
    const { request, order } = await raiseAndStartPayment(50);
    await webhook(order.orderId, payAtGateway(order.orderId), order.amountPaise);

    const decisions = await Promise.all(
      [1, 2, 3, 4].map(() => call(platform, 'POST', `/seats/requests/${request.id}/decision`, { decision: 'APPROVED' })),
    );
    expect(decisions.map((d) => d.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await summaryOf(adminA)).toMatchObject({ approvedSeats: 150, purchasedSeats: 150 });
    expect(await runAcrossSchools(() => SeatLedgerEntry.countDocuments({ event: 'EXTRA_SEATS_APPROVED' }))).toBe(1);
  });

  it('rolls a settlement back when the seat movement fails, so the gateway\'s retry still buys the seats', async () => {
    const { order } = await raiseAndStartPayment(30);
    const paymentId = payAtGateway(order.orderId);

    const create = SeatLedgerEntry.create.bind(SeatLedgerEntry);
    const spy = vi.spyOn(SeatLedgerEntry, 'create').mockImplementationOnce(async () => {
      throw new Error('simulated write failure');
    });
    const failed = await webhook(order.orderId, paymentId, order.amountPaise);
    expect(failed.status).toBe(500);
    spy.mockImplementation(create);

    const request = await runAcrossSchools(() => SeatRequest.findOne({ 'payment.gatewayOrderRef': order.orderId }).lean());
    expect(request.status).toBe('PENDING_PAYMENT');
    expect((await summaryOf(adminA)).purchasedSeats).toBe(100);

    const retried = await webhook(order.orderId, paymentId, order.amountPaise);
    expect(retried.body.data).toMatchObject({ handled: true, status: 'PAID' });
    expect((await summaryOf(adminA)).purchasedSeats).toBe(130);
  });

  it('never takes a seat balance below zero under concurrent corrections', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => call(platform, 'POST', `/seats/schools/${A}`, { seats: -40, event: 'ADJUSTMENT' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 400]);
    const account = await runAcrossSchools(() => SeatAccount.findOne({ tenantId: A }).lean());
    expect(account).toMatchObject({ purchasedSeats: 20, approvedSeats: 20 });
    // The failed correction left no ledger row behind.
    expect(await runAcrossSchools(() => SeatLedgerEntry.countDocuments({ tenantId: A, event: 'ADJUSTMENT' }))).toBe(2);
  });
});

describe('security: seat enforcement on user creation', () => {
  it('reads approved seats only: paid-but-unapproved seats cannot be used', async () => {
    await call(platform, 'POST', `/seats/schools/${A}`, { seats: -98, event: 'ADJUSTMENT' }); // 2 approved, admin uses 1
    const { order } = await raiseAndStartPayment(10);
    await webhook(order.orderId, payAtGateway(order.orderId), order.amountPaise);

    const first = await call(adminA, 'POST', '/users', { roleKey: 'TEACHER', displayName: 'Teacher One', phone: phone() });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await call(adminA, 'POST', '/users', { roleKey: 'TEACHER', displayName: 'Teacher Two', phone: phone() });
    expect(second.status).toBe(409);
  });
});
