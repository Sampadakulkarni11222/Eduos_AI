import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SchoolDomain } from '../src/models/schoolDomain.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import * as domains from '../src/modules/domains/domain.service.js';
import { setDomainProbes, probes } from '../src/modules/domains/domain.checks.js';
import { corsOrigin } from '../src/modules/domains/domain.cors.js';
import {
  normalizeCustomDomain, parseSubdomain, slugifySubdomain, hostnameForLookup, RESERVED_SUBDOMAINS,
} from '../src/modules/domains/domain.hostname.js';

/**
 * School domain management.
 *
 * The rule the feature is built around, stated as tests: a domain goes live
 * only after real DNS shows the records exist, a real TLS handshake shows a
 * certificate is served, and a Super Admin activates it. Typing a hostname
 * does none of that.
 *
 * DNS and TLS are the one thing substituted here, through the probe seam in
 * domain.checks.js — the suite scripts what "the internet" answers for each
 * hostname and the service reacts exactly as it would to the real resolver.
 * Everything else is real: the models and their unique indexes, the tenancy
 * plugin, the permission catalog, the HTTP routes and the audit trail.
 */

const A = 'abc-public';
const B = 'bright-future';
const PLATFORM = 'eduos.test-platform.com';
const TARGET = 'school-erp-frontend.onrender.com';

/* ── The scripted internet ─────────────────────────────────── */

let net;
function resetNet() {
  net = { txt: new Map(), address: new Map(), cname: new Map(), dnsDown: new Set(), tls: new Map() };
  setDomainProbes({
    dns: {
      txt: async (h) => (net.dnsDown.has(h) ? { error: 'ETIMEOUT' } : { found: net.txt.get(h) ?? [] }),
      address: async (h) => (net.dnsDown.has(h) ? { error: 'ETIMEOUT' } : { found: net.address.get(h) ?? [] }),
      cname: async (h) => (net.dnsDown.has(h) ? { error: 'ETIMEOUT' } : { found: net.cname.get(h) ?? [] }),
    },
    tls: async (h) => net.tls.get(h) ?? { ok: false, error: 'ECONNREFUSED' },
  });
}
const goodCert = { ok: true, validTo: new Date('2027-01-01'), issuer: "Let's Encrypt" };

/* ── People ───────────────────────────────────────────────── */

const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91955${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function seedPerson({ roleKey, tenantId, displayName = `${roleKey} person` }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get(roleKey);
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName,
    ...(tenantId ? { tenantId, tenantName: tenantId } : {}), status: 'ACTIVE',
  });
  return {
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
const saved = {};

beforeEach(async () => {
  saved.platformDomain = env.PLATFORM_DOMAIN;
  saved.target = env.DOMAIN_CNAME_TARGET;
  saved.cors = env.CORS_ORIGIN;
  env.PLATFORM_DOMAIN = PLATFORM;
  env.DOMAIN_CNAME_TARGET = TARGET;
  env.CORS_ORIGIN = 'http://localhost:3000';
  resetNet();
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
  env.DOMAIN_CNAME_TARGET = saved.target;
  env.CORS_ORIGIN = saved.cors;
  setDomainProbes();
});

const asPlatform = (fn) => runAcrossSchools(fn);
const inSchool = (slug, fn) => runWithTenant(slug, fn);
const P = () => platform.actor;

/** Takes a custom domain all the way to live, the way a Super Admin would. */
async function makeLive(slug, hostname) {
  const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), slug, { domain: hostname }));
  net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
  net.tls.set(hostname, goodCert);
  await asPlatform(() => domains.verifyDomain(P(), slug));
  await asPlatform(() => domains.checkSsl(P(), slug));
  return asPlatform(() => domains.activateDomain(P(), slug));
}

/* ── 1. Subdomain generation ──────────────────────────────── */

