import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { requireFeature, featureEnabled } from '../../utils/features.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import * as opps from './opportunities.service.js';
import * as editions from './editions.service.js';

/**
 * @swagger
 * tags:
 *   - name: Newsletter
 *     description: Opportunities (competitions, olympiads, scholarships, exams, programmes) with matching and eligibility, and the interactive weekly / monthly newsletter (flashcards, quiz, poll, comments), reviewed and published by an editor
 *
 * Mounted at /newsletter. Readers need digest.read; the editor's desk
 * (review queue, sources allowlist, publishing, analytics) needs digest.manage
 * for the whole school. The services check everything else: a parent's
 * matches are their own children's, a student cannot turn on email, only
 * staff add items, only staff moderate comments (teachers: students' only).
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('newsletter'));
const read = requirePermission('digest.read');
const manage = requirePermission('digest.manage', 'ALL');

// Reader
router.get('/home', read, ok((r) => editions.home(r.actor)));
router.get('/preferences', read, ok((r) => opps.myPreferences(r.actor)));
router.put('/preferences', read, ok((r) => opps.setPreferences(r.actor, r.body), 'Preferences saved'));
router.get('/opportunities', read, ok((r) => opps.list(r.actor, r.query)));
router.get('/opportunities/map', read, ok((r) => opps.map(r.actor)));
router.get('/matches', read, ok((r) => opps.matches(r.actor, r.query)));
router.get('/saved', read, ok((r) => opps.saved(r.actor)));
router.get('/questions', read, ok((r) => opps.questions(r.actor)));
router.post('/questions/:id/answer', read, ok((r) => opps.answer(r.actor, r.params.id, r.body), 'Answer sent'));
router.post('/opportunities', read, ok((r) => opps.create(r.actor, r.body), 'Added to the review queue', 201));
router.get('/opportunities/:id', read, ok((r) => opps.get(r.actor, r.params.id)));
router.patch('/opportunities/:id', read, ok((r) => opps.update(r.actor, r.params.id, r.body), 'Saved'));
router.get('/opportunities/:id/eligibility', read, ok((r) => opps.eligibility(r.actor, r.params.id, r.query)));
router.post('/opportunities/:id/save', read, ok((r) => opps.save(r.actor, r.params.id, r.body), 'Saved'));
router.delete('/opportunities/:id/save', read, ok((r) => opps.unsave(r.actor, r.params.id, r.query), 'Removed'));
router.get('/opportunities/:id/calendar', read, ok((r) => opps.calendar(r.actor, r.params.id)));
router.post('/opportunities/:id/click', read, ok((r) => opps.click(r.actor, r.params.id)));
router.post('/opportunities/:id/ask', read, ok((r) => opps.ask(r.actor, r.params.id, r.body), 'Question sent', 201));
router.get('/editions', read, ok((r) => editions.list(r.actor, r.query)));
router.get('/editions/:id', read, ok((r) => editions.read(r.actor, r.params.id, r.query)));
router.post('/editions/:id/progress', read, ok((r) => editions.progress(r.actor, r.params.id, r.body)));
router.post('/editions/:id/quiz', read, ok((r) => editions.answerQuiz(r.actor, r.params.id, r.body), 'Quiz answered'));
router.post('/editions/:id/poll', read, ok((r) => editions.vote(r.actor, r.params.id, r.body), 'Vote counted'));
router.post('/editions/:id/react', read, ok((r) => editions.react(r.actor, r.params.id, r.body)));
router.post('/editions/:id/comments', read, ok((r) => editions.comment(r.actor, r.params.id, r.body), 'Comment received', 201));
router.post('/editions/:id/click/:opportunityId', read, ok((r) => editions.clickFromEdition(r.actor, r.params.id, r.params.opportunityId)));
router.get('/flashcards', read, ok((r) => editions.flashcardDeck(r.actor)));
router.post('/flashcards/review', read, ok((r) => editions.reviewCard(r.actor, r.body)));
router.get('/comments/pending', read, ok((r) => editions.pendingComments(r.actor)));
router.post('/comments/:id/moderate', read, ok((r) => editions.moderate(r.actor, r.params.id, r.body), 'Comment moderated'));

// Editor's desk
router.get('/settings', manage, ok(() => opps.getSettings()));
router.put('/settings', manage, ok((r) => opps.updateSettings(r.actor, r.body), 'Official sites saved'));
router.post('/opportunities/:id/review', manage, ok((r) => opps.review(r.actor, r.params.id, r.body), 'Decision recorded'));
router.post('/catalogue/import', manage, ok((r) => opps.importCatalogue(r.actor), 'Starter list added to the review queue'));
router.post('/feeds/scan', manage, ok(() => opps.scanFeeds(), 'Feeds scanned'));
router.post('/editions/generate', manage, ok(async (r) => {
  const out = await editions.generate({ cadence: r.body?.cadence, by: 'EDITOR', actor: r.actor, force: r.body?.force === true });
  return { ...out, edition: { id: String(out.edition._id), cadence: out.edition.cadence, periodKey: out.edition.periodKey, title: out.edition.title, status: out.edition.status } };
}, 'Draft ready'));
router.patch('/editions/:id', manage, ok((r) => editions.updateDraft(r.actor, r.params.id, r.body), 'Draft saved'));
router.post('/editions/:id/publish', manage, ok((r) => editions.publish(r.actor, r.params.id), 'Edition published'));
router.post('/editions/:id/withdraw', manage, ok((r) => editions.withdraw(r.actor, r.params.id, r.body), 'Edition withdrawn'));
router.get('/analytics', manage, ok((r) => editions.analytics(r.actor)));

export default router;

/**
 * The one public newsletter endpoint: one-click unsubscribe from the email
 * copy, by the reader's random token. Rate-limited; no sign-in; it can only
 * turn the email off.
 */
export const publicNewsletterRouter = Router({ mergeParams: true });
const unsubLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `nl-unsub:${req.ip}`,
  handler: (_req, res) => sendError(res, 'Too many requests, please try again later.', 429, [], 'RATE_LIMITED'),
});
const inSchool = asyncHandler(async (req, _res, next) => {
  const slug = String(req.params.school ?? '').toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new AppError('School not found', 404);
  const school = await School.findOne({ slug, status: 'ACTIVE' }).select('slug').lean();
  if (!school) throw new AppError('School not found', 404);
  return runWithTenant(school.slug, next);
});
publicNewsletterRouter.post('/:school/unsubscribe', unsubLimiter, inSchool, ok(async (r) => {
  if (!(await featureEnabled('newsletter'))) throw new AppError('Not found', 404);
  return opps.unsubscribeByToken(r.body?.token);
}, 'Unsubscribed'));
