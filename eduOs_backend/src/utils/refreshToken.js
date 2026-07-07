import crypto from 'crypto';

export const generateRefreshToken = () => crypto.randomBytes(40).toString('hex');

export const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
