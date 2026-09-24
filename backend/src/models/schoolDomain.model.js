import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * The address a school's portal is reached at.
 *
 * One document per school, of one of two kinds:
 *
 *   SUBDOMAIN  a label under the platform's own domain —
 *              abc-public-school.<PLATFORM_DOMAIN>. The platform owns the
 *              parent, so verification only has to show the name resolves.
 *   CUSTOM     a domain the school bought — www.abcschool.com. The platform
 *              owns nothing here, so verification has to show the school
 *              controls the DNS: a TXT record carrying a token only this
 *              document knows.
 *
 * Three states are kept apart on purpose, because each is established by a
 * different act and none implies another:
 *
 *   verificationStatus  PENDING → VERIFIED | FAILED, set only by a real DNS
 *                       lookup (domain.checks.js). Typing a hostname sets
 *                       PENDING and nothing else.
 *   sslStatus           NOT_CHECKED → ACTIVE | FAILED, set only by a real TLS
 *                       handshake. This deployment cannot issue certificates,
 *                       so it records what the host serves rather than
 *                       claiming to manage it.
 *   active              whether the portal answers on this hostname. Only a
 *                       Super Admin sets it, and only once the domain is
 *                       VERIFIED with a working certificate.
 *
 * School-owned (`tenantScoped`) so a school-level read sees only its own
 * address. `hostname` is unique across every school: two schools cannot hold
 * the same address, whatever state either is in.
 */

export const DOMAIN_TYPES = Object.freeze(['SUBDOMAIN', 'CUSTOM']);
export const VERIFICATION_STATUSES = Object.freeze(['PENDING', 'VERIFIED', 'FAILED']);
export const SSL_STATUSES = Object.freeze(['NOT_CHECKED', 'ACTIVE', 'FAILED']);
export const DOMAIN_SOURCES = Object.freeze(['MANUAL', 'PROFILE']);

const schoolDomainSchema = new Schema(
  {
    type: { type: String, enum: DOMAIN_TYPES, required: true },
    // SUBDOMAIN only: the label, e.g. "abc-public-school".
    subdomain: { type: String, default: null, trim: true, lowercase: true },
    // CUSTOM only: the domain as normalised, e.g. "www.abcschool.com".
    customDomain: { type: String, default: null, trim: true, lowercase: true },
    // The full hostname either kind resolves to. What lookups, CORS and routing use.
    hostname: { type: String, required: true, trim: true, lowercase: true },
    // The platform domain a subdomain was issued under, kept so changing
    // PLATFORM_DOMAIN later does not silently re-point existing schools.
    platformDomain: { type: String, default: null },

    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING' },
    // CUSTOM only. Random, per configuration; a new hostname gets a new token,
    // so a TXT record left over from a previous owner verifies nothing.
    verificationToken: { type: String, default: null, select: false },
    verificationRecordName: { type: String, default: null },
    lastVerificationAt: { type: Date, default: null },
    lastVerificationError: { type: String, default: null },
    verifiedAt: { type: Date, default: null },

    sslStatus: { type: String, enum: SSL_STATUSES, default: 'NOT_CHECKED' },
    sslCheckedAt: { type: Date, default: null },
    sslError: { type: String, default: null },
    sslValidTo: { type: Date, default: null },
    sslIssuer: { type: String, default: null },

    // Where the hostname came from. MANUAL: typed by a Super Admin. PROFILE:
    // imported from the website on the school's School Admin profile, with
    // that profile and the value as entered kept alongside.
    source: { type: String, enum: DOMAIN_SOURCES, default: 'MANUAL' },
    sourceProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    sourceProfileName: { type: String, default: null },
    sourceWebsite: { type: String, default: null },
    sourceFetchedAt: { type: Date, default: null },

    // A change on the School Admin profile that has NOT been applied, because
    // applying it would replace a configuration someone has to review first —
    // an active domain above all. Cleared when a Super Admin imports or
    // dismisses it. The configuration above is untouched while this is set.
    pendingProfileDomain: {
      type: new Schema(
        {
          // CHANGED: the profile names a different valid domain.
          // REMOVED: the profile no longer names one.
          // INVALID: the profile's website cannot be normalised.
          // CONFLICT: two School Admin profiles name different domains.
          // DUPLICATE: the profile's domain is held by another school.
          change: { type: String, enum: ['CHANGED', 'REMOVED', 'INVALID', 'CONFLICT', 'DUPLICATE'], required: true },
          hostname: { type: String, default: null },
          website: { type: String, default: null },
          profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
          profileName: { type: String, default: null },
          detectedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },

    active: { type: Boolean, default: false },
    activatedAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
    deactivationReason: { type: String, default: null },

    configuredByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    configuredByName: { type: String, default: null },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true }
);

schoolDomainSchema.index({ tenantId: 1 }, { unique: true });
schoolDomainSchema.index({ hostname: 1 }, { unique: true });
schoolDomainSchema.index({ subdomain: 1, platformDomain: 1 }, { unique: true, partialFilterExpression: { type: 'SUBDOMAIN' } });

schoolDomainSchema.plugin(tenantScoped); // school-owned
export const SchoolDomain = model('SchoolDomain', schoolDomainSchema);
