import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as authService from './auth.service.js';

const sessionOpts = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

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
  sendSuccess(res, await authService.requestOtp(req.body), 'OTP sent');
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) throw new AppError('phone and code are required', 400);
  sendSuccess(res, await authService.verifyOtp({ phone, code }, sessionOpts(req)), 'OTP verified');
});

export const login = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.login(req.body, sessionOpts(req)), 'Login successful');
});

export const requestEmailOtp = asyncHandler(async (req, res) => {
  if (!req.body.email) throw new AppError('email is required', 400);
  sendSuccess(res, await authService.requestEmailOtp(req.body), 'OTP sent');
});

export const verifyEmailOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) throw new AppError('email and code are required', 400);
  sendSuccess(res, await authService.verifyEmailOtp({ email, code }, sessionOpts(req)), 'OTP verified');
});

export const googleLogin = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.googleLogin(req.body, sessionOpts(req)), 'Google sign-in successful');
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
