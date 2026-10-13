import { MessageOutbox, ContactPreference } from '../../models/messaging.model.js';
import { Profile } from '../../models/profile.model.js';
import { Account } from '../../models/account.model.js';
import { env, isWhatsappLive } from '../../config/env.js';
import { notify } from '../notifications/notification.service.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { dto, pageArgs, pageOf, requireProfile } from '../ops/common.js';

/**
 * Operational messaging: the one way the operations modules reach people
 * outside the app (WhatsApp today; SMS/email adapters slot in the same way).
 *
 * Every send also leaves an in-app notification, so a message that could not
 * go out on WhatsApp — no opt-in, quiet hours, channel not configured — still
 * reaches the person when they next open the portal. Messages never carry
 * confidential content: a template says *that* something needs attention and
 * links to the authenticated page; the page holds the detail.
 *
 * Template names. Meta only delivers business-initiated messages through
 * templates it has approved for the sending account, so each key maps to the
 * name the school registered, read from WA_TEMPLATE_<KEY>. A key with no
 * configured name is recorded as SKIPPED_TEMPLATE_NOT_CONFIGURED in live mode
 * rather than being sent as free text that Meta would reject.
 */
export const TEMPLATES = {
  APPROVAL_PENDING: {
    category: 'UTILITY',
    text: (v) => `${v.title}: an approval is waiting for you${v.dueOn ? ` (due ${v.dueOn})` : ''}. Open EduOS to review.`,
  },
  APPROVAL_DECIDED: {
    category: 'UTILITY',
    text: (v) => `Your request "${v.title}" was ${String(v.decision).toLowerCase()}. Open EduOS for details.`,
  },
  MEETING_SCHEDULED: {
    category: 'UTILITY',
    text: (v) => `${v.body} meeting "${v.title}" is scheduled for ${v.when}. Agenda and RSVP in EduOS.`,
  },
  MEETING_REMINDER: {
    category: 'UTILITY',
    text: (v) => `Reminder: "${v.title}" on ${v.when}. Please review the agenda in EduOS.`,
  },
  MEETING_MINUTES: {
    category: 'UTILITY',
    text: (v) => `Minutes for "${v.title}" are approved and available in EduOS. Actions assigned: ${v.actions ?? 0}.`,
  },
  DEADLINE_REMINDER: {
    category: 'UTILITY',
    text: (v) => `Reminder: "${v.title}" is due ${v.dueOn}. Open EduOS to act.`,
  },
  EVENT_UPDATE: {
    category: 'UTILITY',
    text: (v) => `Event "${v.title}": ${v.update}. Details in EduOS.`,
  },
  FEE_REMINDER: {
    category: 'UTILITY',
    text: (v) => `A fee payment is due${v.dueOn ? ` on ${v.dueOn}` : ''}. Please check the Payments page in EduOS.`,
  },
  GENERAL_NOTICE: {
    category: 'UTILITY',
    text: (v) => `${v.title}. Please check EduOS for details.`,
  },
};

const IST_OFFSET_MIN = 330;

/** Hour of day in India for a UTC instant (the platform's schools are in IST). */
function istHour(at) {
  return new Date(at.getTime() + IST_OFFSET_MIN * 60_000).getUTCHours();
}

export function inQuietHours(at, quiet) {
  if (!quiet?.enabled) return false;
  const h = istHour(at);
  const { startHour: s, endHour: e } = quiet;
  return s > e ? (h >= s || h < e) : (h >= s && h < e);
}

/** First moment after the quiet window ends. */
function quietEnds(at, quiet) {
  const next = new Date(at.getTime());
  for (let i = 0; i < 24 * 4; i++) {
    next.setTime(next.getTime() + 15 * 60_000);
    if (!inQuietHours(next, quiet)) return next;
  }
  return next;
}

function mask(phone) {
  if (!phone) return null;
  const s = String(phone);
  return s.length <= 4 ? '••••' : `${s.slice(0, 3)}••••${s.slice(-3)}`;
}

function templateName(key) {
  return String(process.env[`WA_TEMPLATE_${key}`] ?? '').trim() || null;
}

/**
 * Overridable transport, so tests and the in-app preview never call Meta.
 * Returns `{ ok, providerMessageId?, error?, unknown? }`.
 */
let transport = async ({ to, template, variables, language }) => {
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: language || 'en' },
        components: [{
          type: 'body',
          parameters: Object.values(variables ?? {}).slice(0, 10).map((v) => ({ type: 'text', text: String(v).slice(0, 1000) })),
        }],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const body = await res.json().catch(() => ({}));
  return { ok: true, providerMessageId: body?.messages?.[0]?.id ?? null };
};

export function setTransportForTests(fn) { transport = fn; }

/**
 * Queue and (where policy allows) send one templated message to each recipient.
 *
 * Never throws for a delivery problem — the action that triggered the message
 * has already happened and must not be undone by a provider outage. It does
 * throw for a programming error (an unknown template).
 *
 * @returns {Promise<Array<{recipientProfileId, status}>>}
 */
