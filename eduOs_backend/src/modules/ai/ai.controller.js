import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './ai.service.js';

export const chat = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) throw new AppError('message is required', 400);
  sendSuccess(res, await service.chat({ message, conversationId }, req.actor), 'AI response generated');
});
