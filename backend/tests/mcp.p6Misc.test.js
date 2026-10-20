import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as miscTools } from '../src/modules/ai/mcp/tools/p6/misc.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Notification } from '../src/models/notification.model.js';
import { PtmBooking, ReviewCase } from '../src/models/ptm.model.js';
import { ConversationMessage } from '../src/models/conversation.model.js';
import { AnalyticsView } from '../src/models/analyticsView.model.js';
import { Facility } from '../src/models/facility.model.js';
import { notify } from '../src/modules/notifications/notification.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * Part-6 coverage, misc (tools/p6/misc.js): notifications, the risk scan, AI
 * drafting options and credits, PTM reads and staff booking for families,
 * review calls, the conversation queue and replies, analytics views and
 * quarterly deliveries, campus detail, the caller's dashboard and search.
 */
const NAMES = Object.keys(miscTools);
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}
async function read(actor, name, args = {}) {
  const out = await mcp(OAK, actor, name, args);
  expect(out.success, `${name}: ${JSON.stringify(out.error)}`).toBe(true);
  return out;
}

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; the boot check passes', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(32);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(t.approverDecision, n).toBeFalsy();
      if (t.operation === 'GET') expect(n, n).toMatch(/^(get|list|search)_/);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise({}, {}, undefined), n).toBe('string');
      }
    }
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['reserve_ptm_slot_for_family', 'change_family_ptm_booking', 'manage_family_ptm_waitlist', 'send_quarterly_report']) expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    for (const n of ['dismiss_unread_notifications', 'reply_to_conversation', 'save_analytics_view']) expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
  });

  it('shows each role only what its grants allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const parent = visible('PARENT');
    expect(parent).toEqual(expect.arrayContaining(['dismiss_unread_notifications', 'get_my_ai_credits', 'get_ptm_round_schedule', 'reply_to_conversation', 'get_role_dashboard', 'search_everything']));
    for (const n of ['reserve_ptm_slot_for_family', 'get_risk_scan', 'get_review_call', 'save_analytics_view']) expect(parent, n).not.toContain(n);
    expect(visible('TEACHER')).toEqual(expect.arrayContaining(['reserve_ptm_slot_for_family', 'get_ptm_meeting_sheet', 'update_review_call', 'list_unanswered_conversations']));
    expect(visible('TEACHER')).not.toContain('send_quarterly_report');
    expect(visible('PRINCIPAL')).toEqual(expect.arrayContaining(['get_risk_scan', 'send_quarterly_report']));
  });
});

describe('notifications, AI and analytics', () => {
  it('marks notifications read, reads the risk scan, drafting options and credits, and keeps saved views', async () => {
    const P = s.people.PARENT.actor;
    await inOak(() => notify({ recipientProfileIds: [P.profileId], title: 'Fee reminder', body: 'Due soon' }));
    await inOak(() => notify({ recipientProfileIds: [P.profileId], title: 'Sports day', body: 'Friday' }));
    await confirm(P, 'dismiss_unread_notifications', { about: 'fee' }, { unchanged: async () => (await inOak(() => Notification.countDocuments({ readAt: null }))) === 2 });
    expect(await inOak(() => Notification.countDocuments({ readAt: null }))).toBe(1);
    await confirm(P, 'dismiss_unread_notifications', {});
    expect(await inOak(() => Notification.countDocuments({ readAt: null }))).toBe(0);

    await read(s.people.PRINCIPAL.actor, 'get_risk_scan', {});
    expect((await mcp(OAK, s.people.TEACHER.actor, 'get_risk_scan', {})).success).toBe(false);
    expect((await read(s.people.TEACHER.actor, 'get_available_ai_draft_kinds')).data.kinds.length).toBeGreaterThan(0);
    expect((await read(P, 'get_my_ai_credits', { orders: true })).data.packs.length).toBe(3);

    const A = s.people.ADMIN.actor;
    expect((await read(A, 'get_analytics_catalogue')).data.total).toBeGreaterThan(0);
    await confirm(A, 'save_analytics_view', { name: 'Term fees', preset: 'quarter', department: 'finance' }, { unchanged: async () => (await inOak(() => AnalyticsView.countDocuments())) === 0 });
    expect((await read(A, 'list_analytics_views')).data.total).toBe(1);
    await confirm(A, 'delete_analytics_view', { name: 'Term fees' });
    expect(await inOak(() => AnalyticsView.countDocuments())).toBe(0);
    // Quarterly distribution is for school-wide managers only.
    expect((await mcp(OAK, s.people.TEACHER.actor, 'list_quarterly_report_deliveries', {})).success).toBe(false);
  }, 120_000);
});

