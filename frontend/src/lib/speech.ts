'use client';

/**
 * Voice input via the browser's Web Speech API.
 *
 * Deliberately client-side. Server-side speech-to-text would mean a third
 * Anthropic-unrelated provider, its credentials, and per-minute cost, for a
 * capability every Chromium and Safari browser already ships. The trade is
 * that Firefox has no support — handled by hiding the button rather than
 * showing one that does nothing.
 *
 * Note this covers the *web* surface only. WhatsApp voice notes arrive as
 * audio files on the webhook and cannot use a browser API; transcribing those
 * needs a server-side STT provider and is not built.
 */

export interface SpeechLanguage {
  /** BCP-47 tag the recogniser needs. */
  code: string;
  /** Two-letter tag the backend uses for replies. */
  lang: string;
  label: string;
}

/**
 * Offered languages. `lang` is what the assistant replies in; only `en` and
 * `hi` have a full reply catalogue today, the rest fall back to English text
 * unless an LLM is configured — surfaced in the UI rather than hidden.
 */
export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: 'en-IN', lang: 'en', label: 'English' },
  { code: 'hi-IN', lang: 'hi', label: 'हिन्दी' },
  { code: 'mr-IN', lang: 'mr', label: 'मराठी' },
  { code: 'bn-IN', lang: 'bn', label: 'বাংলা' },
  { code: 'ta-IN', lang: 'ta', label: 'தமிழ்' },
  { code: 'te-IN', lang: 'te', label: 'తెలుగు' },
  { code: 'gu-IN', lang: 'gu', label: 'ગુજરાતી' },
  { code: 'kn-IN', lang: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml-IN', lang: 'ml', label: 'മലയാളം' },
  { code: 'pa-IN', lang: 'pa', label: 'ਪੰਜਾਬੀ' },
];

/* The API is still vendor-prefixed in most browsers and absent from the DOM
   lib, so it is described narrowly here rather than pulling in a types pkg. */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getConstructor() !== null;
}

export interface DictationHandlers {
  /** Fires as the user speaks, so the input can update live. */
  onPartial?: (text: string) => void;
  /** Fires once with the settled transcript. */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

/**
 * Language detection matching the backend utils/language.js logic.
 */
const SCRIPT_RANGES = [
  { lang: 'hi', re: /[ऀ-ॿ]/ }, // Devanagari — Hindi/Marathi
  { lang: 'bn', re: /[ঀ-৿]/ }, // Bengali
  { lang: 'gu', re: /[઀-૿]/ }, // Gujarati
  { lang: 'pa', re: /[਀-੿]/ }, // Gurmukhi — Punjabi
  { lang: 'ta', re: /[஀-௿]/ }, // Tamil
  { lang: 'te', re: /[ఀ-౿]/ }, // Telugu
  { lang: 'kn', re: /[ಀ-೿]/ }, // Kannada
  { lang: 'ml', re: /[ഀ-ൿ]/ }, // Malayalam
  { lang: 'or', re: /[଀-୿]/ }, // Odia
  { lang: 'ur', re: /[؀-ۿ]/ }, // Arabic script — Urdu
];

const HINGLISH_MARKERS = [
  'kitna', 'kitni', 'kitne', 'kaise', 'kaisa', 'kaha', 'kahan', 'kyun', 'kyu',
  'nahi', 'nahin', 'haan', 'chahiye', 'bataye', 'bataiye', 'batao',
  'chutti', 'haazri', 'hajri', 'shulk', 'pariksha', 'kal', 'aaj',
  'mera', 'meri', 'mere', 'aapka', 'aapki', 'tumhara',
  'karna', 'karna hai', 'hona', 'lagega', 'bakaya', 'jama',
];

export interface DetectedLanguageResult {
  lang: string;
  confident: boolean;
  romanised?: boolean;
}

export function detectLanguage(text: string): DetectedLanguageResult {
  const s = String(text ?? '');
  if (!s.trim()) return { lang: 'en', confident: false };

  for (const { lang, re } of SCRIPT_RANGES) {
    if (re.test(s)) return { lang, confident: true };
  }

  const words = s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hits = words.filter((w) => HINGLISH_MARKERS.includes(w)).length;
  if (hits >= 2 || (hits === 1 && words.length <= 6)) {
    return { lang: 'hi', confident: true, romanised: true };
  }

  return { lang: 'en', confident: false };
}

/**
 * Starts dictation. Returns a stop function, or null if unsupported.
 *
 * Errors are translated into something a parent can act on — "no-speech" and
 * "not-allowed" are the two that actually happen, and the raw codes mean
 * nothing to a user.
 */
/**
 * Starts dictation. Returns a stop function, or null if unsupported.
 *
 * Includes full event lifecycle debug logs and uses continuous mode so the
 * recogniser does not prematurely abort when the user pauses.
 */
export function startDictation(languageCode?: string, handlers?: DictationHandlers): (() => void) | null {
  const Ctor = getConstructor();
  if (!Ctor || !handlers) return null;

  const defaultLang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-IN';
  const recogniser = new Ctor();
  const selectedLang = languageCode || defaultLang;
  recogniser.lang = selectedLang;
  recogniser.continuous = true;
  recogniser.interimResults = true;

  let settled = '';
  let receivedSpeech = false;

  console.log('[SpeechRecognition] Initialising dictation, lang:', selectedLang);

  recogniser.onresult = (event) => {
    receivedSpeech = true;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) settled += text;
      else interim += text;
    }
    console.log('[SpeechRecognition] onresult:', { settled, interim });
    const currentText = (settled + interim).trim();
    if (currentText && handlers.onPartial) handlers.onPartial(currentText);
  };

  recogniser.onerror = (e) => {
    console.warn('[SpeechRecognition] onerror fired:', e.error);
    // If we already captured text or the user is speaking, don't abort with no-speech
    if (e.error === 'no-speech' && receivedSpeech) {
      return;
    }

    const message =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone access was blocked. Allow it in your browser settings to use voice.'
        : e.error === 'no-speech'
          ? "I didn't catch that. Try speaking again."
          : e.error === 'network'
            ? 'Voice input needs a network connection.'
            : 'Voice input stopped unexpectedly.';
    handlers.onError?.(message);
  };

  recogniser.onend = () => {
    console.log('[SpeechRecognition] onend fired, settled text:', settled);
    if (settled.trim()) handlers.onFinal(settled.trim());
    handlers.onEnd?.();
  };

  try {
    recogniser.start();
    console.log('[SpeechRecognition] Started recognition stream.');
  } catch (err) {
    console.error('[SpeechRecognition] Failed to start:', err);
    handlers.onError?.('Could not start voice input.');
    return null;
  }

  return () => {
    console.log('[SpeechRecognition] Stopping recognition manually.');
    try {
      recogniser.stop();
    } catch {
      // Ignore if already stopped
    }
  };
}

/**
 * Fallback MediaRecorder audio recording helper for environments where
 * Web Speech API fails or returns no-speech.
 */
export function recordAudio(onAudioCaptured: (blob: Blob, mediaType: string) => void, onError?: (msg: string) => void): (() => void) | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    onError?.('Microphone recording is not supported in this browser.');
    return null;
  }

  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType });
          onAudioCaptured(blob, mimeType);
        }
      };

      mediaRecorder.start();
      console.log('[MediaRecorder] Recording started, mimeType:', mimeType);
    })
    .catch((err) => {
      console.error('[MediaRecorder] getUserMedia error:', err);
      onError?.('Microphone access was blocked. Allow it in your browser settings.');
    });

  return () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.log('[MediaRecorder] Stopping recording.');
      mediaRecorder.stop();
    }
  };
}

