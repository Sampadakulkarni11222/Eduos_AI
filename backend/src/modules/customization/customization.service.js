import { SchoolCustomization } from '../../models/schoolCustomization.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { currentTenantId, runWithTenant } from '../../tenancy/tenantContext.js';
import { defaultCustomization, foregroundFor } from './customization.defaults.js';
import {
  parseColor, parseAssetUrl, parseText, parseFlag, parseDropdowns, LIMITS,
} from './customization.validate.js';

/**
 * School-wise theme and UI customisation.
 *
 * One document per school, merged over the defaults on every read, so a school
 * that has configured nothing is described exactly as the product ships and a
 * field left null is the same as never having been set. There is no separate
 * "is customised" state to get out of step with the values.
 *
 * Isolation is the tenancy plugin's, not this file's: SchoolCustomization is
 * `tenantScoped`, so a school-level read is rewritten to that school's document
 * before it runs. School A asking for its houses cannot be handed School B's,
 * because the query that would return them is not one this code can express
 * from inside School A. Platform-level work names a school and re-enters its
 * context explicitly, the same way seat pricing does.
 *
 * Authority: reading the render-time theme needs no permission at all — every
 * role has to paint its own portal, and the payload is a school's own branding.
 * Reading the full configuration is `settings.manage`; changing it is
 * `customization.manage`, which is Super-Admin-only.
 */

/** The school this call is acting on, or a 400 telling the caller to name one. */
function actingSchool() {
  const tenantId = currentTenantId();
  if (!tenantId) {
    throw new AppError(
      'Name the school to act on — a platform-level call must choose one.',
      400, [], 'SCHOOL_REQUIRED',
    );
  }
  return tenantId;
}

/**
 * The school this call may act on.
 *
 * Only a caller who is not already inside a school may name one; for everybody
 * else the acting school wins and a different slug is refused. These functions
 * re-enter the named school's tenant context to read it, so a slug that could
 * override the caller's own school would be a way to read another's.
 */
function schoolOf(slug) {
  const acting = currentTenantId();
  const named = String(slug ?? '').trim().toLowerCase();

  if (acting) {
    if (named && named !== acting) {
      throw new AppError(`No school with id "${named}"`, 404, [], 'SCHOOL_NOT_FOUND');
    }
    return acting;
  }
  if (!named) throw new AppError('Name the school.', 400, [], 'SCHOOL_REQUIRED');
  return named;
}

async function assertSchoolExists(slug) {
  const school = await School.findOne({ slug }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');
  return school;
}

/** The stored document merged over the defaults. Never returns null. */
function merge(stored) {
  const base = defaultCustomization();
  if (!stored) return base;

  return {
    theme: { ...base.theme, ...stripNulls(stored.theme) },
    branding: { ...base.branding, ...stripNulls(stored.branding) },
    header: { ...base.header, ...stripNulls(stored.header) },
    sidebar: { ...base.sidebar, ...stripNulls(stored.sidebar) },
    dropdowns: (stored.dropdowns ?? []).map((d) => ({
      key: d.key,
      label: d.label,
      options: (d.options ?? []).map((o) => ({ value: o.value, label: o.label, order: o.order ?? 0 })),
    })),
  };
}

/** Drops keys whose value is null/undefined so the default shows through. */
function stripNulls(section) {
  const source = section?.toObject?.() ?? section ?? {};
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== null && v !== undefined));
}

/* ── Reads ────────────────────────────────────────────────── */

/**
 * The full configuration for a school, as the customisation screen edits it.
 *
 * `customized` reports whether a document exists at all, so the screen can say
 * "never customised" rather than showing the defaults as if someone had chosen
 * them.
 */
