/**
 * Speech-to-text for voice notes (WhatsApp). A provider adapter, like the
 * messaging and AI adapters: it works when the school configures a key, and
 * says so plainly when it does not -- a transcript is never invented.
 *
 *   whisper  OpenAI Whisper API  (OPENAI_STT_API_KEY, or OPENAI_API_KEY)
 *   google   Google Speech-to-Text v1p1beta1 (GOOGLE_STT_API_KEY)
 *   STT_PROVIDER=auto picks whichever is configured (Whisper first).
 *
 * The transcript is only ever text handed to the same assistant as a typed
 * message: it is shown back to the person ("I heard: …") and a write it leads
 * to still needs a typed YES on WhatsApp (see whatsapp.agent.js converse()).
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

const MAX_BYTES = 10 * 1024 * 1024; // Google's synchronous limit; Whisper allows 25 MB.
const SPEECH_TAGS = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', bn: 'bn-IN', pa: 'pa-IN', ml: 'ml-IN' };

const whisperKey = () => env.OPENAI_STT_API_KEY || env.OPENAI_API_KEY || null;
const googleKey = () => env.GOOGLE_STT_API_KEY || null;

/** Which provider will transcribe, or null when none is configured. */
export function sttProvider() {
  const choice = env.STT_PROVIDER || 'auto';
  if (choice === 'whisper' || choice === 'openai') return whisperKey() ? 'whisper' : null;
  if (choice === 'google') return googleKey() ? 'google' : null;
  if (choice === 'none' || choice === 'off') return null;
  if (whisperKey()) return 'whisper';
  if (googleKey()) return 'google';
  return null;
}

export const isSttConfigured = () => sttProvider() !== null;

function extensionFor(mimeType) {
  const m = String(mimeType ?? '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('amr')) return 'amr';
  if (m.includes('webm')) return 'webm';
  if (m.includes('wav')) return 'wav';
  return 'ogg';
}

async function whisper({ audio, mimeType, lang, fetchImpl }) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType || 'audio/ogg' }), `voice.${extensionFor(mimeType)}`);
  form.append('model', env.OPENAI_STT_MODEL || 'whisper-1');
  form.append('response_format', 'json');
  // A language hint helps Indian languages; without one Whisper detects it.
  if (lang && lang !== 'auto') form.append('language', lang);
  const res = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${whisperKey()}` },
    body: form,
    signal: AbortSignal.timeout(env.STT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
  const body = await res.json();
  return { text: String(body?.text ?? '').trim(), language: body?.language ?? lang ?? null };
}

function googleEncoding(mimeType) {
  const ext = extensionFor(mimeType);
  return {
    ogg: { encoding: 'OGG_OPUS', sampleRateHertz: 16000 },
    webm: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 },
    mp3: { encoding: 'MP3', sampleRateHertz: 16000 },
    amr: { encoding: 'AMR', sampleRateHertz: 8000 },
    wav: { encoding: 'LINEAR16' },
    m4a: { encoding: 'MP3', sampleRateHertz: 16000 },
  }[ext];
}

async function google({ audio, mimeType, lang, fetchImpl }) {
  const languageCode = SPEECH_TAGS[lang] ?? 'en-IN';
  const config = {
    ...googleEncoding(mimeType),
    languageCode,
    // A parent may speak Hindi to an English-preference account, and so on.
    alternativeLanguageCodes: ['en-IN', 'hi-IN'].filter((c) => c !== languageCode).slice(0, 3),
    enableAutomaticPunctuation: true,
  };
  const res = await fetchImpl(`https://speech.googleapis.com/v1p1beta1/speech:recognize?key=${encodeURIComponent(googleKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, audio: { content: Buffer.from(audio).toString('base64') } }),
    signal: AbortSignal.timeout(env.STT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google STT HTTP ${res.status}`);
  const body = await res.json();
  const best = (body?.results ?? []).map((r) => r?.alternatives?.[0]?.transcript ?? '').join(' ').trim();
  return { text: best, language: body?.results?.[0]?.languageCode ?? languageCode };
}

/**
 * Transcribes one voice note.
 * @param {{ audio: Buffer|Uint8Array, mimeType?: string, lang?: string, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ configured: boolean, provider: string|null, text: string, language?: string|null, error?: string }>}
 */
export async function transcribe({ audio, mimeType = 'audio/ogg', lang = null, fetchImpl = fetch } = {}) {
  const provider = sttProvider();
  if (!provider) return { configured: false, provider: null, text: '' };
  if (!audio || !audio.length) return { configured: true, provider, text: '', error: 'EMPTY_AUDIO' };
  if (audio.length > MAX_BYTES) return { configured: true, provider, text: '', error: 'TOO_LARGE' };
  try {
    const out = provider === 'whisper'
      ? await whisper({ audio, mimeType, lang, fetchImpl })
      : await google({ audio, mimeType, lang, fetchImpl });
    return { configured: true, provider, text: out.text.slice(0, 1000), language: out.language ?? null };
  } catch (err) {
    // The key is never logged (fetch errors carry the URL; Google's has the key).
    logger.warn(`Speech-to-text (${provider}) failed: ${String(err?.message ?? err).replace(/key=[^&\s]+/g, 'key=[REDACTED]')}`);
    return { configured: true, provider, text: '', error: 'PROVIDER_ERROR' };
  }
}
