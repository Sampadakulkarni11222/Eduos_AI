import crypto from 'node:crypto';
import { SchoolDomain } from '../../models/schoolDomain.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { env } from '../../config/env.js';
import { currentTenantId, runAcrossSchools, runWithTenant } from '../../tenancy/tenantContext.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { probes } from './domain.checks.js';
import {
  RESERVED_SUBDOMAINS, SUBDOMAIN_MAX, SUBDOMAIN_MIN,
  normalizeCustomDomain, normalizeWebsite, parseSubdomain, slugifySubdomain, trimLabel, hostnameForLookup,
} from './domain.hostname.js';

/**
 * School domain management.
 *
 * A school is reachable at a platform subdomain or at a domain it bought, and
 * the whole of this file is about not letting either become live on say-so.
 *
 *   configure  records the hostname and sets verification PENDING. Nothing else.
 *   verify     asks real DNS. A subdomain must resolve; a custom domain must
 *              carry a TXT record holding this configuration's own token. A
 *              lookup that could not be made (timeout, SERVFAIL) is reported
 *              as inconclusive and changes no state — an outage at a resolver
 *              is not evidence about the school's DNS.
 *   check SSL  does a real TLS handshake with certificate verification. This
 *              deployment cannot issue certificates (Render issues them once
 *              the domain is added in its dashboard), so it records what is
 *              served rather than pretending to manage it.
 *   activate   only a VERIFIED domain with a working certificate, for a school
 *              that is itself ACTIVE.
 *
 * Authority: every write is `domains.manage`, which is Super-Admin-only. A
 * School Admin reads its own school's address and DNS instructions through
 * `domains.read`, confined by the tenancy plugin to its own document.
 */

export const TXT_PREFIX = 'eduos-verification=';
export const TXT_LABEL = '_eduos-verification';

/* ── Which school ─────────────────────────────────────────── */

/**
 * The school a call may act on.
 *
 * A caller already inside a school (a School Admin, or a Super Admin who sent
 * X-School-Id) may only name that school: a slug that differs is answered as
 * not found, the same answer an unknown school gets, so the response says
 * nothing about whether the other school exists.
 */
function schoolOf(slug) {
  const acting = currentTenantId();
  const named = String(slug ?? '').trim().toLowerCase();
  if (acting) {
    if (named && named !== acting) throw new AppError(`No school with id "${named}"`, 404, [], 'SCHOOL_NOT_FOUND');
    return acting;
  }
  if (!named) throw new AppError('Name the school.', 400, [], 'SCHOOL_REQUIRED');
  return named;
}

