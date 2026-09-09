import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './ticket.service.js';

export const list = asyncHandler(async (req, res) => {
  const rows = await service.list(req.actor, req.scope, req.query);
  const dtos = rows.map(({ ticket: t, messageCount }) => ({
    id: t._id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    routedToRoleKey: t.routedToRoleKey ?? null,
    raisedBy: t.raisedByProfileId?.displayName || 'Unknown',
    assignedTo: t.assigneeProfileId?.displayName || null,
    studentName: t.studentId ? `${t.studentId.firstName} ${t.studentId.lastName ?? ''}`.trim() : null,
    createdAt: t.createdAt.toISOString(),
    messageCount,
  }));
  sendSuccess(res, dtos, 'Tickets fetched');
});

export const getById = asyncHandler(async (req, res) => {
  const { ticket, messages } = await service.getById(req.actor, req.scope, req.params.id);
  sendSuccess(res, {
    id: ticket._id,
    subject: ticket.subject,
    status: ticket.status,
    routedToRoleKey: ticket.routedToRoleKey ?? null,
    studentName: ticket.studentId ? `${ticket.studentId.firstName} ${ticket.studentId.lastName ?? ''}`.trim() : null,
    documentUrl: ticket.documentUrl ?? null,
    documentName: ticket.documentName ?? null,
    messages: messages.map((m) => ({
      id: m._id,
      body: m.body,
      channel: m.channel,
      mine: m.authorProfileId?.toString() === req.actor.profileId,
      createdAt: m.createdAt.toISOString(),
    })),
  }, 'Ticket fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.body), 'Ticket created', 201);
});

export const reply = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.reply(req.actor, req.scope, req.body), 'Reply added', 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.update(req.params.id, req.body), 'Ticket updated');
});
