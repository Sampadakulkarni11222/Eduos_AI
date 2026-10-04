import { Schema, model } from 'mongoose';

/**
 * A WhatsApp thread and the messages in it.
 *
 * Deliberately NOT tenantScoped, for the same reason Profile is not: a webhook
 * arrives as a phone number and nothing else, so the thread has to be found
 * before the acting school is known. The school is recorded on the row instead
 * (stamped from the resolved profile) so a conversation can still be reported
 * on per school, and every ERP read the turn goes on to make runs inside
 * runWithTenant() — see whatsapp.agent.js.
 *
 * Why persist at all: WhatsApp turns arrive as independent HTTP requests,
 * minutes or hours apart, across restarts and across instances. An in-memory
 * map loses "what about last month?" the moment the process recycles, and
 * loses it silently — the bot just answers the wrong question.
 */
const whatsappConversationSchema = new Schema(
  {
    /** Digits-only E.164 (no '+'), the one canonical form — see normalisePhone(). */
    phone: { type: String, required: true, unique: true, trim: true },
    /**
     * The ERP identity this number resolved to, cached from the last turn.
     *
     * Cached for auditing and for the session dedupe key only. It is NEVER the
     * basis for authorization: every turn re-resolves the account, role and
     * permission map from the live records, so revoking a profile takes effect
     * on the next message rather than whenever the thread happens to expire.
     */
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    erpProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null, index: true },
    role: { type: String, default: null },
    tenantId: { type: String, default: null, trim: true, lowercase: true, index: true },
    displayName: { type: String, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'UNLINKED', 'BLOCKED'],
      default: 'ACTIVE',
    },
    /**
     * Which provider last delivered this thread (META or CHATFLOW) and that
     * provider's own conversation id. Correlation only — the thread is still
     * keyed on the phone, so switching provider keeps the conversation memory.
     */
    provider: { type: String, default: null },
    providerConversationId: { type: String, default: null },
    /** Stable id for the current run of turns; rotates after an idle gap. */
    sessionId: { type: String, required: true },
    sessionStartedAt: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const WhatsappConversation = model('WhatsappConversation', whatsappConversationSchema);

const whatsappMessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'WhatsappConversation', required: true },
    sessionId: { type: String, required: true },
    /**
     * Meta's own message id (`wamid.…`).
     *
     * Unique and sparse: this is the dedupe key. Meta redelivers a webhook it
     * did not get a 200 for, and an inbound "YES" replayed against a pending
     * write would execute it twice. Sparse because outbound rows have no
     * provider id until the send returns one, and some never get one at all.
     */
    providerMessageId: { type: String, default: null },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true },
    messageType: { type: String, default: 'text' },
    text: { type: String, default: '' },
    /** Small, non-sensitive turn metadata: which tool answered, language, error code. */
    metadata: { type: Schema.Types.Mixed, default: null },
    processingStatus: {
      type: String,
      enum: ['RECEIVED', 'PROCESSED', 'SKIPPED_DUPLICATE', 'FAILED', 'SENT', 'SEND_FAILED'],
      default: 'RECEIVED',
    },
  },
  { timestamps: true }
);

// The dedupe index. Partial rather than plain-sparse so the uniqueness applies
// only to rows that actually carry a provider id — many outbound rows are null,
// and a plain unique+sparse index still collides on repeated nulls in some
// server versions.
whatsappMessageSchema.index(
  { providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } }
);
// The history read: newest-first within one conversation.
whatsappMessageSchema.index({ conversationId: 1, createdAt: -1 });

export const WhatsappMessage = model('WhatsappMessage', whatsappMessageSchema);
