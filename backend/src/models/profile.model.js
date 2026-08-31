import { Schema, model } from 'mongoose';

// The actor. Every authenticated action happens AS a profile, not an account —
// one account (one phone number) can hold several profiles (e.g. a PARENT
// profile and a TEACHER profile simultaneously).
const profileSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    displayName: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    tenantId: { type: String, default: 'eduos-demo-tenant' },
    tenantName: { type: String, default: 'EduOS AI Academy' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
profileSchema.index({ accountId: 1, roleId: 1 }, { unique: true });
// Profile is deliberately not tenant-scoped — sign-in has to find an account
// before any school is known — so administrative reads filter by tenantId
// explicitly (see utils tenantFilter and modules/users/user.service.js). This
// collection grows with the whole platform rather than one school, so without
// this index the admin user list scanned every school's profiles on every
// page. `deletedAt` trails it because every one of those reads excludes
// soft-deleted rows.
profileSchema.index({ tenantId: 1, deletedAt: 1 });

export const Profile = model('Profile', profileSchema);
