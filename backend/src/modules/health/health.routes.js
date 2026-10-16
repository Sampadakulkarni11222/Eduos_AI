import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as health from './health.service.js';

/**
 * @swagger
 * tags:
 *   - name: Health
 *     description: >
 *       The school health room: visits (complaint, vitals, action, time in/out, who attended), parent
 *       notification for the outcomes the school chose, medication plans with parent consent and the
 *       prescription, the medication administration record (controlled medicines countersigned by a
 *       second person), first-aid stock with expiry reminders, consent-gated care notes for the class
 *       teacher, immunisations, screenings and the annual health card. Every clinical field is encrypted
 *       at rest and every read of a child's record is audited. The health.* keys are restricted: the
 *       administrator does not hold them by default; the principal sees counts only.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('healthRoom'));
const read = requirePermission('health.read');
const manage = requirePermission('health.manage', 'ALL');
const witness = requirePermission('health.witness');
const careNotes = requirePermission('health.carenotes.read');
const counts = requirePermission('health.summary.read');

// Counts only (principal, administrator).
router.get('/summary', counts, ok((r) => health.summary(r.actor, r.query)));
// The class teacher's care notes: shared ones, own class only.
router.get('/class-care-notes', careNotes, ok((r) => health.classCareNotes(r.actor)));
// A parent's page.
router.get('/family', read, ok((r) => health.family(r.actor)));

// The nurse's desk.
router.get('/today', manage, ok((r) => health.today(r.actor)));
router.get('/students', manage, ok((r) => health.findStudents(r.actor, r.query)));
router.get('/settings', manage, ok(() => health.getSettings()));
router.put('/settings', manage, ok((r) => health.updateSettings(r.actor, r.body), 'Health room settings saved'));

router.get('/visits', read, ok((r) => health.listVisits(r.actor, r.query)));
router.post('/visits', manage, ok((r) => health.recordVisit(r.actor, r.body), 'Visit recorded', 201));
router.patch('/visits/:id', manage, ok((r) => health.updateVisit(r.actor, r.params.id, r.body), 'Visit updated'));

router.get('/plans', read, ok((r) => health.listPlans(r.actor, r.query)));
// The nurse drafts (waits for consent); a parent creates for their own child with the prescription and consent.
router.post('/plans', read, ok((r) => health.createPlan(r.actor, r.body), 'Medication plan saved', 201));
router.post('/plans/:id/consent', read, ok((r) => health.consentPlan(r.actor, r.params.id, r.body), 'Thank you, consent recorded'));
router.post('/plans/:id/stop', read, ok((r) => health.stopPlan(r.actor, r.params.id, r.body), 'Plan stopped'));

router.get('/doses/due', manage, ok((r) => health.dosesDue(r.actor, r.query)));
router.post('/doses', manage, ok((r) => health.recordDose(r.actor, r.body), 'Dose recorded', 201));
router.post('/doses/:id/countersign', witness, ok((r) => health.countersignDose(r.actor, r.params.id), 'Countersigned'));
router.get('/students/:studentId/medication-log', read, ok((r) => health.medicationLog(r.actor, r.params.studentId, r.query)));

router.get('/stock', manage, ok((r) => health.listStock(r.actor)));
router.post('/stock', manage, ok((r) => health.addStock(r.actor, r.body), 'Stock item added', 201));
router.patch('/stock/:id', manage, ok((r) => health.updateStock(r.actor, r.params.id, r.body), 'Stock updated'));

router.get('/care-notes', read, ok((r) => health.listCareNotes(r.actor, r.query)));
router.post('/care-notes', read, ok((r) => health.createCareNote(r.actor, r.body), 'Care note saved', 201));
router.post('/care-notes/:id/consent', read, ok((r) => health.setCareNoteConsent(r.actor, r.params.id, r.body), 'Sharing choice saved'));
router.post('/care-notes/:id/retire', read, ok((r) => health.retireCareNote(r.actor, r.params.id), 'Care note removed'));

router.get('/students/:studentId/entries', read, ok((r) => health.listEntries(r.actor, r.params.studentId, r.query)));
router.post('/entries', manage, ok((r) => health.addEntry(r.actor, r.body), 'Recorded', 201));
router.get('/students/:studentId/card', read, ok((r) => health.healthCard(r.actor, r.params.studentId, r.query)));

export default router;
