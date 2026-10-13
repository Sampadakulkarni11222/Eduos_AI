import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as correspondence from './correspondence.service.js';
import * as facilities from './facility.service.js';
import * as events from './events.service.js';
import * as verification from './verification.service.js';
import * as compliance from '../compliance/compliance.service.js';
import * as accreditation from '../compliance/accreditation.service.js';
import * as safeguarding from '../compliance/safeguarding.service.js';
import * as governance from '../governance/governance.service.js';
import * as institution from '../institution/institution.service.js';

/**
 * Administration department, compliance, safeguarding, verification and
 * governance routes. Every route is gated by a permission key; services then
 * apply record-level scope (assigned items, membership, reporter-only).
 *
 * @swagger
 * tags:
 *   - { name: Correspondence, description: Inward/outward register, replies, approval, dispatch and acknowledgement }
 *   - { name: Facilities, description: Facilities register, room bookings and maintenance work orders }
 *   - { name: Events, description: Institutional events and agreements }
 *   - { name: Verification, description: Background verification of staff, drivers and vendors }
 *   - { name: Compliance, description: Obligations, regulatory returns, licences, policies, trainings and notices }
 *   - { name: Safeguarding, description: Restricted safeguarding concerns and statutory reporting record }
 *   - { name: Governance, description: Board and committee meetings, minutes, resolutions and actions }
 */

/** `ok(fn, message?, status?)` → an express handler that sends `await fn(req)`. */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

// ── Correspondence ────────────────────────────────────────────────────────
export const correspondenceRouter = Router();
correspondenceRouter.use(authenticate);
const cRead = requirePermission('correspondence.read');
const cManage = requirePermission('correspondence.manage');
correspondenceRouter.get('/', cRead, ok((r) => correspondence.list(r.actor, r.scope, r.query)));
correspondenceRouter.get('/stats', cRead, ok((r) => correspondence.stats(r.actor, r.scope)));
correspondenceRouter.post('/', cManage, ok((r) => correspondence.register(r.actor, r.body), 'Registered', 201));
correspondenceRouter.post('/extract', cRead, ok((r) => correspondence.extractTasks(r.body?.text, r.body?.receivedOn ? new Date(r.body.receivedOn) : new Date())));
correspondenceRouter.post('/reminders/run', cManage, ok((r) => correspondence.sendDueReminders(r.actor, { withinDays: Number(r.body?.withinDays) || 3 }), 'Reminders sent'));
correspondenceRouter.get('/:id', cRead, ok((r) => correspondence.get(r.actor, r.scope, r.params.id)));
correspondenceRouter.get('/:id/suggest', cRead, ok((r) => correspondence.suggest(r.actor, r.scope, r.params.id)));
correspondenceRouter.post('/:id/assign', cManage, ok((r) => correspondence.assign(r.actor, r.scope, r.params.id, r.body), 'Assigned'));
correspondenceRouter.post('/:id/verify-source', cRead, ok((r) => correspondence.verifySource(r.actor, r.scope, r.params.id, r.body), 'Source verified'));
correspondenceRouter.post('/:id/transition', cRead, ok((r) => correspondence.transition(r.actor, r.scope, r.params.id, r.body), 'Updated'));
correspondenceRouter.post('/:id/draft', cRead, ok((r) => correspondence.saveDraft(r.actor, r.scope, r.params.id, r.body), 'Draft saved'));
correspondenceRouter.post('/:id/submit', cRead, ok((r) => correspondence.submitForApproval(r.actor, r.scope, r.params.id, r.body), 'Sent for approval'));
correspondenceRouter.post('/:id/dispatch', cManage, ok((r) => correspondence.dispatch(r.actor, r.scope, r.params.id, r.body), 'Dispatched'));
correspondenceRouter.post('/:id/acknowledgement', cManage, ok((r) => correspondence.recordAcknowledgement(r.actor, r.scope, r.params.id, r.body), 'Acknowledgement recorded'));
correspondenceRouter.post('/:id/close', cRead, ok((r) => correspondence.close(r.actor, r.scope, r.params.id, r.body), 'Closed'));
correspondenceRouter.post('/:id/reminders', cRead, ok((r) => correspondence.addReminder(r.actor, r.scope, r.params.id, r.body), 'Reminder set'));
correspondenceRouter.post('/:id/legal-hold', cManage, ok((r) => correspondence.setLegalHold(r.actor, r.scope, r.params.id, r.body), 'Legal hold updated'));

