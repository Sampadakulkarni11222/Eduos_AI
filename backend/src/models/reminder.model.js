import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const reminderRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    daysOffset: { type: Number, required: true }, // negative = before due date (e.g. -3), positive = overdue (e.g. 7)
    channel: { type: String, enum: ['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS'], default: 'IN_APP' },
    templateSubject: { type: String, required: true, trim: true },
    templateBody: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const paymentReminderLogSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    recipientProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    recipientPhone: { type: String, trim: true, default: null },
    recipientEmail: { type: String, trim: true, default: null },
    channel: { type: String, enum: ['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS'], required: true },
    stage: { type: String, enum: ['BEFORE_DUE', 'DUE_TODAY', 'OVERDUE_FIRST', 'OVERDUE_FINAL', 'MANUAL'], required: true },
    status: { type: String, enum: ['QUEUED', 'DELIVERED', 'FAILED', 'SIMULATED'], default: 'DELIVERED' },
    title: { type: String, required: true },
    body: { type: String, required: true },
    failureReason: { type: String, default: null },
    sentAt: { type: Date, default: Date.now },
    triggeredByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null }, // null if automated
  },
  { timestamps: true }
);

// Prevent duplicate automated reminders for the same invoice and stage on the same calendar day
paymentReminderLogSchema.index({ invoiceId: 1, stage: 1, channel: 1, createdAt: -1 });

reminderRuleSchema.plugin(tenantScoped);
export const ReminderRule = model('ReminderRule', reminderRuleSchema);

paymentReminderLogSchema.plugin(tenantScoped);
export const PaymentReminderLog = model('PaymentReminderLog', paymentReminderLogSchema);
