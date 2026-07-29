import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as ocr from './ocr.service.js';

/**
 * Register-photo attendance.
 *
 * Mounted separately from attendance.routes.js purely to keep this feature's
 * surface in one file. It sits behind `attendance.mark` — the same permission
 * the manual path needs — so the photo route can never be a softer way in.
 */
const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /attendance/ocr/draft:
 *   post:
 *     summary: Read a photo of a paper attendance register into a reviewable draft
 *     description: >
 *       Writes nothing. Transcribes the photo, matches rows against the real
 *       roster for that section, and returns high-confidence entries plus
 *       anything needing review. Only the high-confidence entries are attached
 *       to the returned confirmation token — confirm it via
 *       POST /ai/agent/confirm to actually write the attendance.
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sectionId, date, image]
 *             properties:
 *               sectionId: { type: string }
 *               date: { type: string, format: date }
 *               image: { type: string, description: "Base64 image data, with or without a data: URL prefix" }
 *               mediaType: { type: string, example: image/jpeg }
 *     responses:
 *       200:
 *         description: Draft produced (may still require review)
 *       501:
 *         description: OCR_NOT_CONFIGURED — no AI provider configured
 */
router.post(
  '/draft',
  requirePermission('attendance.mark'),
  asyncHandler(async (req, res) => {
    const { sectionId, date, image, mediaType } = req.body ?? {};
    if (!image) throw new AppError('An image of the register is required', 400);

    // Accept a data: URL as well as bare base64 — phone/browser clients
    // produce the former by default and stripping it client-side is easy to
    // forget.
    let data = String(image);
    let type = mediaType;
    const dataUrl = data.match(/^data:([\w/+-]+);base64,(.*)$/s);
    if (dataUrl) {
      type = type ?? dataUrl[1];
      data = dataUrl[2];
    }

    const draft = await ocr.draftFromRegisterPhoto(req.actor, req.scope, {
      sectionId,
      date,
      imageBase64: data,
      mediaType: type ?? 'image/jpeg',
    });

    sendSuccess(
      res,
      draft,
      draft.requiresReview
        ? 'Draft ready — some rows need your review before anything is saved'
        : 'Draft ready — confirm to save'
    );
  })
);

export default router;