export async function sendOperational({
  templateKey, recipientProfileIds = [], variables = {}, link = null, idempotencyKey,
  urgency = 'NORMAL', relatedEntityType = null, relatedEntityId = null, requestedBy = null,
  channels = ['WHATSAPP'], now = new Date(),
}) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new AppError(`Unknown message template ${templateKey}`, 500);
  if (!idempotencyKey) throw new AppError('idempotencyKey is required for an operational message', 500);

  const recipients = [...new Set(recipientProfileIds.filter(Boolean).map(String))];
  if (!recipients.length) return [];
  const preview = template.text(variables);

  // The in-app copy always goes; it is the fallback for every skip below.
  await notify({ recipientProfileIds: recipients, type: 'SYSTEM', title: preview.slice(0, 140), body: preview, link });

  const [profiles, prefs] = await Promise.all([
    Profile.find({ _id: { $in: recipients } }).select('_id accountId').lean(),
    ContactPreference.find({ profileId: { $in: recipients } }).lean(),
  ]);
  const accounts = await Account.find({ _id: { $in: profiles.map((p) => p.accountId) } }).select('_id phoneE164').lean();
  const phoneByAccount = new Map(accounts.map((a) => [String(a._id), a.phoneE164]));
  const prefByProfile = new Map(prefs.map((p) => [String(p.profileId), p]));

  const results = [];
  for (const profile of profiles) {
    for (const channel of channels) {
      const pid = String(profile._id);
      const phone = phoneByAccount.get(String(profile.accountId));
      const pref = prefByProfile.get(pid);
      // eslint-disable-next-line no-await-in-loop -- per-recipient idempotent upsert
      const existing = await MessageOutbox.findOne({ idempotencyKey, recipientProfileId: pid, channel }).lean();
      if (existing) { results.push({ recipientProfileId: pid, status: existing.status, duplicate: true }); continue; }

      const row = {
        channel, templateKey, category: template.category, recipientProfileId: pid,
        recipientMasked: mask(phone), variables, preview, link, urgency, idempotencyKey,
        relatedEntityType, relatedEntityId: relatedEntityId ? String(relatedEntityId) : null,
        requestedByProfileId: requestedBy, status: 'QUEUED', statusHistory: [{ status: 'QUEUED', at: now }],
      };

      let status;
      let reason = null;
      if (!phone) { status = 'SKIPPED_NO_CONTACT'; reason = 'No phone number on the account'; }
      else if (pref?.whatsappOptIn?.status !== 'OPTED_IN') { status = 'SKIPPED_NO_CONSENT'; reason = 'Recipient has not opted in to WhatsApp messages'; }
      else if (urgency !== 'URGENT' && inQuietHours(now, pref?.quietHours ?? { enabled: true, startHour: 21, endHour: 7 })) {
        status = 'DEFERRED'; reason = 'Quiet hours'; row.scheduledFor = quietEnds(now, pref?.quietHours);
      }

      if (!status) {
        if (!isWhatsappLive()) {
          status = 'SIMULATED'; reason = 'WhatsApp is not configured; nothing was sent';
          logger.info(`[WhatsApp SIMULATION] template ${templateKey} → ${mask(phone)}: ${preview.slice(0, 160)}`);
        } else if (!templateName(templateKey)) {
          status = 'SKIPPED_TEMPLATE_NOT_CONFIGURED'; reason = `Set WA_TEMPLATE_${templateKey} to the approved template name`;
        } else {
          row.attempts = 1;
          try {
            // eslint-disable-next-line no-await-in-loop -- sends are sequential per recipient
            const out = await transport({ to: phone, template: templateName(templateKey), variables, language: pref?.language });
            if (out.ok) { status = 'SENT'; row.providerMessageId = out.providerMessageId; }
            else { status = out.unknown ? 'UNKNOWN' : 'FAILED'; reason = out.error ?? null; }
          } catch (err) {
            status = err?.name === 'TimeoutError' ? 'UNKNOWN' : 'FAILED';
            reason = err.message;
          }
        }
      }
      row.status = status;
      row.statusReason = reason;
      row.statusHistory.push({ status, at: new Date(), detail: reason ?? undefined });
      try {
        // eslint-disable-next-line no-await-in-loop
        await MessageOutbox.create(row);
      } catch (err) {
        // A concurrent identical request won the unique index: that is the dedupe working.
        if (err?.code !== 11000) logger.error(`Outbox write failed: ${err.message}`);
      }
      results.push({ recipientProfileId: pid, status });
    }
  }
  return results;
}

/**
 * Sends the messages that were held for quiet hours and are now due. There is
 * no scheduler in the app, so this runs when an administrator (or an external
 * scheduler calling the route) asks for it; running it twice sends nothing
 * twice, because a row leaves DEFERRED the first time.
 */
