import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './profile.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Profiles
 *   description: All role-bound profiles linked to the current account
 */

/**
 * @swagger
 * /profiles:
 *   get:
 *     summary: List every profile linked to the current account (for the profile switcher)
 *     tags: [Profiles]
 *     responses:
 *       200:
 *         description: Profiles fetched
 */
router.get('/', authenticate, controller.list);

export default router;
