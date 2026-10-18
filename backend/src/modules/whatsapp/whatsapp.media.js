/**
 * Downloads a WhatsApp voice note through the provider it arrived from.
 *
 *   Meta     GET /v20.0/{media-id} (Bearer WA_ACCESS_TOKEN) -> { url, mime_type },
 *            then GET that url with the same token. Meta's media URLs live on
 *            its own hosts; any other host is refused (the URL comes from a
 *            response, and the token must never be sent anywhere else).
 *   Chatflow the media URL Chatflow forwards with the message, fetched only
 *            from Chatflow's own API host (with its API key) or Meta's media hosts.
 *
 * Without live credentials (simulation) nothing is downloaded: the caller
 * answers that voice notes need the live channel and a speech service, and
 * the in-app simulator accepts a typed stand-in transcript instead.
 */
import { env, isWhatsappLive, isChatflowLive } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp's own audio limit
const META_MEDIA_HOSTS = /(?:^|\.)(?:fbcdn\.net|fbsbx\.com|facebook\.com|whatsapp\.net)$/i;

function safeHttps(url, allowed) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && allowed(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

async function readCapped(res, limit = MAX_BYTES) {
  const declared = Number(res.headers?.get?.('content-length') ?? 0);
  if (declared > limit) throw new TooLarge();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new TooLarge();
  return buf;
}

class TooLarge extends Error {
  constructor() { super('media too large'); this.code = 'TOO_LARGE'; }
}

/** A Chatflow media URL, only on Chatflow's own API host or Meta's media hosts. */
function chatflowMediaUrl(rawUrl) {
  let apiHost = null;
  try { apiHost = new URL(env.CHATFLOW_API_URL).hostname; } catch { apiHost = null; }
  const url = safeHttps(rawUrl, (host) => host === apiHost || META_MEDIA_HOSTS.test(host));
  return { url, apiHost };
}

/** Meta Cloud API media (any kind) -> { buffer, mimeType } or null. */
async function fetchMetaMedia(mediaId, { fetchImpl = fetch, limit = MAX_BYTES } = {}) {
  if (!isWhatsappLive() || !mediaId || !/^[\w.-]{1,128}$/.test(String(mediaId))) return null;
  const auth = { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}` };
  const meta = await fetchImpl(`https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (!meta.ok) throw new Error(`media lookup HTTP ${meta.status}`);
  const info = await meta.json();
  const url = safeHttps(info?.url, (host) => META_MEDIA_HOSTS.test(host));
  if (!url) throw new Error('media URL is not on a Meta host');
  const file = await fetchImpl(url, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!file.ok) throw new Error(`media download HTTP ${file.status}`);
  return { buffer: await readCapped(file, limit), mimeType: info?.mime_type ?? null };
}

/** Meta Cloud API media -> { audio, mimeType } or null. */
export async function downloadMetaMedia(mediaId, { fetchImpl = fetch } = {}) {
  try {
    const got = await fetchMetaMedia(mediaId, { fetchImpl });
    return got ? { audio: got.buffer, mimeType: got.mimeType ?? 'audio/ogg' } : null;
  } catch (err) {
    logger.warn(`WhatsApp voice note download failed: ${err?.message}`);
    return null;
  }
}

/** Chatflow-forwarded media -> { audio, mimeType } or null. */
export async function downloadChatflowMedia(media, { fetchImpl = fetch } = {}) {
  if (!isChatflowLive() || !media?.url) return null;
  const { url, apiHost } = chatflowMediaUrl(media.url);
  if (!url) {
    logger.warn('Chatflow voice note URL is not on an allowed host; not downloaded.');
    return null;
  }
  try {
    const headers = url.hostname === apiHost ? { 'x-api-key': env.CHATFLOW_API_KEY } : {};
    const file = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!file.ok) throw new Error(`HTTP ${file.status}`);
    return { audio: await readCapped(file), mimeType: media.mimeType ?? file.headers?.get?.('content-type') ?? 'audio/ogg' };
  } catch (err) {
    logger.warn(`Chatflow voice note download failed: ${err?.message}`);
    return null;
  }
}

