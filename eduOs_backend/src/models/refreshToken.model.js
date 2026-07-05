import { Schema, model } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    tokenHash: { type: String, required: true, unique: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null }, // active profile for this session
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);
refreshTokenSchema.index({ accountId: 1 });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
