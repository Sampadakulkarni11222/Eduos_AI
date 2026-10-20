import { signUploadPath } from '../uploads/signedUrls.js';
import { ProviderError } from './http.js';
import { NETWORK_PROVIDER, PROVIDERS, appConfigured } from './providers.js';
import { liveConnection, withTokens, metaPageToken } from './oauth.service.js';
import * as meta from './clients/meta.js';
import * as linkedin from './clients/linkedin.js';
import * as x from './clients/x.js';

/**
 * Live posting to the school's social accounts, used by social.service as
 * its adapter. Returns { status, reason?, providerPostId?, permalink?, sentText? }:
 *
 *   SIMULATED      the provider app is not configured or the school has not
 *                  connected the account: nothing left the server.
 *   SENT           the network accepted the post (its id and link are kept).
 *   FAILED         refused or unreachable, with the reason; can be retried.
 *   NOT_SUPPORTED  the network has no API for this (YouTube community posts),
 *                  final, never retried and never pretended.
 *
 * Each network's limits are respected: X 280 characters (a link counts as
 * 23), Instagram a photo and a 2,200-character caption with at most 30
 * hashtags, LinkedIn 3,000 characters, Facebook 63,206.
 */

export const LIMITS = {
  FACEBOOK: { text: 63206 },
  INSTAGRAM: { text: 2200, hashtags: 30, imageRequired: true },
  X: { text: 280, linkWeight: 23 },
  LINKEDIN: { text: 3000 },
  YOUTUBE: { text: 0 },
};
export const YOUTUBE_NOTE = 'YouTube has no public API for community posts, so nothing was sent. Post it in YouTube Studio; video upload is not offered from EduOS.';

const LABEL = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', X: 'X', LINKEDIN: 'LinkedIn', YOUTUBE: 'YouTube' };

/** Length as X counts it: every URL is 23 characters. */
export function xLength(text) {
  return [...String(text).replace(/https?:\/\/\S+/g, 'x'.repeat(LIMITS.X.linkWeight))].length;
}

