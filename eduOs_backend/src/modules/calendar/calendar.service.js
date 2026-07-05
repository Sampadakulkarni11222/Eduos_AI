import { CalendarEvent } from '../../models/calendarEvent.model.js';

export const list = (query = {}) => {
  const filter = { deletedAt: null };
  if (query.from || query.to) {
    filter.startsAt = {};
    if (query.from) filter.startsAt.$gte = new Date(query.from);
    if (query.to) filter.startsAt.$lte = new Date(query.to);
  }
  return CalendarEvent.find(filter).sort({ startsAt: 1 });
};

export const create = (actor, data) =>
  CalendarEvent.create({ ...data, createdByProfileId: actor.profileId });