describe('a subdomain generated from the school name', () => {
  it.each([
    ['ABC Public School', 'abc-public-school'],
    ["St. Mary's Convent (Pune)", 'st-marys-convent-pune'],
    ['École Française Internationale', 'ecole-francaise-internationale'],
    ['A & B   Public -- School!!', 'a-and-b-public-school'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
  ])('turns %j into %j', (name, expected) => {
    expect(slugifySubdomain(name)).toBe(expected);
  });

  it('never exceeds a DNS label, and never ends on a hyphen when cut', () => {
    const label = slugifySubdomain(`${'a'.repeat(62)} b`);
    expect(label.length).toBeLessThanOrEqual(63);
    expect(label.endsWith('-')).toBe(false);
  });

  it('yields nothing rather than a guess for a name with no Latin letters', () => {
    expect(slugifySubdomain('विद्यालय')).toBe('');
  });

  it('suggests the name-derived label without claiming it', async () => {
    const suggestion = await asPlatform(() => domains.suggestSubdomain(A));
    expect(suggestion).toEqual({ tenantId: A, subdomain: 'abc-public-school', hostname: `abc-public-school.${PLATFORM}` });
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);
  });

  it('configures the generated subdomain as PENDING and inactive', async () => {
    const { changed, domain } = await asPlatform(() => domains.configureSubdomain(P(), A));
    expect(changed).toBe(true);
    expect(domain).toMatchObject({
      type: 'SUBDOMAIN', subdomain: 'abc-public-school', hostname: `abc-public-school.${PLATFORM}`,
      verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false, platformDomain: PLATFORM,
    });
  });

  it('gives a second school with the same name the next free label', async () => {
    await School.create({ slug: 'abc-public-2', name: 'ABC Public School' });
    await asPlatform(() => domains.configureSubdomain(P(), A));
    const second = await asPlatform(() => domains.configureSubdomain(P(), 'abc-public-2'));
    expect(second.domain.subdomain).toBe('abc-public-school-2');

    await School.create({ slug: 'abc-public-3', name: 'ABC Public School' });
    const third = await asPlatform(() => domains.configureSubdomain(P(), 'abc-public-3'));
    expect(third.domain.subdomain).toBe('abc-public-school-3');
  });

  it('steps past a reserved word instead of issuing it', async () => {
    await School.create({ slug: 'admin-school', name: 'Admin' });
    const { domain } = await asPlatform(() => domains.configureSubdomain(P(), 'admin-school'));
    expect(RESERVED_SUBDOMAINS.has('admin')).toBe(true);
    expect(domain.subdomain).toBe('admin-2');
  });

  it('pads a name too short to be a label', async () => {
    await School.create({ slug: 'ab-school', name: 'AB' });
    const { domain } = await asPlatform(() => domains.configureSubdomain(P(), 'ab-school'));
    expect(domain.subdomain).toBe('ab-school');
  });

  it('keeps the suffix inside 63 characters for a very long duplicate name', async () => {
    const long = `${'Very Long School Name '.repeat(5)}`;
    await School.create({ slug: 'long-1', name: long });
    await School.create({ slug: 'long-2', name: long });
    await asPlatform(() => domains.configureSubdomain(P(), 'long-1'));
    const { domain } = await asPlatform(() => domains.configureSubdomain(P(), 'long-2'));
    expect(domain.subdomain.length).toBeLessThanOrEqual(63);
    expect(domain.subdomain.endsWith('-2')).toBe(true);
  });
});

describe('a subdomain the Super Admin types', () => {
  it.each([
    ['uppercase is folded', 'ABC-School', 'abc-school'],
  ])('accepts it: %s', (_label, input, expected) => {
    expect(parseSubdomain(input)).toBe(expected);
  });

  it.each([
    ['too short', 'ab', 'INVALID_SUBDOMAIN'],
    ['too long', 'a'.repeat(64), 'INVALID_SUBDOMAIN'],
    ['a dot', 'abc.school', 'INVALID_SUBDOMAIN'],
    ['an underscore', 'abc_school', 'INVALID_SUBDOMAIN'],
    ['a leading hyphen', '-abc', 'INVALID_SUBDOMAIN'],
    ['a trailing hyphen', 'abc-', 'INVALID_SUBDOMAIN'],
    ['a double hyphen', 'abc--school', 'INVALID_SUBDOMAIN'],
    ['a space', 'abc school', 'INVALID_SUBDOMAIN'],
    ['a script tag', '<script>', 'INVALID_SUBDOMAIN'],
    ['a punycode label', 'xn--bcher-kva', 'INVALID_SUBDOMAIN'],
    ['a reserved word', 'www', 'RESERVED_SUBDOMAIN'],
    ['another reserved word', 'api', 'RESERVED_SUBDOMAIN'],
  ])('refuses %s', (_label, input, code) => {
    expect(() => parseSubdomain(input)).toThrow(expect.objectContaining({ statusCode: 400, code }));
  });

  it('refuses one that another school already holds, rather than suffixing it', async () => {
    await asPlatform(() => domains.configureSubdomain(P(), A, { subdomain: 'shared-name' }));
    await expect(asPlatform(() => domains.configureSubdomain(P(), B, { subdomain: 'shared-name' })))
      .rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_TAKEN' });
  });

  it('is unavailable altogether when the deployment has no platform domain', async () => {
    env.PLATFORM_DOMAIN = '';
    await expect(asPlatform(() => domains.configureSubdomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'PLATFORM_DOMAIN_NOT_CONFIGURED' });
    await expect(asPlatform(() => domains.suggestSubdomain(A)))
      .rejects.toMatchObject({ code: 'PLATFORM_DOMAIN_NOT_CONFIGURED' });
  });
});

