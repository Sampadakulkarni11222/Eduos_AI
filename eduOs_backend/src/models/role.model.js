import { Schema, model } from 'mongoose';

const rolePermissionSchema = new Schema(
  {
    key: { type: String, required: true }, // references Permission.key
    scope: { type: String, enum: ['ALL', 'OWN'], default: 'ALL' },
  },
  { _id: false }
);

const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    // Seeded roles (OWNER, ADMIN, TEACHER, ...) can't be deleted or renamed
    isSystem: { type: Boolean, default: false },
    permissions: { type: [rolePermissionSchema], default: [] },
  },
  { timestamps: true }
);

export const Role = model('Role', roleSchema);