const shorten = (text, max) => {
  const chars = [...String(text)];
  if (chars.length <= max) return String(text);
  const cut = chars.slice(0, Math.max(0, max - 1)).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/**
 * The text a network receives. `shortenable` (a shared newsroom story) is
 * cut to fit with an ellipsis; free text that does not fit is refused, so a
 * person's words are never silently cut.
 */
export function renderFor(network, { text, link, shortenable = false }) {
  const t = String(text ?? '').trim();
  if (network === 'X') {
    const suffix = link ? ` ${link}` : '';
    if (xLength(t + suffix) <= LIMITS.X.text) return { text: t + suffix };
    if (!shortenable) return { error: `The text is ${xLength(t + suffix)} characters as X counts them; X allows ${LIMITS.X.text} (a link counts as ${LIMITS.X.linkWeight}).`, code: 'TOO_LONG_FOR_X' };
    const room = LIMITS.X.text - (link ? LIMITS.X.linkWeight + 1 : 0);
    return { text: shorten(t, room) + suffix };
  }
  if (network === 'INSTAGRAM') {
    const caption = link ? `${t}\n\n${link}` : t;
    const tags = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (tags > LIMITS.INSTAGRAM.hashtags) return { error: `Instagram allows at most ${LIMITS.INSTAGRAM.hashtags} hashtags; this has ${tags}.`, code: 'TOO_MANY_HASHTAGS' };
    if ([...caption].length <= LIMITS.INSTAGRAM.text) return { text: caption };
    if (!shortenable) return { error: `Instagram captions allow ${LIMITS.INSTAGRAM.text} characters; this has ${[...caption].length}.`, code: 'TOO_LONG_FOR_INSTAGRAM' };
    return { text: shorten(t, LIMITS.INSTAGRAM.text - (link ? link.length + 2 : 0)) + (link ? `\n\n${link}` : '') };
  }
  const max = LIMITS[network]?.text ?? 0;
  if ([...t].length <= max) return { text: t };
  if (!shortenable) return { error: `${LABEL[network]} allows ${max} characters; this has ${[...t].length}.`, code: 'TOO_LONG' };
  return { text: shorten(t, max) };
}

/** Problems with this text on these networks, checked when a post is written (free text only). */
export function limitProblems(networks, { text, link }) {
  return networks.map((n) => (n === 'YOUTUBE' ? null : renderFor(n, { text, link }))).filter((r) => r?.error).map((r) => ({ message: r.error, code: r.code }));
}

/** A public https URL the network can fetch the photo from, or null. Stored uploads need PUBLIC_API_URL. */
export function publicImageUrl(imageUrl) {
  if (!imageUrl) return null;
  const s = String(imageUrl);
  if (/^https:\/\//i.test(s)) return s;
  const m = s.match(/^\/uploads\/([A-Za-z0-9_-][A-Za-z0-9._-]*)$/);
  const base = String(process.env.PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!m || !/^https:\/\//i.test(base)) return null;
  return `${base}${signUploadPath(m[1])}`;
}

function failed(err) {
  if (err instanceof ProviderError) {
    if (err.rateLimited) return { status: 'FAILED', reason: `${err.message}. The network is limiting requests; try again later.` };
    if (err.auth) return { status: 'FAILED', reason: `${err.message}. Reconnect the account on the Social page, then retry.` };
    return { status: 'FAILED', reason: err.message };
  }
  return { status: 'FAILED', reason: String(err?.message ?? err).slice(0, 300) };
}

/**
 * Posts to one network. `post` is { text, link, imageUrl, shortenable, title }.
 */
export async function publishTo(network, post) {
  const provider = NETWORK_PROVIDER[network];
  if (!provider) return { status: 'FAILED', reason: `Unknown network ${network}` };
  const conn = appConfigured(provider) ? await liveConnection(provider) : null;
  if (!conn || !(conn.purposes ?? []).includes('social')) {
    const why = !appConfigured(provider)
      ? `the ${PROVIDERS[provider].label.split(' (')[0]} app is not configured by the platform administrator`
      : `the school's ${LABEL[network]} account is not connected`;
    return { status: 'SIMULATED', reason: `Simulated — not posted: ${why}.` };
  }
  if (network === 'YOUTUBE') return { status: 'NOT_SUPPORTED', reason: YOUTUBE_NOTE };

  const rendered = renderFor(network, post);
  if (rendered.error) return { status: 'FAILED', reason: rendered.error };
  const sentText = rendered.text;
  const s = conn.selected ?? {};
  try {
    if (network === 'FACEBOOK') {
      if (!s.metaPageId) return { status: 'FAILED', reason: 'Choose the Facebook Page to post to (Social page, Meta connection).' };
      const token = await metaPageToken(s.metaPageId);
      const image = publicImageUrl(post.imageUrl);
      const out = await meta.publishPagePost(token, s.metaPageId, { text: sentText, link: post.link, imageUrl: image });
      return { status: 'SENT', ...out, sentText };
    }
    if (network === 'INSTAGRAM') {
      const page = (conn.assets?.metaPages ?? []).find((p) => p.id === s.metaPageId);
      if (!page?.igUserId) return { status: 'FAILED', reason: 'The chosen Facebook Page has no Instagram professional account linked. Link one in Meta Business Suite, then refresh the Pages list.' };
      const image = publicImageUrl(post.imageUrl);
      if (!image) return { status: 'FAILED', reason: post.imageUrl ? 'Instagram needs the photo at a public https address: the platform administrator must set PUBLIC_API_URL, or give the photo as an https link.' : 'Instagram posts need a photo. Add one to the post and send again.' };
      const token = await metaPageToken(s.metaPageId);
      const out = await meta.publishInstagram(token, page.igUserId, { caption: sentText, imageUrl: image });
      return { status: 'SENT', ...out, sentText };
    }
    if (network === 'LINKEDIN') {
      if (!s.linkedinOrgUrn) return { status: 'FAILED', reason: 'Choose the LinkedIn organisation page to post as.' };
      const out = await withTokens('LINKEDIN', (t) => linkedin.publishOrgPost(t, s.linkedinOrgUrn, { text: sentText, link: post.link, title: post.title }));
      return { status: 'SENT', ...out, sentText };
    }
    if (network === 'X') {
      const out = await withTokens('X', (t) => x.publishPost(t, { text: sentText }));
      return { status: 'SENT', ...out, sentText };
    }
  } catch (err) {
    return failed(err);
  }
  return { status: 'FAILED', reason: 'Not handled' };
}

/** Likes, comments and shares of a sent post, from the network (null when it cannot be read). */
export async function engagementOf(network, providerPostId) {
  const provider = NETWORK_PROVIDER[network];
  const conn = appConfigured(provider) ? await liveConnection(provider) : null;
  if (!conn || !providerPostId) return null;
  const s = conn.selected ?? {};
  if (network === 'FACEBOOK') return meta.pagePostEngagement(await metaPageToken(s.metaPageId), providerPostId);
  if (network === 'INSTAGRAM') return meta.instagramEngagement(await metaPageToken(s.metaPageId), providerPostId);
  if (network === 'LINKEDIN') return withTokens('LINKEDIN', (t) => linkedin.postEngagement(t, providerPostId));
  if (network === 'X') return withTokens('X', (t) => x.postEngagement(t, providerPostId));
  return null;
}
