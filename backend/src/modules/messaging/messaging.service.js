import { MessageOutbox, ContactPreference } from '../../models/messaging.model.js';
import { Profile } from '../../models/profile.model.js';
import { Account } from '../../models/account.model.js';
import { env, isWhatsappLive } from '../../config/env.js';
import { notify } from '../notifications/notification.service.js';
import { sendEmail, isEmailLive } from '../../providers/notification.provider.js';
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
  CLASS_SCHEDULED: {
    category: 'UTILITY',
    subject: (v) => `Online class: ${v.title}`,
    text: (v) => `Online class "${v.title}" is scheduled for ${v.when}${v.host ? ` with ${v.host}` : ''}. Join from EduOS.`,
  },
  CLASS_REMINDER: {
    category: 'UTILITY',
    subject: (v) => `Starting soon: ${v.title}`,
    text: (v) => `Reminder: online class "${v.title}" starts at ${v.when}. Join from EduOS.`,
  },
  CLASS_CHANGED: {
    category: 'UTILITY',
    subject: (v) => `Changed: ${v.title}`,
    text: (v) => `Online class "${v.title}" has moved to ${v.when}. Join from EduOS.`,
  },
  CLASS_CANCELLED: {
    category: 'UTILITY',
    subject: (v) => `Cancelled: ${v.title}`,
    text: (v) => `Online class "${v.title}" on ${v.when} is cancelled${v.reason ? `: ${v.reason}` : ''}.`,
  },
  GENERAL_NOTICE: {
    category: 'UTILITY',
    text: (v) => `${v.title}. Please check EduOS for details.`,
  },
  // Sent to a student's guardians when the day's register marks them absent or
  // late (modules/attendance-alerts). States only what the register says; the
  // school may still correct a mark, so the wording does not claim more.
  TASK_DUE: {
    category: 'UTILITY',
    text: (v) => `${v.title} is due ${v.days === 0 ? 'today' : v.days === 1 ? 'tomorrow' : `in ${v.days} days`} (${v.when}). See your tasks in EduOS.`,
  },
  TASK_OVERDUE: {
    category: 'UTILITY',
    text: (v) => `Overdue ${v.days} day(s): ${v.title} (${v.department}). It needs an owner's action; see the exceptions list in EduOS.`,
  },
  // Quarterly decision report ready (modules/analytics/quarterly.service.js). Says only that it exists; the figures stay behind sign-in.
  QUARTERLY_REPORT_READY: {
    category: 'UTILITY',
    subject: (v) => `Quarterly report ready: ${v.quarter}`,
    text: (v) => `The quarterly report for ${v.quarter} (version ${v.version}) is ready. Open Quarterly Reports in EduOS to read or download it.`,
  },
  // Transport and safety (modules/fleet, modules/safety, hostel out-pass).
  // Short and factual: the record in EduOS carries the detail.
  SAFETY_ALERT: {
    category: 'UTILITY',
    subject: (v) => `Safety alert: ${String(v.title).slice(0, 80)}`,
    text: (v) => `${v.title}. Open EduOS to see and act on it.`,
  },
  TRIP_UPDATE: {
    category: 'UTILITY',
    text: (v) => `${v.studentName}: ${v.update}. See "My bus today" in EduOS.`,
  },
  OUTPASS_UPDATE: {
    category: 'UTILITY',
    text: (v) => `Hostel out-pass ${v.refNo} for ${v.studentName}: ${v.update}. Open EduOS for details.`,
  },
  VISITOR_UPDATE: {
    category: 'UTILITY',
    text: (v) => `Visitor ${v.name} (${v.purpose}): ${v.update}. Open EduOS to respond.`,
  },
  // Content-free on purpose: camera observations are restricted.
  CAMERA_REVIEW_PENDING: {
    category: 'UTILITY',
    text: () => 'A camera observation is waiting for human review. Open EduOS (Camera review) to decide.',
  },
  // PTM, review calls, conversations, staff leave/cover and report cards
  // (modules/ptm, modules/staff, modules/reportcards). Say that something
  // happened and link to the page; never the detail.
  PTM_BOOKED: {
    category: 'UTILITY',
    subject: (v) => `PTM booked: ${v.when}`,
    text: (v) => `PTM booked with ${v.teacher} for ${v.student} on ${v.when}${v.venue ? ` (${v.venue})` : ''}. Details in EduOS.`,
  },
  PTM_REMINDER: {
    category: 'UTILITY',
    subject: (v) => `PTM reminder: ${v.when}`,
    text: (v) => `Reminder: your PTM with ${v.teacher} for ${v.student} is ${v.lead} (${v.when}). Details in EduOS.`,
  },
  PTM_CANCELLED: {
    category: 'UTILITY',
    subject: (v) => `PTM cancelled: ${v.when}`,
    text: (v) => `The PTM with ${v.teacher} for ${v.student} on ${v.when} was cancelled${v.reason ? `: ${v.reason}` : ''}. You can book another time in EduOS.`,
  },
  PTM_SLOT_OFFERED: {
    category: 'UTILITY',
    subject: (v) => `A PTM slot is free: ${v.when}`,
    text: (v) => `A PTM slot with ${v.teacher} on ${v.when} is held for you until ${v.until}. Accept it in EduOS.`,
  },
  REVIEW_CALL_ASSIGNED: {
    category: 'UTILITY',
    text: (v) => `A parent review call (${v.ref}) is assigned to you. Open EduOS to see the case.`,
  },
  CONVERSATION_MESSAGE: {
    category: 'UTILITY',
    subject: (v) => `New message about ${v.student}`,
    text: (v) => `${v.from} sent you a message about ${v.student}. Read and reply in EduOS.`,
  },
  STAFF_LEAVE_REQUESTED: {
    category: 'UTILITY',
    text: (v) => `${v.name} applied for ${v.days} day(s) of leave from ${v.from}. Review it in EduOS.`,
  },
  STAFF_LEAVE_DECIDED: {
    category: 'UTILITY',
    text: (v) => `Your leave from ${v.from} (${v.days} day(s)) was ${String(v.decision).toLowerCase()}. Details in EduOS.`,
  },
  COVER_ASSIGNED: {
    category: 'UTILITY',
    subject: (v) => `Cover: ${v.className} period ${v.period} on ${v.date}`,
    text: (v) => `Cover arranged for ${v.className}, period ${v.period} (${v.time}) on ${v.date}: ${v.substitute} takes the lesson in place of ${v.absent}.`,
  },
  REPORT_CARD_PUBLISHED: {
    category: 'UTILITY',
    subject: (v) => `Report card: ${v.term}`,
    text: (v) => `The ${v.term} report card for ${v.student} is published${v.version > 1 ? ` (corrected version ${v.version})` : ''}. View and download it in EduOS.`,
  },
  ATTENDANCE_ALERT: {
    category: 'UTILITY',
    subject: (v) => `${v.studentName} marked ${v.statusLabel} on ${v.date}`,
    text: (v) => `${v.studentName} was marked ${v.statusLabel} in today's register (${v.date}). If this is unexpected, please contact the class teacher. You can apply for leave in EduOS.`,
  },
  // Clubs and teams (modules/clubs).
  CLUB_CONSENT_NEEDED: {
    category: 'UTILITY',
    subject: (v) => `Consent needed: ${v.club}`,
    text: (v) => `${v.student} asked to join ${v.club}. Please give or refuse your consent in EduOS (Clubs).`,
  },
  CLUB_JOIN_REQUEST: {
    category: 'UTILITY',
    text: (v) => `A request to join ${v.club} is waiting for your decision. Open EduOS (Clubs) to review it.`,
  },
  CLUB_JOIN_DECIDED: {
    category: 'UTILITY',
    subject: (v) => `${v.club}: ${v.outcome}`,
    text: (v) => `${v.student}'s request to join ${v.club}: ${v.outcome}. Details in EduOS.`,
  },
  CLUB_SESSION_CANCELLED: {
    category: 'UTILITY',
    text: (v) => `The ${v.club} session on ${v.when} is cancelled${v.reason ? `: ${v.reason}` : ''}.`,
  },
  // Online admission form (modules/admissions/online.service.js).
  ADMISSION_ACK: {
    category: 'UTILITY',
    subject: (v) => `Application received: ${v.ref}`,
    text: (v) => `${v.school} has received the admission application for ${v.child}. Your reference number is ${v.ref}. Use it with this phone number to check the status online. No fee is due at this stage.`,
  },
  ADMISSION_RECEIVED: {
    category: 'UTILITY',
    text: (v) => `New online admission application ${v.ref}: ${v.child} for ${v.grade}. Open the admissions CRM in EduOS to follow up.`,
  },
  DIGEST_READY: {
    category: 'UTILITY',
    subject: (v) => `Your daily digest for ${v.day}`,
    text: (v) => `Your daily digest is ready: ${v.count} headline(s) from feeds your school approved${v.top ? `, starting with "${v.top}"` : ''}. Read it in EduOS.`,
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

const maskEmail = (email) => (email ? String(email).replace(/^(.).*(@.*)$/, '$1***$2') : null);

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

  // The in-app copy always goes; it is the fallback for every skip below. A
  // repeat of the same message (same idempotency key) is not announced again,
  // so a scheduled reminder that runs every hour notifies once.
  const already = new Set((await MessageOutbox.find({ idempotencyKey, recipientProfileId: { $in: recipients } }).select('recipientProfileId').lean()).map((m) => String(m.recipientProfileId)));
  const fresh = recipients.filter((id) => !already.has(id));
  if (fresh.length) await notify({ recipientProfileIds: fresh, type: 'SYSTEM', title: preview.slice(0, 140), body: preview, link });

  const [profiles, prefs] = await Promise.all([
    Profile.find({ _id: { $in: recipients } }).select('_id accountId').lean(),
    ContactPreference.find({ profileId: { $in: recipients } }).lean(),
  ]);
  const accounts = await Account.find({ _id: { $in: profiles.map((p) => p.accountId) } }).select('_id phoneE164 email').lean();
  const phoneByAccount = new Map(accounts.map((a) => [String(a._id), a.phoneE164]));
  const emailByAccount = new Map(accounts.map((a) => [String(a._id), a.email ?? null]));
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

      const email = emailByAccount.get(String(profile.accountId));
      const row = {
        channel, templateKey, category: template.category, recipientProfileId: pid,
        recipientMasked: channel === 'EMAIL' ? maskEmail(email) : mask(phone), variables, preview, link, urgency, idempotencyKey,
        relatedEntityType, relatedEntityId: relatedEntityId ? String(relatedEntityId) : null,
        requestedByProfileId: requestedBy, status: 'QUEUED', statusHistory: [{ status: 'QUEUED', at: now }],
      };

      let status;
      let reason = null;
      if (channel === 'EMAIL') {
        // Email: no template approval and no quiet hours, but the same honesty
        // about whether anything actually left the server.
        if (!email) { status = 'SKIPPED_NO_CONTACT'; reason = 'No email address on the account'; }
        else if (pref?.emailOptOut) { status = 'SKIPPED_NO_CONSENT'; reason = 'Recipient has turned off email messages'; }
        else {
          row.attempts = 1;
          // eslint-disable-next-line no-await-in-loop -- sends are sequential per recipient
          const out = await sendEmail({ to: email, subject: (template.subject ? template.subject(variables) : preview).slice(0, 150), text: `${preview}${link ? `\n\nOpen EduOS to see the details.` : ''}` });
          if (out.sent) { status = 'SENT'; row.providerMessageId = out.id ?? null; }
          else if (out.simulated) { status = 'SIMULATED'; reason = 'Email is not configured; nothing was sent'; }
          else { status = out.unknown ? 'UNKNOWN' : 'FAILED'; reason = out.error ?? null; }
        }
      } else if (!phone) { status = 'SKIPPED_NO_CONTACT'; reason = 'No phone number on the account'; }
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
  // The scheduler calls this with no person behind it.
  if (!actor?.system) requireProfile(actor);
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
  return pref ? dto(pref) : { profileId: actor.profileId, whatsappOptIn: { status: 'UNKNOWN' }, emailOptOut: false, language: 'en', quietHours: { enabled: true, startHour: 21, endHour: 7 } };
}

/** A person records their own opt-in or opt-out; nobody can do it for them. */
export async function updatePreferences(actor, body = {}) {
  requireProfile(actor);
  const set = {};
  if (body.whatsappOptIn !== undefined) {
    const status = body.whatsappOptIn ? 'OPTED_IN' : 'OPTED_OUT';
    set.whatsappOptIn = { status, at: new Date(), source: 'portal' };
  }
  if (typeof body.emailOptOut === 'boolean') set.emailOptOut = body.emailOptOut;
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
    email: { mode: isEmailLive() ? 'LIVE' : 'SIMULATION' },
  };
}
