import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './document.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Documents
 *   description: Document management (report cards, ID cards, course material)
 */

router.get('/', requirePermission('materials.read'), controller.listDocuments);
router.get('/:id/file', requirePermission('materials.read'), controller.getFile);
router.post('/', requirePermission('materials.manage'), controller.createDocument);
router.put('/:id', requirePermission('materials.manage'), controller.updateDocument);
router.delete('/:id', requirePermission('materials.manage'), controller.deleteDocument);

export default router;
