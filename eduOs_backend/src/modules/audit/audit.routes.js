import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './audit.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Audit
 *   description: System audit logs
 */

router.get('/logs', controller.listLogs);

export default router;