export async function getCustomization(slug) {
  const tenantId = schoolOf(slug);
  const stored = await runWithTenant(tenantId, () =>
    SchoolCustomization.findOne({ tenantId }).lean(),
  );

  return {
    tenantId,
    ...merge(stored),
    customized: Boolean(stored),
    updatedBy: stored?.updatedByName ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

/**
 * The render-time theme: what a portal needs to paint itself, and nothing else.
 *
 * Returned to any signed-in member of the school, because every role renders
 * the sidebar. It carries branding and option lists — no audit fields, no
 * indication of who configured it.
 *
 * `cssVariables` is computed here rather than in the browser so that every
 * client paints the same thing, and so the contrast rule that keeps text
 * readable on an arbitrary brand colour lives beside the palette it protects.
 */
export async function getTheme(slug) {
  const tenantId = slug ? schoolOf(slug) : actingSchool();
  const config = await getCustomization(tenantId);

  return {
    tenantId,
    theme: config.theme,
    branding: config.branding,
    header: config.header,
    sidebar: config.sidebar,
    dropdowns: config.dropdowns,
    cssVariables: cssVariablesFor(config.theme),
  };
}

/**
 * The CSS custom properties a school's colours translate into.
 *
 * Deliberately the properties `design-system.css` already themes with. A school
 * that sets a primary colour re-tints every component that reads `--accent`;
 * one that sets none publishes nothing, and the role themes stand.
 *
 * The foreground set rides along with the primary colour, because the two
 * cannot be chosen independently: the shipped themes pair each accent with
 * hand-picked text colours, and a brand colour with no such pairing needs one
 * derived or it will be illegible.
 */
export function cssVariablesFor(theme = {}) {
  const vars = {};
  if (theme.primaryColor) {
    vars['--accent'] = theme.primaryColor;
    // Doubles as the gradient partner when no secondary colour is set, so a
    // school that picks one colour does not get a half-themed header.
    vars['--accent-2'] = theme.secondaryColor ?? theme.primaryColor;
    const fg = foregroundFor(theme.primaryColor);
    vars['--on-accent'] = fg.onAccent;
    vars['--sidebar-text'] = fg.sidebarText;
    vars['--sidebar-heading'] = fg.sidebarHeading;
    vars['--sidebar-secondary'] = fg.sidebarSecondary;
    vars['--sidebar-group'] = fg.sidebarGroup;
    vars['--badge-on-accent-text'] = fg.badgeOnAccentText;
    vars['--header-title'] = theme.primaryColor;
  } else if (theme.secondaryColor) {
    vars['--accent-2'] = theme.secondaryColor;
  }
  if (theme.accentColor) vars['--brand-accent'] = theme.accentColor;
  return vars;
}

/**
 * One school's option list, by key — what a form populates its dropdown from.
 *
 * Confined to the acting school, so "house" means Red/Blue/Green in School A
 * and Alpha/Beta/Gamma in School B, and neither can ask for the other's.
 * An unknown key is an empty list rather than a 404: a form asking for a list
 * the school has not defined has no options, which is a state it must handle
 * anyway.
 */
export async function getDropdown(key) {
  const tenantId = actingSchool();
  const config = await getCustomization(tenantId);
  const wanted = String(key ?? '').trim().toLowerCase();
  const list = config.dropdowns.find((d) => d.key === wanted);
  return { tenantId, key: wanted, label: list?.label ?? wanted, options: list?.options ?? [] };
}

/** Every school's configuration, for the platform's customisation console. */
export async function listSchoolCustomizations() {
  const schools = await School.find().sort({ slug: 1 }).lean();
  return Promise.all(
    schools.map(async (school) => {
      const config = await getCustomization(school.slug);
      return {
        tenantId: school.slug,
        tenantName: school.name,
        status: school.status,
        customized: config.customized,
        theme: config.theme,
        branding: config.branding,
        dropdownCount: config.dropdowns.length,
        updatedAt: config.updatedAt,
      };
    }),
  );
}

/* ── Writes ───────────────────────────────────────────────── */

/**
 * Validates a whole configuration payload.
 *
 * Exported so the preview on the customisation screen can be checked by the
 * same code that will accept or refuse the save — a preview that renders
 * something the server would reject is worse than no preview.
 */
export function validateCustomization(input = {}, current = defaultCustomization()) {
  const theme = input.theme ?? {};
  const branding = input.branding ?? {};
  const header = input.header ?? {};
  const sidebar = input.sidebar ?? {};

  return {
    theme: {
      primaryColor: parseColor(theme.primaryColor, 'theme.primaryColor'),
      secondaryColor: parseColor(theme.secondaryColor, 'theme.secondaryColor'),
      accentColor: parseColor(theme.accentColor, 'theme.accentColor'),
    },
    branding: {
      displayName: parseText(branding.displayName, 'branding.displayName', LIMITS.maxDisplayName),
      tagline: parseText(branding.tagline, 'branding.tagline', LIMITS.maxTagline),
      logoUrl: parseAssetUrl(branding.logoUrl, 'branding.logoUrl'),
      faviconUrl: parseAssetUrl(branding.faviconUrl, 'branding.faviconUrl'),
    },
    header: {
      showSchoolName: parseFlag(header.showSchoolName, 'header.showSchoolName', current.header.showSchoolName),
      showTagline: parseFlag(header.showTagline, 'header.showTagline', current.header.showTagline),
    },
    sidebar: {
      showLogo: parseFlag(sidebar.showLogo, 'sidebar.showLogo', current.sidebar.showLogo),
      showPortalLabel: parseFlag(sidebar.showPortalLabel, 'sidebar.showPortalLabel', current.sidebar.showPortalLabel),
      defaultCollapsed: parseFlag(sidebar.defaultCollapsed, 'sidebar.defaultCollapsed', current.sidebar.defaultCollapsed),
    },
    dropdowns: parseDropdowns(input.dropdowns) ?? current.dropdowns,
  };
}

/**
 * Replaces a school's configuration with a validated one.
 *
 * A whole-document write rather than a patch, because the screen edits the
 * whole thing: a partial update would make "I cleared the tagline" and "I did
 * not mention the tagline" the same request, and one of those must clear it.
 * Fields the caller omits fall back to the school's current value for the
 * flags, and to null — the default — for the colours, assets and text.
 *
 * Validation happens before anything is written, so a payload with one bad
 * colour changes nothing at all rather than half-applying.
 */
export async function updateCustomization(actor, slug, input = {}) {
  const tenantId = schoolOf(slug);
  await assertSchoolExists(tenantId);

  const before = await getCustomization(tenantId);
  const next = validateCustomization(input, before);

  const saved = await runWithTenant(tenantId, () =>
    SchoolCustomization.findOneAndUpdate(
      { tenantId },
      {
        $set: {
          ...next,
          updatedByProfileId: actor?.profileId ?? null,
          updatedByName: actor?.displayName ?? null,
        },
        $setOnInsert: { tenantId },
      },
      { new: true, upsert: true, runValidators: true },
    ),
  );

  await recordAudit({
    actor,
    action: 'customization.updated',
    entityType: 'SchoolCustomization',
    entityId: tenantId,
    before: { tenantId, theme: before.theme, branding: before.branding, dropdownCount: before.dropdowns.length },
    after: { tenantId, theme: next.theme, branding: next.branding, dropdownCount: next.dropdowns.length },
  });

  logger.info(`School customisation updated for ${tenantId} by ${actor?.displayName ?? 'system'}`);
  return getCustomization(tenantId);
}

/**
 * Returns a school to the shipped defaults.
 *
 * Deletes the document rather than writing the default values into it, so the
 * school goes back to genuinely "never customised" — the same state a new
 * school is in, and the one the reset button promises.
 */
export async function resetCustomization(actor, slug) {
  const tenantId = schoolOf(slug);
  await assertSchoolExists(tenantId);

  const before = await getCustomization(tenantId);
  await runWithTenant(tenantId, () => SchoolCustomization.deleteOne({ tenantId }));

  await recordAudit({
    actor,
    action: 'customization.reset',
    entityType: 'SchoolCustomization',
    entityId: tenantId,
    before: { tenantId, theme: before.theme, branding: before.branding, dropdownCount: before.dropdowns.length },
    after: { tenantId, reset: true },
  });

  logger.info(`School customisation reset to defaults for ${tenantId}`);
  return getCustomization(tenantId);
}