async function findSchool(slug) {
  const school = await School.findOne({ slug }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');
  return school;
}

/** The school's domain document, with its token, or null. */
const loadDomain = (tenantId) =>
  runWithTenant(tenantId, () => SchoolDomain.findOne({ tenantId }).select('+verificationToken').lean());

async function requireDomain(tenantId) {
  const doc = await loadDomain(tenantId);
  if (!doc) {
    throw new AppError('This school has no domain configured yet.', 404, [], 'DOMAIN_NOT_CONFIGURED');
  }
  return doc;
}

/** Every hostname any school holds, except the given school's own. */
async function hostnameOwner(hostname) {
  return runAcrossSchools(() => SchoolDomain.findOne({ hostname }).select('tenantId').lean());
}

/* ── Shapes ───────────────────────────────────────────────── */

/**
 * What the records a school has to create look like.
 *
 * Generated from the configuration, never stored, so it always matches the
 * token and hostname in force — including after a reconfiguration.
 */
export function dnsInstructions(doc) {
  if (!doc) return null;
  const target = env.DOMAIN_CNAME_TARGET || null;

  if (doc.type === 'SUBDOMAIN') {
    return {
      summary:
        `${doc.hostname} is under the platform domain, so the school does not need to create any DNS records. ` +
        'The platform team must make sure it resolves and is covered by a certificate.',
      records: [
        {
          purpose: 'ROUTING',
          type: 'CNAME',
          name: doc.hostname,
          value: target,
          managedBy: 'PLATFORM',
          note: `Not needed if a wildcard record *.${doc.platformDomain ?? env.PLATFORM_DOMAIN} already points at the platform.`,
        },
      ],
      steps: [
        `Confirm *.${doc.platformDomain ?? env.PLATFORM_DOMAIN} (or ${doc.hostname} itself) resolves to the platform.`,
        'Confirm the host serves a certificate valid for this name (a wildcard certificate covers every school).',
        'Verify, then Check SSL, then Activate.',
      ],
    };
  }

  const apex = doc.hostname.split('.').length === 2;
  return {
    summary:
      `The school must prove it controls ${doc.hostname} and point it at the platform. ` +
      'The domain stays inactive until both records are live and a certificate is being served.',
    records: [
      {
        purpose: 'OWNERSHIP',
        type: 'TXT',
        name: doc.verificationRecordName,
        value: doc.verificationToken ? `${TXT_PREFIX}${doc.verificationToken}` : null,
        managedBy: 'SCHOOL',
        note: 'Proves the school controls this domain. Leave it in place — it is re-checked on every verification.',
      },
      {
        purpose: 'ROUTING',
        type: apex ? 'ALIAS' : 'CNAME',
        name: doc.hostname,
        value: target,
        managedBy: 'SCHOOL',
        note: apex
          ? 'A bare domain cannot hold a CNAME. Use your DNS provider\'s ALIAS/ANAME/flattened CNAME, or use www.' + doc.hostname + ' instead.'
          : 'Sends the portal\'s traffic to the platform.',
      },
    ],
    steps: [
      'Create both records at the DNS provider for this domain. Changes can take up to 48 hours to propagate.',
      'The platform team adds the domain to the hosting service so a certificate can be issued for it.',
      'Verify, then Check SSL, then Activate.',
    ],
    ...(target ? {} : { warning: 'DOMAIN_CNAME_TARGET is not set on this deployment; ask the platform team for the routing target.' }),
  };
}

/** The configuration as the API returns it. The token rides along only inside the DNS instructions. */
function toDto(doc, school) {
  if (!doc) return null;
  return {
    tenantId: doc.tenantId,
    tenantName: school?.name ?? null,
    type: doc.type,
    subdomain: doc.subdomain ?? null,
    customDomain: doc.customDomain ?? null,
    hostname: doc.hostname,
    platformDomain: doc.platformDomain ?? null,
    verificationStatus: doc.verificationStatus,
    verificationRecordName: doc.verificationRecordName ?? null,
    lastVerificationAt: doc.lastVerificationAt ?? null,
    lastVerificationError: doc.lastVerificationError ?? null,
    verifiedAt: doc.verifiedAt ?? null,
    sslStatus: doc.sslStatus,
    sslCheckedAt: doc.sslCheckedAt ?? null,
    sslError: doc.sslError ?? null,
    sslValidTo: doc.sslValidTo ?? null,
    sslIssuer: doc.sslIssuer ?? null,
    source: doc.source ?? 'MANUAL',
    sourceProfileId: doc.sourceProfileId ? String(doc.sourceProfileId) : null,
    sourceProfileName: doc.sourceProfileName ?? null,
    sourceWebsite: doc.sourceWebsite ?? null,
    sourceFetchedAt: doc.sourceFetchedAt ?? null,
    pendingProfileDomain: doc.pendingProfileDomain
      ? {
        change: doc.pendingProfileDomain.change,
        hostname: doc.pendingProfileDomain.hostname ?? null,
        website: doc.pendingProfileDomain.website ?? null,
        profileName: doc.pendingProfileDomain.profileName ?? null,
        detectedAt: doc.pendingProfileDomain.detectedAt,
      }
      : null,
    active: Boolean(doc.active),
    activatedAt: doc.activatedAt ?? null,
    deactivatedAt: doc.deactivatedAt ?? null,
    deactivationReason: doc.deactivationReason ?? null,
    configuredBy: doc.configuredByName ?? null,
    updatedBy: doc.updatedByName ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    dnsInstructions: dnsInstructions(doc),
  };
}

/** What the audit trail keeps about a domain: its state, never its token. */
const auditState = (doc) => (doc
  ? {
    type: doc.type,
    hostname: doc.hostname,
    verificationStatus: doc.verificationStatus,
    sslStatus: doc.sslStatus,
    active: Boolean(doc.active),
    source: doc.source ?? 'MANUAL',
  }
  : null);

const actorStamp = (actor) => ({
  updatedByProfileId: actor?.profileId ?? null,
  updatedByName: actor?.displayName ?? null,
});

/* ── Platform settings ────────────────────────────────────── */

export function domainSettings() {
  return {
    platformDomain: env.PLATFORM_DOMAIN || null,
    subdomainsEnabled: Boolean(env.PLATFORM_DOMAIN),
    cnameTarget: env.DOMAIN_CNAME_TARGET || null,
    reservedSubdomains: [...RESERVED_SUBDOMAINS].sort(),
  };
}

function requirePlatformDomain() {
  if (!env.PLATFORM_DOMAIN) {
    throw new AppError(
      'Subdomains are not available: this deployment has no PLATFORM_DOMAIN configured.',
      409, [], 'PLATFORM_DOMAIN_NOT_CONFIGURED',
    );
  }
  return env.PLATFORM_DOMAIN;
}

/* ── Reads ────────────────────────────────────────────────── */

/** Every school with its domain, configured or not — the Domain Management table. */
export async function listDomains() {
  const [schools, docs] = await Promise.all([
    School.find().sort({ name: 1 }).lean(),
    runAcrossSchools(() => SchoolDomain.find().lean()),
  ]);
  const byTenant = new Map(docs.map((d) => [d.tenantId, d]));
  const profileViews = new Map(await Promise.all(
    schools.map(async (school) => [school.slug, await profileDomainView(school.slug, byTenant.get(school.slug))]),
  ));
  return {
    settings: domainSettings(),
    schools: schools.map((school) => {
      const doc = byTenant.get(school.slug);
      const profile = profileViews.get(school.slug);
      return {
        profileDomain: profile.hostname,
        profileDomainStatus: profile.status,
        profileDomainSync: profile.sync,
        source: doc?.source ?? null,
        pendingProfileChange: doc?.pendingProfileDomain?.change ?? null,
        tenantId: school.slug,
        tenantName: school.name,
        schoolStatus: school.status,
        configured: Boolean(doc),
        type: doc?.type ?? null,
        hostname: doc?.hostname ?? null,
        verificationStatus: doc?.verificationStatus ?? null,
        sslStatus: doc?.sslStatus ?? null,
        active: Boolean(doc?.active),
        updatedAt: doc?.updatedAt ?? null,
      };
    }),
  };
}

/** One school's domain configuration, or null when none has been set. */
export async function getDomain(slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const doc = await loadDomain(tenantId);
  return {
    tenantId,
    tenantName: school.name,
    domain: toDto(doc, school),
    profileDomain: await profileDomainView(tenantId, doc),
  };
}

/**
 * The subdomain a school would be given, without claiming it.
 *
 * Starts from the school's name and walks "-2", "-3"… past anything reserved
 * or already held by another school. The same walk runs again at save time,
 * so two schools previewing the same name concurrently cannot both be handed
 * one label: the unique index on hostname decides, and the loser is told.
 */
export async function suggestSubdomain(slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const platformDomain = requirePlatformDomain();
  const subdomain = await availableSubdomain(school, platformDomain, tenantId);
  return { tenantId, subdomain, hostname: `${subdomain}.${platformDomain}` };
}

async function availableSubdomain(school, platformDomain, tenantId) {
  let base = slugifySubdomain(school.name);
  if (!base) base = slugifySubdomain(school.slug);
  if (!base) {
    throw new AppError(
      'A subdomain cannot be generated from this school\'s name. Enter one instead.',
      400, [], 'SUBDOMAIN_NOT_GENERATED',
    );
  }
  if (base.length < SUBDOMAIN_MIN) base = `${base}-school`;

  for (let n = 1; n <= 500; n += 1) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${trimLabel(base, SUBDOMAIN_MAX - suffix.length)}${suffix}`;
    if (RESERVED_SUBDOMAINS.has(candidate) || candidate.startsWith('xn--')) continue;
    const owner = await hostnameOwner(`${candidate}.${platformDomain}`);
    if (!owner || owner.tenantId === tenantId) return candidate;
  }
  throw new AppError('No free subdomain could be found for this school. Enter one instead.', 409, [], 'SUBDOMAIN_EXHAUSTED');
}

/* ── Configuration ────────────────────────────────────────── */

/**
 * Writes a new address for a school, resetting everything that was true of
 * the old one.
 *
 * Re-submitting the address a school already has is a no-op, so pressing
 * "configure" twice does not throw away a verification. Any other address
 * starts again from PENDING, inactive, with a fresh token.
 */
async function writeConfiguration(actor, tenantId, school, next) {
  const before = await loadDomain(tenantId);
  if (before && before.type === next.type && before.hostname === next.hostname) {
    return { changed: false, domain: toDto(before, school) };
  }

  const owner = await hostnameOwner(next.hostname);
  if (owner && owner.tenantId !== tenantId) {
    throw new AppError(`${next.hostname} is already assigned to another school.`, 409, [], 'DOMAIN_TAKEN');
  }

  const now = new Date();
  const replacement = {
    tenantId,
    type: next.type,
    subdomain: next.subdomain ?? null,
    customDomain: next.customDomain ?? null,
    hostname: next.hostname,
    platformDomain: next.platformDomain ?? null,
    verificationStatus: 'PENDING',
    verificationToken: next.verificationToken ?? null,
    verificationRecordName: next.verificationRecordName ?? null,
    lastVerificationAt: null,
    lastVerificationError: null,
    verifiedAt: null,
    sslStatus: 'NOT_CHECKED',
    sslCheckedAt: null,
    sslError: null,
    sslValidTo: null,
    sslIssuer: null,
    active: false,
    activatedAt: null,
    deactivatedAt: before?.active ? now : before?.deactivatedAt ?? null,
    deactivationReason: before?.active ? 'RECONFIGURED' : null,
    configuredByProfileId: actor?.profileId ?? null,
    configuredByName: actor?.displayName ?? null,
    ...sourceFields(next.source),
    // A new configuration answers whatever profile change was waiting.
    pendingProfileDomain: null,
    ...actorStamp(actor),
  };

  try {
    await runWithTenant(tenantId, () =>
      SchoolDomain.findOneAndReplace({ tenantId }, replacement, { upsert: true, runValidators: true }),
    );
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError(`${next.hostname} is already assigned to another school.`, 409, [], 'DOMAIN_TAKEN');
    }
    throw err;
  }
  invalidateActiveHostCache();

  const after = await loadDomain(tenantId);
  await recordAudit({
    actor,
    action: 'domain.configured',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: before ? { tenantId, ...auditState(before) } : { tenantId, configured: false },
    after: { tenantId, ...auditState(after), sourceWebsite: after.sourceWebsite ?? null },
  });
  logger.info(`Domain for ${tenantId} set to ${next.type} ${next.hostname} by ${actor?.displayName ?? 'system'}`);
  return { changed: true, domain: toDto(after, school) };
}

/**
 * Gives a school a platform subdomain.
 *
 * With no `subdomain` the label is generated from the school's name; with one,
 * it is validated and must be free — an explicit choice is never quietly
 * suffixed into something the operator did not type.
 */
export async function configureSubdomain(actor, slug, { subdomain } = {}) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const platformDomain = requirePlatformDomain();

  let label;
  if (subdomain === undefined || subdomain === null || String(subdomain).trim() === '') {
    label = await availableSubdomain(school, platformDomain, tenantId);
  } else {
    label = parseSubdomain(subdomain);
  }

  const hostname = `${label}.${platformDomain}`;
  if (hostname.length > 253) throw new AppError('That subdomain makes the address too long.', 400, [], 'INVALID_SUBDOMAIN');

  return writeConfiguration(actor, tenantId, school, {
    type: 'SUBDOMAIN', subdomain: label, hostname, platformDomain, source: { kind: 'MANUAL' },
  });
}

/** Gives a school its own purchased domain, pending proof that it controls it. */
export async function configureCustomDomain(actor, slug, { domain } = {}) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const hostname = normalizeCustomDomain(domain, { platformDomain: env.PLATFORM_DOMAIN });

  return writeConfiguration(actor, tenantId, school, {
    type: 'CUSTOM',
    customDomain: hostname,
    hostname,
    verificationToken: crypto.randomBytes(20).toString('hex'),
    verificationRecordName: `${TXT_LABEL}.${hostname}`,
    source: { kind: 'MANUAL' },
  });
}

/* ── The School Admin profile as a source ─────────────────── */
//
// School Admin profile (Profile.website)
//   → fetchProfileDomain: validated and normalised, never guessed
//   → School Domain Configuration (source PROFILE, PENDING, inactive)
//   → Super Admin review: verify, check SSL
//   → activation
//
// The profile is a SOURCE, not an authority. Nothing on it can make a domain
// live, and a change to it never tears down a configuration that is active or
// that a Super Admin chose by hand: those get a pending change to review.

/** The source fields a configuration is written with. */
function sourceFields(source) {
  if (source?.kind === 'PROFILE') {
    return {
      source: 'PROFILE',
      sourceProfileId: source.profileId ?? null,
      sourceProfileName: source.profileName ?? null,
      sourceWebsite: source.website ?? null,
      sourceFetchedAt: new Date(),
    };
  }
  return { source: 'MANUAL', sourceProfileId: null, sourceProfileName: null, sourceWebsite: null, sourceFetchedAt: null };
}

/**
 * The domain the school's School Admin profiles name.
 *
 * Reads the ACTIVE School Admin profiles of this one school — Profile is not
 * tenant-scoped, so the tenantId filter here is what keeps School B's profiles
 * out of School A's answer. Outcomes:
 *
 *   FOUND         one valid domain (several admins agreeing count as one); the
 *                 most recently updated profile is recorded as the source
 *   NOT_PROVIDED  no admin profile has a website
 *   INVALID       websites are present but none can be normalised
 *   CONFLICT      admins name different domains; none is picked
 */
export async function fetchProfileDomain(tenantId) {
  const adminRole = await Role.findOne({ key: 'ADMIN' }).select('_id').lean();
  if (!adminRole) return { status: 'NOT_PROVIDED', hostname: null };

  const profiles = await Profile.find({
    tenantId, roleId: adminRole._id, deletedAt: null, status: 'ACTIVE', website: { $nin: [null, ''] },
  }).sort({ updatedAt: -1 }).select('displayName website updatedAt').lean();

  const valid = [];
  let firstInvalid = null;
  for (const p of profiles) {
    try {
      const hostname = normalizeWebsite(p.website, { platformDomain: env.PLATFORM_DOMAIN });
      if (hostname) valid.push({ hostname, website: p.website, profileId: String(p._id), profileName: p.displayName });
    } catch (err) {
      firstInvalid ??= { website: p.website, profileId: String(p._id), profileName: p.displayName, error: err.message };
    }
  }

  const distinct = [...new Set(valid.map((v) => v.hostname))];
  if (distinct.length > 1) {
    return {
      status: 'CONFLICT',
      hostname: null,
      candidates: distinct.map((hostname) => {
        const from = valid.find((v) => v.hostname === hostname);
        return { hostname, profileName: from.profileName };
      }),
    };
  }
  if (distinct.length === 1) return { status: 'FOUND', ...valid[0] };
  if (firstInvalid) return { status: 'INVALID', hostname: null, ...firstInvalid };
  return { status: 'NOT_PROVIDED', hostname: null };
}

/**
 * The profile's domain compared with the school's configuration.
 *
 * `sync` is what the screens show:
 *   NOT_PROVIDED | INVALID | CONFLICT   the profile gives nothing usable
 *   DUPLICATE        the profile's domain is configured for another school
 *   NOT_CONFIGURED   usable, and the school has no configuration yet
 *   IN_SYNC          the configuration already is this domain
 *   CHANGED          the configuration is something else
 */
async function profileDomainView(tenantId, doc) {
  const fetched = await fetchProfileDomain(tenantId);
  let sync = fetched.status;
  let takenByAnotherSchool = false;
  if (fetched.status === 'FOUND') {
    const owner = await hostnameOwner(fetched.hostname);
    takenByAnotherSchool = Boolean(owner && owner.tenantId !== tenantId);
    if (takenByAnotherSchool) sync = 'DUPLICATE';
    else if (!doc) sync = 'NOT_CONFIGURED';
    else sync = doc.hostname === fetched.hostname ? 'IN_SYNC' : 'CHANGED';
  }
  // The other school is never named: a School Admin reads this view too.
  return { ...fetched, takenByAnotherSchool, sync };
}

const profileSource = (view) => ({
  kind: 'PROFILE', profileId: view.profileId, profileName: view.profileName, website: view.website,
});

const customFromProfile = (view) => ({
  type: 'CUSTOM',
  customDomain: view.hostname,
  hostname: view.hostname,
  verificationToken: crypto.randomBytes(20).toString('hex'),
  verificationRecordName: `${TXT_LABEL}.${view.hostname}`,
  source: profileSource(view),
});

async function setPending(actor, tenantId, doc, view, change) {
  const pending = {
    change,
    hostname: view.hostname ?? null,
    website: view.website ?? null,
    profileId: view.profileId ?? null,
    profileName: view.profileName ?? null,
    detectedAt: new Date(),
  };
  await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, { $set: { pendingProfileDomain: pending } }));
  await recordAudit({
    actor,
    action: 'domain.profile_change_pending',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, ...auditState(doc) },
    after: { tenantId, ...auditState(doc), pendingChange: change, profileHostname: pending.hostname, profileWebsite: pending.website },
  });
}

async function clearPending(tenantId, doc) {
  if (!doc?.pendingProfileDomain) return;
  await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, { $set: { pendingProfileDomain: null } }));
}

/**
 * Reacts to a School Admin profile's website having changed.
 *
 * Called by the School Admin write paths after they save. What it may do on
 * its own is deliberately narrow:
 *
 *   no configuration yet, usable domain    create one: CUSTOM, PENDING, inactive
 *   configuration came from the profile,   replace it with the new domain —
 *   is inactive, domain changed             still PENDING, still inactive
 *   already this domain                     refresh the source, clear any pending
 *   anything else                           record a pending change for review:
 *                                           an ACTIVE domain, a Super Admin's
 *                                           manual choice, a removed, invalid,
 *                                           conflicting or duplicate website
 *
 * It never activates, never deactivates, and never deletes a configuration.
 */
export async function detectProfileDomainChange(actor, slug, { previousWebsite = null } = {}) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const doc = await loadDomain(tenantId);
  const view = await profileDomainView(tenantId, doc);

  await recordAudit({
    actor,
    action: 'domain.profile_website_changed',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, website: previousWebsite },
    after: { tenantId, website: view.website ?? null, hostname: view.hostname ?? null, status: view.status, sync: view.sync },
  });

  if (!doc) {
    if (view.sync !== 'NOT_CONFIGURED') return { action: 'NONE', profileDomain: view, domain: null };
    const created = await writeConfiguration(actor, tenantId, school, customFromProfile(view));
    return { action: 'CREATED', profileDomain: view, domain: created.domain };
  }

  if (view.sync === 'IN_SYNC') {
    if (doc.source === 'PROFILE' || doc.pendingProfileDomain) {
      await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, {
        $set: { ...sourceFields(profileSource(view)), pendingProfileDomain: null },
      }));
    }
    return { action: 'IN_SYNC', profileDomain: view, domain: toDto(await loadDomain(tenantId), school) };
  }

  // A manual configuration is not the profile's to question when the profile
  // offers nothing usable.
  if (doc.source !== 'PROFILE' && view.status !== 'FOUND') {
    await clearPending(tenantId, doc);
    return { action: 'NONE', profileDomain: view, domain: toDto(await loadDomain(tenantId), school) };
  }

  if (view.sync === 'CHANGED' && doc.source === 'PROFILE' && !doc.active) {
    const replaced = await writeConfiguration(actor, tenantId, school, customFromProfile(view));
    return { action: 'REPLACED', profileDomain: view, domain: replaced.domain };
  }

  const change = { CHANGED: 'CHANGED', DUPLICATE: 'DUPLICATE', NOT_PROVIDED: 'REMOVED', INVALID: 'INVALID', CONFLICT: 'CONFLICT' }[view.sync];
  await setPending(actor, tenantId, doc, view, change);
  return { action: 'PENDING_REVIEW', profileDomain: view, domain: toDto(await loadDomain(tenantId), school) };
}

/**
 * A Super Admin applying the profile's domain to the school's configuration.
 *
 * The review step. Replacing an ACTIVE domain takes it offline, so that needs
 * `confirmReplace: true`; without it the call is refused and the active
 * configuration is left exactly as it was.
 */
export async function importProfileDomain(actor, slug, { confirmReplace = false } = {}) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const doc = await loadDomain(tenantId);
  const view = await profileDomainView(tenantId, doc);

  const refusals = {
    NOT_PROVIDED: ['No School Admin profile for this school has a website. Not Provided.', 'PROFILE_DOMAIN_NOT_PROVIDED'],
    INVALID: [`The website on ${view.profileName ?? 'the School Admin profile'} is not a usable domain: ${view.error ?? ''}`.trim(), 'PROFILE_DOMAIN_INVALID'],
    CONFLICT: ['School Admin profiles name different domains. Correct the profiles, or configure the domain manually.', 'PROFILE_DOMAIN_CONFLICT'],
    DUPLICATE: [`${view.hostname} is already assigned to another school.`, 'DOMAIN_TAKEN'],
  };
  if (refusals[view.sync]) {
    const [message, code] = refusals[view.sync];
    throw new AppError(message, view.sync === 'NOT_PROVIDED' || view.sync === 'INVALID' ? 422 : 409, [], code);
  }

  if (view.sync === 'IN_SYNC') {
    await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, {
      $set: { ...sourceFields(profileSource(view)), pendingProfileDomain: null, ...actorStamp(actor) },
    }));
    const after = await loadDomain(tenantId);
    await recordAudit({
      actor, action: 'domain.profile_imported', entityType: 'SchoolDomain', entityId: tenantId,
      before: { tenantId, ...auditState(doc) }, after: { tenantId, ...auditState(after), sourceWebsite: view.website },
    });
    return { changed: false, domain: toDto(after, school), profileDomain: view };
  }

  if (doc?.active && confirmReplace !== true) {
    if (doc.pendingProfileDomain?.hostname !== view.hostname) await setPending(actor, tenantId, doc, view, 'CHANGED');
    throw new AppError(
      `${doc.hostname} is live. Replacing it with ${view.hostname} takes it offline until the new domain is verified and activated — confirm the replacement to continue.`,
      409, [], 'ACTIVE_DOMAIN_REPLACE_UNCONFIRMED',
    );
  }

  const result = await writeConfiguration(actor, tenantId, school, customFromProfile(view));
  await recordAudit({
    actor, action: 'domain.profile_imported', entityType: 'SchoolDomain', entityId: tenantId,
    before: doc ? { tenantId, ...auditState(doc) } : { tenantId, configured: false },
    after: { tenantId, ...auditState(await loadDomain(tenantId)), sourceWebsite: view.website, replacedActive: Boolean(doc?.active) },
  });
  return { changed: true, domain: result.domain, profileDomain: view };
}

/** A Super Admin deciding a pending profile change does not apply. The configuration stays as it is. */
export async function dismissProfileDomainChange(actor, slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const doc = await requireDomain(tenantId);
  if (!doc.pendingProfileDomain) return { changed: false, domain: toDto(doc, school) };

  await clearPending(tenantId, doc);
  const after = await loadDomain(tenantId);
  await recordAudit({
    actor, action: 'domain.profile_change_dismissed', entityType: 'SchoolDomain', entityId: tenantId,
    before: { tenantId, ...auditState(doc), pendingChange: doc.pendingProfileDomain.change, profileHostname: doc.pendingProfileDomain.hostname },
    after: { tenantId, ...auditState(after) },
  });
  return { changed: true, domain: toDto(after, school) };
}

/* ── Verification ─────────────────────────────────────────── */

/**
 * Checks the school's DNS, for real, and moves the state machine.
 *
 * Outcomes:
 *   VERIFIED      the records are there.
 *   FAILED        the resolver answered, and the records are not there. An
 *                 ACTIVE domain that fails is deactivated: the school no longer
 *                 demonstrably controls it.
 *   INCONCLUSIVE  the resolver could not be asked. Nothing changes except the
 *                 note of when it was tried and why it did not work.
 */
export async function verifyDomain(actor, slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const before = await requireDomain(tenantId);
  const dns = probes().dns;

  const now = new Date();
  let outcome;
  let error = null;
  let routing = null;

  if (before.type === 'CUSTOM') {
    const txt = await dns.txt(before.verificationRecordName);
    const expected = `${TXT_PREFIX}${before.verificationToken}`;
    if (txt.error) {
      outcome = 'INCONCLUSIVE';
      error = `The DNS lookup for ${before.verificationRecordName} could not be completed (${txt.error}).`;
    } else if (txt.found.some((value) => value.trim() === expected)) {
      outcome = 'VERIFIED';
    } else {
      outcome = 'FAILED';
      error = txt.found.length
        ? `A TXT record exists at ${before.verificationRecordName}, but none of its values is the expected verification value.`
        : `No TXT record was found at ${before.verificationRecordName}.`;
    }
    routing = await routingCheck(before.hostname);
  } else {
    const [address, cname] = await Promise.all([dns.address(before.hostname), dns.cname(before.hostname)]);
    const found = [...(address.found ?? []), ...(cname.found ?? [])];
    if (found.length) {
      outcome = 'VERIFIED';
    } else if (address.error && cname.error) {
      outcome = 'INCONCLUSIVE';
      error = `The DNS lookup for ${before.hostname} could not be completed (${address.error}).`;
    } else {
      outcome = 'FAILED';
      error = `${before.hostname} does not resolve. The platform's DNS needs a record (or a wildcard) for it.`;
    }
  }

  const update = { lastVerificationAt: now, lastVerificationError: error, ...actorStamp(actor) };
  if (outcome === 'VERIFIED') {
    update.verificationStatus = 'VERIFIED';
    update.verifiedAt = before.verificationStatus === 'VERIFIED' ? before.verifiedAt : now;
  } else if (outcome === 'FAILED') {
    update.verificationStatus = 'FAILED';
    update.verifiedAt = null;
    if (before.active) {
      Object.assign(update, { active: false, deactivatedAt: now, deactivationReason: 'VERIFICATION_FAILED' });
    }
  }

  await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, { $set: update }));
  if (update.active === false) invalidateActiveHostCache();
  const after = await loadDomain(tenantId);

  await recordAudit({
    actor,
    action: 'domain.verification',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, ...auditState(before) },
    after: { tenantId, ...auditState(after), outcome, error },
  });

  return { outcome, error, routing, domain: toDto(after, school) };
}

