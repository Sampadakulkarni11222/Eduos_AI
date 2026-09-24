import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * How one school's portals look, and the option lists its forms offer.
 *
 * One document per school, holding only what a school is allowed to differ on.
 * Everything in it is optional: a school with no document, or with a field left
 * null, renders exactly as EduOS did before this existed. That is the point of
 * the shape — the defaults live in customization.defaults.js and are merged on
 * read, so "not configured" and "configured to the default" are the same
 * picture and neither can drift.
 *
 * Nothing here is a second theme system. The colours are applied as the very
 * CSS custom properties `design-system.css` already themes every portal with
 * (`--accent`, `--accent-2`), so a school's brand colour flows through every
 * component that already reads them rather than through a parallel stylesheet.
 *
 * School-owned (`tenantScoped`), so a school-level read is filtered to its own
 * document by the same plugin that confines students and invoices — School A
 * cannot see School B's house list because the query never reaches it.
 */

/** A hex colour, or null to leave the design system's own value in place. */
const colorField = { type: String, default: null, trim: true };

const themeSchema = new Schema(
  {
    // The school's brand colour. Drives `--accent`: sidebar, primary buttons,
    // focus rings — everything the role themes already tint.
    primaryColor: colorField,
    // The lighter partner used in gradients, which `--accent-2` already names.
    secondaryColor: colorField,
    // Highlights and callouts. Published as `--brand-accent`; nothing in the
    // shipped stylesheet depends on it, so leaving it null changes nothing.
    accentColor: colorField,
  },
  { _id: false }
);

const brandingSchema = new Schema(
  {
    // What the sidebar and the browser tab call this school. Falls back to the
    // school's registered name, so it is only for schools whose display name
    // differs from their legal one.
    displayName: { type: String, trim: true, default: null },
    tagline: { type: String, trim: true, default: null },
    // Stored as the URL the existing upload endpoint returned ("/uploads/…"),
    // or an absolute https URL. Validated on the way in — see
    // customization.validate.js.
    logoUrl: { type: String, trim: true, default: null },
    faviconUrl: { type: String, trim: true, default: null },
  },
  { _id: false }
);

/**
 * Header configuration.
 *
 * Each flag names exactly one thing on screen, so there is no pair of settings
 * that can disagree about the same element:
 *   showSchoolName  the school's name in the browser tab
 *   showTagline     the tagline under the page title
 */
const headerSchema = new Schema(
  {
    showSchoolName: { type: Boolean, default: true },
    showTagline: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Sidebar configuration.
 *   showLogo          the logo mark in the brand block (falls back to an initial)
 *   showPortalLabel   the portal's name under the school's, e.g. "Admin Console"
 *   defaultCollapsed  the rail's starting state, until this device says otherwise
 */
const sidebarSchema = new Schema(
  {
    showLogo: { type: Boolean, default: true },
    showPortalLabel: { type: Boolean, default: true },
    defaultCollapsed: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * One option in one of a school's dropdowns.
 *
 * `value` is what gets stored on a record, `label` is what a person reads. They
 * are separate because renaming "Red House" to "Ruby House" must not orphan the
 * students already recorded against it.
 */
const dropdownOptionSchema = new Schema(
  {
    value: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * A named option list — "house", "transport-zone", and whatever else a school
 * needs its forms to offer.
 *
 * The lists are per school by construction: this document is tenant-scoped, so
 * School A's houses (Red, Blue, Green) and School B's (Alpha, Beta, Gamma) are
 * rows in different documents that no single query returns together.
 */
const dropdownSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    options: { type: [dropdownOptionSchema], default: [] },
  },
  { _id: false }
);

const schoolCustomizationSchema = new Schema(
  {
    theme: { type: themeSchema, default: () => ({}) },
    branding: { type: brandingSchema, default: () => ({}) },
    header: { type: headerSchema, default: () => ({}) },
    sidebar: { type: sidebarSchema, default: () => ({}) },
    dropdowns: { type: [dropdownSchema], default: [] },

    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true }
);
// One document per school. A race between two callers provisioning the same
// school ends in a duplicate-key error rather than two half-configurations.
schoolCustomizationSchema.index({ tenantId: 1 }, { unique: true });

schoolCustomizationSchema.plugin(tenantScoped); // school-owned
export const SchoolCustomization = model('SchoolCustomization', schoolCustomizationSchema);
