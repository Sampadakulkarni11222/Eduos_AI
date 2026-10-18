import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { conversationAs, INTERNAL_LEAKS } from './support/askAiSchool.js';
import { PersonalAutomation, AutomationSetting, AutomationOptIn } from '../src/models/automation.model.js';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { withNextSteps, automationTurn } from '../src/modules/ai/agent/p7Automation.js';

/**
 * Part 7 through Ask AI: personal reminders and reports set up, listed and
 * stopped in words (each a draft the same person confirms), "what needs me
 * today" for any role, school automations switched by a settings manager on
 * the website only, opt-ins, and the suggested-next-step chips.
 */

let school;
beforeEach(async () => { school = await seedSchool(); });
const oak = (fn) => inSchool(OAK, fn);
const noLeaks = (reply) => INTERNAL_LEAKS.forEach((re) => expect(reply).not.toMatch(re));

describe('personal reminders in words', () => {
  it('"remind me every Friday to submit lesson plans": a draft, confirmed, listed, then stopped', async () => {
    const chat = conversationAs(school, 'TEACHER');
    const ask = await chat.say('Remind me every Friday at 4 pm to submit lesson plans');
    expect(ask.tool).toBe('create_my_reminder');
    expect(ask.action).toBeTruthy();
    expect(ask.action.summary).toMatch(/"submit lesson plans".*every Friday at 4 pm/);
    expect(await oak(() => PersonalAutomation.countDocuments())).toBe(0); // nothing until "yes"
    const yes = await chat.say('yes');
    expect(yes.reply).toMatch(/remind you to submit lesson plans every Friday/);
    const [row] = await oak(() => PersonalAutomation.find().lean());
    expect(String(row.profileId)).toBe(school.people.TEACHER.actor.profileId);
    expect(row.createdVia).toBe('ASK_AI');

    const list = await chat.say('show my reminders');
    expect(list.tool).toBe('list_my_reminders');
    expect(list.reply).toMatch(/submit lesson plans/);
    expect(list.result.nextSteps?.map((s) => s.ask)).toContain('stop reminder 1');
    noLeaks(list.reply);

    const stop = await chat.say('stop the Friday reminder');
    expect(stop.tool).toBe('stop_my_reminder');
    expect(stop.action.summary).toMatch(/submit lesson plans/);
    await chat.say('yes');
    expect((await oak(() => PersonalAutomation.findById(row._id).lean())).active).toBe(false);
  });

  it('asks when, then finishes the reminder from the answer', async () => {
    const chat = conversationAs(school, 'PARENT');
    const first = await chat.say('remind me to pay the bus fee');
    expect(first.reply).toMatch(/When should I remind you/);
    const second = await chat.say('on the 5th of every month at 10 am');
    expect(second.tool).toBe('create_my_reminder');
    expect(second.action.summary).toMatch(/"pay the bus fee".*day 5 of every month at 10 am/);
  });

  it('a scheduled report only for what the person may see', async () => {
    const principal = conversationAs(school, 'PRINCIPAL');
    const ok = await principal.say('every morning send me the list of absent staff');
    expect(ok.tool).toBe('create_my_reminder');
    expect(ok.action.summary).toMatch(/report "Absent staff today".*every day at 8 am/);

    const teacher = conversationAs(school, 'TEACHER');
    const no = await teacher.say('every morning send me the list of absent staff');
    expect(no.action).toBeFalsy();
    expect(no.reply).toMatch(/not something your account can see/);
  });

  it('works on WhatsApp too (it reaches only the person), confirmed there', async () => {
    const chat = conversationAs(school, 'PARENT', { source: 'WHATSAPP' });
    const ask = await chat.say('remind me tomorrow at 7 am to sign the diary');
    expect(ask.action).toBeTruthy();
    await chat.say('yes');
    const [row] = await oak(() => PersonalAutomation.find().lean());
    expect(row.createdVia).toBe('WHATSAPP');
    expect(row.text).toBe('sign the diary');
  });
});

describe('what needs me today', () => {
  it('answers for a parent with each child, and for a teacher, from records', async () => {
    const parent = await conversationAs(school, 'PARENT').say('what needs me today?');
    expect(parent.tool).toBe('get_what_needs_me_today');
    expect(parent.reply).toMatch(/Rahul Sharma: .*a fee is due/);
    noLeaks(parent.reply);
    const teacher = await conversationAs(school, 'TEACHER').say("what's on my plate today");
    expect(teacher.tool).toBe('get_what_needs_me_today');
  });
});

