import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './document.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Documents
 *   description: Document management
 */

router.get('/', controller.listDocuments);
router.post('/', controller.createDocument);
router.delete('/:id', controller.deleteDocument);

export default router;
