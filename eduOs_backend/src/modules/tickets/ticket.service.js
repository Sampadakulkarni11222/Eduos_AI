import { Ticket, TicketMessage } from '../../models/ticket.model.js';
import { AppError } from '../../utils/AppError.js';

export async function list(actor, scope, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;

  if (scope === 'OWN') {
    filter.$or = [{ raisedByProfileId: actor.profileId }, { assigneeProfileId: actor.profileId }];
  }

  return Ticket.find(filter)
    .populate('raisedByProfileId', 'displayName')
    .populate('assigneeProfileId', 'displayName')
    .sort({ createdAt: -1 });
}

export async function getById(actor, scope, id) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new AppError('Ticket not found', 404);

  if (scope === 'OWN') {
    const owns =
      ticket.raisedByProfileId?.toString() === actor.profileId ||
      ticket.assigneeProfileId?.toString() === actor.profileId;
    if (!owns) throw new AppError('Ticket not found', 404);
  }

  const messages = await TicketMessage.find({ ticketId: id }).sort({ createdAt: 1 });
  return { ticket, messages };
}

export const create = (actor, data) =>
  Ticket.create({ ...data, raisedByProfileId: actor.profileId, status: 'NEW' });

export async function reply(actor, scope, { ticketId, body }) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError('Ticket not found', 404);

  if (scope === 'OWN') {
    const owns =
      ticket.raisedByProfileId?.toString() === actor.profileId ||
      ticket.assigneeProfileId?.toString() === actor.profileId;
    if (!owns) throw new AppError('Ticket not found', 404);
  }

  const message = await TicketMessage.create({ ticketId, authorProfileId: actor.profileId, body });

  if (ticket.status === 'NEW') ticket.status = 'OPEN';
  await ticket.save();

  return message;
}

export async function update(id, updates) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new AppError('Ticket not found', 404);
  Object.assign(ticket, updates);
  await ticket.save();
  return ticket;
}
