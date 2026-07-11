import { Schema, model } from 'mongoose';

const otpCodeSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    codeHash: { type: String, required: true },
    purpose: { type: String, default: 'LOGIN' }, // LOGIN | WA_LINK | SENSITIVE_ROLE
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);
otpCodeSchema.index({ accountId: 1, purpose: 1 });

export const OtpCode = model('OtpCode', otpCodeSchema);