// ── Facilities ────────────────────────────────────────────────────────────
export const facilitiesRouter = Router();
facilitiesRouter.use(authenticate);
const fRead = requirePermission('facilities.read');
const fReq = requirePermission('facilities.request');
const fManage = requirePermission('facilities.manage');
facilitiesRouter.get('/', fRead, ok((r) => facilities.listFacilities(r.actor, r.query)));
facilitiesRouter.get('/stats', fRead, ok(() => facilities.stats()));
facilitiesRouter.post('/', fManage, ok((r) => facilities.createFacility(r.body), 'Facility created', 201));
facilitiesRouter.post('/sample-campus', fManage, ok(async (r) => {
  const { institutionType } = await institution.terminology();
  return facilities.createSampleCampus({ institutionType: r.body?.institutionType ?? institutionType });
}, 'Sample campus created', 201));
facilitiesRouter.get('/bookings', fRead, ok((r) => facilities.listBookings(r.actor, r.query)));
facilitiesRouter.post('/bookings', fReq, ok((r) => facilities.requestBooking(r.actor, r.body), 'Booking requested', 201));
facilitiesRouter.post('/bookings/:id/decide', fManage, ok((r) => facilities.decideBooking(r.actor, r.params.id, r.body), 'Booking decided'));
facilitiesRouter.post('/bookings/:id/cancel', fReq, ok((r) => facilities.cancelBooking(r.actor, r.params.id), 'Booking cancelled'));
facilitiesRouter.get('/work-orders', fReq, ok((r) => facilities.listWorkOrders(r.actor, r.query)));
facilitiesRouter.post('/work-orders', fReq, ok((r) => facilities.reportIssue(r.actor, r.body), 'Issue reported', 201));
facilitiesRouter.patch('/work-orders/:id', fManage, ok((r) => facilities.updateWorkOrder(r.actor, r.params.id, r.body), 'Work order updated'));
facilitiesRouter.patch('/:id', fManage, ok((r) => facilities.updateFacility(r.params.id, r.body), 'Facility updated'));

// ── Events & agreements ───────────────────────────────────────────────────
export const eventsRouter = Router();
eventsRouter.use(authenticate);
const eRead = requirePermission('events.read');
eventsRouter.get('/', eRead, ok((r) => events.listEvents(r.actor, r.query)));
// Any staff member can propose an event; the approval engine decides it.
eventsRouter.post('/', requirePermission('approvals.submit'), ok((r) => events.proposeEvent(r.actor, r.body), 'Event proposed', 201));
eventsRouter.get('/:id', eRead, ok((r) => events.getEvent(r.actor, r.params.id)));
eventsRouter.patch('/:id', eRead, ok((r) => events.updateEvent(r.actor, r.params.id, r.body), 'Event updated'));
eventsRouter.post('/:id/submit', requirePermission('approvals.submit'), ok((r) => events.submitEvent(r.actor, r.params.id), 'Sent for approval'));
eventsRouter.post('/:id/move', eRead, ok((r) => events.moveEvent(r.actor, r.params.id, r.body), 'Event updated'));
eventsRouter.post('/:id/complete', eRead, ok((r) => events.completeEvent(r.actor, r.params.id, r.body), 'Event completed'));

export const contractsRouter = Router();
contractsRouter.use(authenticate);
contractsRouter.get('/', requirePermission('contracts.read'), ok((r) => events.listContracts(r.actor, r.query)));
contractsRouter.post('/', requirePermission('contracts.manage'), ok((r) => events.createContract(r.actor, r.body), 'Agreement created', 201));
contractsRouter.get('/:id', requirePermission('contracts.read'), ok((r) => events.getContract(r.actor, r.params.id)));
contractsRouter.patch('/:id', requirePermission('contracts.manage'), ok((r) => events.updateContract(r.actor, r.params.id, r.body), 'Agreement updated'));
contractsRouter.post('/:id/submit', requirePermission('contracts.manage'), ok((r) => events.submitContract(r.actor, r.params.id), 'Sent for approval'));

