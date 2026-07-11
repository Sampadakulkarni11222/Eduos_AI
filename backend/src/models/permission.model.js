import { Schema, model } from 'mongoose';

const permissionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    group: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    // Seeded catalog entries are protected from deletion/rename via the API
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Permission = model('Permission', permissionSchema);
