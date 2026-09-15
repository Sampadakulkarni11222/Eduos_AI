import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYSTEM_ROLES, PERMISSION_CATALOG } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { validateArgs } from '../src/modules/ai/mcp/validate.js';

/**
 * Authorized permission surface vs MCP capability surface, for EVERY role the
 * authorization system actually defines.
 *
 * The roles are read from SYSTEM_ROLES rather than listed here, so a role added
 * later is covered the day it is added instead of the day someone remembers
 * this file. There are nine today; an earlier round of this work assumed five,
 * which is exactly the mistake the enumeration prevents.
 *
 * Where a granted permission has no capability of its own, the reason is
 * recorded in UNCOVERED below and asserted in both directions. A new
 * permission with no capability and no entry fails; an entry that stops being
 * true (the permission gained a capability, or left the catalog) also fails,
 * so the ledger cannot quietly rot into a list of excuses.
 *
 * This file touches no database: it is a statement about the static shape of
 * the authorization and capability surfaces.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Every role the authorization system defines, and the subset the assistant
 * serves.
 *
 * SUPER_ADMIN is deliberately not one of them. It is a platform role that acts
 * across schools, and a request it makes without naming one runs outside any
 * tenant — where the filter confining every other caller is absent. It is
 * excluded by withholding `ai.copilot.use`, the single permission every route
 * into the assistant requires, so the exclusion is enforced by the same
 * authorization layer as everything else rather than by a branch in the AI
 * code. Coverage below is therefore asserted over ASSISTANT_ROLES; the
 * exclusion itself is asserted separately.
 */
const ALL_ROLES = SYSTEM_ROLES.map((r) => r.key);
const EXCLUDED_ROLES = ['SUPER_ADMIN'];
const ROLES = ALL_ROLES.filter((key) => !EXCLUDED_ROLES.includes(key));
const actorFor = (roleKey) => ({
  roleKey,
  profileId: '000000000000000000000001',
  permissions: buildPermissionMap({
    permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants,
  }),
});

/** Granted permission keys that no capability visible to that role declares. */
function uncoveredFor(roleKey) {
  const actor = actorFor(roleKey);
  const declared = new Set(mcpToolsFor(actor).map((t) => MCP_TOOLS[t.name].permission));
  return Object.keys(actor.permissions).filter((key) => !declared.has(key)).sort();
}

/**
 * Why each permission has no capability of its own.
 *
 * A — the business capability IS reachable, through a capability that declares
 *     a different permission. Nothing is missing; the permission key simply is
 *     not the one the tool gates on.
 * C — blocked: either the service cannot be called safely as an actor, or the
 *     feature does not exist in the backend at all.
 * D — deliberately unavailable to the assistant.
 */