/**
 * Whether the hostname already points where the platform expects.
 *
 * Reported, not enforced: ownership is what verification proves, and a school
 * part-way through moving its DNS should be told what is missing rather than
 * refused. Activation still waits for a working certificate, which cannot be
 * served for a name whose traffic does not reach the host.
 */
async function routingCheck(hostname) {
  const target = env.DOMAIN_CNAME_TARGET;
  const cname = await probes().dns.cname(hostname);
  if (cname.error) return { expected: target || null, found: [], pointsAtPlatform: null, error: cname.error };
  const found = cname.found.map((v) => v.toLowerCase().replace(/\.$/, ''));
  return {
    expected: target || null,
    found,
    pointsAtPlatform: target ? found.includes(target) : null,
  };
}

/**
 * Checks the certificate the host serves for this hostname, for real.
 *
 * Only for a VERIFIED domain: a handshake against a name the school has not
 * proved it controls tells us about somebody else's server.
 */
export async function checkSsl(actor, slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const before = await requireDomain(tenantId);
  if (before.verificationStatus !== 'VERIFIED') {
    throw new AppError('Verify the domain before checking its certificate.', 409, [], 'DOMAIN_NOT_VERIFIED');
  }

  const result = await probes().tls(before.hostname);
  const now = new Date();
  const inconclusive = !result.ok && result.error === 'TLS_TIMEOUT';
  const update = { sslCheckedAt: now, ...actorStamp(actor) };
  if (result.ok) {
    Object.assign(update, {
      sslStatus: 'ACTIVE', sslError: null, sslValidTo: result.validTo ?? null, sslIssuer: result.issuer ?? null,
    });
  } else if (inconclusive) {
    update.sslError = `The TLS handshake with ${before.hostname} timed out.`;
  } else {
    Object.assign(update, {
      sslStatus: 'FAILED', sslError: `No valid certificate for ${before.hostname}: ${result.error}.`, sslValidTo: null, sslIssuer: null,
    });
  }

  await runWithTenant(tenantId, () => SchoolDomain.updateOne({ tenantId }, { $set: update }));
  const after = await loadDomain(tenantId);

  await recordAudit({
    actor,
    action: 'domain.ssl_checked',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, ...auditState(before) },
    after: { tenantId, ...auditState(after), error: update.sslError ?? null },
  });

  return {
    outcome: result.ok ? 'ACTIVE' : inconclusive ? 'INCONCLUSIVE' : 'FAILED',
    error: update.sslError ?? null,
    domain: toDto(after, school),
  };
}

