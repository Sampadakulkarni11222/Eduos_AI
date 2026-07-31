import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './ai.service.js';
import * as agentCore from './agent/orchestrator.js';
import { toolsAvailableTo } from './agent/tools.js';
import * as tutorService from './tutor.service.js';
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

export const creditOrders = asyncHandler(async (req, res) => {
  sendSuccess(res, await creditService.listOrders(req.actor), 'Credit orders fetched');
});

export const chat = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) throw new AppError('message is required', 400);
  sendSuccess(res, await service.chat({ message, conversationId }, req.actor), 'AI response generated');
});

/* ── Agentic layer ──────────────────────────────────────────
   Shared by the in-app assistant and WhatsApp; `source` only affects the
   audit trail, never the authorization. */
export const agent = asyncHandler(async (req, res) => {
  const { message, source, lang } = req.body;
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
    }),
    'Agent response'
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

export const agentCapabilities = asyncHandler(async (req, res) => {
  sendSuccess(res, { tools: toolsAvailableTo(req.actor) }, 'Agent capabilities');
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
