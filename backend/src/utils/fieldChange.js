/**
 * "Change X's address to Y" -- a field, the record it belongs to, and its new value.
 *
 * Grammar, not vocabulary. A correction is said in a few shapes and every one of
 * them carries the same three things:
 *
 *   owner's field to value        "Change Rahul Sharma's address to 12 Park Street"
 *                                 "Set Rahul Sharma's blood group to O+"
 *   the field of owner to value   "Change the capacity of room A-101 to 4"
 *                                 "Change the receipt number of the payment for INV-1001 to R-778"
 *   owner to a quantity           "Update Wings of Fire to 5 copies"
 *
 * The field is whatever words the sentence puts there; which property of which
 * capability it names is decided by the capability, against its own schema (see
 * propertyForField), so a new capability with a new field is understood by
 * declaring it. Pure string work: nothing here reads a database or decides what
 * anybody may change.
 */

const VERBS = '(?:change|update|set|edit|correct|fix|modify|amend|revise)';

/** Words that are not a field even when the grammar puts them there. */
const NOT_A_FIELD = /^(?:it|him|her|them|this|that|status|state)$/i;

const trimValue = (s) => String(s ?? '').trim().replace(/[.!?]+$/, '').replace(/^["'“‘]+|["'”’]+$/g, '').trim();

/**
 * The correction a sentence asks for, or null.
 *
 * @returns {null | { field: string, owner: string | null, value: string, span: string }}
 *   `span` is the value as written, so the readers of every other dimension can
 *   leave it out: the new address is not a place to look for a name.
 */
export function fieldChangeFromText(text) {
  const str = String(text ?? '').trim();

  // "Change Rahul Sharma's address to 12 Park Street"
  const possessive = new RegExp(
    `\\b${VERBS}\\s+(?:the\\s+)?(.+?)['’]s\\s+([a-z][a-z ]{1,30}?)\\s+(?:to|as|=)\\s+(.+)$`, 'i',
  ).exec(str);
  if (possessive && !NOT_A_FIELD.test(possessive[2].trim()) && !/^my$/i.test(possessive[1].trim())) {
    return { owner: possessive[1].trim(), field: possessive[2].trim(), value: trimValue(possessive[3]), span: possessive[3].trim().replace(/[.!?]+$/, '') };
  }

  // "Change the capacity of room A-101 to 4"
  const ofOwner = new RegExp(
    `\\b${VERBS}\\s+the\\s+([a-z][a-z ]{1,30}?)\\s+of\\s+(?:the\\s+)?(.+?)\\s+(?:to|as)\\s+(.+)$`, 'i',
  ).exec(str);
  if (ofOwner && !NOT_A_FIELD.test(ofOwner[1].trim())) {
    return { owner: ofOwner[2].trim(), field: ofOwner[1].trim(), value: trimValue(ofOwner[3]), span: ofOwner[3].trim().replace(/[.!?]+$/, '') };
  }

  // "Update Wings of Fire to 5 copies": a quantity and its unit, the unit naming the field.
  const quantity = new RegExp(`\\b${VERBS}\\s+(.+?)\\s+to\\s+(\\d[\\d,.]*)\\s+([a-z]+)\\s*[.!?]*$`, 'i').exec(str);
  if (quantity && !/\b(?:period|class|grade|day|month|week|year|point|mark)s?$/i.test(quantity[3])) {
    return { owner: quantity[1].trim(), field: quantity[3].trim(), value: trimValue(quantity[2]), span: `${quantity[2]} ${quantity[3]}` };
  }

  return null;
}

/** The words of a property name: "bloodGroup" -> ["blood", "group"], "receiptNo" -> ["receipt", "no"]. */
const wordsOfProperty = (name) =>
  String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** A crude singular, so "copies" meets "copy" and "phones" meets "phone". */
const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words that mean the same inside a field name. */
const FIELD_SYNONYMS = { number: 'no', num: 'no', dob: 'birth', birthday: 'birth', birthdate: 'birth', phone: 'phone', mobile: 'phone' };
const canon = (w) => FIELD_SYNONYMS[w] ?? singular(w);

/**
 * The property a field phrase names, on one capability's schema.
 *
 * Looked for at the top level and inside an object property called `fields` /
 * `changes` (a capability that takes a bag of corrected values). Every word of
 * the phrase must be one of the property's own words, so "blood group" names
 * `bloodGroup`, "receipt number" names `receiptNo`, "copies" names
 * `totalCopies` and "address" names `address` -- and "name" alone does not name
 * `routeName` unless nothing more specific does.
 *
 * @returns {null | { path: string[], name: string, schema: object }}
 */
export function propertyForField(field, schema) {
  const wanted = wordsOfProperty(field.replace(/\s+/g, ' ')).map(canon);
  if (!wanted.length) return null;
  const candidates = [];
  const consider = (name, prop, path) => {
    const words = wordsOfProperty(name).map(canon);
    // "driver" names driverName; "date of birth" names dob; every wanted word must be present.
    const covers = wanted.every((w) => words.includes(w));
    if (covers) candidates.push({ path, name, schema: prop, extra: words.length - wanted.length });
  };
  for (const [name, prop] of Object.entries(schema?.properties ?? {})) {
    if (['fields', 'changes'].includes(name) && prop?.type === 'object') {
      for (const [inner, innerProp] of Object.entries(prop.properties ?? {})) consider(inner, innerProp, [name, inner]);
    } else if (!/Id$/.test(name)) {
      consider(name, prop, [name]);
    }
  }
  // The tightest fit wins: "name" names `name` before it names `routeName`.
  return candidates.sort((a, b) => a.extra - b.extra)[0] ?? null;
}

/**
 * A value as the property wants it: a number for a number, a boolean for a
 * boolean, an amount in paise for a money property, text otherwise.
 * Null when the value cannot be read as that -- the caller then leaves it out
 * and the tool asks.
 */
export function coerceFieldValue(value, schema, propertyName = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (Array.isArray(schema?.enum)) {
    const hit = schema.enum.find((v) => String(v).toLowerCase().replace(/_/g, ' ') === raw.toLowerCase());
    return hit ?? null;
  }
  if (schema?.type === 'integer' || schema?.type === 'number') {
    const n = Number(raw.replace(/[₹,]/g, '').replace(/^rs\.?\s*/i, ''));
    if (!Number.isFinite(n)) return null;
    if (/Paise$/.test(propertyName)) return Math.round(n * 100);
    return schema.type === 'integer' ? Math.trunc(n) : n;
  }
  if (schema?.type === 'boolean') {
    if (/^(?:yes|true|on|enabled?)$/i.test(raw)) return true;
    if (/^(?:no|false|off|disabled?)$/i.test(raw)) return false;
    return null;
  }
  if (schema?.type === 'string') return raw;
  return null;
}
