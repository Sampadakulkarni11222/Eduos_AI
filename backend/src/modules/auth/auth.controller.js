import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { isValidEmail, isValidPhone } from '../../utils/validators.js';
import * as authService from './auth.service.js';

const sessionOpts = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

/**
 * The sign-in address the request came through, added to the credentials the
 * service checks.
 *
 * `/nvmp` sends `schoolId: "nvmp"`; the platform sign-in sends nothing, which
 * the service reads as the platform door. Omitting it is therefore no way past
 * the check — it only asks to be let in where platform administrators are.
 */
const withDoor = (req, fields) => ({
  ...fields,
  schoolId: req.body.schoolId ?? req.headers['x-school-id'] ?? null,
});

export const register = asyncHandler(async (req, res) => {
  const { account, profile } = await authService.register(req.body);
  sendSuccess(
    res,
    { accountId: account._id, profileId: profile._id, displayName: profile.displayName },
    'Profile registered',
    201
  );
});

export const requestOtp = asyncHandler(async (req, res) => {
  if (!req.body.phone) throw new AppError('phone is required', 400);
  if (!isValidPhone(req.body.phone)) {
    throw new AppError('Enter a valid phone number.', 400, [], 'INVALID_PHONE');
  }
  sendSuccess(res, await authService.requestOtp(withDoor(req, req.body)), 'OTP sent');
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) throw new AppError('phone and code are required', 400);
  if (!isValidPhone(phone)) throw new AppError('Enter a valid phone number.', 400, [], 'INVALID_PHONE');
  sendSuccess(res, await authService.verifyOtp(withDoor(req, { phone, code }), sessionOpts(req)), 'OTP verified');
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('email and password are required', 400);
  if (!isValidEmail(email)) throw new AppError('Enter a valid email address.', 400, [], 'INVALID_EMAIL');
  sendSuccess(res, await authService.login(withDoor(req, req.body), sessionOpts(req)), 'Login successful');
});

export const requestEmailOtp = asyncHandler(async (req, res) => {
  if (!req.body.email) throw new AppError('email is required', 400);
  if (!isValidEmail(req.body.email)) throw new AppError('Enter a valid email address.', 400, [], 'INVALID_EMAIL');
  sendSuccess(res, await authService.requestEmailOtp(withDoor(req, req.body)), 'OTP sent');
});

export const verifyEmailOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) throw new AppError('email and code are required', 400);
  if (!isValidEmail(email)) throw new AppError('Enter a valid email address.', 400, [], 'INVALID_EMAIL');
  sendSuccess(res, await authService.verifyEmailOtp(withDoor(req, { email, code }), sessionOpts(req)), 'OTP verified');
});

export const googleLogin = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.googleLogin(withDoor(req, req.body), sessionOpts(req)), 'Google sign-in successful');
});

export const selectProfile = asyncHandler(async (req, res) => {
  if (!req.body.profileId) throw new AppError('profileId is required', 400);
  sendSuccess(res, await authService.selectProfile(req.actor, req.body.profileId, sessionOpts(req)), 'Profile selected');
});

export const refresh = asyncHandler(async (req, res) => {
  if (!req.body.refreshToken) throw new AppError('refreshToken is required', 400);
  sendSuccess(res, await authService.refresh(req.body.refreshToken, sessionOpts(req)), 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.actor, req.body.refreshToken);
  sendSuccess(res, null, 'Logged out');
});

export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.me(req.actor), 'Current profile');
});
