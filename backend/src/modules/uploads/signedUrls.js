import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { Upload } from '../../models/upload.model.js';
import { currentTenantState } from '../../tenancy/tenantContext.js';
import { sendError } from '../../utils/response.js';

/**
 * Signed, expiring links for files under /uploads.
 *
 * /uploads used to be served to anyone holding a URL, forever — medical
 * attachments, leave certificates, payment proofs and student photos
 * included. The portal cannot attach its in-memory Bearer token to an <img>
 * or an <a href>, so the files are not gated by a header. Instead:
 *
 *   1. Every stored `/uploads/<file>` path that leaves the API inside a JSON
 *      response is rewritten to `/uploads/<file>?exp=…&sig=…`. Only a caller
 *      entitled to that record receives the response — tenant isolation,
 *      OWN scope and role checks decide that exactly as they already did —
 *      so only they receive a working link.
 *   2. GET /uploads/<file> serves nothing without a valid, unexpired
 *      signature. A bare URL, an expired one, or a tampered one is refused.
 *   3. A file recorded as belonging to another school is never signed in
 *      this school's responses, so a leaked foreign URL cannot be laundered by
 *      pasting it into a record here.
 *   4. Signatures are stripped from request bodies, so what is stored stays
 *      the canonical `/uploads/<file>` form every validator expects.
 */

const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const STORED_PATH = /^\/uploads\/([A-Za-z0-9_-][A-Za-z0-9._-]*)$/;
const SIGNED_PATH = /^(\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*)\?(?:[^#]*)$/;

// Links are stable within an hour (so browsers can cache an image across
// responses) and live between one and two hours.
const BUCKET_SECONDS = 3600;
const MAX_LIFETIME_SECONDS = 2 * BUCKET_SECONDS;

const signingKey = () =>
  crypto.createHmac('sha256', String(env.FILE_URL_SECRET || env.JWT_SECRET)).update('eduos-upload-url-v1').digest();

const signatureFor = (name, exp) =>
  crypto.createHmac('sha256', signingKey()).update(`${name}.${exp}`).digest('hex').slice(0, 40);

export function expiryFor(nowMs = Date.now()) {
  return (Math.floor(nowMs / 1000 / BUCKET_SECONDS) + 2) * BUCKET_SECONDS;
}

export function signUploadPath(name, nowMs = Date.now()) {
  const exp = expiryFor(nowMs);
  return `/uploads/${name}?exp=${exp}&sig=${signatureFor(name, exp)}`;
}

export function verifyUploadSignature(name, exp, sig, nowMs = Date.now()) {
  if (!FILE_NAME.test(String(name)) || String(name).includes('..')) return false;
  const expNum = Number(exp);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isInteger(expNum) || expNum < now || expNum - now > MAX_LIFETIME_SECONDS) return false;
  const expected = Buffer.from(signatureFor(name, expNum));
  const given = Buffer.from(String(sig ?? ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** `/uploads/x?exp=…&sig=…` → `/uploads/x`; anything else unchanged. */
export function stripUploadSignature(value) {
  if (typeof value !== 'string') return value;
  const m = SIGNED_PATH.exec(value.trim());
  return m ? m[1] : value;
}

function walk(value, visit, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string') value[i] = visit(value[i]);
      else walk(value[i], visit, depth + 1);
    }
    return value;
  }
  // Mongoose documents and ObjectIds are serialised by toJSON; convert first.
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === 'string') value[key] = visit(v);
    else if (v && typeof v === 'object') walk(v, visit, depth + 1);
  }
  return value;
}

/**
 * Which of `names` this response may sign. A file recorded for another school
 * is refused; a platform upload (tenantId null) and a file with no record
 * (stored before uploads were recorded) are allowed.
 */
async function signableNames(names, tenant) {
  const rows = await Upload.find({ storedName: { $in: [...names] } }).select('storedName tenantId').lean();
  const owner = new Map(rows.map((r) => [r.storedName, r.tenantId ?? null]));
  const allowed = new Set();
  for (const name of names) {
    if (!owner.has(name)) { allowed.add(name); continue; }
    const fileTenant = owner.get(name);
    if (fileTenant === null || tenant.bypass || fileTenant === tenant.tenantId) allowed.add(name);
  }
  return allowed;
}

/** Response middleware: signs every stored upload path in a JSON body. */
export function signUploadUrlsInResponses(req, res, next) {
  const original = res.json.bind(res);
  res.json = (body) => {
    let payload;
    try {
      // A plain copy: Mongoose documents serialise through toJSON, and the
      // walk must never write into a document or a cached object. Most
      // responses carry no file at all and are passed through untouched.
      const text = body === undefined ? undefined : JSON.stringify(body);
      if (!text || !text.includes('/uploads/')) return original(body);
      payload = JSON.parse(text);
    } catch {
      return original(body);
    }
    const names = new Set();
    walk(payload, (s) => {
      const m = STORED_PATH.exec(s);
      if (m) names.add(m[1]);
      return s;
    });
    if (!names.size) return original(payload);

    // The acting school for this response. A public endpoint (a school's
    // sign-in door) has no signed-in actor and names its school explicitly.
    const state = currentTenantState();
    const tenant = res.locals.uploadTenantId
      ? { tenantId: res.locals.uploadTenantId, bypass: false }
      : { tenantId: state.tenantId, bypass: state.bypass };

    signableNames(names, tenant)
      .catch((err) => {
        logger.error(`Could not resolve upload owners for signing: ${err.message}`);
        return new Set();
      })
      .then((allowed) => {
        const now = Date.now();
        walk(payload, (s) => {
          const m = STORED_PATH.exec(s);
          return m && allowed.has(m[1]) ? signUploadPath(m[1], now) : s;
        });
        original(payload);
      });
    return res;
  };
  next();
}

/** Request middleware: signed links sent back are stored in canonical form. */
export function unsignUploadUrlsInBody(req, _res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    walk(req.body, stripUploadSignature);
  }
  next();
}

/** Gate in front of the static /uploads handler. */
export function requireSignedUploadUrl(req, res, next) {
  const name = decodeURIComponentSafe(req.path.replace(/^\//, ''));
  if (name && verifyUploadSignature(name, req.query.exp, req.query.sig)) return next();
  return sendError(
    res,
    'This file link is missing, invalid or has expired. Reopen the page you found it on to get a fresh link.',
    403, [], 'FILE_LINK_INVALID'
  );
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}