/* ── 2. Custom domain validation ──────────────────────────── */

describe('a custom domain is normalised', () => {
  it.each([
    ['WWW.AbcSchool.com', 'www.abcschool.com'],
    ['  www.abcschool.com  ', 'www.abcschool.com'],
    ['www.abcschool.com.', 'www.abcschool.com'],
    ['abcschool.co.in', 'abcschool.co.in'],
    ['portal.abc-school.edu.in', 'portal.abc-school.edu.in'],
    ['bücher-schule.de', 'xn--bcher-schule-dlb.de'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeCustomDomain(input, { platformDomain: PLATFORM })).toBe(expected);
  });
});

describe('a malformed or unsafe custom domain is refused', () => {
  it.each([
    ['an https URL', 'https://www.abcschool.com', 'DOMAIN_HAS_PROTOCOL'],
    ['an http URL', 'http://abcschool.com', 'DOMAIN_HAS_PROTOCOL'],
    ['a javascript: URL', 'javascript:alert(1)', 'DOMAIN_HAS_PROTOCOL'],
    ['a protocol-relative URL', '//abcschool.com', 'DOMAIN_HAS_PATH'],
    ['a path', 'www.abcschool.com/login', 'DOMAIN_HAS_PATH'],
    ['a trailing slash', 'www.abcschool.com/', 'DOMAIN_HAS_PATH'],
    ['a query', 'abcschool.com?x=1', 'DOMAIN_HAS_PATH'],
    ['a fragment', 'abcschool.com#top', 'DOMAIN_HAS_PATH'],
    ['a backslash', 'abcschool.com\\evil', 'DOMAIN_HAS_PATH'],
    ['a port', 'abcschool.com:8443', 'DOMAIN_HAS_PORT'],
    ['credentials', 'user@abcschool.com', 'INVALID_DOMAIN'],
    ['a wildcard', '*.abcschool.com', 'INVALID_DOMAIN'],
    ['a space', 'abc school.com', 'INVALID_DOMAIN'],
    ['a newline', 'abcschool.com\nHost: evil.com', 'INVALID_DOMAIN'],
    ['an IPv4 address', '192.168.1.10', 'INVALID_DOMAIN'],
    ['an IPv6 literal', '[::1]', 'INVALID_DOMAIN'],
    ['a single label', 'abcschool', 'INVALID_DOMAIN'],
    ['localhost', 'localhost', 'INVALID_DOMAIN'],
    ['a .local name', 'school.local', 'INVALID_DOMAIN'],
    ['a .test name', 'school.test', 'INVALID_DOMAIN'],
    ['a leading hyphen label', '-abc.com', 'INVALID_DOMAIN'],
    ['an empty label', 'abc..com', 'INVALID_DOMAIN'],
    ['a numeric TLD', 'abc.123', 'INVALID_DOMAIN'],
    ['an underscore', 'abc_school.com', 'INVALID_DOMAIN'],
    ['a label over 63 characters', `${'a'.repeat(64)}.com`, 'INVALID_DOMAIN'],
    ['a name over 253 characters', `${'abcdefghij.'.repeat(24)}com`, 'INVALID_DOMAIN'],
    ['an HTML payload', '<img src=x onerror=alert(1)>.com', 'INVALID_DOMAIN'],
    ['the platform domain itself', PLATFORM, 'DOMAIN_IS_PLATFORM'],
    ['a name under the platform domain', `someone.${PLATFORM}`, 'DOMAIN_IS_PLATFORM'],
    ['an empty string', '   ', 'INVALID_DOMAIN'],
  ])('refuses %s', (_label, input, code) => {
    expect(() => normalizeCustomDomain(input, { platformDomain: PLATFORM }))
      .toThrow(expect.objectContaining({ statusCode: 400, code }));
  });

  it('refuses a non-string', () => {
    expect(() => normalizeCustomDomain({ host: 'abc.com' })).toThrow(expect.objectContaining({ code: 'INVALID_DOMAIN' }));
  });

  it('writes nothing when the domain is refused', async () => {
    await expect(asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'https://abc.com/x' })))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);
  });

  it('treats two spellings of one host as the same host, so two schools cannot share it', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await expect(asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'WWW.ABCSCHOOL.COM.' })))
      .rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_TAKEN' });
  });
});

/* ── 3. Verification is real, and nothing else activates ─── */

