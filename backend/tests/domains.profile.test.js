import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SchoolDomain } from '../src/models/schoolDomain.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { MCP_TOOLS } from '../src/modules/ai/mcp/registry.js';
import * as domains from '../src/modules/domains/domain.service.js';
import * as schools from '../src/modules/schools/school.service.js';
import { setDomainProbes } from '../src/modules/domains/domain.checks.js';
import { normalizeWebsite } from '../src/modules/domains/domain.hostname.js';

/**
 * Automatic domain fetching from the School Admin profile.
 *
 *   School Admin profile (Profile.website)
 *     → validated and normalised
 *     → School Domain Configuration (PENDING, inactive, source PROFILE)
 *     → Super Admin review → activation
 *
 * The rules under test: a domain is only ever what a profile actually says,
 * normalised — never invented; a profile change never takes an active domain
 * down on its own; and one school's profiles never feed another school's
 * configuration.
 */

const A = 'abc-public';
const B = 'bright-future';

const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91966${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function seedPerson({ roleKey, tenantId, displayName = `${roleKey} person` }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get(roleKey);
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName,
    ...(tenantId ? { tenantId, tenantName: tenantId } : {}), status: 'ACTIVE',
  });
  return {
    profile,
    actor: {
      accountId: String(account._id), profileId: String(profile._id), displayName,
      roleKey, permissions: buildPermissionMap(role), tenantId: tenantId ?? null,
    },
  };
}

let platform;
let adminA;
let adminB;
let teacherA;
let net;
const saved = {};

beforeEach(async () => {
  saved.platformDomain = env.PLATFORM_DOMAIN;
  env.PLATFORM_DOMAIN = 'eduos.test-platform.com';
  net = { txt: new Map(), tls: new Map() };
  setDomainProbes({
    dns: {
      txt: async (h) => ({ found: net.txt.get(h) ?? [] }),
      address: async () => ({ found: [] }),
      cname: async () => ({ found: [] }),
    },
    tls: async (h) => net.tls.get(h) ?? { ok: false, error: 'ECONNREFUSED' },
  });
  domains.invalidateActiveHostCache();

  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }
  await School.create({ slug: A, name: 'ABC Public School' });
  await School.create({ slug: B, name: 'Bright Future Academy' });

  platform = await seedPerson({ roleKey: 'SUPER_ADMIN', displayName: 'Platform Owner' });
  adminA = await seedPerson({ roleKey: 'ADMIN', tenantId: A, displayName: 'A admin' });
  adminB = await seedPerson({ roleKey: 'ADMIN', tenantId: B, displayName: 'B admin' });
  teacherA = await seedPerson({ roleKey: 'TEACHER', tenantId: A, displayName: 'A teacher' });
});

afterEach(() => {
  env.PLATFORM_DOMAIN = saved.platformDomain;
  setDomainProbes();
});

const P = () => platform.actor;
const asPlatform = (fn) => runAcrossSchools(fn);
const inSchool = (slug, fn) => runWithTenant(slug, fn);

/** A Super Admin editing a School Admin's website through the existing service. */
const setWebsite = (slug, person, website) =>
  asPlatform(() => schools.updateSchoolAdmin(slug, person.actor.profileId, { website }, P()));

const domainOf = async (slug) => (await asPlatform(() => domains.getDomain(slug)));

/** Verifies, certifies and activates whatever the school is configured with. */
async function makeLive(slug) {
  const { domain } = await domainOf(slug);
  net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
  net.tls.set(domain.hostname, { ok: true, validTo: new Date('2027-01-01'), issuer: 'Test CA' });
  await asPlatform(() => domains.verifyDomain(P(), slug));
  await asPlatform(() => domains.checkSsl(P(), slug));
  return asPlatform(() => domains.activateDomain(P(), slug));
}

/* ── 1. Normalisation ─────────────────────────────────────── */