const UNCOVERED = {
  /* ── A. reachable under another permission key ─────────── */
  'reportcards.read': {
    category: 'A',
    via: 'get_report_card',
    why: 'Report cards are served by exam.service.getReportCard(); the tool gates on marks.read, the same key the exams report-card route requires.',
  },
  'fees.plan.review': {
    category: 'A',
    via: 'transition_fee_plan',
    why: 'plan.service.transitionFeePlan() checks fees.plan.review itself, per transition (review, requestApproval). The tool gates visibility on fees.read and the service enforces the real key, so the permission is honoured where it decides the outcome.',
  },
  'analytics.school.read': {
    category: 'A',
    via: 'get_dashboard',
    why: 'School-level figures are the admin and finance dashboard views, each gated on its own route permission inside the tool.',
  },
  'analytics.class.read': {
    category: 'A',
    via: 'get_dashboard',
    why: 'Class-level figures are the teacher dashboard view, alongside get_attendance_statistics and get_at_risk_students.',
  },
  'analytics.child.read': {
    category: 'A',
    via: 'get_dashboard',
    why: 'Child-level figures for a parent are the parent dashboard view, alongside get_growth_score.',
  },

  /* ── C. blocked ────────────────────────────────────────── */
  'settings.manage': {
    category: 'C',
    why: 'No settings module, route, controller or service exists anywhere in src. The permission is granted to roles but enforced nowhere, so there is nothing to wrap.',
  },
  'attendance.regularize': {
    category: 'C',
    why: 'No regularization route, controller or service exists anywhere in src. The permission is granted to roles but enforced nowhere, so there is nothing to wrap.',
  },

  /* ── D. deliberately unavailable ───────────────────────── */
  'users.manage': {
    category: 'D',
    why: 'Creating and importing user accounts. Bulk import is a CSV upload and MCP has no file-upload channel, the same constraint that keeps attendance OCR unexposed; single creation mints credentials, which the assistant must not do. Reading the staff directory is available through list_users.',
  },
  'roles.manage': {
    category: 'D',
    why: 'Editing role grants. This is the authorization system that constrains the assistant, so a capability here would let the assistant widen its own reach.',
  },
  'permissions.manage': {
    category: 'D',
    why: 'Editing the permission catalog itself, which is the same self-widening objection as roles.manage one level deeper.',
  },
  'schools.read': {
    category: 'D',
    why: 'Cross-tenant read held only by SUPER_ADMIN. Every MCP call runs inside one tenant AsyncLocalStorage state; a capability reading across schools would have to leave it.',
  },
  'schools.manage': {
    category: 'D',
    why: 'Creating schools and their administrator accounts. Cross-tenant, and it mints administrator credentials.',
  },
  'calendar.manage': {
    category: 'D',
    scopes: ['OWN'],
    why: 'create_calendar_event requires school-wide scope because a CalendarEvent has no section: there is no such thing as an event for one class only, so a holder at OWN scope has nothing it could safely create. calendar.service.create() refuses a non-ALL actor for the same reason. At ALL scope the permission is covered.',
  },
};

/* ── The roles are real and enumerated, not assumed ──────── */

describe('every role the authorization system defines', () => {
  it('is enumerated from SYSTEM_ROLES, and there are more than the obvious few', () => {
    expect(ROLES).toContain('TEACHER');
    expect(ROLES).toContain('STUDENT');
    // The roles that are easy to forget: staff roles with narrow surfaces.
    expect(ROLES).toContain('FINANCE');
    expect(ROLES).toContain('LIBRARIAN');
    expect(ROLES).toContain('WARDEN');
    expect(ALL_ROLES).toContain('SUPER_ADMIN');
    expect(ALL_ROLES.length).toBeGreaterThanOrEqual(9);
  });

  it('excludes SUPER_ADMIN from the assistant, by permission rather than by name', () => {
    const superAdmin = actorFor('SUPER_ADMIN');
    // The whole exclusion: it does not hold the assistant permission, which
    // every route into the agent requires.
    expect(superAdmin.permissions['ai.copilot.use']).toBeUndefined();
    // And so it is described no catalogue at all.
    expect(mcpToolsFor(superAdmin)).toEqual([]);
    expect(capabilitiesFor(superAdmin)).toEqual([]);

    // Nothing else about the role changed: it still holds every other
    // permission in the catalog, the platform-only ones included.
    const catalog = PERMISSION_CATALOG.map((p) => p.key);
    const held = Object.keys(superAdmin.permissions);
    expect(held.sort()).toEqual(catalog.filter((k) => k !== 'ai.copilot.use').sort());
    expect(superAdmin.permissions['schools.manage']).toBe('ALL');
    expect(superAdmin.permissions['ai.insights.read']).toBe('ALL');
  });

  it('gives the catalogue only to an actor holding the assistant permission', () => {
    // Uniform, not role-specific: strip the permission from any role and the
    // catalogue closes; nothing else about that actor changes.
    for (const role of ROLES) {
      const actor = actorFor(role);
      expect(mcpToolsFor(actor).length).toBeGreaterThan(0);

      const withoutIt = { ...actor, permissions: { ...actor.permissions } };
      delete withoutIt.permissions['ai.copilot.use'];
      expect(mcpToolsFor(withoutIt), `${role} keeps a catalogue without ai.copilot.use`).toEqual([]);
    }
  });

  it('holds only permissions that exist in the catalog', () => {
    const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const role of ROLES) {
      for (const key of Object.keys(actorFor(role).permissions)) {
        expect(catalog.has(key), `${role} is granted ${key}, which is not in the catalog`).toBe(true);
      }
    }
  });

  it('sees capabilities, and sees exactly its authorized tools', () => {
    for (const role of ROLES) {
      const actor = actorFor(role);
      const capabilities = capabilitiesFor(actor).map((c) => c.name).sort();
      const tools = mcpToolsFor(actor).map((t) => t.name).sort();
      // One architecture for every role: the capability index a role prompt is
      // built from is the same set the server will let that role call.
      expect(capabilities, `${role}`).toEqual(tools);
      expect(capabilities.length, `${role} can reach nothing`).toBeGreaterThan(0);
    }
  });
});

