import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './ai.service.js';
import * as agentCore from './agent/orchestrator.js';
import { toolsAvailableTo } from './agent/tools.js';

export const chat = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) throw new AppError('message is required', 400);
  sendSuccess(res, await service.chat({ message, conversationId }, req.actor), 'AI response generated');
});

/* ── Agentic layer ──────────────────────────────────────────
   Shared by the in-app assistant and WhatsApp; `source` only affects the
   audit trail, never the authorization. */
export const agent = asyncHandler(async (req, res) => {
  const { message, source } = req.body;
  if (!message) throw new AppError('message is required', 400);
  sendSuccess(
    res,
    await agentCore.runAgent({ message, actor: req.actor, source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB' }),
    'Agent response'
  );
});

export const agentConfirm = asyncHandler(async (req, res) => {
  const { confirmToken, accept, source } = req.body;
  sendSuccess(
    res,
    await agentCore.confirmAction({
      confirmToken,
      actor: req.actor,
      accept: accept !== false,
      source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
    }),
    'Agent action processed'
  );
});

export const agentCapabilities = asyncHandler(async (req, res) => {
  sendSuccess(res, { tools: toolsAvailableTo(req.actor) }, 'Agent capabilities');
});
