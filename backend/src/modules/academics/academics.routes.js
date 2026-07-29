import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './academics.controller.js';

const router = Router();
const manage = requirePermission('academics.structure.manage');

/**
 * School-wide structure reads were authenticated but ungated, so any signed-in
 * user — including a parent or student — could enumerate every grade, section,
 * subject and teaching assignment in the school. Low sensitivity individually,
 * but it is roster metadata a family has no reason to hold, so it now needs an
 * explicit staff permission.
 *
 * The `/mine` endpoints below stay open to any authenticated user on purpose:
 * they return only the caller's own sections/offerings and are what the
 * student, parent and teacher portals actually use.
 */
const read = requirePermission('academics.read');

router.use(authenticate);

// ── Academic Years ──
router.get('/years', read, controller.listYears);
router.post('/years', manage, controller.createYear);

// ── Terms ──
router.get('/terms', read, controller.listTerms);
router.post('/terms', manage, controller.createTerm);

// ── Grades ──
router.get('/grades', read, controller.listGrades);
router.post('/grades', manage, controller.createGrade);
router.post('/grades/bulk', manage, csvUploadSingle('file'), controller.bulkCreateGrades);

// ── Sections ──
// /sections/mine MUST come before /sections to prevent route conflict
router.get('/sections/mine', controller.mySections);
router.get('/sections', read, controller.listSections);
router.post('/sections', manage, controller.createSection);
router.patch('/sections/:id', manage, controller.updateSection);
router.post('/sections/bulk', manage, csvUploadSingle('file'), controller.bulkCreateSections);

// ── Subjects ──
router.get('/subjects', read, controller.listSubjects);
router.post('/subjects', manage, controller.createSubject);
router.post('/subjects/bulk', manage, csvUploadSingle('file'), controller.bulkCreateSubjects);

// ── Subject Offerings ──
// /offerings/mine MUST come before /offerings
router.get('/offerings/mine', controller.myOfferings);
router.get('/offerings', read, controller.listOfferings);
router.post('/offerings', manage, controller.createOffering);

export default router;