describe('PTM, staff side', () => {
  it('a teacher books, moves and cancels a meeting for a family and reads the round, sheet, briefing and metrics', async () => {
    const admin = s.people.ADMIN.actor;
    const T = s.people.TEACHER.actor;
    const date = ymdIn(4);
    await confirm(admin, 'create_ptm_round', { title: 'Term 1 PTM', startsOn: date, classes: ['Class 6 A'], slotMinutes: 10 });
    await confirm(T, 'add_ptm_availability', { date, from: '16:00', to: '16:40' });

    expect((await read(T, 'get_ptm_round_schedule')).data.title).toBe('Term 1 PTM');
    const slots = await read(T, 'list_my_ptm_slots');
    expect(slots.data.total).toBeGreaterThanOrEqual(2);
    const second = slots.data.items[1].time.slice(0, 5);
    const opts = await read(T, 'get_ptm_options_for_pupil', { admissionNo: 'OAK-1' });
    expect(opts.data.total).toBeGreaterThan(0);

    const wa = await mcp(OAK, T, 'reserve_ptm_slot_for_family', { admissionNo: 'OAK-1', time: '16:00', date }, { channel: 'WHATSAPP' });
    expect(wa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    await confirm(T, 'reserve_ptm_slot_for_family', { admissionNo: 'OAK-1', time: '16:00', date }, { unchanged: async () => (await inOak(() => PtmBooking.countDocuments())) === 0 });
    const b = await inOak(() => PtmBooking.findOne({ active: true }).lean());
    expect(String(b.parentProfileId)).toBe(String(s.people.PARENT.profile._id));
    expect(b.assisted).toBe(true);

    const sheet = await read(T, 'get_ptm_meeting_sheet');
    expect(sheet.data.items.filter((r) => r.pupil).length).toBe(1);
    const brief = await read(T, 'get_ptm_meeting_briefing', { studentName: 'Rahul' });
    expect(brief.data.student.admissionNo).toBe('OAK-1');
    expect((await read(T, 'get_ptm_metrics')).data.booked).toBe(1);
    expect((await read(T, 'list_ptm_unbooked_families')).data.items.map((r) => r.pupil)).not.toContain('Rahul Sharma');

    await confirm(T, 'change_family_ptm_booking', { step: 'reschedule', studentName: 'Rahul', time: second, date, reason: 'Clash with a duty' });
    const moved = await inOak(() => PtmBooking.findOne({ active: true }).lean());
    expect(moved.startsAt.getTime()).toBeGreaterThan(b.startsAt.getTime());
    await confirm(T, 'change_family_ptm_booking', { step: 'cancel', studentName: 'Rahul', reason: 'Family asked to cancel' });
    expect(await inOak(() => PtmBooking.countDocuments({ active: true }))).toBe(0);

    // Taking a family off a waiting list is for PTM managers only.
    const remove = await mcp(OAK, T, 'manage_family_ptm_waitlist', { step: 'remove', admissionNo: 'OAK-1' });
    expect(remove.success).toBe(false);
  }, 120_000);
});

describe('review calls and conversations', () => {
  it('reads and changes a review call; a teacher replies to a parent', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'open_review_call', { studentName: 'Rahul', reason: 'ATTENDANCE', summary: 'Absent often' });
    expect((await read(T, 'get_review_call', { studentName: 'Rahul' })).data.reason).toBe('ATTENDANCE');
    await confirm(T, 'update_review_call', { studentName: 'Rahul', priority: 'HIGH', nextFollowUpOn: ymdIn(5) });
    expect((await inOak(() => ReviewCase.findOne().lean())).priority).toBe('HIGH');
    expect((await read(T, 'get_review_call_briefing', { studentName: 'Rahul' })).data.student.admissionNo).toBe('OAK-1');
    expect((await read(T, 'get_review_call_metrics')).data.openCases).toBe(1);

    await confirm(s.people.PARENT.actor, 'send_conversation_message', { message: 'Is the trip on Friday?', studentName: 'Rahul' });
    expect((await read(T, 'list_unanswered_conversations', { hours: 1 })).data.total).toBe(0);
    await confirm(T, 'reply_to_conversation', { message: 'Yes, it is on Friday.', studentName: 'Rahul' });
    expect(await inOak(() => ConversationMessage.countDocuments())).toBe(2);
    expect((await read(T, 'get_conversation_office_hours')).success).toBe(true);
  }, 90_000);
});

describe('campus, dashboard and search', () => {
  it('reads layers, a facility, live detail, the caller\'s dashboard and search results', async () => {
    const A = s.people.ADMIN.actor;
    await inOak(() => Facility.create({ code: 'PHY', name: 'Physics lab', kind: 'LAB' }));
    await inOak(() => Facility.create({ code: 'SRV', name: 'Server room', kind: 'SERVER_ROOM', restricted: true }));
    expect((await read(A, 'get_campus_layers')).data.layers).toBeTruthy();
    expect((await read(A, 'get_facility_detail', { name: 'Physics lab' })).data.name).toBe('Physics lab');
    // A family cannot open a restricted place.
    expect((await mcp(OAK, s.people.PARENT.actor, 'get_facility_detail', { name: 'Server room' })).success).toBe(false);
    expect((await read(A, 'get_campus_live_detail', { kind: 'gate' })).data.kind).toBe('gate');
    expect((await read(s.people.PARENT.actor, 'get_campus_live_detail', { kind: 'class', name: 'Class 6 A' })).data.kind).toBe('class');
    await read(s.people.TEACHER.actor, 'get_role_dashboard', { days: 7 });
    const found = await read(A, 'search_everything', { query: 'Rahul' });
    expect(found.data.total).toBeGreaterThan(0);
  }, 90_000);
});
