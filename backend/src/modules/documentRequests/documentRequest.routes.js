import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permission.js';
import * as controller from './documentRequest.controller.js';

/**
 * Student document requests and the document types they are made against.
 *
 * Existing permission keys, no new ones:
 *   students.read (OWN) + STUDENT role   a student's own requests and documents
 *   students.manage at ALL scope         the school office: review, decide, issue
 *   settings.manage                      configuring document types
 *
 * A student holds neither office key, so approving, rejecting or uploading an
 * official document is refused before any service code runs.
 */

const student = [requirePermission('students.read'), requireRole('STUDENT')];
const office = requirePermission('students.manage', 'ALL');
const configure = requirePermission('settings.manage');

/**
 * @swagger
 * tags:
 *   name: Document Requests
 *   description: Students request school documents (any configured type); the office reviews, issues and versions them
 */

/* ── /document-requests ─────────────────────────────────────── */

export const requestRouter = Router();
requestRouter.use(authenticate);

/**
 * @swagger
 * /document-requests/mine/types:
 *   get:
 *     summary: Document types the signed-in student may request
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Requestable document types }
 * /document-requests/mine:
 *   get:
 *     summary: The signed-in student's own requests
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Requests }
 *   post:
 *     summary: Request a document
 *     tags: [Document Requests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documentTypeId, purpose]
 *             properties:
 *               documentTypeId: { type: string }
 *               purpose: { type: string }
 *               additionalInformation: { type: string }
 *               requiredBy: { type: string, format: date }
 *               fields: { type: object, description: "Answers keyed by the document type's field keys" }
 *     responses:
 *       201: { description: Request created }
 * /document-requests/mine/{id}:
 *   get:
 *     summary: One of the student's own requests
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Request }
 * /document-requests/mine/{id}/cancel:
 *   post:
 *     summary: Cancel a request that is still pending
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Cancelled }
 * /document-requests/mine/{id}/file:
 *   get:
 *     summary: Download the student's own issued document (first download completes the request)
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: The file }
 */
requestRouter.get('/mine/types', ...student, controller.requestableTypes);
requestRouter.get('/mine', ...student, controller.listMine);
requestRouter.post('/mine', ...student, controller.createRequest);
requestRouter.get('/mine/:id', ...student, controller.getMine);
requestRouter.post('/mine/:id/cancel', ...student, controller.cancelMine);
requestRouter.get('/mine/:id/file', ...student, controller.downloadMine);

/**
 * @swagger
 * /document-requests:
 *   get:
 *     summary: The school's document requests (filters — status, issued, documentTypeId, q, from, to)
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Requests }
 * /document-requests/{id}:
 *   get:
 *     summary: One request, with every issued version
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Request }
 * /document-requests/{id}/review:
 *   post:
 *     summary: PENDING → UNDER_REVIEW
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Under review }
 * /document-requests/{id}/approve:
 *   post:
 *     summary: PENDING / UNDER_REVIEW → APPROVED
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Approved }
 * /document-requests/{id}/reject:
 *   post:
 *     summary: PENDING / UNDER_REVIEW → REJECTED (reason required)
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Rejected }
 * /document-requests/{id}/issue:
 *   post:
 *     summary: Attach the official file (uploaded via POST /uploads); issues v1 or adds a new version
 *     tags: [Document Requests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileUrl]
 *             properties:
 *               fileUrl: { type: string }
 *               remarks: { type: string }
 *     responses:
 *       201: { description: Issued }
 * /document-requests/{id}/file:
 *   get:
 *     summary: Download an issued version (default latest; ?version=N)
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: The file }
 */
requestRouter.get('/', office, controller.listForSchool);
requestRouter.get('/:id', office, controller.getForSchool);
requestRouter.post('/:id/review', office, controller.review);
requestRouter.post('/:id/approve', office, controller.approve);
requestRouter.post('/:id/reject', office, controller.reject);
requestRouter.post('/:id/issue', office, controller.issue);
requestRouter.get('/:id/file', office, controller.downloadForSchool);

/* ── /document-types ────────────────────────────────────────── */

export const typeRouter = Router();
typeRouter.use(authenticate);

/**
 * @swagger
 * /document-types:
 *   get:
 *     summary: The school's document types
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Document types }
 *   post:
 *     summary: Create a document type
 *     tags: [Document Requests]
 *     responses:
 *       201: { description: Created }
 * /document-types/suggested:
 *   post:
 *     summary: Add the suggested document types the school does not have yet (as ordinary, editable types)
 *     tags: [Document Requests]
 *     responses:
 *       201: { description: Added }
 * /document-types/{id}:
 *   patch:
 *     summary: Edit, activate or deactivate a document type
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Delete a document type nobody has requested
 *     tags: [Document Requests]
 *     responses:
 *       200: { description: Deleted }
 */
typeRouter.get('/', configure, controller.listTypes);
typeRouter.post('/', configure, controller.createType);
typeRouter.post('/suggested', configure, controller.addSuggestedTypes);
typeRouter.patch('/:id', configure, controller.updateType);
typeRouter.delete('/:id', configure, controller.deleteType);
