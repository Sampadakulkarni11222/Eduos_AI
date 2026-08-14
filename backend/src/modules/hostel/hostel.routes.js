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

/**
 * @swagger
 * /hostel/summary:
 *   get:
 *     summary: Hostel dashboard summary
 *     description: Returns total rooms, occupied beds, inquiries, and maintenance count
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary fetched successfully
 */
router.get('/summary', requirePermission('hostel.read'), controller.getSummary);

/**
 * @swagger
 * /hostel/rooms:
 *   get:
 *     summary: List all hostel rooms with occupancy
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rooms fetched successfully
 *   post:
 *     summary: Create a hostel room
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Room created successfully
 */
router.get('/rooms', requirePermission('hostel.read'), controller.listRooms);
router.post('/rooms', requirePermission('hostel.manage'), controller.createRoom);
router.post('/rooms/bulk', requirePermission('hostel.manage'), csvUploadSingle('file'), controller.bulkCreateRooms);

/**
 * @swagger
 * /hostel/rooms/{id}:
 *   get:
 *     summary: Get a single hostel room
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Room fetched successfully
 *   patch:
 *     summary: Update a hostel room
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Room updated successfully
 */
router.get('/rooms/:id', requirePermission('hostel.read'), controller.getRoomById);
router.patch('/rooms/:id', requirePermission('hostel.manage'), controller.updateRoom);

/**
 * @swagger
 * /hostel/allocations:
 *   get:
 *     summary: List room allocations
 *     description: Returns active allocations by default
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Allocations fetched successfully
 *   post:
 *     summary: Allocate a student to a room
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Student allocated successfully
 */
router.get('/allocations', requirePermission('hostel.read'), controller.listAllocations);
router.post('/allocations', requirePermission('hostel.manage'), controller.allocate);
router.post('/allocations/bulk', requirePermission('hostel.manage'), csvUploadSingle('file'), controller.bulkAllocate);

/**
 * @swagger
 * /hostel/allocations/{id}/vacate:
 *   patch:
 *     summary: Mark an allocation as vacated
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student vacated successfully
 */
router.patch('/allocations/:id/vacate', requirePermission('hostel.manage'), controller.vacate);

/**
 * @swagger
 * /hostel/students:
 *   get:
 *     summary: List all current hostel residents with room info
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hostel students fetched successfully
 */
router.get('/students', requirePermission('hostel.read'), controller.listHostelStudents);

/**
 * @swagger
 * /hostel/medical-lookup/{studentId}:
 *   get:
 *     summary: Emergency medical lookup for a hostel student
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Medical record fetched successfully
 */
router.get('/medical-lookup/:studentId', requirePermission('hostel.read'), controller.getMedicalRecord);

/**
 * @swagger
 * /hostel/inquiries:
 *   get:
 *     summary: List hostel inquiries and maintenance requests
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inquiries fetched successfully
 *   post:
 *     summary: Create a new hostel inquiry
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Inquiry created successfully
 */
router.get('/inquiries', requirePermission('hostel.read'), controller.listInquiries);
router.post('/inquiries', requirePermission('hostel.read'), controller.createInquiry);

/**
 * @swagger
 * /hostel/inquiries/{id}:
 *   patch:
 *     summary: Update inquiry status
 *     description: Set status to resolved or in-progress
 *     tags: [Hostel]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inquiry updated successfully
 */
router.patch('/inquiries/:id', requirePermission('hostel.manage'), controller.updateInquiry);

export default router;
