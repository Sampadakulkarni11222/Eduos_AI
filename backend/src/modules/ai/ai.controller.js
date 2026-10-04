import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as agentCore from './agent/orchestrator.js';
import { mcpToolsFor } from './mcp/registry.js';
import * as tutorService from './tutor.service.js';
import * as studyBuddyService from './studyBuddy/studyBuddy.service.js';
import * as creditService from './aiCredit.service.js';

/* ── AI credits ─────────────────────────────────────────────
   Metering for AI-generated answers. Staff are not metered; students and
   parents get a free monthly allowance and can buy packs beyond it. */

export const creditStatus = asyncHandler(async (req, res) => {
  sendSuccess(res, await creditService.getStatus(req.actor), 'AI credit status');
});

export const creditPacks = asyncHandler(async (_req, res) => {
  sendSuccess(res, { packs: creditService.CREDIT_PACKS, freeMonthly: creditService.FREE_MONTHLY_CREDITS }, 'Credit packs');
});

export const buyCredits = asyncHandler(async (req, res) => {
  // beneficiaryProfileId is passed through rather than dropped. The service
  // refuses anything other than the caller's own wallet — but it has to *see*
  // the field to refuse it. Silently ignoring it would return 201 for a request
  // to top up somebody else's account while actually crediting your own, which
  // is a success response for something that did not happen.
  const result = await creditService.purchasePack(req.actor, {
    packKey: req.body?.packKey,
    beneficiaryProfileId: req.body?.beneficiaryProfileId,
  });
  sendSuccess(res, result, result.paid ? 'Credits added' : 'Order created', result.paid ? 201 : 200);
});

export const verifyCreditPurchase = asyncHandler(async (req, res) => {
  const result = await creditService.verifyPackPurchase(req.actor, {
    orderId: req.body?.orderId,
    paymentId: req.body?.paymentId,
    signature: req.body?.signature,
  });
  sendSuccess(res, result, result.idempotent ? 'Credits already added' : 'Credits added');
});

export const creditOrders = asyncHandler(async (req, res) => {
  sendSuccess(res, await creditService.listOrders(req.actor), 'Credit orders fetched');
});

/* ── Agentic layer ──────────────────────────────────────────
   Shared by the in-app assistant and WhatsApp; `source` only affects the
   audit trail, never the authorization. */
/* Recent turns only, and trimmed: the transcript is a routing aid, not a
   transport for arbitrary client-supplied text. */
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_TEXT = 1000;

/**
 * Accepts the client's transcript, and nothing else from it.
 *
 * The shape is rebuilt field by field rather than passed through, so a client
 * cannot smuggle extra keys into the object the agent reasons over. It stays
 * transcript: runAgent reads identity, role and permissions from `actor` on
 * every turn, so nothing in here can widen what this one may do.
 */
function sanitiseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((turn) => (turn?.role === 'user' || turn?.role === 'assistant') && typeof turn.text === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_HISTORY_TEXT) }));
}

export const agent = asyncHandler(async (req, res) => {
  const { message, source, lang, history } = req.body;
  if (!message) throw new AppError('message is required', 400);
  sendSuccess(
    res,
    // Safe variant: a provider outage degrades to the rule-based answer rather
    // than a 500 the client can only render as "could not reach the assistant".
    await agentCore.runAgentSafely({
      message,
      actor: req.actor,
      source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      lang,
      // Without this the website had no conversation at all: every turn was a
      // first turn, so a follow-up that named nobody was answered by asking
      // who was meant — while WhatsApp, which has always passed history,
      // resolved it. Same core, same behaviour now.
      history: sanitiseHistory(history),
    }),
    'Agent response'
  );
});

/**
 * The next window of a long answer ("Load more"). The token was issued by the
 * server with the answer; redeeming it is an ordinary MCP read for this same
 * caller, authorized and audited like the first.
 */
export const agentContinue = asyncHandler(async (req, res) => {
  const { continuationToken, source, lang } = req.body;
  if (!continuationToken) throw new AppError('continuationToken is required', 400);
  sendSuccess(
    res,
    await agentCore.continueAnswer({
      token: continuationToken,
      actor: req.actor,
      source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      lang,
    }),
    'Agent response continued'
  );
});

export const agentConfirm = asyncHandler(async (req, res) => {
  const { confirmToken, accept, source, lang } = req.body;
  sendSuccess(
    res,
    await agentCore.confirmAction({
      confirmToken,
      actor: req.actor,
      accept: accept !== false,
      source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      lang,
    }),
    'Agent action processed'
  );
});

/**
 * What this caller can actually ask the assistant to do.
 *
 * Read from the MCP registry rather than the pre-MCP tool list, which was the
 * one place still reporting the old eighteen capabilities — so the panel
 * advertised a fraction of what the assistant could do, and none of the write
 * operations. Filtering is the same permission-driven pass `tools/list` makes
 * (`mcpToolsFor`), so this endpoint and the model are shown the same catalog.
 *
 * The `{ name, description, mutates }` shape is kept exactly as it was, since
 * the frontend's `AgentTool` type declares it. The extra fields are additive:
 * a client that ignores them behaves as before, and one that reads them can
 * show which capabilities change data and which will ask before they do.
 */
export const agentCapabilities = asyncHandler(async (req, res) => {
  const tools = mcpToolsFor(req.actor).map((tool) => ({
    name: tool.name,
    description: tool.description,
    mutates: tool.annotations.readOnlyHint === false,
    module: tool.annotations.module,
    operation: tool.annotations.operation,
    risk: tool.annotations.risk,
    confirmationRequired: tool.annotations.confirmationRequired,
  }));
  sendSuccess(res, { tools }, 'Agent capabilities');
});

/* ── Student tutor mode ─────────────────────────────────────
   Curriculum and performance are resolved server-side from the caller's own
   enrollment — there is no parameter for "whose syllabus". */
export const tutorStatus = asyncHandler(async (_req, res) => {
  sendSuccess(res, tutorService.tutorStatus(), 'Tutor status');
});

export const tutorSyllabus = asyncHandler(async (req, res) => {
  sendSuccess(res, await tutorService.getSyllabus(req.actor), 'Syllabus fetched');
});

export const tutor = asyncHandler(async (req, res) => {
  const { subject, topic, mode, lang } = req.body;
  sendSuccess(res, await tutorService.tutor(req.actor, { subject, topic, mode, lang }), 'Tutor response');
});

/* ── Student Study Help (Student Learning Buddy) ───────────
   Students only — the service refuses every other role with 403, so the
   parent portal stays on /ai/tutor above. */
export const learnStatus = asyncHandler(async (req, res) => {
  sendSuccess(res, studyBuddyService.learnStatus(req.actor), 'Study help status');
});

export const learn = asyncHandler(async (req, res) => {
  const { subject, topic, mode, lang } = req.body;
  sendSuccess(res, await studyBuddyService.learn(req.actor, { subject, topic, mode, lang }), 'Study help response');
});
