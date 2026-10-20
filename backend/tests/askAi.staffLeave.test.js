import { describe, it, expect, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { staffLeaveStep, staffLeaveTypeFrom, staffLeaveQuestion, asksLeaveWithoutPermission } from '../src/modules/ai/agent/directIntents.js';
import { StaffLeave } from '../src/models/staffLeave.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { inSchool, OAK, actorForRole } from './support/mcpSchool.js';
import { seedAskAiSchool, conversationAs, INTERNAL_LEAKS } from './support/askAiSchool.js';

/**
 * Part 3: a member of staff saying "apply for leave" means their OWN staff
 * leave. It reaches apply_staff_leave (tools/platformOps.js) as a draft, or a
 * question for what is missing (the day, then the kind of leave, then the
 * reason). Nothing is filed without the person's own yes. Students and parents
 * keep their student-leave behaviour.
 */
let school;
beforeEach(async () => { resetAgentThrottle(); school = await seedAskAiSchool(); });
afterAll(async () => { await resetMcpClient(); });

const as = (role) => conversationAs(school, role);
const count = (Model) => inSchool(OAK, () => Model.countDocuments({}));
const noLeak = (reply) => { for (const leak of INTERNAL_LEAKS) expect(String(reply), `leaked: ${leak}`).not.toMatch(leak); };

describe('reading a staff leave request', () => {
  it('names the leave type from ordinary words', () => {
    expect(staffLeaveTypeFrom('take casual leave on 20 Oct')).toBe('CL');
    expect(staffLeaveTypeFrom('sick leave tomorrow')).toBe('SL');
    expect(staffLeaveTypeFrom('leave tomorrow because of fever')).toBe('SL');
    expect(staffLeaveTypeFrom('leave without pay on Friday')).toBe('LWP');
    expect(staffLeaveTypeFrom('apply for leave tomorrow')).toBeNull();
  });

  it('turns a teacher\'s leave step into apply_staff_leave, and leaves a student\'s alone', () => {
    const step = { tool: 'apply_for_leave', args: {} };
    const teacher = actorForRole('TEACHER');
    const now = new Date(2026, 9, 15);
    const out = staffLeaveStep(step, 'take casual leave on 20 Oct for a family function', teacher, now);
    expect(out).toMatchObject({ tool: 'apply_staff_leave', args: { type: 'CL', fromDate: '2026-10-20', reason: 'a family function' } });
    expect(staffLeaveStep(step, 'apply for leave tomorrow', actorForRole('STUDENT'), now)).toBe(step);
    expect(staffLeaveStep(step, 'apply for leave tomorrow', actorForRole('PARENT'), now)).toBe(step);
    expect(staffLeaveQuestion({})).toMatch(/Which day/);
    expect(staffLeaveQuestion({ fromDate: '2026-10-20' })).toMatch(/Which kind of leave/);
    expect(staffLeaveQuestion({ fromDate: '2026-10-20', type: 'CL' })).toMatch(/reason/);
    expect(staffLeaveQuestion({ fromDate: '2026-10-20', type: 'CL', reason: 'x' })).toBeNull();
    // Staff are no longer told that applying is "not enabled".
    expect(asksLeaveWithoutPermission('Apply for leave tomorrow', teacher)).toBe(false);
  });
});

describe('through the assistant', () => {
  // Staff leave counts school days: on a weekend "tomorrow" would be a Sunday and
  // nothing could be applied for, so these run on a fixed Wednesday (after the seed).
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:30:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('"apply for leave" asks which day; the answers lead to a draft; nothing is filed until yes', async () => {
    const t = as('TEACHER');
    const first = await t.say('apply for leave');
    expect(first.reply).toMatch(/Which day/);
    expect(first.refused).toBeNull();
    expect(first.reply).not.toMatch(/isn't enabled|not permitted|not authorized/i);
    const second = await t.say('tomorrow');
    expect(second.reply).toMatch(/Which kind of leave/);
    const third = await t.say('casual');
    expect(third.reply).toMatch(/reason/i);
    const fourth = await t.say('family function');
    expect(fourth.action?.tool ?? fourth.tool).toBe('apply_staff_leave');
    expect(fourth.reply).toMatch(/Casual leave|casual/i);
    noLeak(fourth.reply);
    expect(await count(StaffLeave)).toBe(0);
    expect(await count(LeaveApplication)).toBe(0);
  });

  it.each([
    ['apply for leave tomorrow', /Which kind of leave/],
    ['I need leave on Monday', /Which kind of leave/],
  ])('"%s" reaches the staff leave flow with a question for the type', async (said, question) => {
    const turn = await as('TEACHER').say(said);
    expect(turn.reply).toMatch(question);
    expect(turn.reply).not.toMatch(/isn't enabled|not permitted|not authorized/i);
    expect(await count(LeaveApplication)).toBe(0);
  });

  it('"take casual leave on 20 Oct because of a family function" is a draft of the staff leave', async () => {
    const turn = await as('TEACHER').say('take casual leave on 20 Oct because of a family function');
    expect(turn.action?.tool ?? turn.tool).toBe('apply_staff_leave');
    expect(turn.reply).toMatch(/Shall I go ahead|confirm/i);
    expect(await count(StaffLeave)).toBe(0);
  });

  it('a student keeps the student leave of absence', async () => {
    const turn = await as('STUDENT').say('Apply for leave tomorrow because of fever');
    expect(turn.action?.tool ?? turn.tool).toBe('apply_for_leave');
  });
});