/* ── Permission surface vs capability surface ─────────────── */

describe('the authorized permission surface is covered by the capability surface', () => {
  it('accounts for every granted permission that has no capability of its own', () => {
    const unexplained = {};
    for (const role of ROLES) {
      for (const key of uncoveredFor(role)) {
        if (!UNCOVERED[key]) (unexplained[key] ??= []).push(role);
      }
    }
    // A permission granted to a role, with no capability and no recorded
    // reason, lands here. Decide what it is and record it.
    expect(unexplained).toEqual({});
  });

  it('records a category and a real reason for each', () => {
    for (const [key, entry] of Object.entries(UNCOVERED)) {
      expect(['A', 'C', 'D'], `${key}`).toContain(entry.category);
      expect(entry.why.length, `${key} has no real reason recorded`).toBeGreaterThan(40);
      // Category A claims a capability exists; it has to actually exist.
      if (entry.category === 'A') expect(MCP_TOOLS, `${key} claims ${entry.via}`).toHaveProperty(entry.via);
    }
  });

  it('carries no stale entry: each is still a real, still-uncovered permission', () => {
    const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
    // Asked of the registry rather than of the roles: whether a capability
    // declares this permission is a fact about the catalogue, and stays a
    // useful check even for a permission only SUPER_ADMIN holds - which, being
    // excluded from the assistant, reaches nothing by definition.
    const declaredByATool = new Set(Object.values(MCP_TOOLS).map((t) => t.permission));

    for (const [key, entry] of Object.entries(UNCOVERED)) {
      expect(catalog.has(key), `${key} is recorded as uncovered but is not in the catalog`).toBe(true);

      if (entry.scopes) {
        // A scope-gated entry: a capability DOES declare the permission, and
        // the entry explains who cannot reach it. Both halves must hold.
        expect(declaredByATool.has(key), `${key} is recorded as scope-gated but no capability declares it`).toBe(true);
        const blocked = ROLES.filter((role) => {
          const held = actorFor(role).permissions[key];
          return held && entry.scopes.includes(held) && uncoveredFor(role).includes(key);
        });
        expect(blocked.length, `${key} is recorded as blocked at ${entry.scopes} but no role is`).toBeGreaterThan(0);
      } else {
        // If a capability now declares this permission, the entry is obsolete:
        // delete it rather than leave a false excuse behind.
        expect(declaredByATool.has(key), `${key} now has a capability; remove its UNCOVERED entry`).toBe(false);
      }
    }
  });

  it('has, for every role, exactly the uncovered set the ledger predicts', () => {
    // The other direction, per role and without a tuned threshold: a permission
    // the ledger explains must actually be uncovered for each role that holds
    // it, and a role must have nothing uncovered beyond what it explains. This
    // catches the case a single global check misses — a permission whose
    // capability exists but is scope-gated out of one role's reach, which is
    // how calendar.manage sits for a teacher.
    for (const role of ROLES) {
      const granted = Object.keys(actorFor(role).permissions);
      const predicted = granted
        .filter((key) => UNCOVERED[key])
        .filter((key) => {
          const scopes = UNCOVERED[key].scopes;
          return !scopes || scopes.includes(actorFor(role).permissions[key]);
        })
        .sort();
      expect(uncoveredFor(role), `${role}`).toEqual(predicted);
    }
  });
});

/* ── Permissions the backend never enforces ───────────────── */

