import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './school.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Schools
 *   description: Super Admin — schools and their School Admin accounts
 */

/**
 * @swagger
 * /schools/public/{slug}:
 *   get:
 *     summary: Resolve a school's URL slug to its display name (public)
 *     tags: [Schools]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: School fetched }
 *       404: { description: No such school }
 */
// Deliberately before `authenticate`: /oakridge/login has to name the school
// before anyone has signed in. It returns the slug and display name only.
router.get('/public/:slug', controller.publicBySlug);

// Everything below is gated by the existing permission system.
// `schools.read` / `schools.manage` are granted to SUPER_ADMIN only, so every
// other role (Admin, Principal, Teacher, Student, Parent, ...) gets the same
// 403 requirePermission already returns everywhere else — no second
// authorization mechanism is introduced.
router.use(authenticate);

/**
 * @swagger
 * /schools:
 *   get:
 *     summary: List the schools on the platform (Super Admin)
 *     tags: [Schools]
 *     responses:
 *       200: { description: Schools fetched }
 *   post:
 *     summary: Register a new school together with its first School Admin
 *     tags: [Schools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId, tenantName, admin]
 *             properties:
 *               tenantId: { type: string, example: oakridge-north }
 *               tenantName: { type: string, example: Oakridge North Campus }
 *               admin:
 *                 type: object
 *                 required: [displayName, phone]
 *                 properties:
 *                   displayName: { type: string }
 *                   phone: { type: string, example: '+919876543210' }
 *                   email: { type: string }
 *                   password: { type: string }
 *     responses:
 *       201: { description: School created }
 */
router.get('/', requirePermission('schools.read', 'ALL'), controller.list);
router.post('/', requirePermission('schools.manage', 'ALL'), controller.create);

/**
 * @swagger
 * /schools/{tenantId}:
 *   get:
 *     summary: Get one school
 *     tags: [Schools]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: School fetched }
 *   patch:
 *     summary: Rename a school
 *     tags: [Schools]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: School updated }
 */
router.get('/:tenantId', requirePermission('schools.read', 'ALL'), controller.getById);
router.patch('/:tenantId', requirePermission('schools.manage', 'ALL'), controller.update);

/**
 * @swagger
 * /schools/{tenantId}/admins:
 *   get:
 *     summary: List a school's School Admin accounts
 *     tags: [Schools]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: School Admins fetched }
 *   post:
 *     summary: Create a School Admin for this school
 *     tags: [Schools]
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
 *             required: [displayName, phone]
 *             properties:
 *               displayName: { type: string }
 *               phone: { type: string, example: '+919876543210' }
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       201: { description: School Admin created }
 */
router.get('/:tenantId/admins', requirePermission('schools.read', 'ALL'), controller.listAdmins);
router.post('/:tenantId/admins', requirePermission('schools.manage', 'ALL'), controller.createAdmin);

/**
 * @swagger
 * /schools/{tenantId}/admins/{profileId}:
 *   patch:
 *     summary: Activate, deactivate, suspend or rename a School Admin
 *     tags: [Schools]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: profileId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *               displayName: { type: string }
 *     responses:
 *       200: { description: School Admin updated }
 */
router.patch('/:tenantId/admins/:profileId', requirePermission('schools.manage', 'ALL'), controller.updateAdmin);

export default router;
