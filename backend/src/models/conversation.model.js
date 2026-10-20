import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { attachmentEntry } from '../modules/ops/common.js';

/**
 * Parent–teacher conversations: one thread per child, parent and member of
 * staff (class teacher, subject teacher or principal), with messages,
 * attachments and read receipts. Nobody's phone number or email is held or
 * shown here; the school's platform is the channel.
 */
const conversationThreadSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    parentProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    staffProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    // How the member of staff relates to the child when the thread began.
    staffRole: { type: String, enum: ['CLASS_TEACHER', 'SUBJECT_TEACHER', 'PRINCIPAL', 'STAFF'], default: 'STAFF' },
    subject: { type: String, required: true, trim: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    closedAt: { type: Date, default: null },
    closedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    startedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    lastMessageAt: { type: Date, default: null },
    lastMessageSide: { type: String, enum: ['PARENT', 'STAFF', null], default: null },
    // Set while the family's latest message has no staff reply; cleared by a reply.
    awaitingStaffSince: { type: Date, default: null },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
// One open thread per child, parent and member of staff.
conversationThreadSchema.index({ tenantId: 1, studentId: 1, parentProfileId: 1, staffProfileId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
conversationThreadSchema.index({ tenantId: 1, parentProfileId: 1, lastMessageAt: -1 });
conversationThreadSchema.index({ tenantId: 1, staffProfileId: 1, lastMessageAt: -1 });
conversationThreadSchema.index({ tenantId: 1, status: 1, awaitingStaffSince: 1 });

const conversationMessageSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'ConversationThread', required: true },
    senderProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    senderName: { type: String, default: null },
    side: { type: String, enum: ['PARENT', 'STAFF'], required: true },
    body: { type: String, required: true },
    attachments: { type: [attachmentEntry], default: [] },
    readBy: [{ profileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true },
);
conversationMessageSchema.index({ tenantId: 1, threadId: 1, createdAt: 1 });
conversationMessageSchema.index({ tenantId: 1, senderProfileId: 1, createdAt: -1 });

/** A member of staff's note about when they answer (shown to families). */
const conversationSettingSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    officeHoursNote: { type: String, default: null },
  },
  { timestamps: true },
);
conversationSettingSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });

for (const s of [conversationThreadSchema, conversationMessageSchema, conversationSettingSchema]) s.plugin(tenantScoped);
export const ConversationThread = model('ConversationThread', conversationThreadSchema);
export const ConversationMessage = model('ConversationMessage', conversationMessageSchema);
export const ConversationSetting = model('ConversationSetting', conversationSettingSchema);