describe('permissions granted but enforced nowhere in the backend', () => {
  /**
   * These are in the catalog and granted to roles, but no route, controller or
   * service references them. They are not an MCP gap: the permission list is
   * ahead of the application. Recorded so that whoever implements the feature
   * knows a capability is expected along with it.
   */
  const DEAD = [
    'analytics.child.read', 'analytics.class.read', 'analytics.school.read',
    'attendance.regularize', 'reportcards.read', 'settings.manage',
  ];

  const sources = (() => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // The catalog itself declares every key, so it cannot be evidence of use.
        else if (entry.name.endsWith('.js') && full !== path.join(SRC, 'constants', 'permissions.js')) files.push(full);
      }
    };
    walk(SRC);
    return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  })();

  it('is exactly the recorded set, with no additions', () => {
    const dead = PERMISSION_CATALOG.map((p) => p.key).filter((key) => !sources.includes(key)).sort();
    // If this grows, a permission was added to the catalog and never wired up.
    expect(dead).toEqual([...DEAD].sort());
  });

  it('is exactly the recorded set, with no removals', () => {
    // If one of these is now enforced somewhere, the feature landed: expose a
    // capability for it and drop it from DEAD and from UNCOVERED.
    for (const key of DEAD) {
      expect(sources.includes(key), `${key} is now enforced in src; it needs an MCP capability`).toBe(false);
    }
  });
});

/* ── Write safety, for every role ─────────────────────────── */

describe('write safety holds for every role, not only the ones with their own tests', () => {
  const writesFor = (role) => mcpToolsFor(actorFor(role)).map((t) => MCP_TOOLS[t.name]).filter(mutates);

  it('every write any role can reach can describe itself for confirmation', () => {
    for (const role of ROLES) {
      for (const tool of writesFor(role)) {
        expect(typeof tool.summarise, `${role} -> ${tool.name}`).toBe('function');
      }
    }
  });

  it('every write that reaches another person is confirmed by a human', () => {
    for (const role of ROLES) {
      for (const tool of writesFor(role)) {
        if (!tool.affectsOthers) continue;
        expect(Boolean(tool.confirm || tool.confirmWhen), `${role} -> ${tool.name}`).toBe(true);
      }
    }
  });

  it('no write any role can reach accepts an identity or scope argument', () => {
    // Identity is re-resolved server-side from the session handle; a schema
    // that accepted it would be a way to act as someone else.
    const IDENTITY = [
      'actorProfileId', 'userId', 'profileId', 'roleKey', 'role',
      'tenantId', 'scope', 'permissions',
    ];
    for (const role of ROLES) {
      for (const tool of writesFor(role)) {
        const props = Object.keys(tool.inputSchema?.properties ?? {});
        expect(props.filter((p) => IDENTITY.includes(p)), `${role} -> ${tool.name}`).toEqual([]);
      }
    }
  });

  it('every capability any role can reach declares a closed schema that refuses unknown arguments', () => {
    for (const role of ROLES) {
      for (const { name } of mcpToolsFor(actorFor(role))) {
        const schema = MCP_TOOLS[name].inputSchema;
        expect(schema?.type, `${role} -> ${name}`).toBe('object');
        expect(schema.additionalProperties, `${role} -> ${name} accepts arbitrary keys`).toBe(false);
        expect(validateArgs(schema, { definitelyNotAParameter: 'x' }).valid, `${role} -> ${name}`).toBe(false);
      }
    }
  });

  it('a school-wide-only capability is invisible to every role without school-wide scope', () => {
    for (const role of ROLES) {
      const actor = actorFor(role);
      for (const { name } of mcpToolsFor(actor)) {
        const tool = MCP_TOOLS[name];
        if (tool.minScope !== 'ALL') continue;
        expect(actor.permissions[tool.permission], `${role} sees ${name} without ALL scope`).toBe('ALL');
      }
    }
  });
});

/* ── The registry's own metadata is well formed ───────────── */

