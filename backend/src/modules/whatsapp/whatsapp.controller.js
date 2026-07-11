import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './whatsapp.service.js';

export const verifyWebhook = asyncHandler(async (req, res) => {
  const challenge = service.verifyWebhook({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
  });
  if (challenge === null) throw new AppError('Webhook verification failed', 403);
  res.status(200).send(challenge);
});

export const receiveWebhook = asyncHandler(async (req, res) => {
  sendSuccess(res, service.receiveWebhook(req.body), 'Webhook received');
});

export const simulate = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.simulate(req.body, req.actor), 'Simulated WhatsApp exchange');
});
