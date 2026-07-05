import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './ticket.service.js';

export const list = asyncHandler(async (req, res) => {
  const tickets = await service.list(req.actor, req.scope, req.query);
  const dtos = tickets.map(t => ({
    id: t._id,
    ticketNo: t.ticketNo || t._id.toString().substring(0, 6).toUpperCase(),
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    openedBy: t.raisedByProfileId?.displayName || 'Unknown',
    assignedTo: t.assigneeProfileId?.displayName || null,
    createdAt: t.createdAt.toISOString(),
  }));
  sendSuccess(res, dtos, 'Tickets fetched');
});

export const getById = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getById(req.actor, req.scope, req.params.id), 'Ticket fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.body), 'Ticket created', 201);
});

export const reply = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.reply(req.actor, req.body), 'Reply added', 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.update(req.params.id, req.body), 'Ticket updated');
});
