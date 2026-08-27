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
    // Password brute-force throttling — see login() in auth.service.js.
    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Account = model('Account', accountSchema);
