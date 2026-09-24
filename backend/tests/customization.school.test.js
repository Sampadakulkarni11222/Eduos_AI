import { describe, it, expect, beforeEach } from 'vitest';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SchoolCustomization } from '../src/models/schoolCustomization.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import * as customization from '../src/modules/customization/customization.service.js';
import { DEFAULT_CUSTOMIZATION } from '../src/modules/customization/customization.defaults.js';

/**
 * School-wise theme and UI customisation.
 *
 * The example the feature exists for, stated as a test: School A's houses are
 * Red, Blue and Green; School B's are Alpha, Beta and Gamma; and neither school
 * can be handed the other's — not by asking for them, not by naming the other
 * school, and not through the assistant.
 *
 * Alongside that: a school with no configuration looks exactly like the shipped
 * product, a malformed colour or asset is refused outright rather than
 * sanitised into something nobody chose, and only the platform may change any
 * of it.
 */

const A = 'school-a';
const B = 'school-b';

const roleByKey = new Map();
let phoneSeq = 0;
const nextPhone = () => `+91944${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

async function seedPerson({ roleKey, tenantId, displayName = 'Test person' }) {
  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get(roleKey);
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName,
    tenantId, tenantName: tenantId, status: 'ACTIVE',
  });
  return {
    profile,
    actor: {
      accountId: String(account._id), profileId: String(profile._id), displayName,
      roleKey, permissions: buildPermissionMap(role), tenantId,
    },
  };
}

let platform;
let adminA;
let studentA;

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({
      key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.grants,
    }));
  }
  await School.create({ slug: A, name: 'School A' });
  await School.create({ slug: B, name: 'School B' });

  adminA = await seedPerson({ roleKey: 'ADMIN', tenantId: A, displayName: 'A admin' });
  studentA = await seedPerson({ roleKey: 'STUDENT', tenantId: A, displayName: 'A student' });

  const account = await Account.create({ phoneE164: nextPhone(), status: 'ACTIVE' });
  const role = roleByKey.get('SUPER_ADMIN');
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName: 'Platform Owner', status: 'ACTIVE',
  });
  platform = {
    actor: {
      accountId: String(account._id), profileId: String(profile._id), displayName: 'Platform Owner',
      roleKey: 'SUPER_ADMIN', permissions: buildPermissionMap(role), tenantId: null,
    },
  };
});

const inSchool = (slug, fn) => runWithTenant(slug, fn);
const asPlatform = (fn) => runAcrossSchools(fn);

const save = (slug, config) =>
  asPlatform(() => customization.updateCustomization(platform.actor, slug, config));

const houses = (...values) => ({
  dropdowns: [{ key: 'house', label: 'House', options: values.map((v) => ({ value: v, label: v })) }],
});

/* ── 1. Default configuration ─────────────────────────────── */

describe('a school nobody has customised', () => {
  it('reads back as the shipped product, not as a grey fallback theme', async () => {
    const config = await asPlatform(() => customization.getCustomization(A));

    expect(config.customized).toBe(false);
    expect(config.theme).toEqual(DEFAULT_CUSTOMIZATION.theme);
    // No colours at all: the role themes in design-system.css stand.
    expect(config.theme.primaryColor).toBeNull();
    expect(config.branding.logoUrl).toBeNull();
    expect(config.dropdowns).toEqual([]);
  });

  it('publishes no CSS variables, so nothing is overridden', async () => {
    const theme = await inSchool(A, () => customization.getTheme());
    expect(theme.cssVariables).toEqual({});
  });

  it('shows the defaults for the flags a screen renders from', async () => {
    const config = await asPlatform(() => customization.getCustomization(A));
    expect(config.header).toEqual({ showSchoolName: true, showTagline: false });
    expect(config.sidebar).toEqual({ showLogo: true, showPortalLabel: true, defaultCollapsed: false });
  });

  it('writes nothing to the database just by being read', async () => {
    await inSchool(A, () => customization.getTheme());
    await asPlatform(() => customization.getCustomization(A));
    expect(await asPlatform(() => SchoolCustomization.countDocuments({}))).toBe(0);
  });
});

/* ── 2. School-specific theme ─────────────────────────────── */

describe('a school-specific theme', () => {
  it('stores the three colours and the branding', async () => {
    const saved = await save(A, {
      theme: { primaryColor: '#1F4A3A', secondaryColor: '#2c6049', accentColor: '#c9a23f' },
      branding: { displayName: 'School A Senior', tagline: 'Learn well', logoUrl: '/uploads/abc-logo.png' },
    });

    expect(saved.theme).toEqual({
      primaryColor: '#1f4a3a', secondaryColor: '#2c6049', accentColor: '#c9a23f',
    });
    expect(saved.branding).toMatchObject({
      displayName: 'School A Senior', tagline: 'Learn well', logoUrl: '/uploads/abc-logo.png',
    });
    expect(saved.customized).toBe(true);
  });

  it('publishes the design system\'s own custom properties, not a second theme', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a', secondaryColor: '#2c6049' } });
    const { cssVariables } = await inSchool(A, () => customization.getTheme());

    // The very properties design-system.css already themes every portal with.
    expect(cssVariables['--accent']).toBe('#1f4a3a');
    expect(cssVariables['--accent-2']).toBe('#2c6049');
    expect(cssVariables['--header-title']).toBe('#1f4a3a');
  });

  it('pairs a dark brand colour with light text, and a light one with dark text', async () => {
    await save(A, { theme: { primaryColor: '#111111' } });
    const dark = (await inSchool(A, () => customization.getTheme())).cssVariables;
    await save(A, { theme: { primaryColor: '#f5f0e0' } });
    const light = (await inSchool(A, () => customization.getTheme())).cssVariables;

    // A brand colour arrives with no hand-picked foreground, so one is derived
    // — otherwise pale-brand schools get cream text on cream.
    expect(dark['--on-accent']).not.toBe(light['--on-accent']);
    expect(dark['--sidebar-text']).not.toBe(light['--sidebar-text']);
  });

  it('fills the gradient partner from the primary when no secondary is set', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    const { cssVariables } = await inSchool(A, () => customization.getTheme());
    expect(cssVariables['--accent-2']).toBe('#1f4a3a');
  });

  it('applies to every role in the school, because every role renders the portal', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });

    // The theme read carries no permission: a student's portal must be themed
    // too. Same school, same answer, whoever asks.
    const asAdmin = await inSchool(A, () => customization.getTheme());
    const asStudent = await inSchool(A, () => customization.getTheme());
    expect(asStudent.cssVariables).toEqual(asAdmin.cssVariables);
    expect(studentA.actor.permissions['customization.manage']).toBeUndefined();
  });
});

/* ── 3. School isolation ──────────────────────────────────── */

describe('one school\'s configuration never reaches another', () => {
  it('gives each school its own theme', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    await save(B, { theme: { primaryColor: '#5f0f40' } });

    expect((await inSchool(A, () => customization.getTheme())).cssVariables['--accent']).toBe('#1f4a3a');
    expect((await inSchool(B, () => customization.getTheme())).cssVariables['--accent']).toBe('#5f0f40');
  });

  it('leaves a school unthemed when only the other has been configured', async () => {
    await save(B, { theme: { primaryColor: '#5f0f40' }, branding: { logoUrl: '/uploads/b-logo.png' } });

    const a = await inSchool(A, () => customization.getTheme());
    expect(a.cssVariables).toEqual({});
    expect(a.branding.logoUrl).toBeNull();
  });

  it('refuses a school that names another one', async () => {
    await save(B, { theme: { primaryColor: '#5f0f40' } });
    await expect(inSchool(A, () => customization.getCustomization(B))).rejects.toMatchObject({
      statusCode: 404, code: 'SCHOOL_NOT_FOUND',
    });
    await expect(inSchool(A, () => customization.getTheme(B))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('stamps every configuration with the school that owns it', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    await save(B, { theme: { primaryColor: '#5f0f40' } });

    const stray = await asPlatform(() => SchoolCustomization.find({ tenantId: { $nin: [A, B] } }).lean());
    expect(stray).toEqual([]);
    expect(await inSchool(A, () => SchoolCustomization.countDocuments({}))).toBe(1);
  });

  it('does not let changing one school touch the other', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' }, ...houses('Red', 'Blue') });
    const bBefore = await asPlatform(() => customization.getCustomization(B));

    await save(A, { theme: { primaryColor: '#111111' }, ...houses('Ruby') });

    expect(await asPlatform(() => customization.getCustomization(B))).toEqual(bBefore);
  });
});

/* ── 4. Dropdown isolation ────────────────────────────────── */

describe('dropdown values are per school', () => {
  beforeEach(async () => {
    await save(A, houses('Red', 'Blue', 'Green'));
    await save(B, houses('Alpha', 'Beta', 'Gamma'));
  });

  it('gives School A its houses and School B its own', async () => {
    const a = await inSchool(A, () => customization.getDropdown('house'));
    const b = await inSchool(B, () => customization.getDropdown('house'));

    expect(a.options.map((o) => o.value)).toEqual(['Red', 'Blue', 'Green']);
    expect(b.options.map((o) => o.value)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('never shows School A one of School B\'s options', async () => {
    const a = await inSchool(A, () => customization.getDropdown('house'));
    for (const foreign of ['Alpha', 'Beta', 'Gamma']) {
      expect(a.options.map((o) => o.value)).not.toContain(foreign);
    }
  });

  it('returns an empty list for a key the school has not defined', async () => {
    const list = await inSchool(A, () => customization.getDropdown('transport-zone'));
    expect(list).toMatchObject({ key: 'transport-zone', options: [] });
  });

  it('keeps the value and the label apart, so a rename does not orphan records', async () => {
    await save(A, {
      dropdowns: [{
        key: 'house',
        label: 'House',
        options: [{ value: 'Red', label: 'Ruby House' }],
      }],
    });
    const [option] = (await inSchool(A, () => customization.getDropdown('house'))).options;
    expect(option).toMatchObject({ value: 'Red', label: 'Ruby House' });
  });

  it('orders options as the school arranged them', async () => {
    await save(A, {
      dropdowns: [{
        key: 'house',
        label: 'House',
        options: [
          { value: 'Green', label: 'Green', order: 3 },
          { value: 'Red', label: 'Red', order: 1 },
          { value: 'Blue', label: 'Blue', order: 2 },
        ],
      }],
    });
    const list = await inSchool(A, () => customization.getDropdown('house'));
    expect(list.options.map((o) => o.value)).toEqual(['Red', 'Blue', 'Green']);
  });
});

/* ── 5. Invalid configuration ─────────────────────────────── */

describe('malformed configuration is refused', () => {
  it.each([
    ['a colour keyword', 'red'],
    ['an rgb() function', 'rgb(255,0,0)'],
    ['a custom property', 'var(--accent)'],
    ['a value carrying a second declaration', '#fff;background:url(x)'],
    ['a half-written hex', '#12'],
  ])('refuses %s as a colour', async (_label, value) => {
    await expect(save(A, { theme: { primaryColor: value } })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_COLOR',
    });
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a plaintext http URL', 'http://example.com/logo.png'],
    ['a protocol-relative URL', '//example.com/logo.png'],
    ['a path outside the upload directory', '/etc/passwd'],
    ['a traversal', '/uploads/../../etc/passwd'],
  ])('refuses %s as a logo', async (_label, value) => {
    await expect(save(A, { branding: { logoUrl: value } })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_ASSET_URL',
    });
  });

  it('keeps ordinary spaced text, but refuses a label carrying a line break', async () => {
    const saved = await save(A, { branding: { tagline: 'Learn well - live well' } });
    expect(saved.branding.tagline).toBe('Learn well - live well');

    await expect(save(A, { branding: { displayName: 'School A\nInjected' } })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_TEXT',
    });
  });

  it('refuses an SVG, which is active content served from our own origin', async () => {
    // The same reason the upload endpoint already excludes it.
    await expect(save(A, { branding: { logoUrl: '/uploads/abc-logo.svg' } })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_ASSET_TYPE',
    });
  });

  it('accepts an uploaded path and an https URL', async () => {
    const saved = await save(A, {
      branding: { logoUrl: '/uploads/abc-logo.png', faviconUrl: 'https://cdn.example.com/fav.png' },
    });
    expect(saved.branding.logoUrl).toBe('/uploads/abc-logo.png');
    expect(saved.branding.faviconUrl).toBe('https://cdn.example.com/fav.png');
  });

  it.each([
    ['a key with spaces', { key: 'my house', label: 'House', options: [] }, 'INVALID_DROPDOWN_KEY'],
    ['an option with a control character', { key: 'house', label: 'House', options: [{ value: 'Red', label: 'Red\nBlue' }] }, 'INVALID_TEXT'],
    ['an empty option value', { key: 'house', label: 'House', options: [{ value: '', label: 'Red' }] }, 'INVALID_DROPDOWN_OPTION'],
  ])('refuses %s', async (_label, dropdown, code) => {
    await expect(save(A, { dropdowns: [dropdown] })).rejects.toMatchObject({ statusCode: 400, code });
  });

  it('refuses two lists with the same key rather than silently dropping one', async () => {
    await expect(save(A, {
      dropdowns: [
        { key: 'house', label: 'House', options: [{ value: 'Red', label: 'Red' }] },
        { key: 'house', label: 'Houses', options: [{ value: 'Blue', label: 'Blue' }] },
      ],
    })).rejects.toMatchObject({ statusCode: 400, code: 'DUPLICATE_DROPDOWN_KEY' });
  });

  it('refuses a duplicate option inside one list', async () => {
    await expect(save(A, {
      dropdowns: [{
        key: 'house', label: 'House',
        options: [{ value: 'Red', label: 'Red' }, { value: 'red', label: 'Red again' }],
      }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'DUPLICATE_DROPDOWN_OPTION' });
  });

  it('caps how many lists and options a school may define', async () => {
    const many = (n) => Array.from({ length: n }, (_, i) => ({ key: `list-${i}`, label: `L${i}`, options: [] }));
    await expect(save(A, { dropdowns: many(21) })).rejects.toMatchObject({ code: 'TOO_MANY_DROPDOWNS' });

    const options = Array.from({ length: 51 }, (_, i) => ({ value: `V${i}`, label: `V${i}` }));
    await expect(save(A, { dropdowns: [{ key: 'house', label: 'House', options }] }))
      .rejects.toMatchObject({ code: 'TOO_MANY_DROPDOWN_OPTIONS' });
  });

  it('writes nothing at all when one field in the payload is bad', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });

    await expect(save(A, {
      theme: { primaryColor: '#5f0f40' },
      branding: { logoUrl: 'javascript:alert(1)' },
    })).rejects.toMatchObject({ statusCode: 400 });

    // The good colour in the same payload did not land either.
    expect((await asPlatform(() => customization.getCustomization(A))).theme.primaryColor).toBe('#1f4a3a');
  });

  it('refuses a configuration for a school that does not exist', async () => {
    await expect(save('no-such-school', { theme: { primaryColor: '#1f4a3a' } })).rejects.toMatchObject({
      statusCode: 404, code: 'SCHOOL_NOT_FOUND',
    });
  });
});

/* ── 6. Updating and resetting ────────────────────────────── */

describe('updating a configuration', () => {
  it('replaces the whole configuration, so a cleared field really clears', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' }, branding: { tagline: 'Learn well' } });
    const after = await save(A, { theme: { primaryColor: '#5f0f40' } });

    expect(after.theme.primaryColor).toBe('#5f0f40');
    expect(after.branding.tagline).toBeNull();
  });

  it('keeps the flags a caller did not mention', async () => {
    await save(A, { sidebar: { defaultCollapsed: true } });
    const after = await save(A, { theme: { primaryColor: '#1f4a3a' } });
    expect(after.sidebar.defaultCollapsed).toBe(true);
  });

  it('records who changed it and when', async () => {
    const saved = await save(A, { theme: { primaryColor: '#1f4a3a' } });
    expect(saved.updatedBy).toBe('Platform Owner');
    expect(saved.updatedAt).toBeTruthy();
  });

  it('keeps one document per school however many times it is saved', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    await save(A, { theme: { primaryColor: '#5f0f40' } });
    await save(A, { theme: { primaryColor: '#111111' } });
    expect(await asPlatform(() => SchoolCustomization.countDocuments({ tenantId: A }))).toBe(1);
  });

  it('resets to genuinely uncustomised, not to written-out defaults', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' }, ...houses('Red') });

    const reset = await asPlatform(() => customization.resetCustomization(platform.actor, A));

    expect(reset.customized).toBe(false);
    expect(reset.theme).toEqual(DEFAULT_CUSTOMIZATION.theme);
    expect(reset.dropdowns).toEqual([]);
    expect(await asPlatform(() => SchoolCustomization.countDocuments({ tenantId: A }))).toBe(0);
  });

  it('resets one school without touching another', async () => {
    await save(A, houses('Red'));
    await save(B, houses('Alpha'));

    await asPlatform(() => customization.resetCustomization(platform.actor, A));

    expect((await inSchool(B, () => customization.getDropdown('house'))).options.map((o) => o.value)).toEqual(['Alpha']);
  });

  it('validates a preview with exactly the validator the save uses', async () => {
    const current = await asPlatform(() => customization.getCustomization(A));
    // What renders is what would save.
    const preview = customization.validateCustomization({ theme: { primaryColor: '#1F4A3A' } }, current);
    expect(preview.theme.primaryColor).toBe('#1f4a3a');
    // And what would be refused is refused before anything is built on it.
    expect(() => customization.validateCustomization({ theme: { primaryColor: 'red' } }, current)).toThrow();
  });

  it('audits the change and the reset', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    await asPlatform(() => customization.resetCustomization(platform.actor, A));

    const actions = (await AuditLog.find().sort({ createdAt: 1 }).lean()).map((a) => a.action);
    expect(actions).toContain('customization.updated');
    expect(actions).toContain('customization.reset');

    const entry = await AuditLog.findOne({ action: 'customization.updated' }).lean();
    expect(String(entry.actorProfileId)).toBe(platform.actor.profileId);
    expect(entry.after).toMatchObject({ tenantId: A });
  });
});

/* ── 7. RBAC ──────────────────────────────────────────────── */

describe('who may change a school\'s look', () => {
  const guard = (roleKey, permissionKey) => {
    const req = { actor: { roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) } };
    try {
      requirePermission(permissionKey, 'ALL')(req, {}, () => {});
      return 'ALLOW';
    } catch (err) {
      return `DENY ${err.statusCode}`;
    }
  };

  it('gives the customisation key to SUPER_ADMIN alone', () => {
    expect(guard('SUPER_ADMIN', 'customization.manage')).toBe('ALLOW');
    expect(SUPER_ADMIN_ONLY).toContain('customization.manage');

    const holders = SYSTEM_ROLES
      .filter((r) => r.grants.some((g) => g.key === 'customization.manage'))
      .map((r) => r.key);
    expect(holders).toEqual(['SUPER_ADMIN']);
  });

  it.each(['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN'])(
    '%s cannot change any school\'s configuration',
    (roleKey) => {
      expect(guard(roleKey, 'customization.manage')).toBe('DENY 403');
    },
  );

  it('lets a School Admin read its own configuration, on the existing settings key', () => {
    // The rule the Settings screen has always stated: a school sees how it is
    // configured; the platform team changes it.
    expect(guard('ADMIN', 'settings.manage')).toBe('ALLOW');
    expect(adminA.actor.permissions['settings.manage']).toBe('ALL');
    expect(adminA.actor.permissions['customization.manage']).toBeUndefined();
  });

  it.each(['TEACHER', 'STUDENT', 'PARENT'])('%s cannot read the full configuration either', (roleKey) => {
    expect(guard(roleKey, 'settings.manage')).toBe('DENY 403');
  });

  it('still lets every role read the render-time theme, which carries no permission', async () => {
    await save(A, { theme: { primaryColor: '#1f4a3a' } });
    // A student holds neither key and must still get a themed portal.
    const theme = await inSchool(A, () => customization.getTheme());
    expect(theme.cssVariables['--accent']).toBe('#1f4a3a');
    expect(studentA.actor.permissions['settings.manage']).toBeUndefined();
  });
});

/* ── 8. MCP ───────────────────────────────────────────────── */

describe('the assistant\'s view of it', () => {
  it('exposes one read tool and no way to change anything', () => {
    const tool = MCP_TOOLS.get_school_customization;
    expect(tool.operation).toBe('GET');
    expect(tool.permission).toBe('settings.manage');
    expect(tool.minScope).toBe('ALL');

    // No write tool: changing a theme is Super-Admin-only, and SUPER_ADMIN has
    // no assistant. A write tool could only exist by handing it to a school.
    const writes = Object.entries(MCP_TOOLS)
      .filter(([, t]) => t.module === 'Customization' && t.operation !== 'GET')
      .map(([n]) => n);
    expect(writes).toEqual([]);
  });

  it('is offered to a School Admin and to nobody else', () => {
    const visible = (roleKey) =>
      mcpToolsFor({ roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) })
        .map((t) => t.name)
        .includes('get_school_customization');

    expect(visible('ADMIN')).toBe(true);
    for (const roleKey of ['PRINCIPAL', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN']) {
      expect(visible(roleKey), roleKey).toBe(false);
    }
  });

  it('is not offered to the platform role, which holds no assistant at all', () => {
    expect(mcpToolsFor(platform.actor)).toEqual([]);
  });

  it('takes no argument that could name another school', () => {
    const props = Object.keys(MCP_TOOLS.get_school_customization.inputSchema.properties);
    expect(props).toEqual(['dropdownKey']);
    expect(MCP_TOOLS.get_school_customization.inputSchema.additionalProperties).toBe(false);
  });

  it('answers with the caller\'s own school\'s lists', async () => {
    await save(A, houses('Red', 'Blue', 'Green'));
    await save(B, houses('Alpha', 'Beta', 'Gamma'));

    const fromA = await inSchool(A, () => MCP_TOOLS.get_school_customization.run({ actor: adminA.actor }, {}));
    expect(fromA.success).toBe(true);
    expect(fromA.data.dropdowns[0].options).toEqual(['Red', 'Blue', 'Green']);
    expect(JSON.stringify(fromA.data)).not.toContain('Alpha');
  });

  it('narrows to one list, and says so plainly when there is none', async () => {
    await save(A, houses('Red'));

    const found = await inSchool(A, () =>
      MCP_TOOLS.get_school_customization.run({ actor: adminA.actor }, { dropdownKey: 'house' }));
    expect(found.data.count).toBe(1);

    const missing = await inSchool(A, () =>
      MCP_TOOLS.get_school_customization.run({ actor: adminA.actor }, { dropdownKey: 'zone' }));
    expect(missing.data.count).toBe(0);
    expect(missing.speak).toMatch(/no "zone" list/);
  });
});
