import crypto from 'crypto';

export const generateOtp = () => String(crypto.randomInt(100000, 1000000)); // 6 digits

export const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');