describe('a website is normalised to the domain it names', () => {
  it.each([
    ['a valid domain', 'example.com', 'example.com'],
    ['an https URL', 'https://example.com', 'example.com'],
    ['an http URL', 'http://example.com', 'example.com'],
    ['a www domain', 'www.example.com', 'example.com'],
    ['https, www and a trailing slash', 'https://www.example.com/', 'example.com'],
    ['a trailing slash', 'example.com/', 'example.com'],
    ['mixed case and whitespace', '  HTTPS://WWW.Example.COM/  ', 'example.com'],
    ['a subdomain other than www', 'https://portal.abcschool.edu.in/', 'portal.abcschool.edu.in'],
    ['a trailing root dot', 'www.example.com.', 'example.com'],
  ])('%s: %j → %j', (_label, input, expected) => {
    expect(normalizeWebsite(input)).toBe(expected);
  });

  it('keeps www when stripping it would leave no registrable name', () => {
    expect(normalizeWebsite('www.com')).toBe('www.com');
  });

  it.each([
    [null], [undefined], [''], ['   '],
  ])('treats %j as not provided — never a guess', (input) => {
    expect(normalizeWebsite(input)).toBeNull();
  });

  it.each([
    ['a URL containing a path', 'https://www.example.com/about', 'WEBSITE_HAS_PATH'],
    ['a path on a shared host', 'https://sites.google.com/abc-school', 'WEBSITE_HAS_PATH'],
    ['a query', 'https://example.com/?ref=1', 'WEBSITE_HAS_PATH'],
    ['a fragment', 'example.com#home', 'WEBSITE_HAS_PATH'],
    ['an ftp URL', 'ftp://example.com', 'INVALID_WEBSITE'],
    ['a javascript: URL', 'javascript:alert(1)', 'DOMAIN_HAS_PROTOCOL'],
    ['an invalid URL', 'https://', 'INVALID_DOMAIN'],
    ['not a URL at all', 'our school website', 'INVALID_WEBSITE'],
    ['a malformed scheme', 'https:/example.com', 'WEBSITE_HAS_PATH'],
    ['a port', 'https://example.com:8443/', 'DOMAIN_HAS_PORT'],
    ['credentials', 'https://user:pass@example.com', 'INVALID_WEBSITE'],
    ['an IP address', 'http://192.168.0.1', 'INVALID_DOMAIN'],
    ['a single label', 'https://intranet/', 'INVALID_DOMAIN'],
    ['localhost', 'http://localhost', 'INVALID_DOMAIN'],
    ['a non-string', 42, 'INVALID_WEBSITE'],
  ])('refuses %s', (_label, input, code) => {
    expect(() => normalizeWebsite(input)).toThrow(expect.objectContaining({ statusCode: 400, code }));
  });

  it('refuses the platform\'s own domain as a school website', () => {
    expect(() => normalizeWebsite('https://abc.eduos.test-platform.com', { platformDomain: 'eduos.test-platform.com' }))
      .toThrow(expect.objectContaining({ code: 'DOMAIN_IS_PLATFORM' }));
  });
});

/* ── 2. The profile field ─────────────────────────────────── */

describe('the website on the School Admin profile', () => {
  it('is stored as entered, and refused when invalid — changing nothing', async () => {
    await setWebsite(A, adminA, 'https://www.abcschool.com/');
    expect((await Profile.findById(adminA.actor.profileId).lean()).website).toBe('https://www.abcschool.com/');

    await expect(setWebsite(A, adminA, 'https://www.abcschool.com/admissions'))
      .rejects.toMatchObject({ statusCode: 400, code: 'WEBSITE_HAS_PATH' });
    expect((await Profile.findById(adminA.actor.profileId).lean()).website).toBe('https://www.abcschool.com/');
  });

  it('refuses an invalid website before creating a School Admin at all', async () => {
    const before = await Account.countDocuments();
    await expect(asPlatform(() => schools.createSchoolAdmin(A, {
      displayName: 'New admin', phone: '+919811100001', website: 'not a website',
    }, P()))).rejects.toMatchObject({ statusCode: 400 });
    expect(await Account.countDocuments()).toBe(before);
  });

  it('is listed with the school\'s admins', async () => {
    await setWebsite(A, adminA, 'www.abcschool.com');
    const admins = await asPlatform(() => schools.listSchoolAdmins(A));
    expect(admins.find((a) => a.profileId === adminA.actor.profileId).website).toBe('www.abcschool.com');
  });
});

/* ── 3. Fetching ──────────────────────────────────────────── */