// ── Verification ──────────────────────────────────────────────────────────
export const verificationRouter = Router();
verificationRouter.use(authenticate);
const vRead = requirePermission('verification.read');
const vManage = requirePermission('verification.manage');
verificationRouter.get('/', vRead, ok((r) => verification.list(r.actor, r.query)));
verificationRouter.get('/stats', vRead, ok(() => verification.stats()));
verificationRouter.get('/clearance', vRead, ok((r) => verification.clearanceFor({ subjectProfileId: r.query.subjectProfileId, subjectName: r.query.subjectName, subjectType: r.query.subjectType })));
verificationRouter.post('/', vManage, ok((r) => verification.initiate(r.actor, r.body), 'Verification initiated', 201));
verificationRouter.get('/:id', vRead, ok((r) => verification.get(r.actor, r.params.id)));
verificationRouter.post('/:id/consent', vManage, ok((r) => verification.recordConsent(r.actor, r.params.id, r.body), 'Consent recorded'));
verificationRouter.post('/:id/checks/:checkId', vManage, ok((r) => verification.recordCheck(r.actor, r.params.id, r.params.checkId, r.body), 'Check recorded'));
verificationRouter.post('/:id/hr-review', vManage, ok((r) => verification.hrReview(r.actor, r.params.id, r.body), 'Sent for decision'));
verificationRouter.post('/:id/decide', requirePermission('verification.decide'), ok((r) => verification.decide(r.actor, r.params.id, r.body), 'Decision recorded'));
verificationRouter.post('/:id/dispute', vManage, ok((r) => verification.raiseDispute(r.actor, r.params.id, r.body), 'Dispute recorded'));
verificationRouter.post('/:id/dispute/resolve', requirePermission('verification.decide'), ok((r) => verification.resolveDispute(r.actor, r.params.id, r.body), 'Dispute resolved'));

// ── Compliance ────────────────────────────────────────────────────────────
export const complianceRouter = Router();
complianceRouter.use(authenticate);
const kRead = requirePermission('compliance.read');
const kManage = requirePermission('compliance.manage');
// Policies and trainings addressed to the caller: every signed-in person.
complianceRouter.get('/my/policies', ok((r) => compliance.myPolicies(r.actor)));
complianceRouter.post('/my/policies/:id/acknowledge', ok((r) => compliance.acknowledgePolicy(r.actor, r.params.id), 'Acknowledged'));
complianceRouter.get('/my/trainings', ok((r) => compliance.myTrainings(r.actor)));
complianceRouter.post('/my/trainings/:id/acknowledge', ok((r) => compliance.acknowledgeTraining(r.actor, r.params.id), 'Acknowledged'));

complianceRouter.get('/overview', kRead, ok(() => compliance.overview()));
complianceRouter.get('/calendar', kRead, ok((r) => compliance.calendar({ days: Math.min(Number(r.query.days) || 120, 730) })));
complianceRouter.get('/obligations', kRead, ok((r) => compliance.listObligations(r.query)));
complianceRouter.post('/obligations', kManage, ok((r) => compliance.createObligation(r.body), 'Obligation added', 201));
complianceRouter.post('/obligations/seed', kManage, ok(async (r) => {
  const { institutionType } = await institution.terminology();
  return compliance.seedCatalogue(r.actor, r.body?.institutionType ?? institutionType);
}, 'Catalogue loaded for review'));
complianceRouter.patch('/obligations/:id', kManage, ok((r) => compliance.reviewObligation(r.actor, r.params.id, r.body), 'Obligation updated'));

