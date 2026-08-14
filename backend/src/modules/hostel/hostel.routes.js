import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './hostel.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Hostel
 *   description: Hostel room management, allocations, and warden operations
 */

router.get('/summary', requirePermission('hostel.read'), controller.getSummary);

router.get('/rooms', requirePermission('hostel.read'), controller.listRooms);
router.post('/rooms', requirePermission('hostel.manage'), controller.createRoom);
router.post('/rooms/bulk', requirePermission('hostel.manage'), csvUploadSingle('file'), controller.bulkCreateRooms);

router.get('/rooms/:id', requirePermission('hostel.read'), controller.getRoomById);
router.patch('/rooms/:id', requirePermission('hostel.manage'), controller.updateRoom);

router.get('/allocations', requirePermission('hostel.read'), controller.listAllocations);
router.post('/allocations', requirePermission('hostel.manage'), controller.allocate);
router.post('/allocations/bulk', requirePermission('hostel.manage'), csvUploadSingle('file'), controller.bulkAllocate);

router.patch('/allocations/:id/vacate', requirePermission('hostel.manage'), controller.vacate);

router.get('/students', requirePermission('hostel.read'), controller.listHostelStudents);

router.get('/medical-lookup/:studentId', requirePermission('hostel.read'), controller.getMedicalRecord);

router.get('/inquiries', requirePermission('hostel.read'), controller.listInquiries);
router.post('/inquiries', requirePermission('hostel.read'), controller.createInquiry);
router.patch('/inquiries/:id', requirePermission('hostel.manage'), controller.updateInquiry);

// ─── Hostel Passes (Feature 12) ──────────────────────────────
router.post('/passes/apply', requirePermission('hostel.read'), controller.applyPass);
router.get('/passes/mine', requirePermission('hostel.read'), controller.listMyPasses);
router.get('/passes', requirePermission('hostel.read'), controller.listPasses);
router.patch('/passes/:id/parent-review', requirePermission('hostel.read'), controller.parentReviewPass);
router.patch('/passes/:id/review', requirePermission('hostel.manage'), controller.wardenReviewPass);
router.patch('/passes/:id/movement', requirePermission('hostel.manage'), controller.recordGateMovement);

export default router;
