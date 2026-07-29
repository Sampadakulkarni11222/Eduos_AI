import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './notification.service.js';

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.list(req.actor, req.query), 'Notifications fetched');
});

export const unreadCount = asyncHandler(async (req, res) => {
  sendSuccess(res, { unreadCount: await service.unreadCount(req.actor) }, 'Unread count fetched');
});

export const markRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.markRead(req.actor, req.body.ids), 'Notifications marked read');
});

export const markAllRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.markAllRead(req.actor), 'All notifications marked read');
});
