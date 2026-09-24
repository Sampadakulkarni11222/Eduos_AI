import { AppError } from '../../utils/AppError.js';

/**
 * What a school is allowed to put in its customisation.
 *
 * Every value here ends up in a stylesheet, an <img src> or a form control on
 * somebody else's screen, so this file is the boundary that decides what is
 * even representable. It rejects rather than sanitises wherever a rejection is
 * possible: silently "cleaning" a colour into something the operator did not
 * choose is how a school ends up with a brand nobody approved.
 *
 * The two that matter most:
 *
 *   colours  must be a literal #rgb/#rrggbb. Not `red`, not `rgb()`, not
 *            `var(--x)` — a value that is substituted into a custom property
 *            must not be able to carry a second declaration with it.
 *   assets   must be a path from this deployment's own upload endpoint, or an
 *            absolute https URL. `javascript:`, `data:` and SVG are refused:
 *            the first two are script, and an SVG served from our own origin
 *            is an active-content format — which is exactly why the upload
 *            endpoint already excludes it.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Matches what the upload endpoint hands back: `/uploads/<stored-name>`. */
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._-]+$/;
const DROPDOWN_KEY = /^[a-z][a-z0-9-]{1,39}$/;
const OPTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;

export const LIMITS = Object.freeze({
  maxDropdowns: 20,
  maxOptionsPerDropdown: 50,
  maxLabel: 60,
  maxDisplayName: 120,
  maxTagline: 160,
  maxUrl: 512,
});

/** Active-content and script-bearing asset types, refused whatever the host. */
const FORBIDDEN_ASSET_EXTENSIONS = new Set(['svg', 'svgz', 'html', 'htm', 'xml', 'js', 'mjs']);

const fail = (message, code) => {
  throw new AppError(message, 400, [], code);
};

/** True when a string holds an ASCII control character (including tab and newline). */
export function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** A #rgb/#rrggbb colour, normalised to lowercase, or null. */
export function parseColor(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!HEX.test(raw)) {
    fail(`${field} must be a hex colour such as #1f4a3a`, 'INVALID_COLOR');
  }
  return raw.toLowerCase();
}

/**
 * An asset URL this deployment is willing to render, or null.
 *
 * Accepts a path from our own upload endpoint or an absolute https URL, and
 * nothing else — which rules out protocol-relative URLs, `http://` (mixed
 * content on an https portal), and every scheme that can execute.
 */
export function parseAssetUrl(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();

  if (raw.length > LIMITS.maxUrl) fail(`${field} is too long`, 'INVALID_ASSET_URL');

  const extensionOf = (pathname) => {
    const base = pathname.split('/').pop() ?? '';
    return base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  };

  if (raw.startsWith('/')) {
    if (!UPLOAD_PATH.test(raw)) {
      fail(
        `${field} must be a file uploaded to this deployment (an /uploads/… path) or an https URL`,
        'INVALID_ASSET_URL',
      );
    }
    if (FORBIDDEN_ASSET_EXTENSIONS.has(extensionOf(raw))) {
      fail(`${field} may not be a ${extensionOf(raw)} file`, 'INVALID_ASSET_TYPE');
    }
    return raw;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail(`${field} is not a valid URL`, 'INVALID_ASSET_URL');
  }
  if (url.protocol !== 'https:') {
    fail(`${field} must be served over https`, 'INVALID_ASSET_URL');
  }
  if (FORBIDDEN_ASSET_EXTENSIONS.has(extensionOf(url.pathname))) {
    fail(`${field} may not be a ${extensionOf(url.pathname)} file`, 'INVALID_ASSET_TYPE');
  }
  return url.toString();
}

/** A trimmed string no longer than `max`, or null. */
export function parseText(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length > max) fail(`${field} must be ${max} characters or fewer`, 'INVALID_TEXT');
  // Control characters have no business in a label and are how a value smuggles
  // a line break into somewhere that assumed one line.
  if (hasControlChars(raw)) fail(`${field} contains characters that are not allowed`, 'INVALID_TEXT');
  return raw;
}

/** A boolean, or the supplied default when the caller said nothing. */
export function parseFlag(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(`${field} must be true or false`, 'INVALID_FLAG');
  return value;
}

/**
 * One school's dropdown lists, validated whole.
 *
 * Duplicate keys and duplicate option values are refused rather than
 * de-duplicated: two "house" lists is a mistake with two possible fixes, and
 * picking one silently means the operator never learns which of theirs was
 * dropped.
 */
export function parseDropdowns(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail('dropdowns must be a list', 'INVALID_DROPDOWNS');
  if (value.length > LIMITS.maxDropdowns) {
    fail(`A school may define at most ${LIMITS.maxDropdowns} dropdowns`, 'TOO_MANY_DROPDOWNS');
  }

  const seenKeys = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`dropdowns[${index}] must be an object`, 'INVALID_DROPDOWNS');

    const key = String(entry.key ?? '').trim().toLowerCase();
    if (!DROPDOWN_KEY.test(key)) {
      fail(
        `dropdowns[${index}].key must be 2-40 lowercase letters, digits or hyphens`,
        'INVALID_DROPDOWN_KEY',
      );
    }
    if (seenKeys.has(key)) fail(`dropdowns has more than one "${key}" list`, 'DUPLICATE_DROPDOWN_KEY');
    seenKeys.add(key);

    const label = parseText(entry.label, `dropdowns[${index}].label`, LIMITS.maxLabel) ?? key;

    const rawOptions = entry.options ?? [];
    if (!Array.isArray(rawOptions)) fail(`dropdowns[${index}].options must be a list`, 'INVALID_DROPDOWNS');
    if (rawOptions.length > LIMITS.maxOptionsPerDropdown) {
      fail(
        `"${key}" may have at most ${LIMITS.maxOptionsPerDropdown} options`,
        'TOO_MANY_DROPDOWN_OPTIONS',
      );
    }

    const seenValues = new Set();
    const options = rawOptions.map((option, i) => {
      const where = `dropdowns[${index}].options[${i}]`;
      if (!option || typeof option !== 'object') fail(`${where} must be an object`, 'INVALID_DROPDOWNS');

      const optionValue = String(option.value ?? '').trim();
      if (!OPTION_VALUE.test(optionValue)) {
        fail(
          `${where}.value must be 1-60 letters, digits, spaces, dots, hyphens or underscores`,
          'INVALID_DROPDOWN_OPTION',
        );
      }
      if (seenValues.has(optionValue.toLowerCase())) {
        fail(`"${key}" has more than one "${optionValue}" option`, 'DUPLICATE_DROPDOWN_OPTION');
      }
      seenValues.add(optionValue.toLowerCase());

      const optionLabel = parseText(option.label, `${where}.label`, LIMITS.maxLabel) ?? optionValue;
      const order = option.order === undefined || option.order === null ? i : Number(option.order);
      if (!Number.isInteger(order)) fail(`${where}.order must be a whole number`, 'INVALID_DROPDOWN_OPTION');

      return { value: optionValue, label: optionLabel, order };
    });

    options.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    return { key, label, options };
  });
}
