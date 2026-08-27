import { Ticket, TicketMessage } from '../../models/ticket.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { paginate, mapPage } from '../../utils/paginate.js';
import { getGuardianStudentIds } from '../../utils/scope.js';

export async function list(actor, scope, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;

  if (scope === 'OWN') {
    filter.$or = [{ raisedByProfileId: actor.profileId }, { assigneeProfileId: actor.profileId }];
  }

  // Opt-in pagination: callers passing pageSize get a Paged envelope, everyone
  // else keeps the array they always got — but capped rather than unbounded.
  const page = await paginate(
    Ticket.find(filter)
      .populate('raisedByProfileId', 'displayName')
      .populate('assigneeProfileId', 'displayName')
      .populate('studentId', 'firstName lastName')
      .sort({ createdAt: -1 }),
    Ticket,
    filter,
    { page: query.page, pageSize: query.pageSize, label: 'tickets.list' }
  );

  // Count messages only for the rows actually being returned.
  const rows = Array.isArray(page) ? page : page.items;
  const counts = await TicketMessage.aggregate([
    { $match: { ticketId: { $in: rows.map((t) => t._id) } } },
    { $group: { _id: '$ticketId', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

  return mapPage(page, (t) => ({ ticket: t, messageCount: countMap[t._id.toString()] ?? 0 }));
}

export async function getById(actor, scope, id) {
  const ticket = await Ticket.findById(id).populate('studentId', 'firstName lastName');
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

/**
 * Raise a support query. When routed to the student's class teacher, the
 * assignee is resolved server-side from the section's classTeacherId — the
 * parent picks a child, never a specific teacher.
 */
export async function create(actor, data) {
  const payload = { ...data, raisedByProfileId: actor.profileId, status: 'NEW' };

  if (data.routedToRoleKey === 'CLASS_TEACHER') {
    if (!data.studentId) throw new AppError('Select the child this query is about', 400);
    if (actor.roleKey === 'PARENT') {
      const ownIds = await getGuardianStudentIds(actor.profileId);
      if (!ownIds.includes(data.studentId)) throw new AppError('That student is not linked to your account', 403);
    }
    const enrollment = await Enrollment.findOne({ studentId: data.studentId, status: 'ACTIVE' }).populate({
      path: 'sectionId',
      select: 'classTeacherId',
    });
    const classTeacherId = enrollment?.sectionId?.classTeacherId;
    if (!classTeacherId) throw new AppError("This student's class teacher hasn't been assigned yet — route to the admin office instead", 400);
    payload.assigneeProfileId = classTeacherId;
  }

  return Ticket.create(payload);
}

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
