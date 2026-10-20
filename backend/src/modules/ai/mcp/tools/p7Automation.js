import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, noArgs } from './_shared.js';
import * as automations from '../../../automations/automations.service.js';
import * as personal from '../../../automations/personal.js';
import { AUTOMATION_KEYS, automationDef, weekdayName } from '../../../automations/automations.catalogue.js';
import { AutomationDraft } from '../../../../models/automation.model.js';

/**
 * Part 7: automation through Ask AI (and WhatsApp).
 *
 *   get_what_needs_me_today     GET     the caller's day: tasks, decisions, registers, drafts, reminders, family items
 *   list_my_reminders           GET     the caller's own scheduled reminders and reports
 *   create_my_reminder          CREATE  "remind me every Friday to submit lesson plans" / "every morning send me absent staff"
 *   stop_my_reminder            UPDATE  "stop the Friday reminder", "cancel reminder 2"
 *   list_school_automations     GET     the school's automations, their schedule, audience and a sample message
 *   set_school_automation       UPDATE  switch one on/off, its hour, weekday or audience (website only: affects others)
 *   list_automation_drafts      GET     drafts an automation prepared for the caller (cover, purchase request)
 *   confirm_automation_draft    ACTION  carry a draft out (assign the covers / create the DRAFT purchase request; website only)
 *   dismiss_automation_draft    UPDATE  set a draft aside
 *   set_my_automation_optin     UPDATE  opt in or out of the weekly child digest / birthday greetings
 *
 * Every write is a draft the same person confirms (confirm: true); personal
 * reminders reach only the person who set them; school-wide changes and
 * drafts that touch other people's records are confirmed on the website.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const ask = (message) => new AppError(message, 400, [], 'AGENT_NEEDS_INPUT');
const viaOf = (ctx) => (ctx?.channel === 'WHATSAPP' ? 'WHATSAPP' : 'ASK_AI');
const fmtNext = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);

const scheduleProps = {
  frequency: { type: 'string', enum: ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'], description: 'How often' },
  weekdays: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'WEEKLY: 0 Sunday ... 6 Saturday' },
  dayOfMonth: { type: 'integer', minimum: 1, maximum: 28, description: 'MONTHLY: the day' },
  onDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'ONCE: YYYY-MM-DD' },
  hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Hour of day, 24h (default 9)' },
  minute: { type: 'integer', minimum: 0, maximum: 59 },
};

async function theDraft(ctx, args) {
  const drafts = await automations.listDrafts(ctx.actor, { status: 'DRAFT' });
  if (!drafts.length) throw new AppError('There are no automation drafts waiting for you.', 404, [], 'NOT_FOUND');
  let d = null;
  if (args.draftId) d = drafts.find((x) => x.id === args.draftId);
  else if (Number.isInteger(args.number)) d = drafts[args.number - 1];
  else if (drafts.length === 1) [d] = drafts;
  if (!d) throw ask(`Which draft? ${drafts.slice(0, 8).map((x, i) => `${i + 1}. ${x.title}`).join('; ')}`);
  return d;
}

export const p7AutomationTools = {
  get_what_needs_me_today: {
    module: 'Automations', operation: 'GET', risk: RISK.LOW,
    description: 'What needs the caller today, for any role: tasks due or overdue, approvals waiting, class registers still to take, periods without cover, automation drafts to confirm, their own reminders due today, and for a parent each child\'s homework and fees, for a student homework due soon. Use for "what needs me today", "what is on my plate", "what should I do today", "anything pending for me today", "my to-do for today". Read-only.',
    inputSchema: noArgs,
    permission: 'ai.copilot.use',
    service: 'automations.service.whatNeedsMe()',
    async run(ctx) {
      const out = await automations.whatNeedsMe(ctx.actor);
      if (!out.items.length) return ok(out, { speak: 'Nothing needs you right now: no tasks due, nothing waiting for a decision and no reminders today.' });
      return ok(out, {
        speak: `Today (${out.date}): ${out.items.map((i) => i.title).join('; ')}.`,
        view: { type: 'list.numbered', intro: `**What needs you today** (${out.date})`, items: out.items.map((i) => ({ label: i.title, detail: i.examples?.length ? i.examples.join(', ') : undefined })) },
      });
    },
  },

  list_my_reminders: {
    module: 'Automations', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The caller\'s own scheduled reminders and reports (set up in Ask AI or on the Automations page), each with when it runs next. Use for "show my reminders", "what reminders do I have", "my scheduled reports", "list my automations". Read-only.',
    inputSchema: noArgs,
    permission: 'ai.copilot.use',
    service: 'automations/personal.listMine()',
    async run(ctx) {
      const rows = await personal.listMine(ctx.actor);
      if (!rows.length) return ok({ reminders: [] }, { speak: 'You have no reminders or scheduled reports. Try "remind me every Friday at 4 pm to submit lesson plans".' });
      return ok({ reminders: rows }, {
        speak: `You have ${rows.length} reminder(s) and report(s): ${rows.map((r, i) => `${i + 1}. ${r.kind === 'REPORT' ? `report "${r.text}"` : `"${r.text}"`} ${r.when}`).join('; ')}.`,
        view: { type: 'list.numbered', intro: `**Your reminders and reports** (${rows.length})`, items: rows.map((r) => ({ label: r.kind === 'REPORT' ? `Report: ${r.text}` : r.text, detail: `${r.when}${r.nextRunAt ? ` — next ${fmtNext(r.nextRunAt)}` : ''}` })) },
      });
    },
  },

  create_my_reminder: {
    module: 'Automations', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Set up a personal reminder or a scheduled report for the caller only: "remind me every Friday to submit lesson plans", "remind me tomorrow at 3 pm to call the transport office", "every morning send me the list of absent staff". kind REMINDER (with text) or REPORT (with reportKey: ABSENT_STAFF, ABSENT_STUDENTS, UNMARKED_REGISTERS, PENDING_TASKS, PENDING_APPROVALS, TODAY_BRIEFING, OVERDUE_FEES, LIBRARY_OVERDUE — only ones the caller may see). Delivered in the app (and WhatsApp if they opted in; reports also by email). Needs confirmation.',
    inputSchema: closed({
      kind: { type: 'string', enum: ['REMINDER', 'REPORT'] },
      text: text(300, 'What to be reminded about'),
      reportKey: { type: 'string', enum: personal.REPORT_KEYS },
      ...scheduleProps,
    }, ['frequency']),
    permission: 'ai.copilot.use',
    service: 'automations/personal.createMine()',
    async prepare(ctx, args) {
      return personal.prepareCreate(ctx.actor, args);
    },
    summarise: (_a, _actor, p) => `Set up ${p.kind === 'REPORT' ? `a report "${p.text}"` : `a reminder "${p.text}"`} for you, ${p.when} (first on ${fmtNext(p.nextRunAt)}). Only you receive it; say "stop" any time to end it.`,
    async run(ctx, args) {
      const saved = await personal.createMine(ctx.actor, args, { via: viaOf(ctx) });
      return action({ type: 'personal_reminder_created', id: saved.id, data: saved, speak: `Done. ${saved.kind === 'REPORT' ? `I'll send you "${saved.text}"` : `I'll remind you to ${saved.text}`} ${saved.when}; the first one is ${fmtNext(saved.nextRunAt)}. Say "show my reminders" to see them all.` });
    },
  },

  stop_my_reminder: {
    module: 'Automations', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Stop one of the caller\'s own reminders or scheduled reports: by words ("the Friday reminder", "lesson plan reminder", "the absent staff report"), by its number in "show my reminders", or all of them. Use for "stop the Friday reminder", "cancel my lesson plan reminder", "delete reminder 2", "stop all my reminders". Needs confirmation.',
    inputSchema: closed({ match: text(200, 'Words that identify it'), number: { type: 'integer', minimum: 1, maximum: 50 }, all: { type: 'boolean' } }),
    permission: 'ai.copilot.use',
    service: 'automations/personal.stopMine()',
    async prepare(ctx, args) {
      const found = await personal.findMine(ctx.actor, args);
      if (found.none) throw new AppError('You have no active reminders or reports to stop.', 404, [], 'NOT_FOUND');
      if (found.ambiguous || !found.rows.length) {
        const mine = await personal.listMine(ctx.actor);
        throw ask(`${found.rows.length ? 'Which one' : 'I could not tell which one'}? ${mine.map((r, i) => `${i + 1}. ${r.text} (${r.when})`).join('; ')}`);
      }
      return { ids: found.rows.map((r) => String(r._id)), labels: found.rows.map((r) => `"${r.text}" (${personal.describeSchedule(r.schedule)})`) };
    },
    summarise: (_a, _actor, p) => `Stop ${p.ids.length > 1 ? `${p.ids.length} reminders: ` : 'your reminder '}${p.labels.join(', ')}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await personal.stopMine(ctx.actor, p.ids);
      return action({ type: 'personal_reminder_stopped', data: out, speak: out.stopped ? `Stopped ${p.labels.join(', ')}.` : 'That reminder was already stopped.' });
    },
  },

  list_school_automations: {
    module: 'Automations', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The school\'s automations (register-not-marked nudges, homework and fee reminders, library overdue, principal briefing, cover suggestions, low-stock purchase drafts, admissions follow-ups, health follow-ups, weekly parent digest, birthday greetings): on or off, when each runs, who it reaches, a sample of its message, and the ones that were already automatic. Give key for one. Use for "show the school automations", "which automations are on", "preview the fee reminder message". Read-only.',
    inputSchema: closed({ key: { type: 'string', enum: AUTOMATION_KEYS } }),
    permission: 'settings.manage', minScope: 'ALL', anyOf: [['settings.manage', 'ALL'], ['institution.manage', 'ALL']],
    service: 'automations.service.listAutomations()',
    async run(ctx, args) {
      const out = await automations.listAutomations(ctx.actor);
      const rows = args.key ? out.automations.filter((a) => a.key === args.key) : out.automations;
      const line = (a) => `${a.label}: ${a.effective ? 'ON' : 'off'}${a.enabled && !a.featureOn ? ` (module ${a.feature} is switched off)` : ''}, ${a.schedule.toLowerCase()}, to ${a.audience.join(', ').toLowerCase()}`;
      if (args.key) {
        const a = rows[0];
        return ok({ automation: a }, { speak: `${line(a)}. Sample message: "${a.preview}"` });
      }
      return ok({ automations: rows, builtIn: out.builtIn, quietHours: out.quietHours }, {
        speak: `${rows.filter((a) => a.effective).length} of ${rows.length} automations are on. ${rows.map(line).join('; ')}. Nothing is sent between ${out.quietHours.from}:00 and ${out.quietHours.to}:00.`,
        view: { type: 'list.numbered', intro: `**School automations** (${rows.filter((a) => a.effective).length} on)`, items: rows.map((a) => ({ label: `${a.effective ? '●' : '○'} ${a.label}`, detail: `${a.schedule} — ${a.audience.join(', ').toLowerCase()}` })) },
      });
    },
  },

  set_school_automation: {
    module: 'Automations', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, confirm: true,
    description: 'Change one school automation: switch it on or off, the hour it runs (7 to 20; never in quiet hours), the weekday of a weekly one, or who it reaches. Use for "turn on fee reminders", "switch off birthday greetings", "send the principal briefing at 8", "run the parent digest on Saturdays". Confirmed on the website.',
    inputSchema: closed({
      key: { type: 'string', enum: AUTOMATION_KEYS }, enabled: { type: 'boolean' },
      hour: { type: 'integer', minimum: 0, maximum: 23 }, weekday: { type: 'integer', minimum: 0, maximum: 6 },
      audience: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 20 } },
    }, ['key']),
    permission: 'settings.manage', minScope: 'ALL', anyOf: [['settings.manage', 'ALL'], ['institution.manage', 'ALL']],
    service: 'automations.service.updateAutomation()',
    async prepare(_ctx, args) {
      const { def, change } = automations.cleanChange(args.key, args);
      return { label: def.label, change };
    },
    summarise: (_a, _actor, p) => `${p.label}: ${[
      p.change.enabled !== undefined ? (p.change.enabled ? 'switch ON' : 'switch OFF') : null,
      p.change.hour !== undefined ? `run from ${p.change.hour}:00` : null,
      p.change.weekday !== undefined ? `on ${weekdayName(p.change.weekday)}s` : null,
      p.change.audience ? `reach ${p.change.audience.join(', ').toLowerCase()}` : null,
    ].filter(Boolean).join(', ')} — for the whole school`,
    async run(ctx, args) {
      const out = await automations.updateAutomation(ctx.actor, args.key, args);
      return action({ type: 'school_automation_set', data: out, speak: `Saved. ${out.label} is ${out.enabled ? 'on' : 'off'}${out.enabled ? `, from ${out.hour}:00${out.weekday != null ? ` on ${weekdayName(out.weekday)}s` : ''}` : ''}.` });
    },
  },

  run_school_automation_now: {
    module: 'Automations', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, confirm: true,
    description: 'Run one school automation now instead of at its scheduled time (the "Run now" button on the Automations page): it sends what it would send today to the people it reaches. Idempotent: anything already sent today is not sent again. Use for "run the fee reminders now", "send the principal briefing right away". Confirmed on the website.',
    inputSchema: closed({ key: { type: 'string', enum: AUTOMATION_KEYS } }, ['key']),
    permission: 'settings.manage', minScope: 'ALL', anyOf: [['settings.manage', 'ALL'], ['institution.manage', 'ALL']],
    service: 'automations.service.runNow()',
    summarise: (a) => `Run now: ${automationDef(a.key)?.label ?? a.key} — sends today's messages to everyone it reaches (nothing already sent today is repeated)`,
    async run(ctx, args) {
      const out = await automations.runNow(ctx.actor, args.key);
      return action({ type: 'school_automation_run', data: { key: args.key, result: out }, speak: `${automationDef(args.key)?.label ?? args.key} has run.` });
    },
  },

  list_automation_drafts: {
    module: 'Automations', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Drafts an automation prepared for the caller to check: cover suggestions for absent teachers, purchase requests for low stock. Nothing in them has been done. Use for "show my automation drafts", "any drafts to confirm", "show the cover suggestions". Read-only.',
    inputSchema: noArgs,
    permission: 'ai.copilot.use',
    service: 'automations.service.listDrafts()',
    async run(ctx) {
      const rows = await automations.listDrafts(ctx.actor, { status: 'DRAFT' });
      if (!rows.length) return ok({ drafts: [] }, { speak: 'No automation drafts are waiting for you.' });
      const full = await AutomationDraft.find({ _id: { $in: rows.map((r) => r.id) } }).lean();
      const willDo = new Map(full.map((d) => [String(d._id), automations.draftAction(d)]));
      return ok({ drafts: rows }, {
        speak: `${rows.length} draft(s) to check: ${rows.map((r, i) => `${i + 1}. ${r.title} — confirming would ${willDo.get(r.id)}`).join('; ')}. Say "confirm draft 1" or "dismiss draft 1".`,
      });
    },
  },

  confirm_automation_draft: {
    module: 'Automations', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, confirm: true,
    description: 'Carry out one automation draft the caller owns: assign the suggested substitute for each period of a cover draft, or create the DRAFT purchase request of a low-stock draft (which still goes for approval). By its number in "show my automation drafts" (or the only one). Confirmed on the website.',
    inputSchema: closed({ number: { type: 'integer', minimum: 1, maximum: 100 }, draftId: { type: 'string', pattern: '^[a-f0-9]{24}$' } }),
    permission: 'ai.copilot.use',
    service: 'automations.service.confirmDraft()',
    async prepare(ctx, args) {
      const d = await theDraft(ctx, args);
      const preview = await automations.previewDraft(ctx.actor, d.id);
      return { id: d.id, title: d.title, willDo: preview.willDo };
    },
    summarise: (_a, _actor, p) => `${p.title}: ${p.willDo}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await automations.confirmDraft(ctx.actor, p.id);
      const failed = out.outcome.failed.length ? ` ${out.outcome.failed.length} could not be done: ${out.outcome.failed.map((f) => `period ${f.periodNo} ${f.class} (${f.reason})`).join('; ')}.` : '';
      return action({ type: 'automation_draft_confirmed', id: p.id, data: out.outcome, speak: `Done: ${out.outcome.created.length} carried out for "${p.title}".${failed}` });
    },
  },

  dismiss_automation_draft: {
    module: 'Automations', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Set aside an automation draft without doing anything it suggested. By its number in "show my automation drafts" (or the only one). Needs confirmation.',
    inputSchema: closed({ number: { type: 'integer', minimum: 1, maximum: 100 }, draftId: { type: 'string', pattern: '^[a-f0-9]{24}$' } }),
    permission: 'ai.copilot.use',
    service: 'automations.service.dismissDraft()',
    async prepare(ctx, args) {
      const d = await theDraft(ctx, args);
      return { id: d.id, title: d.title };
    },
    summarise: (_a, _actor, p) => `Dismiss the draft "${p.title}" (nothing in it is done)`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await automations.dismissDraft(ctx.actor, p.id);
      return action({ type: 'automation_draft_dismissed', id: p.id, speak: `Dismissed "${p.title}".` });
    },
  },

  get_my_automation_optins: {
    module: 'Automations', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The automations the caller can opt in to (a parent: the weekly digest; a student or parent: birthday greetings), whether they are opted in, and whether the school has each switched on. Use for "show my automation opt-ins", "am I getting the weekly digest", "what have I opted in to". Read-only.',
    inputSchema: noArgs,
    permission: 'ai.copilot.use',
    service: 'automations.service.myOptIns()',
    async run(ctx) {
      const rows = await automations.myOptIns(ctx.actor);
      if (!rows.length) return ok({ optIns: [] }, { speak: 'There is nothing for your account to opt in to.' });
      const line = (r) => `${r.label}: ${r.optedIn ? 'opted in' : 'not opted in'}${r.schoolEnabled ? '' : ' (switched off by the school for now)'}`;
      return ok({ optIns: rows }, {
        speak: `Your opt-ins: ${rows.map(line).join('; ')}.`,
        view: { type: 'list.numbered', intro: '**Your automation opt-ins**', items: rows.map((r) => ({ label: r.label, detail: line(r).slice(r.label.length + 2) })) },
      });
    },
  },

  set_my_automation_optin: {
    module: 'Automations', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Opt the caller in or out of an automation that needs their consent: weeklyParentDigest (a parent: one short summary per child each week) or birthdayGreetings (a student or parent: a birthday greeting in the app). Use for "send me a weekly summary of my child", "turn on birthday greetings", "stop the weekly digest". Needs confirmation.',
    inputSchema: closed({ key: { type: 'string', enum: automations.OPT_IN_KEYS }, enabled: { type: 'boolean' } }, ['key', 'enabled']),
    permission: 'ai.copilot.use',
    service: 'automations.service.setMyOptIn()',
    summarise: (a) => `${a.enabled ? 'Opt you in to' : 'Opt you out of'}: ${automationDef(a.key)?.label ?? a.key}`,
    async run(ctx, args) {
      const out = await automations.setMyOptIn(ctx.actor, args.key, args.enabled);
      const note = out.optedIn && !out.schoolEnabled ? ' The school has this switched off for now, so nothing is sent until it is switched on.' : '';
      return action({ type: 'automation_optin_set', data: out, speak: `${out.optedIn ? 'You are opted in to' : 'You are opted out of'} ${out.label}.${note}` });
    },
  },
};