describe('fetching the domain from the profile', () => {
  it('reports "Not Provided" when no admin has a website, and configures nothing', async () => {
    const { domain, profileDomain } = await domainOf(A);
    expect(domain).toBeNull();
    expect(profileDomain).toMatchObject({ status: 'NOT_PROVIDED', hostname: null, sync: 'NOT_PROVIDED' });

    await asPlatform(() => schools.updateSchoolAdmin(A, adminA.actor.profileId, { displayName: 'Renamed admin' }, P()));
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);

    const { schools: rows } = await asPlatform(() => domains.listDomains());
    expect(rows.find((r) => r.tenantId === A)).toMatchObject({ profileDomain: null, profileDomainStatus: 'NOT_PROVIDED' });
  });

  it('refuses to import a domain that was never provided', async () => {
    await expect(asPlatform(() => domains.importProfileDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 422, code: 'PROFILE_DOMAIN_NOT_PROVIDED' });
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);
  });

  it('creates a PENDING, inactive configuration from a newly entered website', async () => {
    await setWebsite(A, adminA, 'https://www.abcschool.com/');
    const { domain, profileDomain } = await domainOf(A);

    expect(profileDomain).toMatchObject({ status: 'FOUND', hostname: 'abcschool.com', sync: 'IN_SYNC', profileName: 'A admin' });
    expect(domain).toMatchObject({
      type: 'CUSTOM', hostname: 'abcschool.com', verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false,
      source: 'PROFILE', sourceWebsite: 'https://www.abcschool.com/', sourceProfileName: 'A admin',
      sourceProfileId: adminA.actor.profileId,
    });
    expect(domain.sourceFetchedAt).toBeTruthy();
  });

  it('does not activate or verify anything merely because the profile named a domain', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await expect(asPlatform(() => domains.activateDomain(P(), A))).rejects.toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });
    expect(await domains.resolveHostname('abcschool.com')).toBeNull();
  });

  it('agrees when several admins give the same domain in different spellings', async () => {
    const second = await seedPerson({ roleKey: 'ADMIN', tenantId: A, displayName: 'A second admin' });
    await setWebsite(A, adminA, 'https://www.abcschool.com/');
    await setWebsite(A, second, 'abcschool.com');
    const { profileDomain } = await domainOf(A);
    expect(profileDomain).toMatchObject({ status: 'FOUND', hostname: 'abcschool.com' });
  });

  it('picks nothing when two admins give different domains', async () => {
    const second = await seedPerson({ roleKey: 'ADMIN', tenantId: A, displayName: 'A second admin' });
    await Profile.updateOne({ _id: adminA.actor.profileId }, { website: 'abcschool.com' });
    await Profile.updateOne({ _id: second.actor.profileId }, { website: 'abc-school.org' });
    const { profileDomain } = await domainOf(A);
    expect(profileDomain.status).toBe('CONFLICT');
    expect(profileDomain.hostname).toBeNull();
    expect(profileDomain.candidates.map((c) => c.hostname).sort()).toEqual(['abc-school.org', 'abcschool.com']);
    await expect(asPlatform(() => domains.importProfileDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'PROFILE_DOMAIN_CONFLICT' });
  });

  it('reports a website stored before validation existed as INVALID, not as a domain', async () => {
    await Profile.updateOne({ _id: adminA.actor.profileId }, { website: 'https://abcschool.com/about-us' });
    const { profileDomain } = await domainOf(A);
    expect(profileDomain).toMatchObject({ status: 'INVALID', hostname: null, website: 'https://abcschool.com/about-us' });
    await expect(asPlatform(() => domains.importProfileDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 422, code: 'PROFILE_DOMAIN_INVALID' });
  });

  it('ignores the website of a suspended School Admin', async () => {
    await Profile.updateOne({ _id: adminA.actor.profileId }, { website: 'abcschool.com', status: 'SUSPENDED' });
    expect((await domainOf(A)).profileDomain.status).toBe('NOT_PROVIDED');
  });

  it('ignores a website on a non-admin profile in the same school', async () => {
    await Profile.updateOne({ _id: teacherA.actor.profileId }, { website: 'teacher-blog.com' });
    expect((await domainOf(A)).profileDomain.status).toBe('NOT_PROVIDED');
  });

  it('keeps a manually configured domain when a website appears, leaving a change to review', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'portal.abcschool.com' }));
    await setWebsite(A, adminA, 'abcschool.com');
    const { domain, profileDomain } = await domainOf(A);
    expect(domain).toMatchObject({ hostname: 'portal.abcschool.com', source: 'MANUAL' });
    expect(domain.pendingProfileDomain).toMatchObject({ change: 'CHANGED', hostname: 'abcschool.com' });
    expect(profileDomain.sync).toBe('CHANGED');
  });
});

