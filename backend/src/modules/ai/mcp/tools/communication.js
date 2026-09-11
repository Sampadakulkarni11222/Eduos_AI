import * as admissions from '../../../admissions/admission.service.js';
import * as calendarEvents from '../../../calendar/calendar.service.js';
import * as notifications from '../../../notifications/notification.service.js';
import * as whatsapp from '../../../whatsapp/whatsapp.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, objectId, dateStr, summarise, wrapAgentTool } from './_shared.js';

const LEAD_STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];

/**
 * Admissions, announcements, calendar and outbound messaging.
 *
 * The messaging tools are the sharpest edge in the whole catalog, and they are
 * deliberately narrow. `send_whatsapp_message` sends to **one** number and
 * always asks first. There is no bulk-broadcast tool, and that is a finding
 * rather than an omission: `announcement.service.dispatch()` only writes a log
 * line for the email and WhatsApp channels — it sends nothing — so a
 * "message all parents" tool would be reporting a delivery that never happened.
 * See docs/MCP-AUDIT.md §L.
 */

export const communicationTools = {
  /* ── Admissions ──────────────────────────────────────── */
  get_admissions: {
    module: 'Admissions',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'The admissions pipeline: how many enquiries sit at each stage (new, contacted, tour scheduled, application, enrolled, lost) and who they are. Use for "how is admissions going" and "which applications are pending". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: LEAD_STAGES },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    permission: 'admissions.read',
    minScope: 'ALL',
    service: 'admission.service.getPipeline()',
    async run(_ctx, args) {
      const pipeline = await admissions.getPipeline();
      const limit = Math.min(Number(args.limit) || 10, 50);
      const stages = args.stage ? [args.stage] : pipeline.stages;
      const counts = Object.fromEntries(pipeline.stages.map((s) => [s, pipeline.byStage[s]?.length ?? 0]));
      const leads = stages.flatMap((s) =>
        (pipeline.byStage[s] ?? []).slice(0, limit).map((l) => ({
          leadId: String(l.id),
          childName: l.childName,
          guardianName: l.guardianName,
          gradeApplying: l.gradeApplying,
          stage: l.stage,
          source: l.source,
          nextActionAt: l.nextActionAt,
          assigneeName: l.assigneeName,
          // Deliberately no phone number: this read answers "how is admissions
          // going". A contact list is a different request, which the CRM screen
          // serves with its own audit trail.
        })),
      );
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return ok(
        { counts, total, leads, stagesReported: stages },
        {
          speak: total === 0
            ? 'There are no admission enquiries recorded yet.'
            : `${total} admission enquiry/enquiries: ` +
              pipeline.stages.filter((s) => counts[s] > 0)
                .map((s) => `${counts[s]} ${s.toLowerCase().replace('_', ' ')}`).join(', ') + '.',
        },
      );
    },
  },

  get_admission_lead: {
    module: 'Admissions',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'One admission enquiry in full, with its recorded interaction history newest first. Read-only.',
    inputSchema: { type: 'object', properties: { leadId: objectId() }, required: ['leadId'], additionalProperties: false },
    permission: 'admissions.read',
    minScope: 'ALL',
    service: 'admission.service.getLeadById()',
    async run(_ctx, args) {
      const lead = await admissions.getLeadById(args.leadId);
      return ok(lead, {
        speak: `${lead.childName ?? 'The applicant'} — stage ${lead.stage}${lead.gradeApplying ? `, applying for ${lead.gradeApplying}` : ''}.`,
      });
    },
  },

  create_admission_lead: {
    module: 'Admissions',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Record a new admission enquiry. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', maxLength: 120 },
        guardianName: { type: 'string', maxLength: 120 },
        phone: { type: 'string', maxLength: 20, description: "Guardian's phone number" },
        email: { type: 'string', maxLength: 160 },
        gradeApplying: { type: 'string', maxLength: 40 },
        source: { type: 'string', enum: ['WHATSAPP', 'WEB', 'WALK_IN', 'REFERRAL'] },
        notes: { type: 'string', maxLength: 1000 },
      },
      // The three admission.service.createLead() refuses to create without.
      required: ['childName', 'guardianName', 'phone'],
      additionalProperties: false,
    },
    permission: 'admissions.manage',
    minScope: 'ALL',
    service: 'admission.service.createLead()',
    summarise: (args) => `Record an admission enquiry for ${args.childName}${args.gradeApplying ? ` (${args.gradeApplying})` : ''}`,
    async run(_ctx, args) {
      const lead = await admissions.createLead(args);
      return action({ type: 'admission_lead_created', id: lead._id ?? lead.id, data: lead, speak: `Enquiry recorded for ${args.childName}.` });
    },
  },

  update_admission_lead: {
    module: 'Admissions',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Move an admission enquiry to a new stage, or change its notes, assignee or next action date. Setting the stage to ENROLLED is how an admission is approved; LOST is how it is rejected. Each stage change is written to the interaction history. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: objectId(),
        stage: { type: 'string', enum: LEAD_STAGES, description: 'ENROLLED approves the admission; LOST rejects it' },
        notes: { type: 'string', maxLength: 1000 },
        assigneeProfileId: objectId(),
        nextActionAt: dateStr(),
      },
      required: ['leadId'],
      additionalProperties: false,
    },
    permission: 'admissions.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'admission.service.updateLead()',
    summarise: (args) =>
      args.stage
        ? `Move admission enquiry ${args.leadId} to ${args.stage}` +
          (args.stage === 'ENROLLED' ? ' (approving the admission)' : args.stage === 'LOST' ? ' (rejecting it)' : '')
        : `Update admission enquiry ${args.leadId}`,
    async snapshot(_ctx, args) {
      const lead = await admissions.getLeadById(args.leadId);
      return { leadId: String(args.leadId), stage: lead.stage, assigneeProfileId: lead.assigneeProfileId ?? null };
    },
    async run(ctx, args) {
      const lead = await admissions.updateLead({ ...args, actorProfileId: ctx.actor.profileId });
      return action({
        type: 'admission_lead_updated',
        id: args.leadId,
        data: lead,
        speak: args.stage ? `The enquiry is now at stage ${args.stage}.` : 'The enquiry has been updated.',
      });
    },
  },

  /* ── Announcements and calendar ──────────────────────── */
  get_announcements: wrapAgentTool('get_announcements', {
    module: 'Communication',
    description:
      'Recent announcements addressed to the caller. The same audience filter the announcements screen uses applies, so a notice the caller was not addressed in is never read out. Read-only.',
    service: 'announcement.service.list()',
  }),

  create_announcement: wrapAgentTool('create_announcement', {
    module: 'Communication',
    operation: 'CREATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Publish an announcement. The audience is decided by the school\'s own rules from the publisher\'s permissions — a teacher reaches the classes they teach, a school-wide publisher the school. This is visible to many people at once, so it always needs confirmation and the summary names the real audience.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        content: { type: 'string', maxLength: 5000 },
        audience: {
          type: 'object',
          description: 'Optional narrowing. Omit to let the school\'s rules decide what this publisher may address.',
          properties: {
            all: { type: 'boolean' },
            sectionIds: { type: 'array', maxItems: 50, items: objectId() },
            gradeIds: { type: 'array', maxItems: 50, items: objectId() },
            subjectIds: { type: 'array', maxItems: 50, items: objectId() },
          },
          additionalProperties: false,
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    service: 'announcement.service.create()',
  }),

  get_calendar_events: {
    module: 'Communication',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'School calendar events in a date range — holidays, exams, functions. Defaults to the next 30 days. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { from: dateStr(), to: dateStr() },
      additionalProperties: false,
    },
    permission: 'calendar.read',
    service: 'calendar.service.list()',
    async run(_ctx, args) {
      const from = args.from ? new Date(args.from) : new Date();
      const to = args.to ? new Date(args.to) : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
      const items = await calendarEvents.list({ from: from.toISOString(), to: to.toISOString() });
      const view = summarise(items, (e) => `${e.title} (${new Date(e.startsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`);
      return ok(
        { events: items, count: items.length },
        { speak: items.length ? `${items.length} event(s) coming up: ${view.list}.` : 'No events are scheduled in that period.' },
      );
    },
  },

  create_calendar_event: {
    module: 'Communication',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add an event to the school calendar, such as a holiday or a function. Everyone sees it, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        startsAt: { type: 'string', maxLength: 40, description: 'ISO date or date-time' },
        endsAt: { type: 'string', maxLength: 40, description: 'ISO date or date-time; the same day for a one-day event' },
        type: { type: 'string', maxLength: 40, description: 'e.g. HOLIDAY, EXAM, EVENT' },
      },
      required: ['title', 'startsAt', 'endsAt'],
      additionalProperties: false,
    },
    permission: 'calendar.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'calendar.service.create()',
    summarise: (args) => `Add "${args.title}" to the school calendar on ${String(args.startsAt).slice(0, 10)}`,
    async run(ctx, args) {
      const event = await calendarEvents.create(ctx.actor, args);
      return action({ type: 'calendar_event_created', id: event._id, data: event, speak: `"${args.title}" has been added to the calendar.` });
    },
  },

  /* ── Outbound ────────────────────────────────────────── */
  notify_users: {
    module: 'Communication',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Send an in-app notification to named people, by their profile ids. This appears in their EduOS notification bell — it does not send an email or a WhatsApp message. Reaches other people, so it always needs confirmation and the summary states how many recipients.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientProfileIds: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: objectId(),
          description: 'Profile ids, e.g. from list_users',
        },
        title: { type: 'string', maxLength: 160 },
        body: { type: 'string', maxLength: 1000 },
        link: { type: 'string', maxLength: 300, description: 'In-app path to open, e.g. /admin/payments' },
      },
      required: ['recipientProfileIds', 'title', 'body'],
      additionalProperties: false,
    },
    permission: 'announcements.publish',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'notification.service.notify()',
    summarise: (args, _actor, prepared) =>
      `Send an in-app notification titled "${args.title}" to ${prepared?.recipientCount ?? args.recipientProfileIds.length} recipient(s)`,
    /**
     * Every recipient must be a person in the caller's own school. notify()
     * writes whatever profile ids it is given, so without this a cross-school
     * id became a notification row nobody could ever see. Checked before the
     * confirmation prompt, so the count shown is the count that will receive it.
     */
    async prepare(_ctx, args) {
      const recipients = await notifications.recipientsInSchool(args.recipientProfileIds);
      return { recipientCount: recipients.length };
    },
    async run(_ctx, args) {
      const result = await notifications.notify({
        recipientProfileIds: args.recipientProfileIds,
        type: 'SYSTEM',
        title: args.title,
        body: args.body,
        link: args.link,
      });
      const sent = result?.length ?? args.recipientProfileIds.length;
      return action({
        type: 'notification_sent',
        data: { recipients: args.recipientProfileIds.length, created: sent },
        speak: `Notification sent to ${args.recipientProfileIds.length} recipient(s).`,
      });
    },
  },

  send_whatsapp_message: {
    module: 'Communication',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Send one WhatsApp message to one number through the school\'s WhatsApp account. This leaves the school and cannot be recalled, so it always needs confirmation and the exact text is shown first. There is no bulk-send tool: the school has no approved WhatsApp broadcast capability, and Meta only permits free-form messages inside a 24-hour reply window.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', maxLength: 20, minLength: 8, description: 'Recipient number in international format, e.g. +919999900001' },
        text: { type: 'string', minLength: 1, maxLength: 3000 },
      },
      required: ['to', 'text'],
      additionalProperties: false,
    },
    permission: 'announcements.publish',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'whatsapp.service.sendMessage()',
    summarise: (args) => `Send a WhatsApp message to ${args.to}: "${args.text.slice(0, 160)}${args.text.length > 160 ? '…' : ''}"`,
    async run(_ctx, args) {
      if (!whatsapp.isLiveMode()) {
        // Refusing beats a cheerful "message sent" for something that went
        // nowhere. See the "do not fake success" rule in docs/MCP-SECURITY.md.
        throw new AppError(
          'WhatsApp sending is not configured for this school, so the message was not sent.',
          503, [], 'WHATSAPP_NOT_LIVE',
        );
      }
      const result = await whatsapp.sendMessage(args.to, args.text);
      if (result?.sent === false || result?.error) {
        throw new AppError(`WhatsApp did not accept the message: ${result?.error ?? 'unknown reason'}`, 502, [], 'WHATSAPP_SEND_FAILED');
      }
      return action({
        type: 'whatsapp_message_sent',
        id: result?.messageId ?? null,
        data: { to: args.to, messageId: result?.messageId ?? null },
        speak: `Message sent to ${args.to}.`,
      });
    },
  },
};
