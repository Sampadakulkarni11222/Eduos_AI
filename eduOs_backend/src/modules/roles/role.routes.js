import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './role.controller.js';

const router = Router();

router.use(authenticate, requirePermission('roles.manage'));

/**
 * @swagger
 * /roles:
 *   get:
 *     summary: List all roles
 *     tags: [Roles]
 *     responses:
 *       200: { description: List of roles }
 *   post:
 *     summary: Create a new role
 *     tags: [Roles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, name]
 *             properties:
 *               key: { type: string, example: ACCOUNTANT }
 *               name: { type: string, example: Accountant }
 *               description: { type: string }
 *     responses:
 *       201: { description: Role created }
 */
router.get('/', controller.list);
router.post('/', controller.create);

/**
 * @swagger
 * /roles/{id}:
 *   get:
 *     summary: Get a single role with its permissions
 *     tags: [Roles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Role fetched }
 *   patch:
 *     summary: Update a role's name/description
 *     tags: [Roles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Role updated }
 *   delete:
 *     summary: Delete a non-system role
 *     tags: [Roles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Role deleted }
 */
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

/**
 * @swagger
 * /roles/{id}/permissions:
 *   post:
 *     summary: Assign (or update the scope of) a permission on a role
 *     tags: [Roles]
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
 *             required: [key]
 *             properties:
 *               key: { type: string, example: fees.pay }
 *               scope: { type: string, enum: [ALL, OWN], default: ALL }
 *     responses:
 *       200: { description: Permission assigned to role }
 */
router.post('/:id/permissions', controller.assignPermission);

/**
 * @swagger
 * /roles/{id}/permissions/{key}:
 *   delete:
 *     summary: Revoke a permission from a role
 *     tags: [Roles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Permission revoked from role }
 */
router.delete('/:id/permissions/:key', controller.revokePermission);

export default router;
