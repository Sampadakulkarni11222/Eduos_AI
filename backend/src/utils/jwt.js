import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// payload: { accountId, profileId | null } — profileId is null for a
// "pre-session" token issued when an account has multiple profiles and
// must call /auth/profile/select before doing anything else.
// The algorithm is pinned on both sides so a token can only ever be validated
// the way it was issued — never inferred from the token's own header.
const ALGORITHM = 'HS256';

export const signAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
    algorithm: ALGORITHM,
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
