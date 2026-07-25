import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './academics.controller.js';

const router = Router();
const manage = requirePermission('academics.structure.manage');

router.use(authenticate);

// ── Academic Years ──
router.get('/years', controller.listYears);
router.post('/years', manage, controller.createYear);

// ── Terms ──
router.get('/terms', controller.listTerms);
router.post('/terms', manage, controller.createTerm);

// ── Grades ──
router.get('/grades', controller.listGrades);
router.post('/grades', manage, controller.createGrade);
router.post('/grades/bulk', manage, csvUploadSingle('file'), controller.bulkCreateGrades);

// ── Sections ──
// /sections/mine MUST come before /sections to prevent route conflict
router.get('/sections/mine', controller.mySections);
router.get('/sections', controller.listSections);
router.post('/sections', manage, controller.createSection);
router.post('/sections/bulk', manage, csvUploadSingle('file'), controller.bulkCreateSections);

// ── Subjects ──
router.get('/subjects', controller.listSubjects);
router.post('/subjects', manage, controller.createSubject);
router.post('/subjects/bulk', manage, csvUploadSingle('file'), controller.bulkCreateSubjects);

// ── Subject Offerings ──
// /offerings/mine MUST come before /offerings
router.get('/offerings/mine', controller.myOfferings);
router.get('/offerings', controller.listOfferings);
router.post('/offerings', manage, controller.createOffering);

export default router;
