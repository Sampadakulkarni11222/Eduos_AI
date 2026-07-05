import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './permission.controller.js';

const router = Router();

router.use(authenticate, requirePermission('permissions.manage'));

/**
 * @swagger
 * /permissions:
 *   get:
 *     summary: List the permission catalog
 *     tags: [Permissions]
 *     responses:
 *       200: { description: List of permissions }
 *   post:
 *     summary: Create a new permission key
 *     tags: [Permissions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, group]
 *             properties:
 *               key: { type: string, example: library.manage }
 *               group: { type: string, example: library }
 *               description: { type: string }
 *     responses:
 *       201: { description: Permission created }
 */
router.get('/', controller.list);
router.post('/', controller.create);

/**
 * @swagger
 * /permissions/{id}:
 *   patch:
 *     summary: Update a permission's description or group
 *     tags: [Permissions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Permission updated }
 *   delete:
 *     summary: Delete a non-system permission
 *     tags: [Permissions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Permission deleted }
 */
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;