describe('configuring a custom domain', () => {
  it('stores it PENDING, inactive, with a TXT record to create', async () => {
    const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    expect(domain).toMatchObject({
      type: 'CUSTOM', customDomain: 'www.abcschool.com', hostname: 'www.abcschool.com',
      verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false,
      verificationRecordName: '_eduos-verification.www.abcschool.com', configuredBy: 'Platform Owner',
    });
    const [txt, routing] = domain.dnsInstructions.records;
    expect(txt).toMatchObject({ type: 'TXT', name: '_eduos-verification.www.abcschool.com', managedBy: 'SCHOOL' });
    expect(txt.value).toMatch(/^eduos-verification=[a-f0-9]{40}$/);
    expect(routing).toMatchObject({ type: 'CNAME', name: 'www.abcschool.com', value: TARGET });
  });

  it('tells an apex domain to use ALIAS, since it cannot hold a CNAME', async () => {
    const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'abcschool.com' }));
    expect(domain.dnsInstructions.records[1].type).toBe('ALIAS');
  });

  it('never puts the token in the stored document by default read', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    const plain = await asPlatform(() => SchoolDomain.findOne({ tenantId: A }).lean());
    expect(plain.verificationToken).toBeUndefined();
  });

  it('issues a fresh token for a new hostname, so an old TXT record verifies nothing', async () => {
    const first = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    const second = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'portal.abcschool.com' }));
    expect(second.domain.dnsInstructions.records[0].value).not.toBe(first.domain.dnsInstructions.records[0].value);
  });

  it('keeps the verification when the same address is submitted again', async () => {
    await makeLive(A, 'www.abcschool.com');
    const again = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'WWW.abcschool.com' }));
    expect(again.changed).toBe(false);
    expect(again.domain).toMatchObject({ verificationStatus: 'VERIFIED', active: true });
  });

  it('starts over — pending and inactive — when an active school moves to a different address', async () => {
    await makeLive(A, 'www.abcschool.com');
    const moved = await asPlatform(() => domains.configureSubdomain(P(), A));
    expect(moved.domain).toMatchObject({
      type: 'SUBDOMAIN', verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false,
      deactivationReason: 'RECONFIGURED',
    });
    expect(await domains.resolveHostname('www.abcschool.com')).toBeNull();
  });
});

