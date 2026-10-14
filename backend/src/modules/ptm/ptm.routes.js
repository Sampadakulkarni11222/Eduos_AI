import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { requireAnyPermission } from './relations.js';
import * as ptm from './ptm.service.js';
import * as calls from './reviewcalls.service.js';

/**
 * @swagger
 * tags:
 *   - name: PTM
 *     description: Parent–teacher meeting rounds, teacher availability, family booking, waitlist, check-in and outcomes
 *   - name: ReviewCalls
 *     description: Parent review calls with attempts, private notes, agreed actions and follow-up
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const ptmRouter = Router();
ptmRouter.use(authenticate, requireFeature('ptm'));
const read = requirePermission('ptm.read');
const manage = requirePermission('ptm.manage');
const anyPtm = requireAnyPermission('ptm.read', 'ptm.manage', 'ptm.book');
const booker = requireAnyPermission('ptm.book', 'ptm.manage');
const staff = requireAnyPermission('ptm.manage', 'ptm.read');

ptmRouter.get('/rounds', read, ok((r) => ptm.listRounds(r.actor, r.scope, r.query)));
ptmRouter.post('/rounds', manage, ok((r) => ptm.createRound(r.actor, r.scope, r.body), 'PTM round created', 201));
ptmRouter.get('/rounds/:id', read, ok((r) => ptm.getRound(r.actor, r.scope, r.params.id)));
ptmRouter.patch('/rounds/:id', manage, ok((r) => ptm.updateRound(r.actor, r.scope, r.params.id, r.body)));
ptmRouter.post('/rounds/:id/cancel', manage, ok((r) => ptm.cancelRound(r.actor, r.scope, r.params.id, r.body), 'PTM round cancelled'));
ptmRouter.post('/rounds/:id/availability', manage, ok((r) => ptm.addAvailability(r.actor, r.scope, r.params.id, r.body), 'Availability added', 201));
ptmRouter.get('/rounds/:id/slots', manage, ok((r) => ptm.listSlots(r.actor, r.scope, r.params.id, r.query)));
ptmRouter.get('/rounds/:id/options', booker, ok((r) => ptm.bookingOptions(r.actor, r.scopes, r.params.id, r.query)));
ptmRouter.get('/rounds/:id/sheet', staff, ok((r) => ptm.meetingSheet(r.actor, r.scopes, r.params.id, r.query)));
ptmRouter.get('/rounds/:id/unbooked', manage, ok((r) => ptm.unbookedFamilies(r.actor, r.scopes ?? { 'ptm.manage': r.scope }, r.params.id, r.query)));
ptmRouter.post('/slots/:id/block', manage, ok((r) => ptm.blockSlot(r.actor, r.scope, r.params.id)));
ptmRouter.post('/slots/:id/unblock', manage, ok((r) => ptm.unblockSlot(r.actor, r.scope, r.params.id)));

ptmRouter.get('/bookings', anyPtm, ok((r) => ptm.myBookings(r.actor, r.scopes, r.query)));
ptmRouter.post('/bookings', booker, ok((r) => ptm.book(r.actor, r.scopes, r.body), 'Booked', 201));
ptmRouter.post('/bookings/:id/cancel', booker, ok((r) => ptm.cancelBooking(r.actor, r.scopes, r.params.id, r.body), 'Booking cancelled'));
ptmRouter.post('/bookings/:id/reschedule', booker, ok((r) => ptm.reschedule(r.actor, r.scopes, r.params.id, r.body), 'Booking moved'));
ptmRouter.post('/bookings/:id/check-in', manage, ok((r) => ptm.checkIn(r.actor, { 'ptm.manage': r.scope }, r.params.id)));
ptmRouter.post('/bookings/:id/no-show', manage, ok((r) => ptm.markNoShow(r.actor, { 'ptm.manage': r.scope }, r.params.id)));
ptmRouter.post('/bookings/:id/outcome', manage, ok((r) => ptm.recordOutcome(r.actor, { 'ptm.manage': r.scope }, r.params.id, r.body), 'Outcome recorded'));
ptmRouter.get('/bookings/:id/briefing', manage, ok((r) => ptm.briefing(r.actor, { 'ptm.manage': r.scope }, r.params.id)));

ptmRouter.post('/waitlist', booker, ok((r) => ptm.joinWaitlist(r.actor, r.scopes, r.body), 'Added to the waiting list', 201));
ptmRouter.post('/waitlist/:id/leave', booker, ok((r) => ptm.leaveWaitlist(r.actor, r.scopes, r.params.id)));
ptmRouter.post('/waitlist/:id/accept', booker, ok((r) => ptm.acceptOffer(r.actor, r.scopes, r.params.id, r.body), 'Booked', 201));

ptmRouter.get('/metrics', staff, ok((r) => ptm.metrics(r.actor, r.scopes, r.query)));

export const reviewCallsRouter = Router();
reviewCallsRouter.use(authenticate, requireFeature('ptm'));
const rc = requirePermission('reviewcalls.manage');
reviewCallsRouter.get('/', rc, ok((r) => calls.list(r.actor, r.scope, r.query)));
reviewCallsRouter.get('/metrics', rc, ok((r) => calls.metrics(r.actor, r.scope, r.query)));
reviewCallsRouter.post('/', rc, ok((r) => calls.create(r.actor, r.scope, r.body), 'Review call opened', 201));
reviewCallsRouter.get('/:id', rc, ok((r) => calls.get(r.actor, r.scope, r.params.id)));
reviewCallsRouter.patch('/:id', rc, ok((r) => calls.update(r.actor, r.scope, r.params.id, r.body)));
reviewCallsRouter.get('/:id/briefing', rc, ok((r) => calls.briefing(r.actor, r.scope, r.params.id)));
reviewCallsRouter.post('/:id/schedule', rc, ok((r) => calls.schedule(r.actor, r.scope, r.params.id, r.body)));
reviewCallsRouter.post('/:id/attempts', rc, ok((r) => calls.logAttempt(r.actor, r.scope, r.params.id, r.body), 'Attempt logged', 201));
reviewCallsRouter.post('/:id/notes', rc, ok((r) => calls.addNote(r.actor, r.scope, r.params.id, r.body), 'Note added', 201));
reviewCallsRouter.post('/:id/actions', rc, ok((r) => calls.addAction(r.actor, r.scope, r.params.id, r.body), 'Action agreed', 201));
reviewCallsRouter.post('/:id/actions/:actionId/complete', rc, ok((r) => calls.completeAction(r.actor, r.scope, r.params.id, r.params.actionId, r.body)));
reviewCallsRouter.post('/:id/close', rc, ok((r) => calls.close(r.actor, r.scope, r.params.id, r.body), 'Case closed'));
reviewCallsRouter.post('/:id/reopen', rc, ok((r) => calls.reopen(r.actor, r.scope, r.params.id, r.body), 'Case reopened'));
