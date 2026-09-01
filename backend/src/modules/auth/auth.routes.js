import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import * as authController from './auth.controller.js';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Attach a new role-bound profile to an account (admin-driven onboarding)
 *     description: >
 *       Requires an authenticated caller holding `users.manage`. This endpoint
 *       mints profiles bound to any role, so leaving it public allowed anyone
 *       to self-issue an administrator profile and take over the tenant.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, roleKey]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string, example: "+919999999999" }
 *               email: { type: string }
 *               password: { type: string, description: "Optional â€” enables password login for this account" }
 *               roleKey: { type: string, example: TEACHER }
 *     responses:
 *       201:
 *         description: Profile registered
 */
router.post('/register', authenticate, requirePermission('users.manage'), authController.register);

/**
 * @swagger
 * /auth/otp/request:
 *   post:
 *     summary: Request a login OTP for a phone number (existing accounts only)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: "+919999999999" }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: >
 *           OTP sent (STAND-IN â€” no SMS provider configured; the code is
 *           logged server-side and echoed in the response as devOtp
 *           outside production only).
 *       404:
 *         description: PHONE_NOT_REGISTERED — no account exists for this phone number
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/otp/request', authRateLimiter, authController.requestOtp);

/**
 * @swagger
 * /auth/otp/email/request:
 *   post:
 *     summary: Request a login OTP by email (existing accounts only)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: OTP sent (devOtp echoed outside production)
 *       404:
 *         description: EMAIL_NOT_REGISTERED — no account exists for this email
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/otp/email/request', authRateLimiter, authController.requestEmailOtp);

/**
 * @swagger
 * /auth/otp/email/verify:
 *   post:
 *     summary: Verify an email OTP and start a session
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string }
 *               code: { type: string }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: OTP verified
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/otp/email/verify', authRateLimiter, authController.verifyEmailOtp);

/**
 * @swagger
 * /auth/google:
 *   post:
 *     summary: Sign in with a verified Google ID token (existing accounts only)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken: { type: string }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: Signed in
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/google', authRateLimiter, authController.googleLogin);

/**
 * @swagger
 * /auth/otp/verify:
 *   post:
 *     summary: Verify an OTP and start a session
 *     description: >
 *       Only profiles belonging to the school named by `schoolId` are
 *       considered (Super Admin profiles only when it is omitted), so an
 *       account with profiles in two schools signs in as the one whose door it
 *       used. If the account has exactly one such profile, returns a full session
 *       (accessToken + refreshToken + profile + permissions). If it has
 *       multiple, returns a pre-session accessToken plus the profile list â€”
 *       call /auth/profile/select next.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, code]
 *             properties:
 *               phone: { type: string }
 *               code: { type: string }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: OTP verified
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/otp/verify', authRateLimiter, authController.verifyOtp);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Password login for accounts with an email/password set (staff/admin)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *               schoolId: { type: string, example: nvmp, description: "The school door this request came through; omitted at the platform sign-in." }
 *     responses:
 *       200:
 *         description: Login successful
 *       403:
 *         description: WRONG_DOOR - the account has no profile this door admits
 */
router.post('/login', authRateLimiter, authController.login);

/**
 * @swagger
 * /auth/profile/select:
 *   post:
 *     summary: Select which profile a pre-session token should act as
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [profileId]
 *             properties: { profileId: { type: string } }
 *     responses:
 *       200:
 *         description: Profile selected
 */
router.post('/profile/select', authenticate, authController.selectProfile);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new access + refresh token pair
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties: { refreshToken: { type: string } }
 *     responses:
 *       200:
 *         description: Token refreshed
 */
router.post('/refresh', authRateLimiter, authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Revoke a refresh token (or every session on the account if none given)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties: { refreshToken: { type: string } }
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get the current profile and its resolved permissions
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current profile
 */
router.get('/me', authenticate, authController.me);

export default router;
