import { Profile } from '../../models/profile.model.js';

export const listForAccount = (accountId) =>
  Profile.find({ accountId, deletedAt: null }).populate('roleId').sort({ createdAt: 1 });