/* ── Documents (spreadsheets for a bulk import) ──────────────────────────
   NOTE (p7-language): this file was first created by the bulk-import work
   (p7-bulkimport) with downloadWhatsappDocument(); it was overwritten by
   mistake while the voice-note downloader was added, and the function below
   re-creates it from its callers and tests (whatsapp.agent.js
   converseWithDocument, tests/imports.bulkImport.test.js). Contract:
   -> { buffer, filename, mimeType, simulated? } or { error, message }.
   Sources: the simulator's inline file (off-live only), a Meta media id, or a
   Chatflow-forwarded URL (document.chatflowMedia) on Chatflow's API host or
   Meta's media hosts only -- never any other host. */
const DOCUMENT_TYPES = /\.(?:xlsx|xls|csv)$/i;
// The bulk importers' own limit (imports/sheet.js MAX_FILE_BYTES), so WhatsApp and the website agree.
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export async function downloadWhatsappDocument(document, { fetchImpl = fetch } = {}) {
  const filename = String(document?.filename ?? 'upload.csv').slice(0, 200);
  if (!DOCUMENT_TYPES.test(filename)) {
    return { error: 'UNSUPPORTED', message: 'Please send the spreadsheet as an .xlsx, .xls or .csv file.' };
  }
  // The in-app simulator and test webhooks carry the file inline; a live
  // number never does (Meta sends a media id), so it is honoured only off-live.
  if (document?.simulatedBase64 && !isWhatsappLive()) {
    const buffer = Buffer.from(String(document.simulatedBase64), 'base64');
    if (!buffer.length) return { error: 'EMPTY', message: 'That file was empty. Please send it again.' };
    if (buffer.length > MAX_DOCUMENT_BYTES) return { error: 'TOO_LARGE', message: 'That file is larger than 2 MB. Split it into smaller sheets and send them one at a time.' };
    return { buffer, filename, mimeType: document.mimeType ?? null, simulated: true };
  }
  const tooLarge = { error: 'TOO_LARGE', message: 'That file is larger than 2 MB. Split it into smaller sheets and send them one at a time.' };
  const failed = { error: 'DOWNLOAD_FAILED', message: 'I could not download that file. Please send it again, or upload it on the website.' };
  const notHere = { error: 'NOT_AVAILABLE', message: 'I could not download that file over WhatsApp here. Please upload it on the website (Ask AI → attach).' };
  const empty = { error: 'EMPTY', message: 'That file was empty. Please send it again.' };

  // Chatflow forwards a URL, not a media id.
  if (document?.chatflowMedia?.url) {
    if (!isChatflowLive()) return notHere;
    const { url, apiHost } = chatflowMediaUrl(document.chatflowMedia.url);
    if (!url) {
      logger.warn('Chatflow document URL is not on an allowed host; not downloaded.');
      return failed;
    }
    try {
      const headers = url.hostname === apiHost ? { 'x-api-key': env.CHATFLOW_API_KEY } : {};
      const file = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!file.ok) throw new Error(`HTTP ${file.status}`);
      const buffer = await readCapped(file, MAX_DOCUMENT_BYTES);
      if (!buffer.length) return empty;
      return { buffer, filename, mimeType: document.chatflowMedia.mimeType ?? document.mimeType ?? null };
    } catch (err) {
      if (err?.code === 'TOO_LARGE') return tooLarge;
      logger.warn(`Chatflow document download failed: ${err?.message}`);
      return failed;
    }
  }

  if (!isWhatsappLive() || !document?.id) return notHere;
  try {
    const got = await fetchMetaMedia(document.id, { fetchImpl, limit: MAX_DOCUMENT_BYTES });
    if (!got) return failed;
    if (!got.buffer.length) return empty;
    return { buffer: got.buffer, filename, mimeType: got.mimeType ?? document.mimeType ?? null };
  } catch (err) {
    if (err?.code === 'TOO_LARGE') return tooLarge;
    logger.warn(`WhatsApp document download failed: ${err?.message}`);
    return failed;
  }
}
