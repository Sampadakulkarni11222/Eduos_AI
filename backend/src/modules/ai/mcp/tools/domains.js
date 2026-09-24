import * as domains from '../../../domains/domain.service.js';
import { ok } from '../protocol.js';
import { RISK, noArgs } from './_shared.js';

/**
 * Where this school's portal is served, and what its DNS still needs.
 *
 * One read tool, for a School Admin asking "what is our portal address?" or
 * "why isn't our domain live yet?" — both answered from the same configuration
 * and DNS instructions the Domain Management page shows.
 *
 * No write tools, for the reason the seat and customization tools give:
 * configuring, verifying and activating an address is `domains.manage`, a
 * Super-Admin-only key, and SUPER_ADMIN is the role deliberately withheld
 * `ai.copilot.use`. A write tool would have to be exposed to a school-level
 * role, handing a School Admin an assistant that can move its own school's
 * sign-in page — the authority this feature keeps with the platform.
 *
 * The domain on the School Admin profile rides along, so "what website do we
 * have on file, and has it been applied?" is answered here too. Still no write
 * tool for it: the website is written through the Super Admin's School Admin
 * routes (`schools.manage`) and applied through Domain Management
 * (`domains.manage`) — both Super-Admin-only, and that role has no assistant.
 *
 * No argument names a school: the service reads the caller's own, confined by
 * the tenancy plugin, so the assistant cannot be steered into another school's
 * address or verification token.
 */

const STATE_WORDS = {
  PENDING: 'waiting for verification',
  VERIFIED: 'verified',
  FAILED: 'failing verification',
};

export const domainTools = {
  get_school_domain: {
    module: 'Domains',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "This school's portal address — a platform subdomain or its own custom domain — whether it is verified, whether its certificate works, whether it is live, the DNS records still required, and the domain from the website on the School Admin profile (\"Not Provided\" when there is none) with whether it has been applied. Read-only, and always about the caller's own school.",
    inputSchema: noArgs,
    permission: 'domains.read',
    minScope: 'ALL',
    service: 'domain.service.getDomain()',
    resultShape: 'SUMMARY',
    async run() {
      const { tenantName, domain, profileDomain } = await domains.getDomain();
      // "Not Provided" when no School Admin profile carries a website — the
      // assistant reports what is on file and never suggests a domain.
      const profile = {
        status: profileDomain.status,
        hostname: profileDomain.hostname ?? null,
        display: profileDomain.hostname ?? 'Not Provided',
        sync: profileDomain.sync,
      };
      const profileLine = profileDomain.status === 'FOUND'
        ? ` The website on the School Admin profile gives ${profileDomain.hostname}${profileDomain.sync === 'IN_SYNC' ? ', which is the configured domain' : profileDomain.sync === 'DUPLICATE' ? ', which is already assigned elsewhere' : ', which has not been applied yet'}.`
        : ` Website on the School Admin profile: ${profileDomain.status === 'NOT_PROVIDED' ? 'Not Provided' : profileDomain.status === 'CONFLICT' ? 'School Admin profiles disagree' : 'not a usable domain'}.`;

      if (!domain) {
        return ok({ tenantName, configured: false, profileDomain: profile }, {
          speak: `No portal domain has been configured for this school yet. The platform team sets it up.${profileLine}`,
        });
      }

      const data = {
        tenantName,
        configured: true,
        type: domain.type,
        hostname: domain.hostname,
        verificationStatus: domain.verificationStatus,
        sslStatus: domain.sslStatus,
        active: domain.active,
        lastVerificationError: domain.lastVerificationError,
        source: domain.source,
        pendingProfileChange: domain.pendingProfileDomain?.change ?? null,
        profileDomain: profile,
        dnsRecords: (domain.dnsInstructions?.records ?? []).map((r) => ({
          type: r.type, name: r.name, value: r.value, managedBy: r.managedBy,
        })),
      };

      const kind = domain.type === 'CUSTOM' ? 'custom domain' : 'platform subdomain';
      const live = domain.active
        ? 'It is live.'
        : `It is not live yet: it is ${STATE_WORDS[domain.verificationStatus] ?? domain.verificationStatus.toLowerCase()}` +
          `${domain.sslStatus === 'ACTIVE' ? '' : ' and its certificate has not been confirmed'}.`;
      return ok(data, { speak: `This school's ${kind} is ${domain.hostname}. ${live}${profileLine}` });
    },
  },
};