/* ── 4. Changes ───────────────────────────────────────────── */

describe('when the profile\'s domain changes', () => {
  it('follows the change for an inactive profile-sourced configuration, still pending', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    const first = (await domainOf(A)).domain;
    await setWebsite(A, adminA, 'https://www.abc-school.org/');
    const { domain } = await domainOf(A);
    expect(domain).toMatchObject({ hostname: 'abc-school.org', verificationStatus: 'PENDING', active: false, source: 'PROFILE' });
    expect(domain.dnsInstructions.records[0].value).not.toBe(first.dnsInstructions.records[0].value);
    expect(domain.pendingProfileDomain).toBeNull();
  });

  it('never replaces an ACTIVE domain on its own — it records a pending update', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');

    const { domain, profileDomain } = await domainOf(A);
    expect(domain).toMatchObject({ hostname: 'abcschool.com', active: true, verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE' });
    expect(domain.pendingProfileDomain).toMatchObject({ change: 'CHANGED', hostname: 'abc-school.org', website: 'abc-school.org' });
    expect(profileDomain.sync).toBe('CHANGED');
    expect(await domains.resolveHostname('abcschool.com')).toEqual({ slug: A, hostname: 'abcschool.com' });
  });

  it('keeps an active domain live when the website is removed, marking it REMOVED for review', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, '');
    const { domain, profileDomain } = await domainOf(A);
    expect(domain.active).toBe(true);
    expect(domain.pendingProfileDomain).toMatchObject({ change: 'REMOVED', hostname: null });
    expect(profileDomain.status).toBe('NOT_PROVIDED');
  });

  it('keeps an inactive profile-sourced configuration too when the website is removed — never deletes it', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await setWebsite(A, adminA, null);
    const { domain } = await domainOf(A);
    expect(domain.hostname).toBe('abcschool.com');
    expect(domain.pendingProfileDomain.change).toBe('REMOVED');
  });

  it('clears the pending change when the profile returns to the configured domain', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');
    await setWebsite(A, adminA, 'https://www.abcschool.com');
    const { domain } = await domainOf(A);
    expect(domain.pendingProfileDomain).toBeNull();
    expect(domain.sourceWebsite).toBe('https://www.abcschool.com');
  });

  it('lets the Super Admin refuse to replace an active domain without confirmation', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');

    await expect(asPlatform(() => domains.importProfileDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'ACTIVE_DOMAIN_REPLACE_UNCONFIRMED' });
    expect((await domainOf(A)).domain).toMatchObject({ hostname: 'abcschool.com', active: true });
  });

  it('replaces an active domain only on confirmation — pending again, and offline until re-activated', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');

    const result = await asPlatform(() => domains.importProfileDomain(P(), A, { confirmReplace: true }));
    expect(result.changed).toBe(true);
    expect(result.domain).toMatchObject({
      hostname: 'abc-school.org', verificationStatus: 'PENDING', active: false, source: 'PROFILE',
      deactivationReason: 'RECONFIGURED', pendingProfileDomain: null,
    });
    expect(await domains.resolveHostname('abcschool.com')).toBeNull();
  });

  it('dismisses a pending change and leaves the configuration exactly as it was', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');
    const result = await asPlatform(() => domains.dismissProfileDomainChange(P(), A));
    expect(result.domain).toMatchObject({ hostname: 'abcschool.com', active: true, pendingProfileDomain: null });
  });

  it('re-applies nothing when imported while already in sync, but records the source', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'abcschool.com' }));
    await Profile.updateOne({ _id: adminA.actor.profileId }, { website: 'https://abcschool.com/' });
    const result = await asPlatform(() => domains.importProfileDomain(P(), A));
    expect(result.changed).toBe(false);
    expect(result.domain).toMatchObject({ source: 'PROFILE', sourceWebsite: 'https://abcschool.com/', verificationStatus: 'PENDING' });
  });
});

