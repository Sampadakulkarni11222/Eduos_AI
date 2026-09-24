/**
 * What a school looks like when nobody has customised it.
 *
 * The defaults are deliberately *empty colours*. A school that has set no
 * primary colour publishes none, and the portal keeps the role-tinted accent
 * `design-system.css` already gives it — the maroon admin console, the green
 * teacher portal, the indigo platform console. So "not configured" is not a
 * grey fallback theme; it is the product as shipped.
 *
 * Everything else defaults to the behaviour that is already on screen: the
 * school's name in the sidebar, the portal label in the header, an expanded
 * sidebar. Turning those off is the customisation.
 */

export const DEFAULT_CUSTOMIZATION = Object.freeze({
  theme: Object.freeze({
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
  }),
  branding: Object.freeze({
    displayName: null,
    tagline: null,
    logoUrl: null,
    faviconUrl: null,
  }),
  header: Object.freeze({
    showSchoolName: true,
    showTagline: false,
  }),
  sidebar: Object.freeze({
    showLogo: true,
    showPortalLabel: true,
    defaultCollapsed: false,
  }),
  dropdowns: Object.freeze([]),
});

/** A deep, mutable copy of the defaults — callers merge into it. */
export const defaultCustomization = () => ({
  theme: { ...DEFAULT_CUSTOMIZATION.theme },
  branding: { ...DEFAULT_CUSTOMIZATION.branding },
  header: { ...DEFAULT_CUSTOMIZATION.header },
  sidebar: { ...DEFAULT_CUSTOMIZATION.sidebar },
  dropdowns: [],
});

/* ── Contrast ─────────────────────────────────────────────── */

/** The relative luminance of a #rrggbb colour, per WCAG. */
export function luminance(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const channel = (pair) => {
    const srgb = parseInt(pair, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [full.slice(0, 2), full.slice(2, 4), full.slice(4, 6)].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The foreground palette that stays readable on a given brand colour.
 *
 * The shipped role themes pair every accent with hand-picked sidebar and
 * on-accent colours. A school choosing its own brand colour gets no such
 * pairing, and a pale brand colour under the parchment-cream text the themes
 * use is unreadable — so the foreground is *derived* rather than guessed:
 * dark brand colours keep the light set, light ones get a dark set.
 *
 * Deliberately two presets rather than a generated palette. The design system
 * has a considered set of tints; picking which of them applies is a decision a
 * luminance threshold can make correctly, while inventing new ones is not.
 */
export function foregroundFor(hex) {
  const light = luminance(hex) > 0.45;
  return light
    ? {
        onAccent: '#2B2520',
        sidebarText: '#3A322A',
        sidebarHeading: '#241E19',
        sidebarSecondary: '#6B6054',
        sidebarGroup: '#6B6054',
        badgeOnAccentText: '#2B2520',
      }
    : {
        onAccent: '#F4E7D2',
        sidebarText: '#EBE2D2',
        sidebarHeading: '#FBF3E6',
        sidebarSecondary: '#BDB1A0',
        sidebarGroup: '#B3A695',
        badgeOnAccentText: '#2A2417',
      };
}
