import { Schema, model } from 'mongoose';

/**
 * Who stored a file under /uploads, and for which school.
 *
 * Deliberately NOT tenant-scoped by the plugin: the signing step has to see a
 * file's owner even when it belongs to another school, precisely so that it
 * can refuse to sign it (see modules/uploads/signedUrls.js). The tenantId is
 * written explicitly at upload time from the request's own school context.
 *
 * Files stored before this model existed have no row. They stay reachable
 * wherever an authorized response references them (backward compatibility),
 * but only through a signed, expiring link.
 */
const uploadSchema = new Schema(
  {
    storedName: { type: String, required: true, unique: true },
    // null for platform-level uploads (a Super Admin with no school selected).
    tenantId: { type: String, default: null, lowercase: true, trim: true },
    uploaderProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    originalName: { type: String, default: null },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Upload = model('Upload', uploadSchema);
