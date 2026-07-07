import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import * as authController from './auth.controller.js';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Attach a new role-bound profile to an account (admin-driven onboarding)
 *     tags: [Auth]
 *     security: []
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
router.post('/register', authController.register);

/**
 * @swagger
 * /auth/otp/request:
 *   post:
 *     summary: Request a login OTP for a phone number (creates the account if new)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties: { phone: { type: string, example: "+919999999999" } }
 *     responses:
 *       200:
 *         description: >
 *           OTP sent (STAND-IN â€” no SMS provider configured; the code is
 *           logged server-side and echoed in the response as devOtp
 *           outside production only).
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
 *             properties: { email: { type: string } }
 *     responses:
 *       200:
 *         description: OTP sent if the email is registered (devOtp echoed outside production)
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
 *     responses:
 *       200:
 *         description: OTP verified
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
 *             properties: { idToken: { type: string } }
 *     responses:
 *       200:
 *         description: Signed in
 */
router.post('/google', authRateLimiter, authController.googleLogin);

/**
 * @swagger
 * /auth/otp/verify:
 *   post:
 *     summary: Verify an OTP and start a session
 *     description: >
 *       If the account has exactly one profile, returns a full session
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
 *     responses:
 *       200:
 *         description: OTP verified
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
 *     responses:
 *       200:
 *         description: Login successful
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
router.post('/refresh', authController.refresh);

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
