import * as family from '../../../family/family.service.js';
import * as messaging from '../../../messaging/messaging.service.js';
import * as growth from '../../../growth/growth.service.js';
import { audienceFilterFor } from '../../../announcements/announcement.service.js';
import { childrenOf } from '../../../ptm/relations.js';
import { Announcement } from '../../../../models/announcement.model.js';
import { LANGUAGE_NAMES } from '../../../../utils/language.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed } from './_shared.js';

/**
 * Part 4, the parent: what a parent does on the family screens that the
 * assistant (web Ask AI and WhatsApp) could not do yet.
 *
 *   get_family_today            every child at once: today's register mark,
 *                               homework due, fees, next exam, and what is
 *                               waiting for the parent (consents, out-passes,
 *                               PTM booking, unread teacher messages). A parent
 *                               with several children gets one answer instead
 *                               of "which child?" for each question.
 *   get_fee_tax_statement       tuition and other fees paid in a financial year,
 *                               per child, for the Section 80C claim.
 *   translate_school_notice     a school notice in the family's language (AI,
 *                               labelled; the English notice stays official).
 *   get_child_growth_view       the transparent growth score the Student View
 *                               page shows (marks and attendance).
 *   set_my_message_preferences  the language for school messages, WhatsApp
 *                               updates on/off and quiet hours. Confirmed.
 *
 * Same contract as every other tool file: the module's own service, with the
 * caller's own actor, limited to their own linked children; the one write is
 * proposed, summarised and run only on that same person's "yes".
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const rupees = (paise) => `₹${(Math.round(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const TODAY_WORD = { PRESENT: 'present', ABSENT: 'absent', LATE: 'late', EXCUSED: 'excused', HALF_DAY: 'half day', NOT_MARKED: 'not marked yet', NOT_ENROLLED: 'not enrolled this year' };

function parentOnly(ctx, what) {
  if (ctx.actor?.roleKey !== 'PARENT') throw new AppError(`${what} is for parents and guardians.`, 403, [], 'ROLE_NOT_PERMITTED');
}

/** "Hindi", "hindi", "hi", "हिन्दी" → 'hi'. */
function languageCode(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (family.FAMILY_LANGUAGES.includes(s)) return s;
  for (const code of family.FAMILY_LANGUAGES) {
    if (String(LANGUAGE_NAMES[code] ?? '').toLowerCase() === s) return code;
    if (family.languageName(code).toLowerCase().includes(s)) return code;
  }
  throw new AppError(`I can use: ${family.FAMILY_LANGUAGES.map((c) => LANGUAGE_NAMES[c] ?? c).join(', ')}.`, 400, [], 'AGENT_NEEDS_INPUT');
}

