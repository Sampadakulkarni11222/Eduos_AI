import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as collections from './collections.service.js';
import * as people from './people.service.js';
import * as healthInsights from './healthInsights.service.js';

/**
 * @swagger
 * tags:
 *   - { name: FinanceReports, description: Collections by day, mode, cashier, fee head and class; day book; overdue ageing; reminders; audit flags; day-end cash close }
 *   - { name: Recruitment, description: Vacancies, candidates, interview scorecards, offer drafts and verification }
 *   - { name: Exits, description: Notice, department clearances, exit interview, full-and-final estimate and letters }
 *   - { name: HealthInsights, description: Nurse-only watch list (possible clusters, frequent visitors, immunisations due, screening coverage) and the register }
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
// Excel opens a UTF-8 CSV correctly (₹, Indian names) only with a byte-order mark.
const BOM = String.fromCharCode(0xfeff);
const csv = (fn) => asyncHandler(async (req, res) => {
  const out = await fn(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`${BOM}${out.csv}`);
});

export const financeReportsRouter = Router();
financeReportsRouter.use(authenticate);
const fRead = requirePermission('fees.read', 'ALL');
financeReportsRouter.get('/collections', fRead, ok((r) => collections.collectionReport(r.actor, r.query)));
financeReportsRouter.get('/day-book.csv', fRead, csv((r) => collections.dayBookCsv(r.actor, r.query)));
financeReportsRouter.get('/ageing', fRead, ok((r) => collections.ageing(r.actor, r.query)));
financeReportsRouter.get('/ageing.csv', fRead, csv((r) => collections.ageingCsv(r.actor, r.query)));
financeReportsRouter.get('/anomalies', fRead, ok((r) => collections.anomalies(r.actor, r.query)));
financeReportsRouter.post('/reminders/preview', fRead, ok(async (r) => { const { guardianIds: _g, ...rest } = await collections.reminderPreview(r.actor, r.body); return rest; }));
financeReportsRouter.post('/reminders/send', requirePermission('fees.manage', 'ALL'), ok((r) => collections.sendReminders(r.actor, r.body), 'Reminders sent'));
financeReportsRouter.get('/cash-close', fRead, ok((r) => collections.listCloses(r.actor, r.query)));
financeReportsRouter.get('/cash-close/expected', fRead, ok((r) => collections.expectedForDay(r.actor, r.query.day)));
financeReportsRouter.post('/cash-close', requirePermission('fees.pay', 'ALL'), ok((r) => collections.closeDay(r.actor, r.body), 'Day closed', 201));
financeReportsRouter.post('/cash-close/:id/check', requirePermission('fees.payments.approve', 'ALL'), ok((r) => collections.checkClose(r.actor, r.params.id, r.body), 'Count checked'));

export const recruitmentRouter = Router();
recruitmentRouter.use(authenticate);
const hr = requirePermission('org.manage', 'ALL');
recruitmentRouter.get('/vacancies', hr, ok((r) => people.listVacancies(r.actor, r.query)));
recruitmentRouter.post('/vacancies', hr, ok((r) => people.createVacancy(r.actor, r.body), 'Vacancy opened', 201));
recruitmentRouter.post('/vacancies/:id/status', hr, ok((r) => people.setVacancyStatus(r.actor, r.params.id, r.body), 'Vacancy updated'));
recruitmentRouter.get('/candidates', hr, ok((r) => people.listCandidates(r.actor, r.query)));
recruitmentRouter.post('/candidates', hr, ok((r) => people.addCandidate(r.actor, r.body), 'Candidate added', 201));
recruitmentRouter.get('/candidates/:id', hr, ok((r) => people.getCandidate(r.actor, r.params.id)));
recruitmentRouter.post('/candidates/:id/stage', hr, ok((r) => people.moveCandidate(r.actor, r.params.id, r.body), 'Stage updated'));
recruitmentRouter.post('/candidates/:id/scores', hr, ok((r) => people.scoreCandidate(r.actor, r.params.id, r.body), 'Scorecard saved'));
recruitmentRouter.post('/candidates/:id/offer', hr, ok((r) => people.draftOffer(r.actor, r.params.id, r.body), 'Offer drafted'));
recruitmentRouter.post('/candidates/:id/verification', hr, ok((r) => people.startCandidateVerification(r.actor, r.params.id, r.body), 'Verification started'));

export const exitsRouter = Router();
exitsRouter.use(authenticate);
exitsRouter.get('/', hr, ok((r) => people.listExits(r.actor, r.query)));
exitsRouter.post('/', hr, ok((r) => people.startExit(r.actor, r.body), 'Exit started', 201));
exitsRouter.get('/:id', hr, ok((r) => people.getExit(r.actor, r.params.id)));
exitsRouter.post('/:id/clearance', hr, ok((r) => people.updateClearance(r.actor, r.params.id, r.body), 'Clearance updated'));
exitsRouter.post('/:id/interview', hr, ok((r) => people.recordExitInterview(r.actor, r.params.id, r.body), 'Exit interview saved'));
exitsRouter.post('/:id/settlement', hr, requirePermission('payroll.sensitive.read', 'ALL'), ok((r) => people.settlementEstimate(r.actor, r.params.id, r.body), 'Settlement worked out'));
exitsRouter.post('/:id/settlement/payroll', hr, requirePermission('payroll.prepare', 'ALL'), ok((r) => people.sendSettlementToPayroll(r.actor, r.params.id), 'Put on a full-and-final payroll run'));
exitsRouter.get('/:id/letters', hr, ok((r) => people.exitLetters(r.actor, r.params.id, r.query)));
exitsRouter.post('/:id/close', hr, ok((r) => people.closeExit(r.actor, r.params.id, r.body), 'Exit closed'));

export const healthInsightsRouter = Router();
healthInsightsRouter.use(authenticate, requireFeature('healthRoom'));
const nurse = requirePermission('health.manage', 'ALL');
healthInsightsRouter.get('/', nurse, ok((r) => healthInsights.insights(r.actor, r.query)));
healthInsightsRouter.get('/register.csv', nurse, csv((r) => healthInsights.registerCsv(r.actor, r.query)));
