import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { AppError } from '../../utils/AppError.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './library.controller.js';

const router = Router();
router.use(authenticate);

/**
 * `library.read`, or a parent reading on behalf of their own children.
 *
 * The parent portal has a Library page, but the PARENT role was never granted
 * `library.read`, so /library/books and /library/issues answered 403 and the
 * page showed "No books matched". A parent who can read their children's
 * records (`students.read`) is let through at OWN scope, never ALL: the
 * service then narrows lending records to the linked children
 * (resolveOwnBorrowerIds), whatever studentId the caller sends. The proper
 * long-term fix is a `library.read: OWN` grant on PARENT in permissions.js;
 * once that exists, the first branch handles parents and this fallback is inert.
 */
const libraryRead = (req, res, next) => {
  if (req.actor?.permissions?.['library.read']) return requirePermission('library.read')(req, res, next);
  if (req.actor?.roleKey === 'PARENT' && req.actor?.permissions?.['students.read']) {
    req.scope = 'OWN';
    return next();
  }
  throw new AppError('Missing permission: library.read', 403);
};

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
router.get('/books', libraryRead, controller.listBooks);
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
/**
 * @swagger
 * /library/books/facets:
 *   get:
 *     summary: Distinct categories, authors and resource types in the catalog
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Filters fetched successfully
 */
// Declared before /books/:id so "facets" is not read as a book id.
router.get('/books/facets', libraryRead, controller.listBookFacets);

router.get('/books/:id', libraryRead, controller.getBookById);
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
router.get('/issues', libraryRead, controller.listIssues);
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


// ── Book requests ──
// A student asks for a copy; a librarian holding library.manage decides, and
// the approval is what issues the book. `library.request` is deliberately a
// separate permission from `library.read`: browsing the catalogue and asking
// for something off it are different acts, and only the second writes a record.

/**
 * @swagger
 * /library/requests/mine:
 *   get:
 *     summary: The signed-in student's own book requests
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your book requests fetched
 */
router.get('/requests/mine', requirePermission('library.request'), controller.listMyBookRequests);

/**
 * @swagger
 * /library/requests/review:
 *   get:
 *     summary: The librarian's review queue of book requests
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED, ALL]
 *     responses:
 *       200:
 *         description: Book requests fetched
 */
router.get('/requests/review', requirePermission('library.manage'), controller.listBookRequestsForReview);

/**
 * @swagger
 * /library/requests:
 *   post:
 *     summary: Ask for a book to be issued (created as PENDING for a librarian)
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookId]
 *             properties:
 *               bookId: { type: string }
 *     responses:
 *       201:
 *         description: Request submitted for approval
 *       409:
 *         description: You already have a request for this book
 */
router.post('/requests', requirePermission('library.request'), controller.requestBook);

/**
 * @swagger
 * /library/requests/{id}/cancel:
 *   patch:
 *     summary: Withdraw your own pending book request
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
 *         description: Request cancelled
 */
router.patch('/requests/:id/cancel', requirePermission('library.request'), controller.cancelBookRequest);

/**
 * @swagger
 * /library/requests/{id}/decision:
 *   patch:
 *     summary: Approve or reject a book request (approval issues the book)
 *     tags: [Library]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [APPROVED, REJECTED] }
 *               note: { type: string }
 *               dueAt: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Request decided
 *       409:
 *         description: Already decided, or no copies are available
 */
router.patch('/requests/:id/decision', requirePermission('library.manage'), controller.decideBookRequest);

export default router;
