import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { School } from '../../models/school.model.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import * as community from './community.service.js';
import * as marketing from '../marketing/marketing.service.js';

/**
 * @swagger
 * tags:
 *   - { name: Community, description: Newsroom, circles, moderation, media consent and mentoring }
 *   - { name: Marketing, description: Campaigns, creative assets, capacity, seat offers, counselling and enrolment analytics }
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const communityRouter = Router();
// The public newsroom of a school: PUBLIC posts with PUBLIC-consented media only.
communityRouter.get('/public/:slug', asyncHandler(async (req, res) => {
  const slug = String(req.params.slug ?? '').toLowerCase().trim();
  if (!(await School.exists({ slug, status: 'ACTIVE' }))) throw new AppError('Not found', 404);
  sendSuccess(res, await runWithTenant(slug, () => community.publicFeed(req.query)));
}));
communityRouter.use(authenticate);
const cRead = requirePermission('community.read');
const cPost = requirePermission('community.post');
const cMod = requirePermission('community.moderate');
communityRouter.get('/feed', cRead, ok((r) => community.feed(r.actor, r.query)));
communityRouter.post('/posts', cPost, ok((r) => community.createPost(r.actor, r.body), 'Saved', 201));
communityRouter.get('/posts/:id', cRead, ok((r) => community.getPost(r.actor, r.params.id)));
communityRouter.patch('/posts/:id', cPost, ok((r) => community.updatePost(r.actor, r.params.id, r.body), 'Saved'));
communityRouter.delete('/posts/:id', cPost, ok((r) => community.withdrawPost(r.actor, r.params.id), 'Withdrawn'));
communityRouter.post('/posts/:id/submit', cPost, ok((r) => community.submitPost(r.actor, r.params.id), 'Submitted'));
communityRouter.post('/posts/:id/moderate', cRead, ok((r) => community.moderatePost(r.actor, r.params.id, r.body), 'Updated'));
communityRouter.post('/posts/:id/react', cRead, ok((r) => community.react(r.actor, r.params.id, r.body)));
communityRouter.post('/posts/:id/bookmark', cRead, ok((r) => community.bookmark(r.actor, r.params.id)));
communityRouter.post('/posts/:id/comments', cRead, ok((r) => community.comment(r.actor, r.params.id, r.body), 'Comment saved', 201));
// Circle moderators review comments in their circles, so the service decides who may.
communityRouter.get('/comments/pending', cRead, ok((r) => community.pendingComments(r.actor)));
communityRouter.post('/comments/:id/moderate', cRead, ok((r) => community.moderateComment(r.actor, r.params.id, r.body), 'Updated'));
communityRouter.patch('/comments/:id', cRead, ok((r) => community.editComment(r.actor, r.params.id, r.body), 'Comment saved'));
communityRouter.delete('/comments/:id', cRead, ok((r) => community.deleteComment(r.actor, r.params.id), 'Comment deleted'));
communityRouter.post('/reports', cRead, ok((r) => community.report(r.actor, r.body), 'Reported', 201));
communityRouter.get('/reports', cMod, ok((r) => community.listReports(r.actor)));
communityRouter.post('/reports/:id/resolve', cMod, ok((r) => community.resolveReport(r.actor, r.params.id, r.body), 'Resolved'));
communityRouter.post('/events/:id/highlight', requirePermission('events.read'), cPost, ok((r) => community.draftFromEvent(r.actor, r.params.id), 'Draft created', 201));
communityRouter.get('/circles', cRead, ok((r) => community.listCircles(r.actor)));
communityRouter.post('/circles', cPost, ok((r) => community.createCircle(r.actor, r.body), 'Circle created', 201));
communityRouter.post('/circles/:id/join', cRead, ok((r) => community.joinCircle(r.actor, r.params.id)));
communityRouter.post('/circles/:id/leave', cRead, ok((r) => community.leaveCircle(r.actor, r.params.id), 'Left the circle'));
communityRouter.post('/circles/:id/members', cRead, ok((r) => community.manageMember(r.actor, r.params.id, r.body), 'Updated'));
communityRouter.get('/students', cPost, ok((r) => community.taggableStudents(r.actor, r.query)));
communityRouter.get('/consents', ok((r) => community.myConsents(r.actor)));
communityRouter.post('/consents', ok((r) => community.setConsent(r.actor, r.body), 'Consent saved'));
const mentor = requirePermission('mentoring.participate');
communityRouter.get('/mentors', cRead, ok((r) => community.listMentors(r.actor, r.query)));
communityRouter.put('/mentors/me', mentor, ok((r) => community.upsertMentorProfile(r.actor, r.body), 'Profile saved'));
communityRouter.post('/mentors/:id/verify', cMod, ok((r) => community.verifyMentor(r.actor, r.params.id), 'Verified'));
communityRouter.get('/mentoring', cRead, ok((r) => community.myMentoring(r.actor)));
communityRouter.post('/mentoring', mentor, ok((r) => community.requestMentoring(r.actor, r.body), 'Request sent', 201));
communityRouter.post('/mentoring/:id', cRead, ok((r) => community.respondMentoring(r.actor, r.params.id, r.body), 'Updated'));

export const marketingRouter = Router();
marketingRouter.use(authenticate);
const mRead = requirePermission('marketing.read');
const mMan = requirePermission('marketing.manage');
const aRead = requirePermission('admissions.read');
const aMan = requirePermission('admissions.manage');
// Aggregate funnel and capacity figures carry no enquiry details, so marketing.read is enough.
marketingRouter.get('/analytics', mRead, ok((r) => marketing.analytics(r.query)));
marketingRouter.get('/campaigns', mRead, ok(() => marketing.listCampaigns()));
marketingRouter.post('/campaigns', mMan, ok((r) => marketing.createCampaign(r.actor, r.body), 'Campaign created', 201));
marketingRouter.patch('/campaigns/:id', mMan, ok((r) => marketing.updateCampaign(r.actor, r.params.id, r.body), 'Campaign updated'));
marketingRouter.get('/assets/sizes', mRead, ok(() => marketing.assetSizes()));
marketingRouter.get('/assets', mRead, ok((r) => marketing.listAssets(r.query)));
marketingRouter.post('/assets', mMan, ok((r) => marketing.createAsset(r.actor, r.body), 'Asset created', 201));
marketingRouter.patch('/assets/:id', mRead, ok((r) => {
  // Reviewing/approving an asset is marketing.manage or the principal's moderation authority.
  if (!r.actor.permissions['marketing.manage'] && !r.actor.permissions['community.moderate']) throw new AppError('Missing permission: marketing.manage', 403);
  return marketing.updateAsset(r.actor, r.params.id, r.body);
}, 'Asset updated'));
marketingRouter.patch('/leads/:id', aMan, ok((r) => marketing.updateLeadMarketing(r.actor, r.params.id, r.body), 'Enquiry updated'));
marketingRouter.get('/leads/duplicates', aRead, ok(() => marketing.duplicateLeads()));
marketingRouter.get('/capacity', mRead, ok((r) => marketing.listCapacity(r.query)));
marketingRouter.put('/capacity', aMan, ok((r) => marketing.setCapacity(r.actor, r.body), 'Capacity saved'));
marketingRouter.get('/offers', aRead, ok((r) => marketing.listOffers(r.query)));
marketingRouter.post('/offers', aMan, ok((r) => marketing.offerSeat(r.actor, r.body), 'Offer recorded', 201));
marketingRouter.post('/offers/:id', aMan, ok((r) => marketing.moveOffer(r.actor, r.params.id, r.body), 'Offer updated'));
marketingRouter.get('/appointments', aRead, ok((r) => marketing.listAppointments(r.actor, r.query)));
marketingRouter.post('/appointments', aMan, ok((r) => marketing.bookAppointment(r.actor, r.body), 'Appointment booked', 201));
marketingRouter.patch('/appointments/:id', aMan, ok((r) => marketing.updateAppointment(r.actor, r.params.id, r.body), 'Appointment updated'));
