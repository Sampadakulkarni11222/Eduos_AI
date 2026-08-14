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
 *     description: Returns total books, active issues, and overdue count
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
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
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Books fetched successfully
 *   post:
 *     summary: Add a new book to the catalog
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Book created successfully
 */
router.get('/books', requirePermission('library.read'), controller.listBooks);
router.post('/books', requirePermission('library.manage'), controller.createBook);
router.post('/books/bulk', requirePermission('library.manage'), csvUploadSingle('file'), controller.bulkCreateBooks);

/**
 * @swagger
 * /library/books/{id}:
 *   get:
 *     summary: Get a single book
 *     tags: [Library]
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
 *         description: Book fetched successfully
 *   patch:
 *     summary: Update a book record
 *     tags: [Library]
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
 *         description: Book updated successfully
 *   delete:
 *     summary: Soft-delete a book from the catalog
 *     tags: [Library]
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
 *         description: Book deleted successfully
 */
router.get('/books/:id', requirePermission('library.read'), controller.getBookById);
router.patch('/books/:id', requirePermission('library.manage'), controller.updateBook);
router.delete('/books/:id', requirePermission('library.manage'), controller.deleteBook);

/**
 * @swagger
 * /library/issues:
 *   get:
 *     summary: List lending records
 *     description: Filter by status, bookId, or borrowerProfileId
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Issues fetched successfully
 *   post:
 *     summary: Issue a book to a student
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Book issued successfully
 */
router.get('/issues', requirePermission('library.read'), controller.listIssues);
router.post('/issues', requirePermission('library.manage'), controller.issueBook);
router.post('/issues/bulk', requirePermission('library.manage'), csvUploadSingle('file'), controller.bulkIssueBooks);

/**
 * @swagger
 * /library/issues/{id}/return:
 *   patch:
 *     summary: Mark a lending record as returned
 *     tags: [Library]
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
 *         description: Book returned successfully
 */
router.patch('/issues/:id/return', requirePermission('library.manage'), controller.returnBook);

export default router;
