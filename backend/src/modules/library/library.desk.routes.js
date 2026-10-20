import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { getOwnStudentId } from '../../utils/scope.js';
import * as desk from './library.desk.js';

/**
 * @swagger
 * tags:
 *   name: LibraryDesk
 *   description: Renewals, reservations (hold queue), overdue reminders, fines, reading challenges, circulation insights and next-read suggestions
 */
const router = Router();
router.use(authenticate);
const manage = requirePermission('library.manage');
const read = requirePermission('library.read');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/rules', read, ok(() => desk.DESK_RULES));
router.get('/briefing', manage, ok(() => desk.briefing()));
router.get('/insights', manage, ok((r) => desk.insights({ days: r.query.days })));
router.get('/overdue', manage, ok(() => desk.overdueList()));
router.post('/overdue/remind', manage, ok((r) => desk.sendOverdueReminders(r.actor, { dryRun: r.body?.dryRun === true, minDaysLate: Number(r.body?.minDaysLate) || 1 }), 'Reminders sent'));
router.post('/loans/:id/renew', manage, ok((r) => desk.renewLoan(r.actor, r.params.id, r.body ?? {}), 'Loan renewed'));
router.get('/fines', manage, ok((r) => desk.listFines({ status: r.query.status })));
router.post('/loans/:id/fine', manage, ok((r) => desk.settleFine(r.actor, r.params.id, r.body ?? {}), 'Fine updated'));
router.get('/holds', manage, ok((r) => desk.listHolds(r.query)));
router.post('/holds', manage, ok((r) => desk.placeHold(r.actor, r.body ?? {}), 'Reservation placed', 201));
router.post('/holds/:id/cancel', manage, ok((r) => desk.cancelHold(r.actor, r.params.id, r.body ?? {}), 'Reservation cancelled'));
router.post('/holds/:id/collect', manage, ok((r) => desk.collectHold(r.actor, r.params.id, r.body ?? {}), 'Book issued', 201));
router.get('/suggestions/:studentId', manage, ok((r) => desk.suggestFor(r.params.studentId, { limit: r.query.limit })));
router.get('/challenges', manage, ok((r) => desk.listChallenges(r.query)));
router.post('/challenges', manage, ok((r) => desk.createChallenge(r.actor, r.body ?? {}), 'Reading challenge created', 201));
router.get('/challenges/mine', requirePermission('library.request'), ok(async (r) => {
  const studentId = await getOwnStudentId(r.actor?.profileId);
  if (!studentId) throw new AppError('Reading challenges are for students.', 403);
  return desk.myChallenges(studentId);
}));
router.get('/challenges/:id', manage, ok((r) => desk.challengeProgress(r.params.id)));
router.post('/challenges/:id/close', manage, ok((r) => desk.closeChallenge(r.actor, r.params.id), 'Reading challenge closed'));

export default router;