complianceRouter.get('/returns', kRead, ok((r) => compliance.listReturns(r.query)));
complianceRouter.post('/returns', kManage, ok((r) => compliance.createReturn(r.actor, r.body), 'Return generated', 201));
complianceRouter.get('/returns/:id', kRead, ok((r) => compliance.getReturn(r.params.id)));
complianceRouter.get('/returns/:id/export.csv', kRead, asyncHandler(async (req, res) => {
  const csv = await compliance.exportReturnCsv(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="return-${req.params.id}.csv"`);
  res.send(csv);
}));
complianceRouter.post('/returns/:id/regenerate', kManage, ok((r) => compliance.regenerateReturn(r.actor, r.params.id), 'Regenerated'));
complianceRouter.post('/returns/:id/data', kManage, ok((r) => compliance.editReturnData(r.actor, r.params.id, r.body), 'Figures updated'));
complianceRouter.post('/returns/:id/review', kManage, ok((r) => compliance.sendReturnForReview(r.actor, r.params.id, r.body), 'Sent for review'));
complianceRouter.post('/returns/:id/reviewed', kRead, ok((r) => compliance.reviewReturn(r.actor, r.params.id, r.body), 'Review recorded'));
complianceRouter.post('/returns/:id/submission', kManage, ok((r) => compliance.recordSubmission(r.actor, r.params.id, r.body), 'Submission recorded'));
complianceRouter.post('/returns/:id/outcome', kManage, ok((r) => compliance.recordOutcome(r.actor, r.params.id, r.body), 'Outcome recorded'));
complianceRouter.post('/returns/:id/reopen', kManage, ok((r) => compliance.reopenForResubmission(r.actor, r.params.id), 'Reopened'));

complianceRouter.get('/licences', kRead, ok((r) => compliance.listLicences(r.query)));
complianceRouter.post('/licences', kManage, ok((r) => compliance.createLicence(r.actor, r.body), 'Licence added', 201));
complianceRouter.patch('/licences/:id', kManage, ok((r) => compliance.updateLicence(r.actor, r.params.id, r.body), 'Licence updated'));

complianceRouter.get('/policies', kRead, ok(() => compliance.listPolicies()));
complianceRouter.post('/policies', kManage, ok((r) => compliance.createPolicy(r.actor, r.body), 'Policy created', 201));
complianceRouter.get('/policies/:id', kRead, ok((r) => compliance.getPolicy(r.params.id)));
complianceRouter.post('/policies/:id/versions', kManage, ok((r) => compliance.draftPolicyVersion(r.actor, r.params.id, r.body), 'Draft saved'));
complianceRouter.post('/policies/:id/submit', kManage, ok((r) => compliance.submitPolicy(r.actor, r.params.id, r.body), 'Sent for approval'));

complianceRouter.get('/trainings', kRead, ok((r) => compliance.listTrainings(r.query)));
complianceRouter.get('/trainings/coverage', kRead, ok(() => compliance.trainingCoverage()));
complianceRouter.post('/trainings', kManage, ok((r) => compliance.scheduleTraining(r.actor, r.body), 'Training scheduled', 201));
complianceRouter.post('/trainings/:id/attendance', kManage, ok((r) => compliance.recordTrainingAttendance(r.actor, r.params.id, r.body), 'Attendance recorded'));

// Accreditation preparation. Reading a cycle follows compliance.read and
// changing its structure follows compliance.manage. The two routes without a
// permission are for the person an evidence item is assigned to, who may hold
// neither: the service returns only their own items and lets them change only
// those.
complianceRouter.get('/accreditation/frameworks', kRead, ok(() => accreditation.frameworks()));
complianceRouter.get('/accreditation/mine', ok((r) => accreditation.myItems(r.actor)));
complianceRouter.get('/accreditation', kRead, ok(() => accreditation.listCycles()));
complianceRouter.post('/accreditation', kManage, ok((r) => accreditation.createCycle(r.actor, r.body), 'Accreditation cycle created', 201));
complianceRouter.get('/accreditation/:id', kRead, ok((r) => accreditation.getCycle(r.params.id)));
complianceRouter.post('/accreditation/:id/template-verified', kManage, ok((r) => accreditation.verifyTemplate(r.actor, r.params.id, r.body), 'Recorded'));
complianceRouter.post('/accreditation/:id/criteria', kManage, ok((r) => accreditation.addCriterion(r.actor, r.params.id, r.body), 'Criterion added', 201));
complianceRouter.post('/accreditation/:id/criteria/:criterionId/items', kManage, ok((r) => accreditation.addItem(r.actor, r.params.id, r.params.criterionId, r.body), 'Evidence item added', 201));
complianceRouter.patch('/accreditation/:id/items/:itemId', ok((r) => accreditation.updateItem(r.actor, r.params.id, r.params.itemId, r.body), 'Evidence item updated'));
complianceRouter.post('/accreditation/:id/submission', kManage, ok((r) => accreditation.recordSubmission(r.actor, r.params.id, r.body), 'Submission recorded'));
complianceRouter.post('/accreditation/:id/outcome', kManage, ok((r) => accreditation.recordOutcome(r.actor, r.params.id, r.body), 'Outcome recorded'));

complianceRouter.get('/notices', kRead, ok((r) => compliance.listNotices(r.query)));
complianceRouter.post('/notices', kManage, ok((r) => compliance.createNotice(r.actor, r.body), 'Notice recorded', 201));
complianceRouter.post('/notices/:id/decide', kManage, ok((r) => compliance.decideNotice(r.actor, r.params.id, r.body), 'Notice updated'));
complianceRouter.get('/notice-sources', kRead, ok(() => compliance.listNoticeSources()));
complianceRouter.post('/notice-sources', kManage, ok((r) => compliance.addNoticeSource(r.body), 'Source added', 201));
complianceRouter.post('/notice-sources/:id/check', kManage, ok((r) => compliance.checkNoticeSource(r.actor, r.params.id), 'Checked'));

// ── Safeguarding ──────────────────────────────────────────────────────────
export const safeguardingRouter = Router();
safeguardingRouter.use(authenticate);
safeguardingRouter.get('/guidance', ok(() => safeguarding.STATUTORY_GUIDANCE));
safeguardingRouter.post('/reports', requirePermission('safeguarding.report'), ok((r) => safeguarding.report(r.actor, r.body), 'Report received', 201));
safeguardingRouter.get('/reports/mine', requirePermission('safeguarding.report'), ok((r) => safeguarding.mine(r.actor)));
safeguardingRouter.get('/cases', requirePermission('safeguarding.manage'), ok((r) => safeguarding.list(r.actor, r.query)));
safeguardingRouter.get('/cases/:id', requirePermission('safeguarding.manage'), ok((r) => safeguarding.get(r.actor, r.params.id)));
safeguardingRouter.patch('/cases/:id', requirePermission('safeguarding.manage'), ok((r) => safeguarding.update(r.actor, r.params.id, r.body), 'Case updated'));

// ── Governance ────────────────────────────────────────────────────────────
export const governanceRouter = Router();
governanceRouter.use(authenticate);
const gRead = requirePermission('governance.read');
const gManage = requirePermission('governance.manage');
governanceRouter.get('/meetings', gRead, ok((r) => governance.list(r.actor, r.scope, r.query)));
governanceRouter.get('/actions', gRead, ok((r) => governance.openActions(r.actor, r.scope)));
governanceRouter.post('/meetings', gManage, ok((r) => governance.create(r.actor, r.body), 'Meeting created', 201));
governanceRouter.post('/reminders/run', gManage, ok((r) => governance.sendReminders(r.actor, { hours: Number(r.body?.hours) || 48 }), 'Reminders sent'));
governanceRouter.get('/meetings/:id', gRead, ok((r) => governance.get(r.actor, r.scope, r.params.id)));
governanceRouter.post('/meetings/:id/availability', gRead, ok((r) => governance.markAvailability(r.actor, r.scope, r.params.id, r.body), 'Availability saved'));
governanceRouter.post('/meetings/:id/rsvp', gRead, ok((r) => governance.rsvp(r.actor, r.scope, r.params.id, r.body), 'Response saved'));
governanceRouter.post('/meetings/:id/schedule', gManage, ok((r) => governance.schedule(r.actor, 'ALL', r.params.id, r.body), 'Scheduled'));
governanceRouter.post('/meetings/:id/agenda', gManage, ok((r) => governance.setAgenda(r.actor, 'ALL', r.params.id, r.body), 'Agenda saved'));
governanceRouter.post('/meetings/:id/record', gManage, ok((r) => governance.record(r.actor, 'ALL', r.params.id, r.body), 'Recorded'));
governanceRouter.post('/meetings/:id/minutes/approve', gRead, ok((r) => governance.approveMinutes(r.actor, r.scope, r.params.id), 'Minutes approved'));
governanceRouter.post('/meetings/:id/actions/:actionId', gRead, ok((r) => governance.updateAction(r.actor, r.scope, r.params.id, r.params.actionId, r.body), 'Action updated'));
governanceRouter.post('/meetings/:id/cancel', gManage, ok((r) => governance.cancel(r.actor, 'ALL', r.params.id, r.body), 'Cancelled'));
