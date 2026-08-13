import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './user.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Admin user account management (accounts + profiles)
 */

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List all user accounts with their profiles (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by email or phone
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *       - in: query
 *         name: roleKey
 *         schema: { type: string, example: TEACHER }
 *         description: Filter by role
 *     responses:
 *       200:
 *         description: Users fetched
 */
router.get('/', requirePermission('users.read'), controller.list);
router.post('/', requirePermission('users.manage'), controller.create);

/**
 * @swagger
 * /users/bulk:
 *   post:
 *     summary: Bulk-create users from a CSV (roleKey, displayName, phone, email, password, admissionNo, gradeName, sectionName)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Bulk import result { imported, failed, errors }
 */
router.post('/bulk', requirePermission('users.manage'), csvUploadSingle('file'), controller.bulkCreate);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a single user account
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User fetched
 *   patch:
 *     summary: Update user account details or status (activate / deactivate / suspend)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName: { type: string, example: "John Doe" }
 *               phone: { type: string, example: "+919555000111" }
 *               email: { type: string, example: "john@example.com" }
 *               status: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *     responses:
 *       200:
 *         description: User updated
 */
router.get('/:id', requirePermission('users.read'), controller.getById);
router.patch('/:id', requirePermission('users.manage'), controller.update);

export default router;
