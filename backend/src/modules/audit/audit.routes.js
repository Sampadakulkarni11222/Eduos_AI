import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './audit.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Audit
 *   description: System audit logs
 */

// The audit trail records who did what, to which record, from which IP,
// across the whole school — it was previously readable by any signed-in user.
router.get('/logs', requirePermission('audit.read'), controller.listLogs);

export default router;
