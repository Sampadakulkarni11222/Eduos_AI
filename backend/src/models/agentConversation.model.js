import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * One person's Ask AI conversation on one channel, kept on the server.
 *
 * The website used to hold the whole conversation in the browser, inside a
 * component that every page renders again -- so a page change or a reload
 * started it over, and "and 6 B?" after navigating had nothing to refer to.
 * WhatsApp kept its own transcript (whatsappConversation.model.js) but no
 * structured state. This row is that memory for both: the recent turns and
 * what they were about (the last read and its arguments, the students the
 * last answer listed, the draft under discussion, where a long list stopped).
 *
 * It is a routing aid, never authority:
 *   - found only by (school, profile, channel, conversation id) -- the school
 *     by the tenant plugin, the profile from the signed-in session -- so one
 *     person's id is useless to anybody else, and nothing crosses schools;
 *   - everything carried from it goes back through the MCP tools, which
 *     authorize and scope every call for the person asking NOW;
 *   - replies of restricted modules (medical, health room, payroll, safety)
 *     are not kept as text (see agent/memory.js);
 *   - it expires 24 hours after the last turn.
 */
const turnSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const agentConversationSchema = new Schema(
  {
    conversationId: { type: String, required: true, trim: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    channel: { type: String, enum: ['WEB', 'WHATSAPP'], default: 'WEB' },
    turns: { type: [turnSchema], default: [] },
    /** What the conversation is about; see agent/memory.js for the shape. */
    context: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);

agentConversationSchema.index({ tenantId: 1, profileId: 1, channel: 1, conversationId: 1 }, { unique: true });
// Gone a day after the last turn.
agentConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

agentConversationSchema.plugin(tenantScoped); // school-owned

export const AgentConversation = model('AgentConversation', agentConversationSchema);