describe('verifying a custom domain asks DNS, and believes only DNS', () => {
  let domain;
  beforeEach(async () => {
    ({ domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' })));
  });
  const verify = () => asPlatform(() => domains.verifyDomain(P(), A));

  it('fails when no TXT record exists', async () => {
    const result = await verify();
    expect(result.outcome).toBe('FAILED');
    expect(result.domain.verificationStatus).toBe('FAILED');
    expect(result.error).toMatch(/No TXT record/);
  });

  it('fails when the TXT record carries a different value', async () => {
    net.txt.set(domain.verificationRecordName, ['eduos-verification=not-the-token', 'v=spf1 -all']);
    const result = await verify();
    expect(result.outcome).toBe('FAILED');
    expect(result.error).toMatch(/none of its values/);
  });

  it('fails when the right token sits at the wrong name', async () => {
    net.txt.set('www.abcschool.com', [domain.dnsInstructions.records[0].value]);
    expect((await verify()).outcome).toBe('FAILED');
  });

  it('verifies when the exact record is present', async () => {
    net.txt.set(domain.verificationRecordName, ['something-else', domain.dnsInstructions.records[0].value]);
    net.cname.set('www.abcschool.com', [`${TARGET}.`]);
    const result = await verify();
    expect(result.outcome).toBe('VERIFIED');
    expect(result.domain.verificationStatus).toBe('VERIFIED');
    expect(result.domain.verifiedAt).toBeTruthy();
    expect(result.routing).toEqual({ expected: TARGET, found: [TARGET], pointsAtPlatform: true });
    // Verified is not live.
    expect(result.domain.active).toBe(false);
  });

  it('reports routing that does not yet point at the platform without failing ownership', async () => {
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    const result = await verify();
    expect(result.outcome).toBe('VERIFIED');
    expect(result.routing.pointsAtPlatform).toBe(false);
  });

  it('changes nothing when the resolver cannot be reached', async () => {
    net.dnsDown.add(domain.verificationRecordName);
    net.dnsDown.add('www.abcschool.com');
    const result = await verify();
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.domain.verificationStatus).toBe('PENDING');
    expect(result.domain.lastVerificationError).toMatch(/could not be completed \(ETIMEOUT\)/);
    expect(result.domain.lastVerificationAt).toBeTruthy();
  });

  it('refuses to verify a school with nothing configured', async () => {
    await expect(asPlatform(() => domains.verifyDomain(P(), B)))
      .rejects.toMatchObject({ statusCode: 404, code: 'DOMAIN_NOT_CONFIGURED' });
  });
});

describe('verifying a subdomain', () => {
  const host = `abc-public-school.${PLATFORM}`;
  beforeEach(async () => {
    await asPlatform(() => domains.configureSubdomain(P(), A));
  });

  it('fails while the name does not resolve', async () => {
    const result = await asPlatform(() => domains.verifyDomain(P(), A));
    expect(result.outcome).toBe('FAILED');
    expect(result.error).toMatch(/does not resolve/);
  });

  it('verifies once the name resolves (a wildcard or explicit record)', async () => {
    net.address.set(host, ['216.24.57.1']);
    const result = await asPlatform(() => domains.verifyDomain(P(), A));
    expect(result.outcome).toBe('VERIFIED');
  });

  it('asks the school to create no records of its own', async () => {
    const { domain } = await asPlatform(() => domains.getDomain(A));
    expect(domain.dnsInstructions.records.every((r) => r.managedBy === 'PLATFORM')).toBe(true);
  });
});

describe('the certificate check is a real handshake, and only for a verified domain', () => {
  let domain;
  beforeEach(async () => {
    ({ domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' })));
  });

  it('is refused before verification', async () => {
    await expect(asPlatform(() => domains.checkSsl(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_NOT_VERIFIED' });
  });

  it('records a failing handshake as FAILED', async () => {
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    await asPlatform(() => domains.verifyDomain(P(), A));
    net.tls.set('www.abcschool.com', { ok: false, error: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    const result = await asPlatform(() => domains.checkSsl(P(), A));
    expect(result.outcome).toBe('FAILED');
    expect(result.domain.sslStatus).toBe('FAILED');
    expect(result.domain.sslError).toMatch(/ERR_TLS_CERT_ALTNAME_INVALID/);
  });

  it('records a valid certificate as ACTIVE with its expiry', async () => {
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    await asPlatform(() => domains.verifyDomain(P(), A));
    net.tls.set('www.abcschool.com', goodCert);
    const result = await asPlatform(() => domains.checkSsl(P(), A));
    expect(result.domain).toMatchObject({ sslStatus: 'ACTIVE', sslIssuer: "Let's Encrypt" });
    expect(new Date(result.domain.sslValidTo).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('leaves the status alone when the handshake times out', async () => {
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    await asPlatform(() => domains.verifyDomain(P(), A));
    net.tls.set('www.abcschool.com', { ok: false, error: 'TLS_TIMEOUT' });
    const result = await asPlatform(() => domains.checkSsl(P(), A));
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.domain.sslStatus).toBe('NOT_CHECKED');
  });
});

describe('activation', () => {
  it('is refused for a domain that was only typed in', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await expect(asPlatform(() => domains.activateDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_NOT_VERIFIED' });
    expect(await domains.resolveHostname('www.abcschool.com')).toBeNull();
  });

  it('is refused for a verified domain with no working certificate', async () => {
    const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    await asPlatform(() => domains.verifyDomain(P(), A));
    await expect(asPlatform(() => domains.activateDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'SSL_NOT_ACTIVE' });
  });

  it('is refused for a suspended school', async () => {
    const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    net.tls.set('www.abcschool.com', goodCert);
    await asPlatform(() => domains.verifyDomain(P(), A));
    await asPlatform(() => domains.checkSsl(P(), A));
    await School.updateOne({ slug: A }, { status: 'SUSPENDED' });
    await expect(asPlatform(() => domains.activateDomain(P(), A)))
      .rejects.toMatchObject({ statusCode: 409, code: 'SCHOOL_SUSPENDED' });
  });

  it('succeeds once verified with a certificate, and the host then resolves to the school', async () => {
    const { domain } = await makeLive(A, 'www.abcschool.com');
    expect(domain).toMatchObject({ active: true, verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE' });
    expect(domain.activatedAt).toBeTruthy();
    expect(await domains.resolveHostname('WWW.abcschool.com:443')).toEqual({ slug: A, hostname: 'www.abcschool.com' });
  });

  it('deactivates, and the host stops resolving', async () => {
    await makeLive(A, 'www.abcschool.com');
    const { domain } = await asPlatform(() => domains.deactivateDomain(P(), A, { reason: 'School request' }));
    expect(domain).toMatchObject({ active: false, deactivationReason: 'School request' });
    expect(await domains.resolveHostname('www.abcschool.com')).toBeNull();
  });

  it('takes an active domain offline when re-verification shows the record is gone', async () => {
    const { domain } = await makeLive(A, 'www.abcschool.com');
    net.txt.set(domain.verificationRecordName, []);
    const result = await asPlatform(() => domains.verifyDomain(P(), A));
    expect(result.domain).toMatchObject({ verificationStatus: 'FAILED', active: false, deactivationReason: 'VERIFICATION_FAILED' });
    expect(await domains.resolveHostname('www.abcschool.com')).toBeNull();
  });

  it('keeps an active domain online when re-verification merely cannot reach DNS', async () => {
    const { domain } = await makeLive(A, 'www.abcschool.com');
    net.dnsDown.add(domain.verificationRecordName);
    net.dnsDown.add('www.abcschool.com');
    const result = await asPlatform(() => domains.verifyDomain(P(), A));
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.domain.active).toBe(true);
  });

  it('stops resolving a live domain the moment its school is suspended', async () => {
    await makeLive(A, 'www.abcschool.com');
    await School.updateOne({ slug: A }, { status: 'SUSPENDED' });
    expect(await domains.resolveHostname('www.abcschool.com')).toBeNull();
  });

  it('uses the real network probes unless a test replaces them', () => {
    setDomainProbes();
    expect(typeof probes().tls).toBe('function');
    expect(probes().tls.name).toBe('liveTls');
    resetNet();
  });
});

/* ── 4. School isolation ──────────────────────────────────── */

describe('one school never reaches another\'s domain', () => {
  it('shows a School Admin its own domain and nothing of another school\'s', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'www.brightfuture.org' }));

    const mine = await inSchool(A, () => domains.getDomain());
    expect(mine.domain.hostname).toBe('www.abcschool.com');
    expect(JSON.stringify(mine)).not.toContain('brightfuture');
  });

  it('answers a school naming another school as not found', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'www.brightfuture.org' }));
    await expect(inSchool(A, () => domains.getDomain(B))).rejects.toMatchObject({ statusCode: 404, code: 'SCHOOL_NOT_FOUND' });
    await expect(inSchool(A, () => domains.verifyDomain(adminA.actor, B))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps each school\'s verification token to itself', async () => {
    const a = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    const b = await asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'www.brightfuture.org' }));
    // B's record placed at A's name does not verify A.
    net.txt.set(a.domain.verificationRecordName, [b.domain.dnsInstructions.records[0].value]);
    expect((await asPlatform(() => domains.verifyDomain(P(), A))).outcome).toBe('FAILED');
  });

  it('does not let changing one school touch the other', async () => {
    await makeLive(B, 'www.brightfuture.org');
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await asPlatform(() => domains.deactivateDomain(P(), A));
    expect(await domains.resolveHostname('www.brightfuture.org')).toEqual({ slug: B, hostname: 'www.brightfuture.org' });
  });

  it('stamps every domain with the school that owns it, one document per school', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await asPlatform(() => domains.configureSubdomain(P(), A));
    await asPlatform(() => domains.configureSubdomain(P(), B));
    const docs = await asPlatform(() => SchoolDomain.find().lean());
    expect(docs.map((d) => d.tenantId).sort()).toEqual([A, B]);
  });

  it('refuses a hostname held by another school at the database, not only in the service', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await expect(runWithTenant(B, () => SchoolDomain.create({ type: 'CUSTOM', hostname: 'www.abcschool.com' })))
      .rejects.toMatchObject({ code: 11000 });
  });

  it('lists every school on the platform table, configured or not', async () => {
    await makeLive(A, 'www.abcschool.com');
    const { schools, settings } = await asPlatform(() => domains.listDomains());
    expect(settings).toMatchObject({ platformDomain: PLATFORM, subdomainsEnabled: true, cnameTarget: TARGET });
    expect(schools.find((s) => s.tenantId === A)).toMatchObject({
      configured: true, type: 'CUSTOM', hostname: 'www.abcschool.com', verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE', active: true,
    });
    expect(schools.find((s) => s.tenantId === B)).toMatchObject({ configured: false, hostname: null, active: false });
  });
});

/* ── 5. CORS follows activation ───────────────────────────── */

describe('cross-origin access follows activation, not configuration', () => {
  const decide = (origin) => new Promise((resolve) => corsOrigin(origin, (_e, allowed) => resolve(allowed)));

  it('keeps allowing the configured frontend origin', async () => {
    expect(await decide('http://localhost:3000')).toBe(true);
    expect(await decide(undefined)).toBe(true);
  });

  it('does not allow a domain that is configured and verified but not active', async () => {
    const { domain } = await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    net.txt.set(domain.verificationRecordName, [domain.dnsInstructions.records[0].value]);
    await asPlatform(() => domains.verifyDomain(P(), A));
    expect(await decide('https://www.abcschool.com')).toBe(false);
  });

  it('allows https on an active domain, and stops the moment it is deactivated', async () => {
    await makeLive(A, 'www.abcschool.com');
    expect(await decide('https://www.abcschool.com')).toBe(true);
    expect(await decide('http://www.abcschool.com')).toBe(false);
    expect(await decide('https://www.abcschool.com:8443')).toBe(false);
    expect(await decide('https://evil-www.abcschool.com')).toBe(false);

    await asPlatform(() => domains.deactivateDomain(P(), A));
    expect(await decide('https://www.abcschool.com')).toBe(false);
  });

  it('parses a request host defensively', () => {
    expect(hostnameForLookup('WWW.AbcSchool.com:443')).toBe('www.abcschool.com');
    expect(hostnameForLookup('https://www.abcschool.com/path')).toBe('www.abcschool.com');
    expect(hostnameForLookup('evil.com\r\nX: y')).toBeNull();
    expect(hostnameForLookup('')).toBeNull();
  });
});

/* ── 6. Audit ─────────────────────────────────────────────── */

describe('every change is audited, and the token never is', () => {
  it('records configure, verify, SSL, activate and deactivate', async () => {
    await makeLive(A, 'www.abcschool.com');
    await asPlatform(() => domains.deactivateDomain(P(), A, { reason: 'Test' }));

    const logs = await AuditLog.find({ entityType: 'SchoolDomain', entityId: A }).sort({ createdAt: 1 }).lean();
    expect(logs.map((l) => l.action)).toEqual([
      'domain.configured', 'domain.verification', 'domain.ssl_checked', 'domain.activated', 'domain.deactivated',
    ]);
    expect(logs.every((l) => String(l.actorProfileId) === platform.actor.profileId)).toBe(true);
    expect(logs[0].after).toMatchObject({ hostname: 'www.abcschool.com', verificationStatus: 'PENDING', active: false });
    expect(logs[3].before.active).toBe(false);
    expect(logs[3].after.active).toBe(true);

    const token = (await asPlatform(() => SchoolDomain.findOne({ tenantId: A }).select('+verificationToken').lean())).verificationToken;
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  it('records who configured it and who last changed it', async () => {
    const { domain } = await makeLive(A, 'www.abcschool.com');
    expect(domain.configuredBy).toBe('Platform Owner');
    expect(domain.updatedBy).toBe('Platform Owner');
    expect(domain.createdAt).toBeTruthy();
    expect(domain.updatedAt).toBeTruthy();
  });

  it('audits nothing for a refused configuration', async () => {
    await expect(asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'http://x.com' }))).rejects.toThrow();
    expect(await AuditLog.countDocuments({ entityType: 'SchoolDomain' })).toBe(0);
  });
});

