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
 * Starts dictation. Returns a stop function, or null if unsupported.
 *
 * Errors are translated into something a parent can act on — "no-speech" and
 * "not-allowed" are the two that actually happen, and the raw codes mean
 * nothing to a user.
 */
export function startDictation(languageCode: string, handlers: DictationHandlers): (() => void) | null {
  const Ctor = getConstructor();
  if (!Ctor) return null;

  const recogniser = new Ctor();
  recogniser.lang = languageCode;
  recogniser.continuous = false;
  recogniser.interimResults = true;

  let settled = '';

  recogniser.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) settled += text;
      else interim += text;
    }
    if (interim && handlers.onPartial) handlers.onPartial((settled + interim).trim());
  };

  recogniser.onerror = (e) => {
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
    if (settled.trim()) handlers.onFinal(settled.trim());
    handlers.onEnd?.();
  };

  try {
    recogniser.start();
  } catch {
    handlers.onError?.('Could not start voice input.');
    return null;
  }

  return () => recogniser.stop();
}
