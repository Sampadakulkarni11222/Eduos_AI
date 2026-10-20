import crypto from 'node:crypto';
import { authenticate } from './auth.js';
import { IdempotencyRecord } from '../models/idempotencyRecord.model.js';
import { AttendanceRecord } from '../models/attendanceRecord.model.js';
import { sendError } from '../utils/response.js';

/**
 * Idempotency keys for the writes the browser can queue while offline:
 * attendance marking, lab issue/return, staff checkpoint scans (gate, bus),
 * sanitation checks, PTM check-in and teacher class check-in.
 *
 * With an `Idempotency-Key` header, the first request runs and its response
 * is stored per person and key; a replay (the queue retrying after a dropped
 * connection) gets the stored response back with `Idempotent-Replayed: true`
 * and changes nothing. The same key with a different body is refused, so a
 * key cannot be reused for another write. Requests without the header behave
 * exactly as before.
 *
 * Conflicts, server wins: a queued attendance write carries the time it was
 * queued (`X-Offline-Queued-At`). An entry someone else changed on the
 * server after that time is not overwritten; it is left out and reported back
 * as a conflict, so the person sees that the server's version was kept.
 */
export const OFFLINE_ROUTES = [
  { re: /^\/attendance\/mark\/?$/, kind: 'ATTENDANCE' },
  { re: /^\/labs\/stock\/(issue|return)\/?$/, kind: 'LAB_STOCK' },
  { re: /^\/checkpoints\/scan\/?$/, kind: 'CHECKPOINT_SCAN' },
  { re: /^\/sustainability\/sanitation\/[0-9a-fA-F]{24}\/checks\/?$/, kind: 'SANITATION_CHECK' },
  { re: /^\/ptm\/bookings\/[0-9a-fA-F]{24}\/check-in\/?$/, kind: 'PTM_CHECK_IN' },
  { re: /^\/class-check-ins\/?$/, kind: 'CLASS_CHECK_IN' },
];

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;
const KEEP_MS = 7 * 86_400_000;
const STALE_MS = 2 * 60_000;

export const routeKind = (method, path) => (method === 'POST' ? OFFLINE_ROUTES.find((r) => r.re.test(path))?.kind ?? null : null);

const hashBody = (body) => crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

function dayKey(date) {
  const m = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Attendance entries changed on the server by someone else after the client
 * queued its write. Those entries are dropped from the request (server wins).
 */
async function attendanceConflicts(req, queuedAt) {
  const body = req.body ?? {};
  const listKey = Array.isArray(body.records) ? 'records' : Array.isArray(body.entries) ? 'entries' : null;
  const day = dayKey(body.date);
  if (!listKey || !day) return [];
  const items = body[listKey];
  const periodNo = body.periodNo === undefined || body.periodNo === '' ? null : body.periodNo;
  const ids = items.map((i) => String(i?.enrollmentId ?? '')).filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  if (!ids.length) return [];
  const newer = await AttendanceRecord.find({ enrollmentId: { $in: ids }, date: day, periodNo, updatedAt: { $gt: queuedAt } })
    .select('enrollmentId status markedByProfileId updatedAt').lean();
  const conflicts = [];
  for (const row of newer) {
    if (String(row.markedByProfileId ?? '') === String(req.actor?.profileId)) continue;
    const mine = items.find((i) => String(i?.enrollmentId) === String(row.enrollmentId));
    if (!mine || String(mine.status ?? '').toUpperCase() === row.status) continue;
    conflicts.push({ enrollmentId: String(row.enrollmentId), yours: String(mine.status).toUpperCase(), kept: row.status, changedAt: row.updatedAt });
  }
  if (conflicts.length) {
    const drop = new Set(conflicts.map((c) => c.enrollmentId));
    req.body = { ...body, [listKey]: items.filter((i) => !drop.has(String(i?.enrollmentId))) };
  }
  return conflicts;
}

async function guarded(req, res, next, kind, key) {
  const profileId = req.actor?.profileId;
  if (!profileId) return next();
  const bodyHash = hashBody(req.body);
  const now = Date.now();
  let record;
  try {
    record = await IdempotencyRecord.create({ key, profileId, method: req.method, path: req.path, bodyHash, expiresAt: new Date(now + KEEP_MS) });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const prior = await IdempotencyRecord.findOne({ key, profileId }).lean();
    if (!prior) return sendError(res, 'Please retry.', 409, [], 'IDEMPOTENCY_IN_PROGRESS');
    if (prior.bodyHash !== bodyHash || prior.path !== req.path) {
      return sendError(res, 'This idempotency key was already used for a different request.', 422, [], 'IDEMPOTENCY_KEY_REUSED');
    }
    if (prior.state === 'IN_PROGRESS') {
      if (now - new Date(prior.updatedAt).getTime() < STALE_MS) return sendError(res, 'The same change is still being saved. Try again in a moment.', 409, [], 'IDEMPOTENCY_IN_PROGRESS');
      await IdempotencyRecord.deleteOne({ _id: prior._id });
      return guarded(req, res, next, kind, key);
    }
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(prior.responseStatus ?? 200).json(prior.responseBody);
  }

  let conflicts = [];
  const queuedAt = req.headers['x-offline-queued-at'] ? new Date(String(req.headers['x-offline-queued-at'])) : null;
  if (kind === 'ATTENDANCE' && queuedAt && !Number.isNaN(queuedAt.getTime())) {
    conflicts = await attendanceConflicts(req, queuedAt);
    const listKey = Array.isArray(req.body?.records) ? 'records' : 'entries';
    if (conflicts.length && !(req.body?.[listKey]?.length)) {
      const body = { success: false, message: 'Someone else updated this register after your change was queued. The school copy was kept.', errors: [], error: { code: 'OFFLINE_CONFLICT', message: 'Server version kept' }, conflicts };
      await IdempotencyRecord.updateOne({ _id: record._id }, { $set: { state: 'DONE', responseStatus: 409, responseBody: body } });
      return res.status(409).json(body);
    }
  }

  const original = res.json.bind(res);
  res.json = (payload) => {
    res.json = original;
    let body = payload;
    if (conflicts.length && body && typeof body === 'object') {
      const n = conflicts.length;
      // Top level for API readers; inside `data` too, which is what the web client unwraps.
      const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? { ...body.data, conflicts } : body.data;
      body = { ...body, data, conflicts, message: `${body.message ?? 'Saved'}. ${n} ${n === 1 ? 'entry was' : 'entries were'} changed by someone else after you queued this; the school copy was kept.` };
    }
    const status = res.statusCode;
    const save = status >= 500
      ? IdempotencyRecord.deleteOne({ _id: record._id })
      : IdempotencyRecord.updateOne({ _id: record._id }, { $set: { state: 'DONE', responseStatus: status, responseBody: body } });
    Promise.resolve(save).catch(() => {}).finally(() => original(body));
    return res;
  };
  return next();
}

/** Router-level middleware: does nothing unless the request is a queued offline write with a key. */
export function offlineIdempotency(req, res, next) {
  const kind = routeKind(req.method, req.path);
  const key = req.headers['idempotency-key'];
  if (!kind || !key) return next();
  if (!KEY_RE.test(String(key))) return sendError(res, 'Idempotency-Key must be 8 to 100 letters, digits or - _ : .', 400, [], 'BAD_IDEMPOTENCY_KEY');
  // Device-signed scans have their own de-duplication (scanId).
  if (!String(req.headers.authorization ?? '').startsWith('Bearer ')) return next();
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return guarded(req, res, next, kind, String(key)).catch(next);
  });
}