describe('every capability declares metadata the architecture can rely on', () => {
  const OPERATIONS = ['GET', 'CREATE', 'UPDATE', 'DELETE', 'ACTION'];

  it('declares a permission that exists in the catalog', () => {
    const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      expect(typeof tool.permission, `${name}`).toBe('string');
      // A permission outside the catalog can never be granted, so the
      // capability would be unreachable by every role — dead on arrival.
      expect(catalog.has(tool.permission), `${name} declares ${tool.permission}, not in the catalog`).toBe(true);
    }
  });

  it('declares a known operation and a risk level', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      expect(OPERATIONS, `${name}`).toContain(tool.operation);
      expect(tool.risk, `${name} declares no risk level`).toBeDefined();
    }
  });

  it('declares minScope only as school-wide, never as something else', () => {
    // The registry gate reads `minScope === 'ALL'` and nothing else, so 'ALL'
    // gates and absence does not. Both spellings of absence are in use and
    // mean the same thing; what must never appear is a third value like 'OWN',
    // which would read as a gate and silently gate nothing.
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      expect([undefined, null, 'ALL'], `${name} declares minScope ${tool.minScope}`).toContain(tool.minScope);
    }
  });

  it('asks for confirmation only where something is being changed', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      if (tool.operation !== 'GET') continue;
      // A read that demands confirmation would stall an answer behind a
      // pointless prompt; it also implies the operation is mislabelled.
      expect(Boolean(tool.confirm || tool.confirmWhen), `${name} is a GET that asks for confirmation`).toBe(false);
    }
  });

  it('is reachable by at least one role', () => {
    // ROLES excludes SUPER_ADMIN, so this asks whether a capability is
    // reachable by somebody who can actually use the assistant.
    const reachable = new Set(ROLES.flatMap((role) => mcpToolsFor(actorFor(role)).map((t) => t.name)));
    for (const name of Object.keys(MCP_TOOLS)) {
      // A capability no role can see is either mis-permissioned or mis-scoped.
      expect(reachable.has(name), `${name} is visible to no role`).toBe(true);
    }
  });

  it('is exposed to a role only when that role holds its permission and scope', () => {
    // The inverse of the coverage direction: not "can every permission be
    // reached" but "is anything reachable that should not be".
    for (const role of ROLES) {
      const actor = actorFor(role);
      for (const { name } of mcpToolsFor(actor)) {
        const tool = MCP_TOOLS[name];
        const held = actor.permissions[tool.permission];
        expect(held, `${role} sees ${name} without holding ${tool.permission}`).toBeTruthy();
        if (tool.minScope === 'ALL') {
          expect(held, `${role} sees school-wide ${name} at ${held} scope`).toBe('ALL');
        }
      }
    }
  });

  it('hides a capability from every role that lacks its permission', () => {
    for (const role of ROLES) {
      const actor = actorFor(role);
      const visible = new Set(mcpToolsFor(actor).map((t) => t.name));
      for (const [name, tool] of Object.entries(MCP_TOOLS)) {
        if (actor.permissions[tool.permission]) continue;
        expect(visible.has(name), `${role} sees ${name} but lacks ${tool.permission}`).toBe(false);
      }
    }
  });
});

/* ── Each role reaches its own figures ────────────────────── */

describe('role-specific figures are reachable by the role they describe', () => {
  it('every role can reach the dashboard view its own role selects', () => {
    // get_dashboard picks a view from the caller role and then gates on that
    // view own route permission. Visibility, though, gates on students.read,
    // so a role holding the view permission but not students.read would never
    // see the tool at all. That is how warden and librarian figures could be
    // unreachable with nothing looking wrong.
    const VIEW_PERMISSION = {
      admin: 'students.read', finance: 'fees.read', teacher: 'timetable.read',
      student: 'attendance.read', parent: 'students.read', warden: 'hostel.read',
      librarian: 'library.read',
    };
    const ROLE_VIEW = {
      ADMIN: 'admin', SUPER_ADMIN: 'admin', PRINCIPAL: 'admin', FINANCE: 'finance',
      TEACHER: 'teacher', STUDENT: 'student', PARENT: 'parent',
      WARDEN: 'warden', LIBRARIAN: 'librarian',
    };
    for (const role of ROLES) {
      const actor = actorFor(role);
      const view = ROLE_VIEW[role];
      expect(view, `${role} has no dashboard view`).toBeTruthy();
      expect(
        mcpToolsFor(actor).some((t) => t.name === 'get_dashboard'),
        `${role} cannot see get_dashboard`,
      ).toBe(true);
      expect(actor.permissions[VIEW_PERMISSION[view]], `${role} cannot read its own ${view} dashboard`).toBeTruthy();
    }
  });
});