/* ── Activation ───────────────────────────────────────────── */

export async function activateDomain(actor, slug) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const before = await requireDomain(tenantId);

  if (before.active) return { changed: false, domain: toDto(before, school) };
  if (school.status !== 'ACTIVE') {
    throw new AppError('A suspended school\'s domain cannot be activated.', 409, [], 'SCHOOL_SUSPENDED');
  }
  if (before.verificationStatus !== 'VERIFIED') {
    throw new AppError('Only a verified domain can be activated. Verify it first.', 409, [], 'DOMAIN_NOT_VERIFIED');
  }
  if (before.sslStatus !== 'ACTIVE') {
    throw new AppError('The domain has no working certificate yet. Check SSL before activating.', 409, [], 'SSL_NOT_ACTIVE');
  }

  const now = new Date();
  await runWithTenant(tenantId, () => SchoolDomain.updateOne(
    { tenantId },
    { $set: { active: true, activatedAt: now, deactivationReason: null, ...actorStamp(actor) } },
  ));
  invalidateActiveHostCache();
  const after = await loadDomain(tenantId);

  await recordAudit({
    actor,
    action: 'domain.activated',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, ...auditState(before) },
    after: { tenantId, ...auditState(after) },
  });
  logger.info(`Domain ${after.hostname} activated for ${tenantId}`);
  return { changed: true, domain: toDto(after, school) };
}

