import net from 'node:net';
import { AppError } from '../../utils/AppError.js';
import { LINK_KEYS } from '../../models/alumni.model.js';

/**
 * Social links people add to their own profile.
 *
 * Every link is an https URL with no user name or password in it and no
 * unusual port. LinkedIn, Instagram and GitHub links must be on that network's
 * own host; a personal site may be any public host name, never an IP address,
 * localhost or an internal name.
 */
export const LINK_HOSTS = {
  linkedin: ['linkedin.com', 'www.linkedin.com', 'in.linkedin.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  github: ['github.com', 'www.github.com'],
  website: null,
};
const LABELS = { linkedin: 'LinkedIn', instagram: 'Instagram', github: 'GitHub', website: 'Personal site' };
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];

export function cleanLink(key, value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const label = LABELS[key] ?? key;
  const raw = String(value).trim();
  if (raw.length > 300) throw new AppError(`${label} link is too long`, 400, [], 'BAD_LINK');
  let u;
  try { u = new URL(raw); } catch { throw new AppError(`${label} link must be a full web address starting with https://`, 400, [], 'BAD_LINK'); }
  if (u.protocol !== 'https:') throw new AppError(`${label} link must start with https://`, 400, [], 'BAD_LINK');
  if (u.username || u.password) throw new AppError(`${label} link must not contain a user name or password`, 400, [], 'BAD_LINK');
  if (u.port && u.port !== '443') throw new AppError(`${label} link must not name a port`, 400, [], 'BAD_LINK');
  const host = u.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || !host.includes('.') || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new AppError(`${label} link must be a public web address`, 400, [], 'BAD_LINK');
  }
  const allowed = LINK_HOSTS[key];
  if (allowed && !allowed.includes(host)) throw new AppError(`${label} link must be on ${allowed[0]}`, 400, [], 'LINK_HOST_NOT_ALLOWED');
  if (allowed && (u.pathname === '/' || !u.pathname)) throw new AppError(`${label} link must point to a profile, not the home page`, 400, [], 'BAD_LINK');
  u.hash = '';
  return u.toString();
}

/** Validates a `{ linkedin, instagram, github, website }` object; unknown keys are refused. */
export function cleanLinks(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new AppError('links must be an object', 400);
  const unknown = Object.keys(input).filter((k) => !LINK_KEYS.includes(k));
  if (unknown.length) throw new AppError(`Unknown link type: ${unknown.join(', ')}. Allowed: ${LINK_KEYS.join(', ')}`, 400, [], 'BAD_LINK');
  const out = {};
  for (const k of LINK_KEYS) if (k in input) out[k] = cleanLink(k, input[k]);
  return out;
}

export const linksOf = (doc) => Object.fromEntries(LINK_KEYS.map((k) => [k, doc?.[k] ?? null]));
