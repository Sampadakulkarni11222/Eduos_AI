import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './domain.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Domains
 *   description: School subdomains and custom domains, with real DNS and TLS verification
 */

/**
 * @swagger
 * /domains/resolve:
 *   get:
 *     summary: Which school an active hostname serves (public)
 *     description: >
 *       Answers only for an ACTIVE domain of an ACTIVE school. A pending,
 *       failed, deactivated or unknown hostname all get the same 404.
 *     tags: [Domains]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: host
 *         required: true
 *         schema: { type: string, example: www.abcschool.com }
 *     responses:
 *       200: { description: Domain resolved }
 *       404: { description: No school is served at this address }
 */
// Before `authenticate`: the frontend resolves the host before anyone signs in.
router.get('/resolve', controller.resolve);

router.use(authenticate);

/* ── School Admin ─────────────────────────────────────────── */
//
// No school in the path: middleware/auth.js has pinned the acting school, so a
// School Admin reads its own address and cannot name another's. `domains.read`
// is granted to ADMIN and SUPER_ADMIN only.

/**
 * @swagger
 * /domains/mine:
 *   get:
 *     summary: The acting school's domain and the DNS records it needs
 *     tags: [Domains]
 *     responses:
 *       200: { description: Domain fetched }
 */
router.get('/mine', requirePermission('domains.read', 'ALL'), controller.getMine);

/* ── Platform (Super Admin) ───────────────────────────────── */
//
// `domains.manage` is in SUPER_ADMIN_ONLY, so no school-level role can
// configure, verify or activate an address — including its own.

const manage = requirePermission('domains.manage', 'ALL');

/**
 * @swagger
 * /domains/schools:
 *   get:
 *     summary: Every school with its domain configuration (Super Admin)
 *     tags: [Domains]
 *     responses:
 *       200: { description: School domains fetched }
 */
router.get('/schools', manage, controller.list);

/**
 * @swagger
 * /domains/schools/{tenantId}:
 *   get:
 *     summary: One school's domain configuration and DNS instructions (Super Admin)
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Domain fetched }
 */
router.get('/schools/:tenantId', manage, controller.getOne);

/**
 * @swagger
 * /domains/schools/{tenantId}/subdomain/suggestion:
 *   get:
 *     summary: The free subdomain this school's name generates, without claiming it (Super Admin)
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Subdomain suggested }
 *       409: { description: PLATFORM_DOMAIN is not configured }
 */
router.get('/schools/:tenantId/subdomain/suggestion', manage, controller.suggestSubdomain);

/**
 * @swagger
 * /domains/schools/{tenantId}/subdomain:
 *   put:
 *     summary: Give a school a platform subdomain (Super Admin)
 *     description: >
 *       Omit `subdomain` to generate one from the school's name. The domain is
 *       left PENDING and inactive.
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subdomain: { type: string, example: abc-public-school }
 *     responses:
 *       200: { description: Subdomain configured }
 *       400: { description: Invalid or reserved subdomain }
 *       409: { description: Taken, or subdomains not configured on this deployment }
 */
router.put('/schools/:tenantId/subdomain', manage, controller.configureSubdomain);

/**
 * @swagger
 * /domains/schools/{tenantId}/custom:
 *   put:
 *     summary: Give a school its own domain (Super Admin)
 *     description: >
 *       The domain name only — no protocol, path or port. Left PENDING and
 *       inactive, with a TXT verification record to create.
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domain]
 *             properties:
 *               domain: { type: string, example: www.abcschool.com }
 *     responses:
 *       200: { description: Custom domain configured }
 *       400: { description: Not a valid hostname }
 *       409: { description: Assigned to another school }
 */
router.put('/schools/:tenantId/custom', manage, controller.configureCustomDomain);

/**
 * @swagger
 * /domains/schools/{tenantId}/verify:
 *   post:
 *     summary: Check the school's DNS records with a real lookup (Super Admin)
 *     description: >
 *       outcome is VERIFIED, FAILED, or INCONCLUSIVE when the resolver could not
 *       be reached (no state changes in that case).
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Verification ran }
 *       404: { description: No domain configured }
 */
router.post('/schools/:tenantId/verify', manage, controller.verify);

/**
 * @swagger
 * /domains/schools/{tenantId}/ssl-check:
 *   post:
 *     summary: Check the certificate served for the domain with a real TLS handshake (Super Admin)
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Certificate check ran }
 *       409: { description: The domain is not verified }
 */
router.post('/schools/:tenantId/ssl-check', manage, controller.checkSsl);

/**
 * @swagger
 * /domains/schools/{tenantId}/activate:
 *   post:
 *     summary: Start serving the school at its domain (Super Admin)
 *     description: Requires VERIFIED, a working certificate, and an ACTIVE school.
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Domain activated }
 *       409: { description: Not verified, no certificate, or school suspended }
 */
router.post('/schools/:tenantId/activate', manage, controller.activate);

/**
 * @swagger
 * /domains/schools/{tenantId}/deactivate:
 *   post:
 *     summary: Stop serving the school at its domain (Super Admin)
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Domain deactivated }
 */
router.post('/schools/:tenantId/deactivate', manage, controller.deactivate);

/**
 * @swagger
 * /domains/schools/{tenantId}/profile-domain/import:
 *   post:
 *     summary: Apply the domain from the School Admin profile's website (Super Admin)
 *     description: >
 *       Creates or replaces the configuration with the profile's normalised
 *       domain, PENDING and inactive. Replacing an ACTIVE domain requires
 *       confirmReplace=true; otherwise it is refused and the active domain kept.
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               confirmReplace: { type: boolean }
 *     responses:
 *       200: { description: Profile domain imported }
 *       409: { description: Conflict, duplicate, or an unconfirmed replacement of an active domain }
 *       422: { description: The profile has no website, or an unusable one }
 */
router.post('/schools/:tenantId/profile-domain/import', manage, controller.importProfileDomain);

/**
 * @swagger
 * /domains/schools/{tenantId}/profile-domain/dismiss:
 *   post:
 *     summary: Dismiss a pending School Admin profile domain change (Super Admin)
 *     tags: [Domains]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Profile change dismissed }
 */
router.post('/schools/:tenantId/profile-domain/dismiss', manage, controller.dismissProfileDomainChange);

export default router;