/* ── 5. Duplicates and isolation ──────────────────────────── */

describe('duplicate domains and school isolation', () => {
  it('does not give a second school a domain another school holds', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await setWebsite(B, adminB, 'https://www.abcschool.com/');

    const { domain, profileDomain } = await domainOf(B);
    expect(domain).toBeNull();
    expect(profileDomain).toMatchObject({ status: 'FOUND', sync: 'DUPLICATE', takenByAnotherSchool: true });
    await expect(asPlatform(() => domains.importProfileDomain(P(), B)))
      .rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_TAKEN' });
    expect((await domainOf(A)).domain.hostname).toBe('abcschool.com');
  });

  it('records a pending DUPLICATE on a school that already has a configuration', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'brightfuture.org' }));
    await setWebsite(B, adminB, 'abcschool.com');
    const { domain } = await domainOf(B);
    expect(domain).toMatchObject({ hostname: 'brightfuture.org' });
    expect(domain.pendingProfileDomain.change).toBe('DUPLICATE');
  });

  it('never reads School B\'s admin profiles into School A', async () => {
    await setWebsite(B, adminB, 'brightfuture.org');
    const a = await inSchool(A, () => domains.getDomain());
    expect(a.profileDomain.status).toBe('NOT_PROVIDED');
    expect(JSON.stringify(a)).not.toContain('brightfuture');
  });

  it('refuses to edit a School Admin through another school\'s path', async () => {
    await expect(asPlatform(() => schools.updateSchoolAdmin(B, adminA.actor.profileId, { website: 'abcschool.com' }, P())))
      .rejects.toMatchObject({ statusCode: 404 });
    expect((await Profile.findById(adminA.actor.profileId).lean()).website).toBeNull();
  });

  it('answers a school naming another school as not found', async () => {
    await expect(inSchool(A, () => domains.importProfileDomain(adminA.actor, B))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inSchool(A, () => domains.detectProfileDomainChange(adminA.actor, B))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not tell a school which other school holds its domain', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await setWebsite(B, adminB, 'abcschool.com');
    const view = await inSchool(B, () => domains.getDomain());
    expect(view.profileDomain.takenByAnotherSchool).toBe(true);
    expect(JSON.stringify(view)).not.toContain(A);
  });
});

/* ── 6. Audit ─────────────────────────────────────────────── */

describe('every profile-driven domain change is audited', () => {
  it('records the website change, the configuration, the pending update and the review', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');
    await asPlatform(() => domains.dismissProfileDomainChange(P(), A));
    await asPlatform(() => domains.importProfileDomain(P(), A, { confirmReplace: true })).catch(() => {});

    const actions = (await AuditLog.find({ entityType: 'SchoolDomain', entityId: A }).sort({ createdAt: 1 }).lean())
      .map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining([
      'domain.profile_website_changed', 'domain.configured', 'domain.profile_change_pending',
      'domain.profile_change_dismissed', 'domain.profile_imported',
    ]));

    const websiteChange = await AuditLog.findOne({ action: 'domain.profile_website_changed', 'before.website': 'abcschool.com' }).lean();
    expect(websiteChange.after).toMatchObject({ website: 'abc-school.org', hostname: 'abc-school.org', sync: 'CHANGED' });
    expect(String(websiteChange.actorProfileId)).toBe(platform.actor.profileId);
  });
});

/* ── 7. RBAC over real HTTP ───────────────────────────────── */

