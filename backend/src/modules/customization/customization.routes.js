import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './customization.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Customization
 *   description: School-wise theme, branding and dropdown configuration
 */

router.use(authenticate);

/* ── Any signed-in member of the school ───────────────────── */
//
// These two carry no permission, deliberately. Every role has to paint its own
// portal and populate its own forms, so gating the theme behind a permission
// would mean a student whose school has a logo gets a portal that has lost it.
// The payload is the school's own branding and option lists — nothing about
// who configured them, and nothing another school can reach: the tenancy
// plugin has already confined the read to the caller's own school.

/**
 * @swagger
 * /customization/theme:
 *   get:
 *     summary: The acting school's theme, branding and dropdowns, for rendering
 *     tags: [Customization]
 *     responses:
 *       200: { description: Theme fetched }
 */
router.get('/theme', controller.getMyTheme);

/**
 * @swagger
 * /customization/dropdowns/{key}:
 *   get:
 *     summary: One of the acting school's dropdown option lists
 *     description: >
 *       Confined to the caller's own school — "house" is Red/Blue/Green in one
 *       school and Alpha/Beta/Gamma in another, and neither can ask for the
 *       other's. An undefined key returns an empty list.
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dropdown fetched }
 */
router.get('/dropdowns/:key', controller.getMyDropdown);

/* ── School administration ────────────────────────────────── */

/**
 * @swagger
 * /customization:
 *   get:
 *     summary: The acting school's full customisation, including when it was last changed
 *     tags: [Customization]
 *     responses:
 *       200: { description: Customization fetched }
 */
router.get('/', requirePermission('settings.manage', 'ALL'), controller.getMyCustomization);

/* ── Platform (Super Admin) ───────────────────────────────── */
//
// `customization.manage` is in SUPER_ADMIN_ONLY. A School Admin reads its own
// configuration through the routes above and cannot change it, which is the
// rule the Settings screen has always stated: branding is managed by the
// platform team. Widening that later is one line in constants/permissions.js —
// removing the key from SUPER_ADMIN_ONLY — and nothing here changes.

/**
 * @swagger
 * /customization/schools:
 *   get:
 *     summary: Every school's customisation (Super Admin)
 *     tags: [Customization]
 *     responses:
 *       200: { description: School customizations fetched }
 */
router.get('/schools', requirePermission('customization.manage', 'ALL'), controller.listSchools);

/**
 * @swagger
 * /customization/schools/{tenantId}:
 *   get:
 *     summary: One school's customisation (Super Admin)
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Customization fetched }
 *   put:
 *     summary: Save one school's customisation (Super Admin)
 *     description: >
 *       Replaces the whole configuration with a validated one. Colours must be
 *       hex literals and assets must be an uploaded /uploads/… path or an https
 *       URL; a payload with one bad value changes nothing.
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               theme:
 *                 type: object
 *                 properties:
 *                   primaryColor: { type: string, example: '#1f4a3a' }
 *                   secondaryColor: { type: string, example: '#2c6049' }
 *                   accentColor: { type: string, example: '#c9a23f' }
 *               branding:
 *                 type: object
 *                 properties:
 *                   displayName: { type: string }
 *                   tagline: { type: string }
 *                   logoUrl: { type: string, example: '/uploads/abc-logo.png' }
 *                   faviconUrl: { type: string }
 *               header: { type: object }
 *               sidebar: { type: object }
 *               dropdowns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     key: { type: string, example: house }
 *                     label: { type: string, example: House }
 *                     options:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value: { type: string, example: Red }
 *                           label: { type: string, example: Red House }
 *     responses:
 *       200: { description: Customization saved }
 *       400: { description: A malformed colour, asset or dropdown }
 *   delete:
 *     summary: Reset one school to the shipped defaults (Super Admin)
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Customization reset to defaults }
 */
router.get('/schools/:tenantId', requirePermission('customization.manage', 'ALL'), controller.getSchoolCustomization);
router.put('/schools/:tenantId', requirePermission('customization.manage', 'ALL'), controller.updateSchoolCustomization);
router.delete('/schools/:tenantId', requirePermission('customization.manage', 'ALL'), controller.resetSchoolCustomization);

/**
 * @swagger
 * /customization/schools/{tenantId}/theme:
 *   get:
 *     summary: One school's render-time theme, for the console's preview (Super Admin)
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Theme fetched }
 */
router.get('/schools/:tenantId/theme', requirePermission('customization.manage', 'ALL'), controller.getSchoolTheme);

/**
 * @swagger
 * /customization/schools/{tenantId}/preview:
 *   post:
 *     summary: Validate a configuration without saving it (Super Admin)
 *     description: >
 *       Runs the same validator the save runs, and returns the CSS variables the
 *       configuration would produce — so a preview that renders is one that will
 *       save, and one that would be refused says so first.
 *     tags: [Customization]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Customization preview }
 *       400: { description: A malformed colour, asset or dropdown }
 */
router.post('/schools/:tenantId/preview', requirePermission('customization.manage', 'ALL'), controller.previewCustomization);

export default router;