async function childNamed(ctx, name) {
  const kids = await childrenOf(ctx.actor.profileId);
  if (!kids.length) throw new AppError('No children are linked to your number yet. The school office can link them.', 404);
  if (name) return theNamed(kids, name, { label: 'child of yours', nameOf: (k) => k.name, describe: (k) => k.name });
  if (kids.length === 1) return kids[0];
  throw new AppError(`Which child — ${kids.map((k) => k.name).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

export const p4ParentTools = {
  get_family_today: {
    module: 'Family',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A parent's day across all their children at once: today's attendance mark for each child, homework due in the next few days, fees outstanding, the next exam, and everything waiting for the parent (fees past due, club consent, hostel out-pass, health-room consent, PTM slot to book, unread teacher messages). Use for 'how are my kids today', 'anything I need to do', 'good morning'. Read-only.",
    inputSchema: closed({}),
    permission: 'students.read',
    forRoles: ['PARENT'],
    service: 'family.service.familyToday()',
    async run(ctx) {
      parentOnly(ctx, 'The family summary');
      const d = await family.familyToday(ctx.actor);
      if (!d.children.length) return ok(d, { speak: 'No children are linked to your number yet. The school office can link them.' });
      const kidLines = d.children.map((c) => {
        const bits = [`${c.firstName} (${c.className ?? 'no class'}): ${TODAY_WORD[c.today] ?? c.today} today`];
        if (c.homeworkDue.length) bits.push(`${c.homeworkDue.length} homework due soon (${c.homeworkDue.slice(0, 2).map((h) => h.title).join(', ')})`);
        if (c.pendingFeesPaise > 0) bits.push(`fees ${rupees(c.pendingFeesPaise)} outstanding`);
        if (c.nextExam) bits.push(`next exam ${c.nextExam.subject} on ${c.nextExam.on}`);
        return bits.join('; ');
      });
      const todo = d.actions.length ? ` Waiting for you: ${d.actions.slice(0, 4).map((a) => a.text).join('; ')}${d.actions.length > 4 ? ` (+${d.actions.length - 4} more on the dashboard)` : ''}.` : ' Nothing is waiting for you.';
      return ok(d, { speak: `${kidLines.join('. ')}.${todo}` });
    },
  },

  get_fee_tax_statement: {
    module: 'Family',
    operation: 'GET',
    risk: RISK.LOW,
    description: "For a parent: the fees paid to the school in one Indian financial year (April to March), per child, split into tuition and other charges, with receipt numbers. Tuition is what Section 80C of the Income-tax Act allows (up to two children). Use for 'tuition fee for tax', '80C', 'fees paid last year'. Read-only.",
    inputSchema: closed({
      financialYear: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'e.g. "2025-26"; the current year when left out' },
      childName: text(80, 'One child only; all children when left out'),
    }),
    permission: 'fees.read',
    forRoles: ['PARENT'],
    service: 'family.service.feeStatement()',
    async run(ctx, args) {
      parentOnly(ctx, 'The fee statement');
      const child = args.childName ? await childNamed(ctx, args.childName) : null;
      const s = await family.feeStatement(ctx.actor, { fy: args.financialYear, studentId: child?.studentId });
      const lines = s.children.map((c) => `${c.name}: paid ${rupees(c.totalPaise)}, of which tuition ${rupees(c.tuitionPaise)} (${c.payments.length} receipt${c.payments.length === 1 ? '' : 's'})`);
      return ok(s, { speak: `Financial year ${s.financialYear} (${s.from} to ${s.to}). ${lines.join('. ')}. ${s.note}` });
    },
  },

  translate_school_notice: {
    module: 'Family',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A school notice (announcement) put into the reader's language by the AI service, e.g. 'explain the latest circular in Hindi'. Picks the notice by words from its title, or the latest one. The English notice remains the official one and is shown beside it. Read-only.",
    inputSchema: closed({
      notice: text(160, 'Words from the notice title; the latest notice when left out'),
      language: text(40, 'e.g. Hindi, Marathi, Tamil; the language set in your message preferences when left out'),
    }),
    permission: 'announcements.read',
    service: 'family.service.translateAnnouncement()',
    async run(ctx, args) {
      const lang = languageCode(args.language) ?? (await messaging.getPreferences(ctx.actor))?.language ?? null;
      if (!lang || lang === 'en') throw new AppError('Which language should I put it in? For example Hindi, Marathi or Tamil.', 400, [], 'AGENT_NEEDS_INPUT');
      const recent = await Announcement.find({ deletedAt: null, ...(await audienceFilterFor(ctx.actor)) }).sort({ publishedAt: -1 }).limit(30).select('title').lean();
      if (!recent.length) return ok({ notices: 0 }, { speak: 'There are no school notices for you right now.' });
      const pick = args.notice ? theNamed(recent.map((a) => ({ id: String(a._id), name: a.title })), args.notice, { label: 'notice', nameOf: (a) => a.name, describe: (a) => a.name }) : { id: String(recent[0]._id) };
      const t = await family.translateAnnouncement(ctx.actor, { announcementId: pick.id, lang });
      if (!t.available) return ok(t, { speak: `${t.label}\n\n${t.original.title}: ${t.original.content}` });
      return ok(t, { speak: `${t.title}\n\n${t.content}\n\n(${t.label})` });
    },
  },

  get_child_growth_view: {
    module: 'Family',
    operation: 'GET',
    risk: RISK.LOW,
    description: "For a parent: their child's growth score this month, the same transparent figure the Student View page shows (60% published marks, 40% attendance), with each part explained. Never compared with other children. Read-only.",
    inputSchema: closed({ childName: text(80, 'For a parent with several children') }),
    permission: 'analytics.child.read',
    forRoles: ['PARENT'],
    service: 'growth.service.getScore()',
    async run(ctx, args) {
      parentOnly(ctx, 'The growth view');
      const child = await childNamed(ctx, args.childName);
      if (!child.enrollmentId) return ok({ child: child.name }, { speak: `${child.name} is not enrolled in a class this year.` });
      const period = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
      const g = await growth.getScore(child.enrollmentId, period);
      const parts = (g?.breakdown ?? []).map((b) => `${b.component} ${b.raw}% → ${b.points} of ${Math.round(b.weight * 100)} points`);
      return ok({ child: child.name, period, score: g?.score ?? null, breakdown: g?.breakdown ?? [] }, { speak: `${child.name}'s growth score for ${period} is ${g?.score ?? 'not available'} out of 100 (${parts.join('; ')}). It is built only from ${child.name.split(' ')[0]}'s own marks and attendance.` });
    },
  },

  set_my_message_preferences: {
    module: 'Family',
    operation: 'UPDATE',
    risk: RISK.LOW,
    confirm: true,
    description: "Change how the school contacts you: the language for school messages (e.g. Hindi), WhatsApp updates on or off, and quiet hours (no non-urgent messages between two hours). Needs confirmation.",
    inputSchema: closed({
      language: text(40, 'e.g. Hindi, Marathi, English'),
      whatsappUpdates: { type: 'boolean', description: 'true to receive WhatsApp updates, false to stop them' },
      quietFromHour: { type: 'integer', minimum: 0, maximum: 23 },
      quietUntilHour: { type: 'integer', minimum: 0, maximum: 23 },
    }),
    permission: 'ai.copilot.use',
    service: 'messaging.service.updatePreferences()',
    summarise: (_a, _actor, p) => `Update how the school contacts you: ${p.describe}`,
    async prepare(ctx, args) {
      const body = {};
      const said = [];
      if (args.language) { body.language = languageCode(args.language); said.push(`messages in ${LANGUAGE_NAMES[body.language] ?? body.language}`); }
      if (typeof args.whatsappUpdates === 'boolean') { body.whatsappOptIn = args.whatsappUpdates; said.push(args.whatsappUpdates ? 'WhatsApp updates on' : 'WhatsApp updates off'); }
      if (args.quietFromHour != null || args.quietUntilHour != null) {
        const cur = (await messaging.getPreferences(ctx.actor))?.quietHours ?? { startHour: 21, endHour: 7 };
        body.quietHours = { enabled: true, startHour: args.quietFromHour ?? cur.startHour, endHour: args.quietUntilHour ?? cur.endHour };
        said.push(`quiet hours ${String(body.quietHours.startHour).padStart(2, '0')}:00 to ${String(body.quietHours.endHour).padStart(2, '0')}:00`);
      }
      if (!said.length) throw new AppError('What should change: the language, WhatsApp updates, or quiet hours?', 400, [], 'AGENT_NEEDS_INPUT');
      return { body, describe: said.join(', ') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const saved = await messaging.updatePreferences(ctx.actor, plan.body);
      return action({ type: 'message_preferences_updated', data: { language: saved.language, whatsapp: saved.whatsappOptIn?.status, quietHours: saved.quietHours }, speak: `Done: ${plan.describe}.` });
    },
  },
};
