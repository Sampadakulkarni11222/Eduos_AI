'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { SchoolDropdownOptionDto, SchoolThemeDto } from './types';

/**
 * A school's own look, fetched once and applied to its portals.
 *
 * Two deliberate properties:
 *
 *   the server decides   `cssVariables` arrives computed. The browser does not
 *                        pick a contrast colour or normalise a hex — every
 *                        client paints the same thing, and the rule that keeps
 *                        text readable on an arbitrary brand colour lives next
 *                        to the palette it protects.
 *   nothing leaks        the variables are applied to the portal's own element,
 *                        not to :root. A platform administrator moving between
 *                        two schools in one session cannot end up with one
 *                        school's colours behind the other's content, and the
 *                        console itself is never themed by a school at all.
 *
 * A school that has customised nothing publishes no variables, so the role
 * themes in design-system.css stand exactly as they did.
 */

/** The shape a school with no configuration has — also the loading state. */
const UNTHEMED: SchoolThemeDto = {
  tenantId: '',
  theme: { primaryColor: null, secondaryColor: null, accentColor: null },
  branding: { displayName: null, tagline: null, logoUrl: null, faviconUrl: null },
  header: { showSchoolName: true, showTagline: false },
  sidebar: { showLogo: true, showPortalLabel: true, defaultCollapsed: false },
  dropdowns: [],
  cssVariables: {},
};

/**
 * The acting school's theme.
 *
 * `enabled` is false on the platform console, which belongs to no school: it
 * must keep its own indigo whatever school was last opened.
 */
export function useSchoolTheme(
  enabled: boolean,
  // Whichever school the caller is looking at. A platform administrator can
  // open School A and then School B without the shell remounting; keying the
  // fetch on the school is what stops A's colours surviving into B.
  schoolKey: string | null = null,
): { theme: SchoolThemeDto; ready: boolean } {
  const [theme, setTheme] = useState<SchoolThemeDto>(UNTHEMED);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setTheme(UNTHEMED);
      setReady(true);
      return;
    }
    let cancelled = false;
    // Drop the previous school's theme at once rather than when the next one
    // arrives, so there is no moment where one school is painted in another's.
    setTheme(UNTHEMED);
    setReady(false);
    api.schoolTheme()
      .then((next) => { if (!cancelled) setTheme(next); })
      // A school that cannot be themed is a school that renders as it always
      // did. Branding is not worth a broken portal.
      .catch(() => { if (!cancelled) setTheme(UNTHEMED); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [enabled, schoolKey]);

  return { theme, ready };
}

/**
 * Points the browser tab at the school's favicon while its portal is open.
 *
 * Restores whatever was there on the way out, so leaving a school does not
 * leave its mark on the platform console.
 */
export function useFavicon(url: string | null) {
  useEffect(() => {
    if (!url) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?? Object.assign(document.createElement('link'), { rel: 'icon' });
    const previous = link.href;
    const attached = link.isConnected;
    link.href = url;
    if (!attached) document.head.appendChild(link);
    return () => {
      if (attached) link.href = previous;
      else link.remove();
    };
  }, [url]);
}

/**
 * The published variables as a style object.
 *
 * Typed through `as` because React's CSSProperties has no room for custom
 * properties, which is a gap in the type rather than in the DOM: setting
 * `--accent` in a style object is exactly how a custom property is scoped to a
 * subtree.
 */
export function themeStyle(cssVariables: Record<string, string>): React.CSSProperties {
  return cssVariables as React.CSSProperties;
}

/**
 * One of the acting school's option lists, for a form to populate a <select>.
 *
 * Asks the server for the list by key rather than reading it out of a theme
 * fetched earlier, so the options are always the acting school's own: the
 * backend confines the read to the caller's school, and a key the school has
 * not defined comes back as an empty list the form has to handle anyway.
 */
export function useSchoolDropdown(
  key: string,
  schoolKey: string | null = null,
): { options: SchoolDropdownOptionDto[]; label: string; ready: boolean } {
  const [state, setState] = useState<{ options: SchoolDropdownOptionDto[]; label: string; ready: boolean }>(
    { options: [], label: key, ready: false },
  );

  useEffect(() => {
    let cancelled = false;
    setState({ options: [], label: key, ready: false });
    api.schoolDropdown(key)
      .then((list) => { if (!cancelled) setState({ options: list.options, label: list.label, ready: true }); })
      .catch(() => { if (!cancelled) setState({ options: [], label: key, ready: true }); });
    return () => { cancelled = true; };
  }, [key, schoolKey]);

  return state;
}
