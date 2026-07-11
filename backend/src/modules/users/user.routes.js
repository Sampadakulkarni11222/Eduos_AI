import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
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
 *     summary: Update account status (activate / deactivate / suspend)
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
 *               status: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *     responses:
 *       200:
 *         description: User updated
 */
router.get('/:id', requirePermission('users.read'), controller.getById);
router.patch('/:id', requirePermission('users.manage'), controller.update);

export default router;