describe('school automations by the settings manager', () => {
  it('lists them, and switches one on through a draft confirmed on the website', async () => {
    const chat = conversationAs(school, 'ADMIN');
    const list = await chat.say('show the school automations');
    expect(list.tool).toBe('list_school_automations');
    expect(list.reply).toMatch(/Fee due and overdue reminders/);
    const on = await chat.say('turn on fee reminders');
    expect(on.tool).toBe('set_school_automation');
    expect(on.action.summary).toMatch(/switch ON — for the whole school/);
    expect(on.action.affectsOthers).toBe(true);
    await chat.say('yes');
    expect((await oak(() => AutomationSetting.findOne({ key: 'feeReminders' }).lean())).enabled).toBe(true);
  });

  it('is not offered on WhatsApp, and not to a teacher', async () => {
    const wa = await conversationAs(school, 'ADMIN', { source: 'WHATSAPP' }).say('turn on fee reminders');
    expect(wa.action).toBeFalsy();
    expect(wa.reply).toMatch(/website/i);
    const teacher = await conversationAs(school, 'TEACHER').say('turn on fee reminders');
    expect(teacher.tools).not.toContain('set_school_automation');
    expect(await oak(() => AutomationSetting.countDocuments())).toBe(0);
  });

  it('a parent opts in to the weekly digest in words', async () => {
    const chat = conversationAs(school, 'PARENT');
    const ask = await chat.say('send me a weekly summary of my child');
    expect(ask.tool).toBe('set_my_automation_optin');
    await chat.say('yes');
    expect((await oak(() => AutomationOptIn.findOne({ key: 'weeklyParentDigest' }).lean())).enabled).toBe(true);

    // ...and reads them back (the page's opt-in list).
    const read = await chat.say('show my automation opt-ins');
    expect(read.tool).toBe('get_my_automation_optins');
    expect(read.reply).toMatch(/opted in/);
    noLeaks(read.reply);
  });

  it('"run the fee reminders now": the page\'s Run now, a draft confirmed on the website only', async () => {
    const chat = conversationAs(school, 'ADMIN');
    const run = await chat.say('run the fee reminders now');
    expect(run.tool).toBe('run_school_automation_now');
    expect(run.action.summary).toMatch(/Run now: Fee due and overdue reminders/);
    expect(run.action.affectsOthers).toBe(true);
    const wa = await conversationAs(school, 'ADMIN', { source: 'WHATSAPP' }).say('run the fee reminders now');
    expect(wa.action).toBeFalsy();
    expect(wa.reply).toMatch(/website/i);
    const teacher = await conversationAs(school, 'TEACHER').say('run the fee reminders now');
    expect(teacher.tools).not.toContain('run_school_automation_now');
  });

  it('a weekly automation\'s day, in words', () => {
    const held = new Set(mcpToolsFor(school.people.ADMIN.actor).map((t) => t.name));
    expect(automationTurn('run the parent digest on Saturdays', school.people.ADMIN.actor, held).step)
      .toEqual({ tool: 'set_school_automation', args: { key: 'weeklyParentDigest', weekday: 6 } });
  });
});

describe('suggested next steps', () => {
  it('after absentees: chips the person can use; none on a draft or a refusal', async () => {
    const res = await conversationAs(school, 'PRINCIPAL').say('who is absent today?');
    const held = new Set(mcpToolsFor(school.people.PRINCIPAL.actor).map((t) => t.name));
    expect(res.result.nextSteps?.length).toBeGreaterThan(0);
    expect(res.result.nextSteps.length).toBeLessThanOrEqual(3);
    expect(res.result.nextSteps.map((s) => s.ask)).toContain('every morning send me the list of absent students');
    void held;

    const draft = withNextSteps({ tool: 'who_is_absent_today', action: { summary: 'x' } }, school.people.PRINCIPAL.actor, ['create_my_reminder']);
    expect(draft.nextSteps).toBeUndefined();
    const refused = withNextSteps({ tool: 'who_is_absent_today', refused: 'NOT_PERMITTED' }, school.people.PRINCIPAL.actor, ['create_my_reminder']);
    expect(refused.nextSteps).toBeUndefined();
    // Only capabilities held: without send_conversation_message there is no "Message their parents".
    const limited = withNextSteps({ tool: 'who_is_absent_today', data: { students: [{ name: 'A' }] } }, school.people.PRINCIPAL.actor, ['create_my_reminder']);
    expect(limited.nextSteps.map((s) => s.label)).toEqual(['Send me this every morning']);
    const withParents = withNextSteps({ tool: 'who_is_absent_today', data: { students: [{ name: 'A' }] } }, school.people.TEACHER.actor, ['send_conversation_message']);
    expect(withParents.nextSteps.map((s) => s.label)).toEqual(['Message their parents']);
  });

  it('automationTurn leaves unrelated requests alone', () => {
    const held = new Set(mcpToolsFor(school.people.PRINCIPAL.actor).map((t) => t.name));
    for (const text of ['show attendance of Class 6 A', 'send fee reminders', 'who is absent today', 'add a reminder for the fire NOC renewal on 20 Nov']) {
      expect(automationTurn(text, school.people.PRINCIPAL.actor, held)).toBe(null);
    }
  });
});
