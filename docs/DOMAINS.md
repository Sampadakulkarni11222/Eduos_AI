# School domains

Each school can be reached at **one** of:

| Option | Example | Who owns the DNS |
| --- | --- | --- |
| Platform subdomain | `abc-public-school.<PLATFORM_DOMAIN>` | The platform |
| Custom domain | `www.abcschool.com` | The school |

Managed from **Super Admin → Domain Management** (`/super-admin/domains`). A School Admin can see its own school's address and the DNS records still needed under **Admin → Tenant Settings**, but can't change them.

## What this deployment can and cannot do

EduOS runs as two Render web services with no reverse proxy, no DNS-provider API and no ACME client. So the platform **observes** DNS and certificates. It does not create them.

| Step | Automated? | How |
| --- | --- | --- |
| Validate and normalise the hostname | Yes | `backend/src/modules/domains/domain.hostname.js` |
| Generate the TXT verification token | Yes | Random, per configuration |
| Create DNS records | **No** | The school (custom) or the platform team (subdomain) at their DNS provider |
| Add the domain to the host so a certificate is issued | **No** | Render dashboard → frontend service → Custom Domains |
| Verify DNS | Yes, with a real lookup | `node:dns` resolver, `DOMAIN_CHECK_TIMEOUT_MS` per query |
| Check the certificate | Yes, with a real TLS handshake | `node:tls`, SNI and full chain verification |
| Serve the portal on the domain | Yes, once **activated** | Frontend `middleware.ts` + backend CORS |

A domain is **never** verified, marked SSL-active or activated just because a hostname was entered.

## Configuration

Backend (`backend/.env`):

| Variable | Meaning |
| --- | --- |
| `PLATFORM_DOMAIN` | Domain the platform owns. Subdomains are issued under it. Leave empty to disable subdomains. |
| `DOMAIN_CNAME_TARGET` | Hostname custom domains must CNAME to, e.g. `school-erp-frontend.onrender.com`. Shown in the DNS instructions. |
| `DOMAIN_CHECK_TIMEOUT_MS` | Timeout for each DNS query and TLS handshake (default 5000). |

Frontend:

| Variable | Meaning |
| --- | --- |
| `PLATFORM_APP_HOSTS` | Comma-separated hostnames that are the platform itself (e.g. `app.eduos.app,school-erp-frontend.onrender.com`). These skip the domain lookup; `localhost` always skips it. |
| `API_URL` / `NEXT_PUBLIC_BACKEND_URL` | Where the middleware asks `GET /api/v1/domains/resolve`. |

## State machine

```
configure ──► PENDING ──verify──► VERIFIED ──check SSL──► SSL ACTIVE ──activate──► ACTIVE
                 │                    │                        │                      │
                 └──verify──► FAILED ◄┘ (record gone)          └─► SSL FAILED          └─deactivate─► inactive
```

- **Configure** (subdomain or custom) sets `verificationStatus=PENDING`, `sslStatus=NOT_CHECKED` and `active=false`, with a fresh token. Submitting the address the school already has changes nothing. A *different* address starts over, and takes a live domain offline (`deactivationReason=RECONFIGURED`).
- **Verify** can end three ways:
  - `VERIFIED`: the records were found.
  - `FAILED`: DNS answered and the records aren't there.
  - `INCONCLUSIVE`: the resolver timed out or returned SERVFAIL. No state changes in this case.
  - If an **active** domain fails re-verification, it's deactivated (`VERIFICATION_FAILED`).
- **Check SSL** is only allowed once the domain is VERIFIED. A handshake that validates for the hostname gives `ACTIVE`; any certificate error gives `FAILED`. A timeout is inconclusive.
- **Activate** requires `VERIFIED`, SSL `ACTIVE`, and the school itself `ACTIVE`.
- A suspended school's domain stops resolving immediately, even if it's still marked active.

Every transition is written to the audit log (`domain.configured`, `domain.verification`, `domain.ssl_checked`, `domain.activated`, `domain.deactivated`). The verification token is never written there.

## DNS records

### Custom domain (`www.abcschool.com`)

The school creates both records at its DNS provider:

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| TXT | `_eduos-verification.www.abcschool.com` | `eduos-verification=<token>` | Proves the school controls the domain. Leave it in place: it's re-checked on every verification. |
| CNAME | `www.abcschool.com` | `DOMAIN_CNAME_TARGET` | Sends traffic to the platform. |

A bare domain (`abcschool.com`) can't hold a CNAME. Use the provider's ALIAS/ANAME/flattened CNAME, or use `www.`.

Then the platform team:

1. Adds `www.abcschool.com` under Custom Domains on the Render frontend service, so Render issues a certificate.
2. In Domain Management, runs **Verify**, then **Check SSL**, then **Activate**.

The token is shown in the domain's **View** dialog and in the School Admin's Settings page. It changes whenever the hostname changes.

### Platform subdomain (`abc-public-school.eduos.app`)

The school creates nothing. Before any subdomain can verify, the platform needs:

- a DNS record covering it, either wildcard `*.eduos.app` or the specific name, CNAME'd to the frontend host, and
- a certificate valid for it, which in practice means a wildcard certificate for `*.eduos.app` at the host.

Verification checks that the name resolves (A/AAAA/CNAME).

## Domain from the School Admin profile

Before this, the School Admin profile had no website or domain field. None existed on `Profile`, `School` or `Account`. Now there is exactly one: `Profile.website`, stored as entered. The Super Admin sets it on School Admin profiles in **Schools & Admins** (`POST /schools/:tenantId/admins`, `PATCH /schools/:tenantId/admins/:profileId`, both `schools.manage`). A School Admin can't edit their own profile, which matches the existing rule.

