import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './library.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Library
 *   description: Book catalog and lending management
 */

/**
 * @swagger
 * /library/summary:
 *   get:
 *     summary: Library dashboard summary
 *     tags: [Library]
 *     responses:
 *       200:
 *         description: Summary fetched successfully
 */
router.get('/summary', requirePermission('library.read'), controller.getSummary);

/**
 * @swagger
 * /library/books:
 *   get:
 *     summary: List the book catalog
 *     tags: [Library]
 *     responses:
 *       200:
 *         description: Books fetched successfully
 */
router.get('/books', requirePermission('library.read'), controller.listBooks);
router.post('/books', requirePermission('library.manage'), controller.createBook);
router.post('/books/bulk', requirePermission('library.manage'), csvUploadSingle('file'), controller.bulkCreateBooks);

router.get('/books/:id', requirePermission('library.read'), controller.getBookById);
router.patch('/books/:id', requirePermission('library.manage'), controller.updateBook);
router.delete('/books/:id', requirePermission('library.manage'), controller.deleteBook);

/**
 * @swagger
 * /library/issues:
 *   get:
 *     summary: List lending records
 *     tags: [Library]
 *     responses:
 *       200:
 *         description: Issues fetched successfully
 */
router.get('/issues', requirePermission('library.read'), controller.listIssues);
router.get('/issues/overdue', requirePermission('library.read'), controller.listOverdue);
router.post('/reminders/process', requirePermission('library.manage'), controller.processReminders);
router.post('/issues', requirePermission('library.manage'), controller.issueBook);
router.post('/issues/bulk', requirePermission('library.manage'), csvUploadSingle('file'), controller.bulkIssueBooks);

/**
 * @swagger
 * /library/issues/{id}/return:
 *   patch:
 *     summary: Mark a lending record as returned
 *     tags: [Library]
 *     responses:
 *       200:
 *         description: Book returned successfully
 */
router.patch('/issues/:id/return', requirePermission('library.manage'), controller.returnBook);

// ─── Reservations ───────────────────────────────────────────
router.post('/reservations', requirePermission('library.read'), controller.createReservation);
router.get('/reservations/mine', requirePermission('library.read'), controller.listMyReservations);
router.get('/reservations', requirePermission('library.read'), controller.listReservations);
router.get('/reservations/:id', requirePermission('library.read'), controller.getReservationById);
router.patch('/reservations/:id/cancel', requirePermission('library.read'), controller.cancelReservation);
router.patch('/reservations/:id/fulfill', requirePermission('library.manage'), controller.fulfillReservation);

export default router;
