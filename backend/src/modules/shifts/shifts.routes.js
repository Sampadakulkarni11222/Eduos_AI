import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as shifts from './shifts.service.js';

/**
 * @swagger
 * tags:
 *   - name: Shifts
 *     description: School shifts (morning, afternoon…) with their own bell schedules, and the classes assigned to each
 */
const router = Router();
router.use(authenticate);
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const readPerm = requirePermission('timetable.read');
// Shifts are the school's planning: staff only (families see their own class's day on the map).
const staffOnly = (req, _res, next) => (['PARENT', 'STUDENT', 'ALUMNUS'].includes(req.actor?.roleKey) ? next(new AppError('Shifts are kept for staff', 403, [], 'ROLE_NOT_PERMITTED')) : next());
const read = [readPerm, staffOnly];
const manage = requirePermission('timetable.manage', 'ALL');

/**
 * @swagger
 * /shifts:
 *   get:
 *     summary: The shifts, their bells and classes, classes without a shift, and room clashes between shifts
 *     tags: [Shifts]
 *   post:
 *     summary: Create a shift (validates bells, one shift per class, no room used by two shifts at once; sets the classes' period times)
 *     tags: [Shifts]
 */
router.get('/', read, ok(() => shifts.list()));
router.post('/', manage, ok((r) => shifts.create(r.actor, r.body), 'Shift saved', 201));
router.get('/section/:sectionId', read, ok((r) => shifts.forSection(r.params.sectionId)));
router.put('/:id', manage, ok((r) => shifts.update(r.actor, r.params.id, r.body), 'Shift saved'));
router.delete('/:id', manage, ok((r) => shifts.remove(r.actor, r.params.id), 'Shift retired'));

export default router;
