import { Schema, model } from 'mongoose';

// Global identity, keyed by phone. NOT role-bound — see Profile for that.
// Staff/admins may also set a password; parents/students typically use OTP only.
const accountSchema = new Schema(
  {
    phoneE164: { type: String, required: true, unique: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    mfaSecret: { type: String, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    // Account-level login throttle: tracks consecutive failed password attempts.
    // Reset to 0 on a successful login. After MAX_FAILED_ATTEMPTS the account is
    // temporarily locked until lockUntil expires (no permanent lockout).
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Account = model('Account', accountSchema);