/* ── 7. RBAC, over real HTTP ──────────────────────────────── */

describe('who may manage domains, through the real routes', () => {
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

  it('keeps the manage key on SUPER_ADMIN alone', () => {
    expect(SUPER_ADMIN_ONLY).toContain('domains.manage');
    const holders = SYSTEM_ROLES.filter((r) => r.grants.some((g) => g.key === 'domains.manage')).map((r) => r.key);
    expect(holders).toEqual(['SUPER_ADMIN']);
    const readers = SYSTEM_ROLES.filter((r) => r.grants.some((g) => g.key === 'domains.read')).map((r) => r.key).sort();
    expect(readers).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('lets the Super Admin run the whole flow over HTTP', async () => {
    const list = await call(platform, 'GET', '/domains/schools');
    expect(list.status).toBe(200);
    expect(list.body.data.schools.map((s) => s.tenantId).sort()).toEqual([A, B]);

    const configured = await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'www.abcschool.com' });
    expect(configured.status).toBe(200);
    const txt = configured.body.data.domain.dnsInstructions.records[0];
    net.txt.set(txt.name, [txt.value]);
    net.tls.set('www.abcschool.com', goodCert);

    expect((await call(platform, 'POST', `/domains/schools/${A}/verify`)).body.data.outcome).toBe('VERIFIED');
    expect((await call(platform, 'POST', `/domains/schools/${A}/ssl-check`)).body.data.outcome).toBe('ACTIVE');
    const activated = await call(platform, 'POST', `/domains/schools/${A}/activate`);
    expect(activated.status).toBe(200);
    expect(activated.body.data.domain.active).toBe(true);

    const resolved = await call(null, 'GET', '/domains/resolve?host=www.abcschool.com');
    expect(resolved).toMatchObject({ status: 200, body: { data: { slug: A } } });
  });

  it('answers an invalid domain over HTTP with a 400 and its code', async () => {
    const res = await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'https://abc.com/login' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('DOMAIN_HAS_PROTOCOL');
  });

  it('refuses activation over HTTP for a domain that was only typed in', async () => {
    await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'www.abcschool.com' });
    const res = await call(platform, 'POST', `/domains/schools/${A}/activate`);
    expect(res.status).toBe(409);
  });

  it.each([
    ['GET', '/domains/schools'],
    ['GET', `/domains/schools/${A}`],
    ['PUT', `/domains/schools/${A}/subdomain`],
    ['PUT', `/domains/schools/${A}/custom`],
    ['POST', `/domains/schools/${A}/verify`],
    ['POST', `/domains/schools/${A}/ssl-check`],
    ['POST', `/domains/schools/${A}/activate`],
    ['POST', `/domains/schools/${A}/deactivate`],
  ])('forbids a School Admin %s %s — even on its own school', async (method, path) => {
    const res = await call(adminA, method, path, method === 'GET' ? undefined : { domain: 'www.abcschool.com' });
    expect(res.status).toBe(403);
    expect(await asPlatform(() => SchoolDomain.countDocuments())).toBe(0);
  });

  it('forbids a teacher everything, including reading its school\'s domain', async () => {
    expect((await call(teacherA, 'GET', '/domains/mine')).status).toBe(403);
    expect((await call(teacherA, 'PUT', `/domains/schools/${A}/custom`, { domain: 'x.com' })).status).toBe(403);
  });

  it('lets a School Admin read its own domain, and only its own', async () => {
    await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'www.abcschool.com' });
    await call(platform, 'PUT', `/domains/schools/${B}/custom`, { domain: 'www.brightfuture.org' });

    const a = await call(adminA, 'GET', '/domains/mine');
    expect(a.status).toBe(200);
    expect(a.body.data.domain.hostname).toBe('www.abcschool.com');

    const b = await call(adminB, 'GET', '/domains/mine');
    expect(b.body.data.domain.hostname).toBe('www.brightfuture.org');
    expect(JSON.stringify(a.body)).not.toContain('brightfuture');
  });

  it('refuses every route without a token', async () => {
    expect((await call(null, 'GET', '/domains/schools')).status).toBe(401);
    expect((await call(null, 'GET', '/domains/mine')).status).toBe(401);
  });

  it('gives the public resolver the same 404 for pending, deactivated and unknown hosts', async () => {
    await call(platform, 'PUT', `/domains/schools/${A}/custom`, { domain: 'www.abcschool.com' });
    const pending = await call(null, 'GET', '/domains/resolve?host=www.abcschool.com');
    const unknown = await call(null, 'GET', '/domains/resolve?host=nobody.example.org');
    expect(pending.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(pending.body).toEqual(unknown.body);
  });
});

