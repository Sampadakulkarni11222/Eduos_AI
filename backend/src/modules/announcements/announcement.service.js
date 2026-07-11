import { Announcement } from '../../models/announcement.model.js';

export const list = () => Announcement.find({ deletedAt: null }).sort({ publishedAt: -1 });

export const create = (actor, data) =>
  Announcement.create({ ...data, createdByProfileId: actor.profileId });