export async function releaseDeferred(actor, { now = new Date() } = {}) {
  requireProfile(actor);
  const due = await MessageOutbox.find({ status: 'DEFERRED', channel: 'WHATSAPP', scheduledFor: { $lte: now } }).limit(500);
  const counts = {};
  for (const row of due) {
    /* eslint-disable no-await-in-loop -- sends are sequential per recipient */
    const profile = await Profile.findById(row.recipientProfileId).select('accountId').lean();
    const account = profile ? await Account.findById(profile.accountId).select('phoneE164').lean() : null;
    const pref = await ContactPreference.findOne({ profileId: row.recipientProfileId }).lean();
    const phone = account?.phoneE164;
    let status;
    let reason = null;
    // Consent and contact details may have changed while the message waited.
    if (!phone) { status = 'SKIPPED_NO_CONTACT'; reason = 'No phone number on the account'; }
    else if (pref?.whatsappOptIn?.status !== 'OPTED_IN') { status = 'SKIPPED_NO_CONSENT'; reason = 'Recipient has not opted in to WhatsApp messages'; }
    else if (!isWhatsappLive()) { status = 'SIMULATED'; reason = 'WhatsApp is not configured; nothing was sent'; }
    else if (!templateName(row.templateKey)) { status = 'SKIPPED_TEMPLATE_NOT_CONFIGURED'; reason = `Set WA_TEMPLATE_${row.templateKey} to the approved template name`; }
    else {
      row.attempts = (row.attempts ?? 0) + 1;
      try {
        const out = await transport({ to: phone, template: templateName(row.templateKey), variables: row.variables, language: pref?.language });
        if (out.ok) { status = 'SENT'; row.providerMessageId = out.providerMessageId; }
        else { status = out.unknown ? 'UNKNOWN' : 'FAILED'; reason = out.error ?? null; }
      } catch (err) {
        status = err?.name === 'TimeoutError' ? 'UNKNOWN' : 'FAILED';
        reason = err.message;
      }
    }
    row.status = status;
    row.statusReason = reason;
    row.statusHistory.push({ status, at: new Date(), detail: reason ?? undefined });
    await row.save();
    /* eslint-enable no-await-in-loop */
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { released: due.length, byStatus: counts };
}

const STATUS_RANK = { SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Applies Meta status callbacks (sent/delivered/read/failed). Callbacks can
 * arrive out of order and more than once, so a status only ever moves
 * forward — a late "delivered" never overwrites "read".
 */
export async function applyProviderStatuses(payload) {
  const statuses = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) statuses.push(s);
    }
  }
  let applied = 0;
  for (const s of statuses) {
    const next = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[s.status];
    if (!next || !s.id) continue;
    // Status callbacks arrive outside any school context; the provider id is unique.
    // eslint-disable-next-line no-await-in-loop
    const row = await MessageOutbox.findOne({ providerMessageId: s.id });
    if (!row) continue;
    const forward = next === 'FAILED' ? row.status === 'SENT' : (STATUS_RANK[next] ?? 0) > (STATUS_RANK[row.status] ?? 0);
    if (!forward) continue;
    row.status = next;
    row.statusHistory.push({ status: next, at: new Date(), detail: s.errors?.[0]?.title });
    // eslint-disable-next-line no-await-in-loop
    await row.save();
    applied += 1;
  }
  return { applied };
}

export async function listOutbox(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (scope !== 'ALL') filter.recipientProfileId = actor.profileId;
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.relatedEntityId) filter.relatedEntityId = String(query.relatedEntityId);
  const p = pageArgs(query);
  return pageOf(MessageOutbox, filter, { ...p, select: '-variables' });
}

export async function getPreferences(actor) {
  requireProfile(actor);
  const pref = await ContactPreference.findOne({ profileId: actor.profileId }).lean();
  return pref ? dto(pref) : { profileId: actor.profileId, whatsappOptIn: { status: 'UNKNOWN' }, language: 'en', quietHours: { enabled: true, startHour: 21, endHour: 7 } };
}

/** A person records their own opt-in or opt-out; nobody can do it for them. */
export async function updatePreferences(actor, body = {}) {
  requireProfile(actor);
  const set = {};
  if (body.whatsappOptIn !== undefined) {
    const status = body.whatsappOptIn ? 'OPTED_IN' : 'OPTED_OUT';
    set.whatsappOptIn = { status, at: new Date(), source: 'portal' };
  }
  if (typeof body.language === 'string') set.language = body.language.slice(0, 10);
  if (body.quietHours && typeof body.quietHours === 'object') {
    const s = Number(body.quietHours.startHour);
    const e = Number(body.quietHours.endHour);
    set.quietHours = {
      enabled: body.quietHours.enabled !== false,
      startHour: Number.isInteger(s) && s >= 0 && s <= 23 ? s : 21,
      endHour: Number.isInteger(e) && e >= 0 && e <= 23 ? e : 7,
    };
  }
  const doc = await ContactPreference.findOneAndUpdate(
    { profileId: actor.profileId },
    { $set: set, $setOnInsert: { profileId: actor.profileId } },
    { upsert: true, new: true },
  ).lean();
  return dto(doc);
}

export function channelStatus() {
  return {
    whatsapp: {
      mode: isWhatsappLive() ? 'LIVE' : 'SIMULATION',
      templates: Object.keys(TEMPLATES).map((key) => ({ key, category: TEMPLATES[key].category, configuredName: templateName(key) })),
    },
    sms: { mode: 'NOT_CONFIGURED' },
    email: { mode: 'NOT_CONFIGURED' },
  };
}
