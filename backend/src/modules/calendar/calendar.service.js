import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { AppError } from '../../utils/AppError.js';

export const list = (query = {}) => {
  const filter = { deletedAt: null };
  if (query.from || query.to) {
    filter.startsAt = {};
    if (query.from) filter.startsAt.$gte = new Date(query.from);
    if (query.to) filter.startsAt.$lte = new Date(query.to);
  }
  return CalendarEvent.find(filter).sort({ startsAt: 1 });
};

/**
 * Adds an event to the school calendar.
 *
 * A calendar event is school-wide by construction: CalendarEvent carries an
 * `audience` and no section, so there is no such thing as an event scoped to
 * one class. An OWN-scoped grant of calendar.manage therefore has nothing it
 * could legitimately create — it would write an event every pupil, parent and
 * teacher in the school sees — so the scope is refused here rather than
 * silently widened to everybody.
 *
 * The route guard and the assistant's create_calendar_event tool (minScope
 * ALL) both already require school-wide authority; this is the same rule in
 * the one place every caller passes through.
 */
export const create = (actor, scope, data) => {
  if (scope !== 'ALL') {
    throw new AppError('You are not authorized to add school calendar events', 403);
  }
  return CalendarEvent.create({ ...data, createdByProfileId: actor.profileId });
};
