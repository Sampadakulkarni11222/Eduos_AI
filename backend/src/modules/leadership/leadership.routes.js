import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as academics from './academics.service.js';
import * as boardPack from './boardpack.service.js';
import * as certificates from './certificates.service.js';
import { renderBoardPackPdf } from './pdf.js';

/**
 * @swagger
 * tags:
 *   - name: Leadership
 *     description: >
 *       Principal, administrator and trustee views built from existing records: school-wide
 *       attendance (classes, registers not taken today, students below 75%), teacher workload from
 *       the timetable, board packs (live or frozen versions with read receipts, PDF), and
 *       certificates generated from the student record with a no-dues check and a register of
 *       issued certificates.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const router = Router();
router.use(authenticate);

const office = requirePermission('students.manage', 'ALL');

router.get('/attendance-overview', requirePermission('attendance.read', 'ALL'), ok((r) => academics.attendanceOverview(r.actor, r.query)));
router.get('/workload', requirePermission('timetable.read', 'ALL'), ok((r) => academics.teacherWorkload(r.actor, r.query)));

router.get('/board-pack/:meetingId', requirePermission('governance.read'), ok((r) => boardPack.getPack(r.actor, r.scope, r.params.meetingId, { live: r.query.live === '1' || r.query.live === 'true' })));
router.post('/board-pack/:meetingId/freeze', requirePermission('governance.manage', 'ALL'), ok((r) => boardPack.freezePack(r.actor, r.params.meetingId, r.body), 'Board pack frozen for circulation', 201));
router.get('/board-pack/:meetingId/pdf', requirePermission('governance.read'), asyncHandler(async (req, res) => {
  const view = await boardPack.getPack(req.actor, req.scope, req.params.meetingId, { live: req.query.live === '1' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="board-pack-${String(view.pack.meeting.refNo).replace(/[^A-Za-z0-9-]/g, '-')}${view.version ? `-v${view.version}` : ''}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  renderBoardPackPdf(res, view);
}));

router.get('/certificates/register', office, ok((r) => certificates.register(r.query)));
router.get('/certificates/verify/:code', office, ok((r) => certificates.verify(r.params.code)));
router.get('/certificates/:requestId/clearance', office, ok((r) => certificates.clearance(r.actor, r.params.requestId)));
router.post('/certificates/:requestId/preview', office, ok((r) => certificates.preview(r.actor, r.params.requestId, r.body)));
router.post('/certificates/:requestId/generate', office, ok((r) => certificates.generate(r.actor, r.params.requestId, r.body), 'Certificate generated and attached', 201));

export default router;
