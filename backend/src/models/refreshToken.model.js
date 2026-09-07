import { Schema, model } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    tokenHash: { type: String, required: true, unique: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null }, // active profile for this session
    // The sign-in address this session came in through: a school slug, or null
    // for the platform door. Carried so a refresh re-issues a token pinned to
    // the same door. Deliberately without a default: a session created before
    // doors existed stores nothing here and stays unrestricted.
    door: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    /**
     * Set only when this token was spent by a *rotation* — never by a logout
     * or by reuse detection.
     *
     * The distinction matters because the two are revoked the same way but
     * mean opposite things. A token rotated a moment ago and presented again
     * is almost always a second tab that raced the first, and re-issuing is
     * correct. A token revoked by signing out and presented again is a dead
     * session, and must stay dead however recently it died.
     */
    rotatedAt: { type: Date, default: null },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);
refreshTokenSchema.index({ accountId: 1 });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
