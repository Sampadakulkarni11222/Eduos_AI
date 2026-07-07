import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    action: { type: String, required: true }, // e.g. "marks.publish", "medical.read"
    entityType: { type: String },
    entityId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    channel: { type: String, enum: ['WEB', 'MOBILE', 'WHATSAPP', 'SYSTEM'], default: 'WEB' },
    ip: { type: String },
  },
  { timestamps: true } // adds createdAt automatically
);

auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ actorProfileId: 1, createdAt: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);