describe('who may read, change and apply the profile domain', () => {
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

  const call = async (person, method, path, body) => {
    const headers = { 'content-type': 'application/json' };
    if (person) {
      headers.authorization = `Bearer ${signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null })}`;
    }
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  it('lets the Super Admin set a website and import it over HTTP', async () => {
    const updated = await call(platform, 'PATCH', `/schools/${A}/admins/${adminA.actor.profileId}`, { website: 'https://www.abcschool.com/' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.website).toBe('https://www.abcschool.com/');

    const detail = await call(platform, 'GET', `/domains/schools/${A}`);
    expect(detail.body.data.profileDomain).toMatchObject({ hostname: 'abcschool.com', sync: 'IN_SYNC' });

    const imported = await call(platform, 'POST', `/domains/schools/${A}/profile-domain/import`, {});
    expect(imported.status).toBe(200);
  });

  it('answers an invalid website over HTTP with 400 and changes nothing', async () => {
    const res = await call(platform, 'PATCH', `/schools/${A}/admins/${adminA.actor.profileId}`, { website: 'https://abcschool.com/login' });
    expect(res.status).toBe(400);
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);
  });

  it('forbids a School Admin from changing even its own website', async () => {
    const res = await call(adminA, 'PATCH', `/schools/${A}/admins/${adminA.actor.profileId}`, { website: 'abcschool.com' });
    expect(res.status).toBe(403);
    expect((await Profile.findById(adminA.actor.profileId).lean()).website).toBeNull();
  });

  it.each([
    ['POST', `/domains/schools/${A}/profile-domain/import`],
    ['POST', `/domains/schools/${A}/profile-domain/dismiss`],
  ])('forbids a School Admin %s %s', async (method, path) => {
    expect((await call(adminA, method, path, {})).status).toBe(403);
  });

  it('forbids a teacher, and refuses an anonymous caller', async () => {
    expect((await call(teacherA, 'GET', '/domains/mine')).status).toBe(403);
    expect((await call(teacherA, 'POST', `/domains/schools/${A}/profile-domain/import`, {})).status).toBe(403);
    expect((await call(null, 'POST', `/domains/schools/${A}/profile-domain/import`, {})).status).toBe(401);
  });

  it('lets a School Admin read its own profile domain, and not another school\'s', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await setWebsite(B, adminB, 'brightfuture.org');

    const mine = await call(adminA, 'GET', '/domains/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.data.profileDomain).toMatchObject({ hostname: 'abcschool.com', status: 'FOUND' });
    expect(JSON.stringify(mine.body)).not.toContain('brightfuture');

    // A School Admin sending another school's id is still answered about its own.
    const spoofed = await fetch(`${base}/domains/mine`, {
      headers: {
        authorization: `Bearer ${signAccessToken({ accountId: adminA.actor.accountId, profileId: adminA.actor.profileId, door: null })}`,
        'x-school-id': B,
      },
    }).then((r) => r.json());
    expect(spoofed.data.tenantId).toBe(A);
  });
});

/* ── 8. MCP ───────────────────────────────────────────────── */

describe('the assistant\'s view of the profile domain', () => {
  const ask = (slug, person) => inSchool(slug, () => MCP_TOOLS.get_school_domain.run({ actor: person.actor }, {}));

  it('says "Not Provided" and invents nothing', async () => {
    const result = await ask(A, adminA);
    expect(result.data.profileDomain).toEqual({ status: 'NOT_PROVIDED', hostname: null, display: 'Not Provided', sync: 'NOT_PROVIDED' });
    expect(result.speak).toMatch(/Not Provided/);
  });

  it('reports the normalised profile domain and that it is applied', async () => {
    await setWebsite(A, adminA, 'https://www.abcschool.com/');
    const result = await ask(A, adminA);
    expect(result.data).toMatchObject({ source: 'PROFILE', profileDomain: { hostname: 'abcschool.com', sync: 'IN_SYNC' } });
    expect(result.speak).toMatch(/abcschool\.com, which is the configured domain/);
  });

  it('reports a pending change on an active domain', async () => {
    await setWebsite(A, adminA, 'abcschool.com');
    await makeLive(A);
    await setWebsite(A, adminA, 'abc-school.org');
    const result = await ask(A, adminA);
    expect(result.data).toMatchObject({ hostname: 'abcschool.com', active: true, pendingProfileChange: 'CHANGED' });
    expect(result.speak).toMatch(/has not been applied yet/);
  });

  it('never carries another school\'s profile domain', async () => {
    await setWebsite(B, adminB, 'brightfuture.org');
    expect(JSON.stringify(await ask(A, adminA))).not.toContain('brightfuture');
  });

  it('has no write tool for the website or the import', () => {
    const writes = Object.entries(MCP_TOOLS).filter(([, t]) => t.module === 'Domains' && t.operation !== 'GET');
    expect(writes).toEqual([]);
  });
});
