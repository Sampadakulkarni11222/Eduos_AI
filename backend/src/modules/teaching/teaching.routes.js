import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { requireAnyPermission } from '../ptm/relations.js';
import * as plans from './lessonPlans.service.js';
import * as bank from './questionBank.service.js';
import * as cpd from './cpd.service.js';
import { paperResults } from './paperResults.service.js';

/**
 * @swagger
 * tags:
 *   - name: Teaching
 *     description: Lesson plans, the question bank and paper builder, and CPD hours (part 4, teacher audit)
 */
const router = Router();
router.use(authenticate);
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
// Planning is staff work: syllabus.manage (a teacher OWN, the principal and admin ALL). syllabus.read alone
// is held by parents and students and is not enough: plans and the bank hold answers and teacher notes.
const plan = requirePermission('syllabus.manage');
const staff = requireAnyPermission('staffleave.apply', 'staffleave.manage');
const assignScope = (r) => {
  const s = r.actor.permissions?.['assignments.manage'];
  if (!s) throw new AppError('Missing permission: assignments.manage', 403);
  return s;
};

router.get('/lesson-plans', plan, ok((r) => plans.list(r.actor, r.query)));
router.post('/lesson-plans/suggest', plan, ok((r) => plans.suggest(r.actor, r.body)));
router.post('/lesson-plans', plan, ok((r) => plans.create(r.actor, r.body), 'Lesson plan saved', 201));
router.get('/lesson-plans/:id', plan, ok((r) => plans.get(r.actor, r.params.id)));
router.patch('/lesson-plans/:id', plan, ok((r) => plans.update(r.actor, r.params.id, r.body), 'Lesson plan saved'));
router.delete('/lesson-plans/:id', plan, ok((r) => plans.remove(r.actor, r.params.id), 'Lesson plan removed'));
router.post('/lesson-plans/:id/copy', plan, ok((r) => plans.copyTo(r.actor, r.params.id, r.body), 'Copied', 201));
router.post('/lesson-plans/:id/taught', plan, ok((r) => plans.markTaught(r.actor, r.body?.setHomework ? assignScope(r) : (r.actor.permissions?.['assignments.manage'] ?? 'OWN'), r.params.id, r.body), 'Marked taught'));
router.post('/lesson-plans/:id/feedback', plan, ok((r) => plans.addFeedback(r.actor, r.params.id, r.body), 'Feedback added'));

router.get('/question-bank/scopes', plan, ok((r) => bank.scopes(r.actor)));
router.get('/question-bank', plan, ok((r) => bank.listQuestions(r.actor, r.query)));
router.post('/question-bank', plan, ok((r) => bank.addQuestion(r.actor, r.body), 'Question added', 201));
router.patch('/question-bank/:id', plan, ok((r) => bank.updateQuestion(r.actor, r.params.id, r.body), 'Question saved'));
router.delete('/question-bank/:id', plan, ok((r) => bank.archiveQuestion(r.actor, r.params.id), 'Question removed'));
router.get('/papers', plan, ok((r) => bank.listPapers(r.actor, r.query)));
router.post('/papers', plan, ok((r) => bank.createPaper(r.actor, r.body), 'Paper saved', 201));
router.post('/papers/build', plan, ok((r) => bank.buildPaper(r.actor, r.body), 'Draft paper built', 201));
router.post('/papers/to-quiz', plan, ok((r) => bank.toQuiz(r.actor, assignScope(r), r.body), 'Draft quiz created', 201));
router.get('/papers/:id', plan, ok((r) => bank.getPaper(r.actor, r.params.id)));
router.patch('/papers/:id', plan, ok((r) => bank.updatePaper(r.actor, r.params.id, r.body), 'Paper saved'));
router.post('/papers/:id/final', plan, ok((r) => bank.finalisePaper(r.actor, r.params.id), 'Paper is final'));
router.delete('/papers/:id', plan, ok((r) => bank.removePaper(r.actor, r.params.id), 'Paper removed'));

router.get('/paper-results', requirePermission('marks.read'), ok((r) => paperResults(r.actor, r.scope, r.query.examSubjectId)));

router.get('/cpd', staff, ok((r) => cpd.mine(r.actor, r.query)));
router.post('/cpd', staff, ok((r) => cpd.add(r.actor, r.body), 'Hours logged', 201));
router.delete('/cpd/:id', staff, ok((r) => cpd.remove(r.actor, r.params.id), 'Entry removed'));
router.get('/cpd/overview', requirePermission('staffleave.manage', 'ALL'), ok((r) => cpd.overview(r.actor)));
router.post('/cpd/:id/verify', requirePermission('staffleave.manage', 'ALL'), ok((r) => cpd.verify(r.actor, r.params.id), 'Verified'));

export default router;
