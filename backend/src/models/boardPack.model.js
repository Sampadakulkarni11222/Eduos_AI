import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A frozen board pack: the papers for one governance meeting as they stood
 * when the secretariat circulated them (agenda, previous minutes, action
 * register, finance, budget, compliance exceptions, decisions waiting). Each
 * freeze is a new version; earlier versions are kept. Members' opens are
 * recorded as read receipts (who and when, nothing else).
 */
const boardPackSchema = new Schema(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'BoardMeeting', required: true },
    version: { type: Number, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    frozenByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    frozenByName: { type: String, default: null },
    note: { type: String, default: null },
    reads: [{ profileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, name: String, at: Date, _id: false }],
  },
  { timestamps: true },
);
boardPackSchema.index({ tenantId: 1, meetingId: 1, version: 1 }, { unique: true });
boardPackSchema.plugin(tenantScoped);
export const BoardPack = model('BoardPack', boardPackSchema);
