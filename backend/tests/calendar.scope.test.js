import { describe, it, expect, beforeEach } from 'vitest';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import * as calendar from '../src/modules/calendar/calendar.service.js';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { seedSchool, inSchool, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * A calendar event is school-wide by construction, and the enforcement of that
 * lives in the service.
 *
 * CalendarEvent carries an `audience` and no section, so an OWN-scoped grant of
 * calendar.manage has nothing it could legitimately create — it would write an
 * event every pupil, parent and teacher in the school sees. Phase 4 moved that
 * refusal from the MCP tool's minScope into calendar.service.create, so the
 * route and the assistant meet the same rule; these tests exercise the service
 * directly rather than the tool, because the tool's gate is the part that was
 * already covered.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});

const event = (over = {}) => ({
  title: 'Sports Day',
  startsAt: new Date('2026-12-01'),
  endsAt: new Date('2026-12-01'),
  ...over,
});

describe('calendar.service.create enforces school-wide scope', () => {
  it('creates for a caller holding calendar.manage school-wide', async () => {
    const actor = school.people.ADMIN.actor;
    const created = await inSchool(OAK, () => calendar.create(actor, 'ALL', event()));
    expect(created.title).toBe('Sports Day');
    expect(String(created.createdByProfileId)).toBe(actor.profileId);
    expect(created.tenantId).toBe(OAK);
  });

  it('refuses an OWN-scoped caller at the service layer, writing nothing', async () => {
    const before = await inSchool(OAK, () => CalendarEvent.countDocuments());
    await expect(
      inSchool(OAK, () => calendar.create(school.people.TEACHER.actor, 'OWN', event({ title: 'Class trip' }))),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await inSchool(OAK, () => CalendarEvent.countDocuments())).toBe(before);
  });

  it('refuses a missing scope rather than defaulting to school-wide', async () => {
    await expect(
      inSchool(OAK, () => calendar.create(school.people.ADMIN.actor, undefined, event({ title: 'No scope' }))),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('the event belongs to the acting school', async () => {
    const created = await inSchool(OAK, () => calendar.create(school.people.ADMIN.actor, 'ALL', event({ title: 'Founders Day' })));
    expect(created.tenantId).toBe(OAK);
  });
});

describe('the assistant keeps the same gate', () => {
  it('create_calendar_event still requires ALL scope', () => {
    expect(MCP_TOOLS.create_calendar_event.minScope).toBe('ALL');
    expect(MCP_TOOLS.create_calendar_event.permission).toBe('calendar.manage');
    expect(MCP_TOOLS.create_calendar_event.confirm).toBe(true);
  });

  it('is not offered to a teacher at all', () => {
    const teacherTools = mcpToolsFor(actorForRole('TEACHER')).map((t) => t.name);
    expect(teacherTools).not.toContain('create_calendar_event');
  });

  it('is offered to a school-wide holder', () => {
    const adminTools = mcpToolsFor(actorForRole('ADMIN')).map((t) => t.name);
    expect(adminTools).toContain('create_calendar_event');
  });
});