```
School Admin profile website
  → normalizeWebsite (validate + normalise, never guess)
  → School Domain Configuration (CUSTOM, PENDING, inactive, source PROFILE)
  → Super Admin review (verify, check SSL)
  → activation
```

### Normalisation

| Entered | Domain |
| --- | --- |
| `example.com` | `example.com` |
| `https://example.com` | `example.com` |
| `www.example.com` | `example.com` |
| `https://www.example.com/` | `example.com` |
| `https://portal.abcschool.edu.in/` | `portal.abcschool.edu.in` |
| empty / missing | **Not Provided** |

Refused with a 400, and the profile is not changed:

- a page path (`https://example.com/about`), query or fragment
- any scheme other than http/https
- ports and credentials
- IP addresses and single-label names
- everything the custom-domain rules above refuse

### Which profile

Only **ACTIVE** School Admin profiles of **that school** are read.

| Result | Meaning |
| --- | --- |
| `FOUND` | One domain; several admins giving the same domain count once. The most recently updated profile is recorded as the source. |
| `NOT_PROVIDED` | No admin has a website. The UI shows "Not Provided". |
| `INVALID` | Websites exist, but none is usable. |
| `CONFLICT` | Admins give different domains. None is picked. |

### What happens when the website changes

| Situation | Effect |
| --- | --- |
| No configuration yet, usable domain | A configuration is created: CUSTOM, PENDING, inactive, `source=PROFILE` |
| Configuration came from the profile, is **inactive**, domain changed | It's replaced with the new domain, still PENDING and inactive |
| Profile already matches the configuration | Source info is refreshed and any pending change is cleared |
| Configuration is **active**, or was set manually, or the website was removed, is invalid or conflicting, or its domain belongs to another school | Nothing is replaced. A `pendingProfileDomain` change (`CHANGED`, `REMOVED`, `INVALID`, `CONFLICT` or `DUPLICATE`) is recorded for review |

Detection never activates, deactivates or deletes a configuration.

Review, in Domain Management:

- **Import from profile** (`POST /domains/schools/:tenantId/profile-domain/import`) applies the profile's domain. Replacing an **active** domain needs `confirmReplace: true`. Without it the call returns 409 `ACTIVE_DOMAIN_REPLACE_UNCONFIRMED` and the active domain stays live.
- **Dismiss** (`POST /domains/schools/:tenantId/profile-domain/dismiss`) clears the pending change and leaves the configuration as it is.

Audit actions: `domain.profile_website_changed` (old and new website), `domain.configured`, `domain.profile_change_pending`, `domain.profile_imported`, `domain.profile_change_dismissed`.

The School Admin sees the profile's domain (or "Not Provided") read-only in Tenant Settings and through the `get_school_domain` MCP tool. Neither can name another school.

## Subdomain rules

- Generated from the school name: accents folded, apostrophes dropped, `&` becomes `and`, everything else non-alphanumeric becomes one hyphen. Capped at 63 characters with no trailing hyphen.
- Names too short for a label are padded (`AB` → `ab-school`). A name with no Latin characters can't be generated from; enter a subdomain instead.
- Duplicate or reserved labels step to `-2`, `-3`, … (`Admin` → `admin-2`).
- A subdomain typed by hand must be 3–63 lowercase letters, digits and single hyphens, with no `xn--` and no reserved word. If another school holds it, it's refused (409). It is never auto-suffixed.
- Uniqueness is enforced by a unique index on `hostname`, not only by the service.

## Custom domain rules

Normalised: lower-cased, one trailing dot removed, internationalised names converted to punycode.

Refused (400) rather than cleaned up:

- protocols (`https://`, `javascript:`)
- paths, queries, fragments, backslashes
- ports and credentials
- wildcards, whitespace and control characters
- IP addresses and single-label names
- invalid labels or TLDs, and names over 253 characters
- non-public suffixes (`.local`, `.test`, `localhost`, …)
- anything under `PLATFORM_DOMAIN`

## What activation changes

- `GET /api/v1/domains/resolve?host=` answers with the school's slug. It returns the same 404 for pending, failed, deactivated and unknown hosts.
- Backend CORS allows `https://<hostname>`, with no port. The list is cached for 60 s per instance and cleared on every domain change on that instance.
- The frontend middleware redirects `/` on the school's host to `/<slug>`. The school's own paths and the shared sign-in paths (`/login`, `/select-profile`, `/api`, `/public`) are served. Any other school's path, and `/super-admin`, redirect back to the school's front door.

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/domains/resolve?host=` | public |
| GET | `/domains/mine` | `domains.read` (ADMIN, SUPER_ADMIN) |
| GET | `/domains/schools` | `domains.manage` (SUPER_ADMIN only) |
| GET | `/domains/schools/:tenantId` | `domains.manage` |
| GET | `/domains/schools/:tenantId/subdomain/suggestion` | `domains.manage` |
| PUT | `/domains/schools/:tenantId/subdomain` | `domains.manage` |
| PUT | `/domains/schools/:tenantId/custom` | `domains.manage` |
| POST | `/domains/schools/:tenantId/verify` | `domains.manage` |
| POST | `/domains/schools/:tenantId/ssl-check` | `domains.manage` |
| POST | `/domains/schools/:tenantId/activate` | `domains.manage` |
| POST | `/domains/schools/:tenantId/deactivate` | `domains.manage` |

MCP: `get_school_domain` (read-only, `domains.read`, caller's own school, no arguments). There are no write tools, because `domains.manage` is Super-Admin-only and SUPER_ADMIN has no assistant.