/* ── 8. MCP ───────────────────────────────────────────────── */

describe('the assistant\'s view of domains', () => {
  const visible = (roleKey) =>
    mcpToolsFor({ roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) }).map((t) => t.name);

  it('exposes one read tool and no way to configure, verify or activate', () => {
    const tool = MCP_TOOLS.get_school_domain;
    expect(tool).toMatchObject({ operation: 'GET', permission: 'domains.read', minScope: 'ALL', module: 'Domains' });
    const writes = Object.entries(MCP_TOOLS).filter(([, t]) => t.module === 'Domains' && t.operation !== 'GET');
    expect(writes).toEqual([]);
  });

  it('is offered to a School Admin and to no other school role', () => {
    expect(visible('ADMIN')).toContain('get_school_domain');
    for (const roleKey of ['PRINCIPAL', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN']) {
      expect(visible(roleKey), roleKey).not.toContain('get_school_domain');
    }
  });

  it('is not offered to the platform role, which holds no assistant', () => {
    expect(mcpToolsFor(platform.actor)).toEqual([]);
  });

  it('takes no argument that could name another school', () => {
    expect(MCP_TOOLS.get_school_domain.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  it('answers with the caller\'s own school\'s address and records', async () => {
    await asPlatform(() => domains.configureCustomDomain(P(), A, { domain: 'www.abcschool.com' }));
    await asPlatform(() => domains.configureCustomDomain(P(), B, { domain: 'www.brightfuture.org' }));

    const result = await inSchool(A, () => MCP_TOOLS.get_school_domain.run({ actor: adminA.actor }, {}));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ configured: true, hostname: 'www.abcschool.com', active: false });
    expect(result.data.dnsRecords.map((r) => r.type)).toEqual(['TXT', 'CNAME']);
    expect(result.speak).toMatch(/not live yet/);
    expect(JSON.stringify(result)).not.toContain('brightfuture');
  });

  it('says plainly when nothing is configured', async () => {
    const result = await inSchool(A, () => MCP_TOOLS.get_school_domain.run({ actor: adminA.actor }, {}));
    expect(result.data.configured).toBe(false);
    expect(result.speak).toMatch(/No portal domain/);
  });

  it('is refused by the MCP server for a teacher who asks for it by name', async () => {
    const { mcp } = await import('./support/mcpSchool.js');
    const result = await mcp(A, teacherA.actor, 'get_school_domain', {});
    expect(result.success).toBe(false);
  });
});