export async function deactivateDomain(actor, slug, { reason } = {}) {
  const tenantId = schoolOf(slug);
  const school = await findSchool(tenantId);
  const before = await requireDomain(tenantId);
  if (!before.active) return { changed: false, domain: toDto(before, school) };

  const note = reason === undefined || reason === null ? null : String(reason).trim().slice(0, 200) || null;
  const now = new Date();
  await runWithTenant(tenantId, () => SchoolDomain.updateOne(
    { tenantId },
    { $set: { active: false, deactivatedAt: now, deactivationReason: note ?? 'MANUAL', ...actorStamp(actor) } },
  ));
  invalidateActiveHostCache();
  const after = await loadDomain(tenantId);

  await recordAudit({
    actor,
    action: 'domain.deactivated',
    entityType: 'SchoolDomain',
    entityId: tenantId,
    before: { tenantId, ...auditState(before) },
    after: { tenantId, ...auditState(after), reason: after.deactivationReason },
  });
  logger.info(`Domain ${after.hostname} deactivated for ${tenantId}`);
  return { changed: true, domain: toDto(after, school) };
}

/* ── Serving ──────────────────────────────────────────────── */

/**
 * Which school an incoming hostname belongs to — or null.
 *
 * Only an ACTIVE domain of an ACTIVE school answers. A configured, pending,
 * failed or deactivated hostname is indistinguishable from one that was never
 * entered, so the public resolver cannot be used to discover which addresses
 * are part-way through being set up.
 */
