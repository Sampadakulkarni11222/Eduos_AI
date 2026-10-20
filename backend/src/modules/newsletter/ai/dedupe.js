import { canonicalLink } from './googleAlerts.js';

/**
 * "Have we got this one already?" A new alert item is a duplicate of an
 * existing opportunity (in any state but archived) when it points at the same
 * page, or when its title says the same thing: the word sets overlap by 80%
 * or more (Jaccard), or one title's words are all in the other's and it has
 * at least three of them ("CBSE Science Exhibition" inside "CBSE Science
 * Exhibition 2026: registrations open"). Years and filler words are ignored,
 * so next year's announcement of a programme we list counts as that programme.
 */
const STOP = new Set('a an the and or of for to in on at by with from is are be this that its it as new now open opens opened announced announces announcement registration registrations register apply applications invited last date deadline students student school schools india indian national level 2024 2025 2026 2027 2028 inviting invites edition'.split(' '));

export function titleTokens(title) {
  return new Set(String(title ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\p{Script=Devanagari} ]+/gu, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^(19|20)\d{2}$/.test(w) && (w.length > 1 || /\d/.test(w))));
}

export function titleSimilarity(a, b) {
  const A = titleTokens(a); const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  const jaccard = both / (A.size + B.size - both);
  const small = Math.min(A.size, B.size);
  const containment = small >= 3 ? both / small : 0;
  return Math.max(jaccard, containment);
}

export const SIMILAR = 0.8;

/** The existing opportunity this item duplicates, or null. `existing`: [{ _id, title, officialUrl, source: { link } }]. */
export function findDuplicate({ title, link }, existing) {
  const key = link ? canonicalLink(link) : null;
  for (const o of existing) {
    if (key && [o.officialUrl, o.source?.link].some((l) => l && canonicalLink(l) === key)) return { opportunity: o, why: 'same link' };
  }
  let best = null;
  for (const o of existing) {
    const sim = titleSimilarity(title, o.title);
    if (sim >= SIMILAR && (!best || sim > best.sim)) best = { opportunity: o, sim };
  }
  return best ? { opportunity: best.opportunity, why: `similar title (${Math.round(best.sim * 100)}%)` } : null;
}
