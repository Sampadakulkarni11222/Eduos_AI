import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * One outbound message to one recipient on one channel.
 *
 * The status is what the provider has actually told us, never what we hoped:
 * QUEUED until a send is attempted; SIMULATED when the channel is not
 * configured (nothing left the server); SENT once the provider accepted it;
 * DELIVERED / READ / FAILED only from a provider status callback; SKIPPED_* when
 * policy stopped it before sending. UNKNOWN is a send whose outcome we could not
 * determine (a timeout after the request left).
 */
export const MESSAGE_STATUSES = [
  'QUEUED', 'DEFERRED', 'SIMULATED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN',
  'SKIPPED_NO_CONSENT', 'SKIPPED_NO_CONTACT', 'SKIPPED_TEMPLATE_NOT_CONFIGURED',
];

const messageOutboxSchema = new Schema(
  {
    channel: { type: String, enum: ['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'], required: true },
    templateKey: { type: String, required: true },
    category: { type: String, enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION'], default: 'UTILITY' },
    recipientProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    // Masked for display; the full number is resolved at send time from the account.
    recipientMasked: { type: String, default: null },
    variables: { type: Schema.Types.Mixed, default: {} },
    // Rendered text as it would appear (what was actually sent, or would have been).
    preview: { type: String, default: '' },
    link: { type: String, default: null },
    urgency: { type: String, enum: ['NORMAL', 'URGENT'], default: 'NORMAL' },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'QUEUED' },
    statusReason: { type: String, default: null },
    scheduledFor: { type: Date, default: null },
    providerMessageId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, detail: String }],
    relatedEntityType: { type: String, default: null },
    relatedEntityId: { type: String, default: null },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
// One message per (idempotency key, recipient, channel): a retried request
// cannot send the same reminder twice.
messageOutboxSchema.index({ tenantId: 1, idempotencyKey: 1, recipientProfileId: 1, channel: 1 }, { unique: true });
messageOutboxSchema.index({ providerMessageId: 1 });
messageOutboxSchema.index({ createdAt: -1 });

/**
 * A person's contact preferences. WhatsApp business messaging requires the
 * recipient's opt-in, so absence of a record means "not opted in".
 */
const contactPreferenceSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    whatsappOptIn: {
      status: { type: String, enum: ['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'], default: 'UNKNOWN' },
      at: { type: Date, default: null },
      source: { type: String, default: null }, // e.g. "portal", "admission form", "WhatsApp reply"
    },
    language: { type: String, default: 'en' },
    quietHours: {
      enabled: { type: Boolean, default: true },
      startHour: { type: Number, default: 21, min: 0, max: 23 },
      endHour: { type: Number, default: 7, min: 0, max: 23 },
    },
  },
  { timestamps: true }
);
contactPreferenceSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });

messageOutboxSchema.plugin(tenantScoped);
contactPreferenceSchema.plugin(tenantScoped);
export const MessageOutbox = model('MessageOutbox', messageOutboxSchema);
export const ContactPreference = model('ContactPreference', contactPreferenceSchema);
