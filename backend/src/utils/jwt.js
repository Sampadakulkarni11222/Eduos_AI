import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// payload: { accountId, profileId | null } — profileId is null for a
// "pre-session" token issued when an account has multiple profiles and
// must call /auth/profile/select before doing anything else.
export const signAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN });

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_SECRET);
