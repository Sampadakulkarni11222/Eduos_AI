import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as copies from './library.copies.js';

/**
 * @swagger
 * tags:
 *   name: LibraryCopies
 *   description: Accession numbers per copy, printable barcode labels, and scan-to-issue / scan-to-return for a keyboard-wedge scanner
 */
const router = Router();
router.use(authenticate);
const manage = requirePermission('library.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', manage, ok((r) => copies.listCopies(r.query)));
router.post('/generate', manage, ok((r) => copies.generateCopies(r.body), 'Accession numbers assigned', 201));
router.get('/labels', manage, ok((r) => copies.labels(r.query, r.actor)));
router.post('/labels/printed', manage, ok((r) => copies.markLabelsPrinted(r.body), 'Labels marked as printed'));
router.post('/scan', manage, ok((r) => copies.scan(r.body?.code)));
router.post('/scan/issue', manage, ok((r) => copies.scanIssue(r.body), 'Book issued', 201));
router.post('/scan/return', manage, ok((r) => copies.scanReturn(r.body), 'Book returned'));
router.patch('/:id', manage, ok((r) => copies.updateCopy(r.params.id, r.body), 'Copy updated'));

export default router;