export async function resolveHostname(host) {
  const hostname = hostnameForLookup(host);
  if (!hostname) return null;
  const doc = await runAcrossSchools(() => SchoolDomain.findOne({ hostname, active: true }).lean());
  if (!doc) return null;
  const school = await School.findOne({ slug: doc.tenantId }).lean();
  if (!school || school.status !== 'ACTIVE') return null;
  return { slug: school.slug, hostname: doc.hostname };
}

/*
 * Active hostnames, cached briefly for the CORS check — which runs on every
 * cross-origin request and must not cost a query each time. Every write here
 * clears it, so a deactivation takes effect on this instance immediately and on
 * others within the TTL.
 */
const ACTIVE_HOST_TTL_MS = 60_000;
let activeHostCache = { at: 0, hosts: new Set() };

export function invalidateActiveHostCache() {
  activeHostCache = { at: 0, hosts: new Set() };
}

async function activeHostnames() {
  if (Date.now() - activeHostCache.at < ACTIVE_HOST_TTL_MS) return activeHostCache.hosts;
  const docs = await runAcrossSchools(() => SchoolDomain.find({ active: true }).select('hostname tenantId').lean());
  const suspended = new Set(
    (await School.find({ status: { $ne: 'ACTIVE' } }).select('slug').lean()).map((s) => s.slug),
  );
  const hosts = new Set(docs.filter((d) => !suspended.has(d.tenantId)).map((d) => d.hostname));
  activeHostCache = { at: Date.now(), hosts };
  return hosts;
}

/** True when `origin` is https on a school's active domain. For the CORS allow-list. */
export async function isActiveSchoolOrigin(origin) {
  let url;
  try {
    url = new URL(String(origin ?? ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port) return false;
  return (await activeHostnames()).has(url.hostname.toLowerCase());
}
