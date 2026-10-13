import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { nextSequence } from '../../utils/sequence.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';

/**
 * Helpers shared by the institution-operations modules (approvals,
 * administration, finance operations, marketing, community, campus).
 *
 * They exist so every one of those modules answers the same questions the
 * same way: how a reference number is minted, how a state change is checked
 * and recorded, how money is held, and who in this school holds a role.
 */

/** A school-local, year-scoped reference such as `INW/2026/0007`. */
export async function nextRef(prefix, at = new Date()) {
  const year = at.getUTCFullYear();
  const tenant = currentTenantId() ?? 'platform';
  const n = await nextSequence(`ops:${tenant}:${prefix}:${year}`);
  return `${prefix}/${year}/${String(n).padStart(4, '0')}`;
}

export function requireProfile(actor) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  return actor.profileId;
}

export function isObjectId(value) {
  return typeof value === 'string' ? mongoose.isValidObjectId(value) : value instanceof mongoose.Types.ObjectId;
}

export function assertObjectId(value, label = 'id') {
  if (!value || !mongoose.isValidObjectId(String(value))) throw new AppError(`Invalid ${label}`, 400);
  return String(value);
}

/**
 * Enforces a state machine. `machine` maps each state to the states it may
 * move to; anything else is a 409 naming both ends, so the caller sees why.
 */
export function assertTransition(machine, from, to, label = 'record') {
  const allowed = machine[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(`A ${label} cannot move from ${from} to ${to}.`, 409, [], 'INVALID_TRANSITION');
  }
}

/** Appends to a document's `history` array. */
export function pushHistory(doc, actor, action, { from = null, to = null, note = null } = {}) {
  doc.history = doc.history ?? [];
  doc.history.push({
    at: new Date(),
    actorProfileId: actor?.profileId ?? null,
    actorName: actor?.displayName ?? null,
    action,
    from,
    to,
    note: note ? String(note).slice(0, 2000) : null,
  });
}

/** Sub-schema used by every workflow document for its audit trail. */
export const historyEntry = {
  at: { type: Date, default: Date.now },
  actorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', default: null },
  actorName: { type: String, default: null },
  action: { type: String, required: true },
  from: { type: String, default: null },
  to: { type: String, default: null },
  note: { type: String, default: null },
};

/** An uploaded or linked document. `url` is an /uploads path (signed on the way out). */
export const attachmentEntry = {
  name: { type: String, trim: true, required: true },
  url: { type: String, trim: true, required: true },
  kind: { type: String, trim: true, default: 'DOCUMENT' },
  addedAt: { type: Date, default: Date.now },
  addedByProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', default: null },
};

/** Accepts only well-formed attachments from a request body. */
export function cleanAttachments(list, actor) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a.name === 'string' && typeof a.url === 'string' && a.name.trim() && a.url.trim())
    .slice(0, 25)
    .map((a) => ({
      name: a.name.trim().slice(0, 200),
      url: a.url.trim().slice(0, 1000),
      kind: typeof a.kind === 'string' ? a.kind.slice(0, 40) : 'DOCUMENT',
      addedByProfileId: actor?.profileId ?? null,
    }));
}

/**
 * Money is held in integer paise everywhere in this codebase. Anything that
 * arrives as rupees is converted once, here, and rejected if it is not a
 * finite, non-negative amount with at most two decimals.
 */
export function toPaise(value, label = 'amount', { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new AppError(`${label} must be a number`, 400);
  if (!allowNegative && n < 0) throw new AppError(`${label} cannot be negative`, 400);
  const paise = Math.round(n * 100);
  if (Math.abs(paise / 100 - n) > 1e-9) throw new AppError(`${label} can have at most two decimals`, 400);
  return paise;
}

/** Paise already validated as an integer (APIs that accept paise directly). */
export function asPaise(value, label = 'amountPaise') {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`${label} must be a whole, non-negative number of paise`, 400);
  return n;
}

export function parseDate(value, label = 'date', { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new AppError(`${label} is required`, 400);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(`${label} is not a valid date`, 400);
  return d;
}

export function requireText(value, label, { max = 300 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AppError(`${label} is required`, 400);
  if (text.length > max) throw new AppError(`${label} must be at most ${max} characters`, 400);
  return text;
}

export function optionalText(value, { max = 5000 } = {}) {
  if (value === null || value === undefined) return undefined;
  return String(value).trim().slice(0, max);
}

export function oneOf(value, allowed, label, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new AppError(`${label} is required`, 400);
  }
  const v = String(value).toUpperCase();
  if (!allowed.includes(v)) throw new AppError(`${label} must be one of ${allowed.join(', ')}`, 400);
  return v;
}

/** `{ _id, __v, ... }` → `{ id, ... }` for API responses. */
export function dto(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: false }) : { ...doc };
  const { _id, __v, tenantId: _t, ...rest } = obj;
  return { id: String(_id), ...rest };
}

/** Active profiles in the acting school that hold one of the given roles. */
export async function profilesWithRoles(roleKeys) {
  const roles = await Role.find({ key: { $in: roleKeys } }).select('_id key').lean();
  if (!roles.length) return [];
  const tenantId = currentTenantId();
  return Profile.find({
    roleId: { $in: roles.map((r) => r._id) },
    status: 'ACTIVE',
    deletedAt: null,
    ...(tenantId ? { tenantId } : {}),
  })
    .select('_id displayName roleId accountId')
    .populate('roleId', 'key')
    .lean();
}

/** Display names for a set of profile ids, as a Map. */
export async function profileNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!unique.length) return new Map();
  const rows = await Profile.find({ _id: { $in: unique } }).select('_id displayName').lean();
  return new Map(rows.map((r) => [String(r._id), r.displayName]));
}

export function startOfDayUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysBetween(a, b) {
  return Math.round((startOfDayUtc(b) - startOfDayUtc(a)) / 86_400_000);
}

export function pageArgs(query = {}) {
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 50, 1), 200);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function pageOf(Model, filter, { sort = { createdAt: -1 }, page, pageSize, skip, select, map = dto } = {}) {
  const [rows, total] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(pageSize).select(select ?? '').lean(),
    Model.countDocuments(filter),
  ]);
  return { items: rows.map(map), total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Escapes a user string for use inside a RegExp. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
