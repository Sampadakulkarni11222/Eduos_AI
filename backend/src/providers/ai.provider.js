import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

/**
 * Gemini model id.
 *
 * Was `gemini-1.5-flash`, which 404s — that family is retired. `gemini-2.5-*`
 * is not a valid replacement either: it still appears in ListModels but
 * generateContent answers "no longer available to new users", so listing the
 * models is NOT sufficient to pick one. Verified by calling generateContent on
 * each candidate with this project's key:
 *
 *   gemini-3.6-flash        200 on v1 and v1beta   ← chosen
 *   gemini-3.1-flash-lite   200 on v1 and v1beta   (cheaper fallback)
 *   gemini-flash-latest     200 on v1beta only
 *   gemini-2.5-flash/-lite  404 "no longer available to new users"
 *   gemini-1.5-*            404 retired
 *
 * Pinned rather than `gemini-flash-latest`: an alias that silently changes the
 * model behind a school's OCR and tutoring is not something to find out about
 * in production.
 *
 * When this 404s again, do not trust the model list — probe it:
 *   curl -X POST -H 'Content-Type: application/json' -d '{"contents":[{"parts":[{"text":"hi"}]}]}' \
 *     "https://generativelanguage.googleapis.com/v1/models/<id>:generateContent?key=$GEMINI_API_KEY"
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_TOKENS = 16000;

/**
 * OpenAI: called with fetch against the Chat Completions endpoint, the same
 * way OpenRouter is — no SDK dependency. `max_completion_tokens` rather than
 * `max_tokens`: the newer (reasoning) models reject the latter.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * OpenRouter: one OpenAI-compatible endpoint in front of many providers.
 *
 * It is here to keep the chatbot answering when a single provider does not.
 * Two layers of fallback come with it:
 *   - OPENROUTER_FALLBACK_MODELS is sent as `models`, so OpenRouter itself
 *     retries the next model when the first is down, rate-limited or refuses
 *     the request size — without a second round-trip from us.
 *   - When AI_PROVIDER is gemini or anthropic and OPENROUTER_API_KEY is set,
 *     a failed primary call is retried once through OpenRouter (see
 *     withFallback below).
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = env.OPENROUTER_MODEL || 'openrouter/auto';
const OPENROUTER_FALLBACK_MODELS = (env.OPENROUTER_FALLBACK_MODELS ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== OPENROUTER_MODEL);

let anthropicClient = null;
let geminiClient = null;

const hasOpenRouterKey = () => Boolean(process.env.OPENROUTER_API_KEY);
const hasOpenAiKey = () => Boolean(process.env.OPENAI_API_KEY);

/** Whether the provider named by AI_PROVIDER has its own key. */
function primaryConfigured() {
  switch (env.AI_PROVIDER) {
    case 'gemini': return Boolean(process.env.GEMINI_API_KEY);
    case 'anthropic': return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai': return hasOpenAiKey();
    case 'openrouter': return hasOpenRouterKey();
    default: return false;
  }
}

/**
 * OpenRouter backs up gemini/anthropic/openai only. `rules` stays model-free even
 * with a key present: it is a deliberate deployment choice, not a missing key.
 */
function openRouterIsFallback() {
  return ['gemini', 'anthropic', 'openai'].includes(env.AI_PROVIDER) && hasOpenRouterKey();
}

export function isLlmEnabled() {
  return primaryConfigured() || openRouterIsFallback();
}

/**
 * What the model layer is configured to do, for the boot log. Answers "is
 * Render actually using the model I set?" without a request: provider, model
 * id, timeout and whether a key is PRESENT -- never the key.
 */
export function llmConfigSummary() {
  const model = { gemini: GEMINI_MODEL, anthropic: ANTHROPIC_MODEL, openai: OPENAI_MODEL, openrouter: OPENROUTER_MODEL }[env.AI_PROVIDER] ?? null;
  return {
    provider: env.AI_PROVIDER,
    model,
    keyPresent: primaryConfigured(),
    openRouterFallback: openRouterIsFallback(),
    timeoutMs: env.AI_TIMEOUT_MS,
    enabled: isLlmEnabled(),
  };
}

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

function getGeminiClient() {
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return geminiClient;
}

/**
 * Every model call goes through a breaker.
 *
 * Two problems it solves, both measured rather than imagined. The SDKs carry
 * no timeout, so one slow generation held an HTTP request — and the user's
 * chat box — for as long as the provider felt like taking: agent turns were
 * running 30-40 seconds. And when a key is out of quota (this project's was,
 * answering 429 to everything), every single message paid that round-trip
 * before falling back to the deterministic answer it was always going to give.
 *
 * Failing fast for a minute after three consecutive failures is the difference
 * between "the assistant is a little slower today" and "the assistant is
 * broken", which is how the QA report found it.
 *
 * One breaker per provider: Gemini being down must not stop OpenRouter from
 * being tried — an open primary breaker is exactly when the fallback is needed,
 * and it then costs no wait at all.
 */
const breakerOptions = {
  failureThreshold: 3,
  cooldownPeriod: 60_000,
  timeoutMs: env.AI_TIMEOUT_MS,
  concurrencyLimit: 20,
};
const llmBreaker = new CircuitBreaker('llm', breakerOptions);
const openRouterBreaker = new CircuitBreaker('llm-openrouter', breakerOptions);

/** The shape every caller treats as "no model answer" — never a thrown error. */
const notGenerated = (reason) => ({ text: null, generated: false, reason });

/** Anything that could be a credential, scrubbed from text bound for a log. */
function redactSecrets(text) {
  return String(text ?? '')
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]')
    .replace(/\b(?:sk|cfp|xox[bap])[-_][0-9A-Za-z_-]{10,}/g, '[REDACTED]')
    .replace(/\b(Bearer)\s+[^\s"']+/gi, '$1 [REDACTED]');
}

/**
 * What kind of failure a model call was, so a log can say "the key is wrong"
 * or "out of quota" instead of a stack of SDK text. Every provider failure used
 * to collapse into `PROVIDER_ERROR`, and the routing layer then answered "I'm
 * not sure what you need" with no log line saying why -- the exact situation in
 * which an operator most needs one.
 *
 *   AUTH          401/403, an invalid or missing API key, permission denied
 *   MODEL         404 / "not found" / "no longer available" -- check GEMINI_MODEL
 *   QUOTA         429, RESOURCE_EXHAUSTED, quota or rate limit
 *   TIMEOUT       the call outran AI_TIMEOUT_MS
 *   CIRCUIT_OPEN  three recent failures; calls are skipped for a minute
 *   NETWORK       DNS / connection failures before any HTTP status
 *   API           any other provider-side failure (5xx, 400 ...)
 *
 * `detail` is the provider's message with anything credential-shaped removed.
 */
export function classifyLlmError(err) {
  const message = String(err?.message ?? err ?? '');
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status)
    || Number(/\[(\d{3})\b|\bHTTP (\d{3})\b|\bstatus(?: code)?:? (\d{3})\b/i.exec(message)?.slice(1).find(Boolean))
    || null;
  let category = 'API';
  if (/CircuitBreaker .* is OPEN|concurrency limit/i.test(message)) category = 'CIRCUIT_OPEN';
  else if (/Timeout of \d+ms exceeded|timed? ?out|AbortError|ETIMEDOUT/i.test(message) || err?.name === 'TimeoutError') category = 'TIMEOUT';
  else if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit|too many requests/i.test(message)) category = 'QUOTA';
  else if (status === 401 || status === 403 || /API key not valid|invalid api key|API_KEY_INVALID|permission denied|unauthori[sz]ed|PERMISSION_DENIED/i.test(message)) category = 'AUTH';
  else if (status === 404 || /not found for API version|no longer available|is not found|model.*not (?:found|supported)/i.test(message)) category = 'MODEL';
  else if (!status && /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(message)) category = 'NETWORK';
  return { category, status, detail: redactSecrets(message).slice(0, 300) };
}

/** One structured line per failed model call, and the matching "no answer". */
function providerFailure(provider, model, err, legacyPrefix) {
  const { category, status, detail } = classifyLlmError(err);
  // The prefix is kept so existing log searches ("Gemini generation failed")
  // still find these; the fields after it are what a dashboard can group by.
  logger.error(`${legacyPrefix}: [${category}] ${detail}`, {
    event: 'llm_provider_failure', provider, model, category, status, timeoutMs: env.AI_TIMEOUT_MS,
  });
  // `reason` stays PROVIDER_ERROR -- callers (tutor, study help) key their own
  // messages on it -- and the classification travels alongside as `category`.
  return { ...notGenerated('PROVIDER_ERROR'), category, provider, model };
}

/**
 * Runs the configured provider, then OpenRouter if that produced nothing.
 *
 * A refusal is not retried elsewhere: shopping a refused request around until
 * some model agrees is not what a fallback is for.
 */
async function withFallback(primary, fallback) {
  if (env.AI_PROVIDER === 'openrouter') return fallback();

  const result = primaryConfigured() ? await primary() : notGenerated('LLM_NOT_CONFIGURED');
  if (result.generated || result.reason === 'REFUSED' || !openRouterIsFallback()) return result;

  logger.warn(`${env.AI_PROVIDER} produced no answer (${result.reason}); retrying through OpenRouter`);
  return fallback();
}

/**
 * Generates text from a system prompt + user message.
 *
 * Returns `{ text, generated }`. `generated: false` means no LLM ran — the
 * caller must present its own deterministic content rather than passing off
 * a placeholder as a model answer.
 */
export async function generate({ system, message, maxTokens = MAX_TOKENS }) {
  if (!isLlmEnabled()) {
    return notGenerated('LLM_NOT_CONFIGURED');
  }

  const primary = {
    gemini: () => geminiGenerate({ system, parts: [{ text: message }], maxTokens, breaker: true }),
    openai: () => openAiGenerate({ system, content: message, maxTokens, breaker: true }),
  }[env.AI_PROVIDER]
    ?? (() => anthropicGenerate({ system, content: message, maxTokens, effort: 'medium', breaker: true }));

  return withFallback(primary, () => openRouterGenerate({ system, content: message, maxTokens }));
}

/**
 * Reads an image alongside a prompt (used for the attendance-register OCR).
 *
 * Vision is the OCR engine here rather than a separate library. With
 * OpenRouter, the model chosen must accept images.
 */
export async function generateFromImage({ system, message, imageBase64, mediaType, maxTokens = 4096 }) {
  if (!isLlmEnabled()) {
    return notGenerated('LLM_NOT_CONFIGURED');
  }

  const openAiImageContent = [
    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
    { type: 'text', text: message },
  ];

  const primary = env.AI_PROVIDER === 'gemini'
    ? () => geminiGenerate({
      system,
      parts: [{ inlineData: { data: imageBase64, mimeType: mediaType } }, { text: message }],
      maxTokens,
      breaker: false,
    })
    : env.AI_PROVIDER === 'openai'
    ? () => openAiGenerate({ system, content: openAiImageContent, maxTokens, breaker: false })
    : () => anthropicGenerate({
      system,
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: message },
      ],
      maxTokens,
      effort: 'high',
      breaker: false,
    });

  return withFallback(primary, () => openRouterGenerate({ system, content: openAiImageContent, maxTokens }));
}

async function geminiGenerate({ system, parts, maxTokens, breaker }) {
  try {
    const genModel = getGeminiClient().getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: system,
    });
    const call = () => genModel.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens },
    });
    const response = breaker ? await llmBreaker.execute(call) : await call();

    const text = response.response.text();
    if (!text) return notGenerated('EMPTY_RESPONSE');

    return {
      text,
      generated: true,
      model: GEMINI_MODEL,
      usage: {
        input_tokens: response.response.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: response.response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (err) {
    return providerFailure('gemini', GEMINI_MODEL, err, 'Gemini generation failed');
  }
}

async function anthropicGenerate({ system, content, maxTokens, effort, breaker }) {
  try {
    const call = () => getAnthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }],
    });
    const response = breaker ? await llmBreaker.execute(call) : await call();

    if (response.stop_reason === 'refusal') {
      logger.warn(`LLM refused a request (category: ${response.stop_details?.category ?? 'unknown'})`);
      return notGenerated('REFUSED');
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) return notGenerated('EMPTY_RESPONSE');

    return { text, generated: true, model: response.model, usage: response.usage };
  } catch (err) {
    return providerFailure('anthropic', ANTHROPIC_MODEL, err, 'LLM generation failed');
  }
}

async function openAiGenerate({ system, content, maxTokens, breaker }) {
  try {
    const call = async () => {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_completion_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content },
          ],
        }),
        signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) {
        throw new Error(`HTTP ${res.status}: ${json?.error?.message ?? res.statusText}`);
      }
      return json;
    };
    const data = breaker ? await llmBreaker.execute(call) : await call();

    const message = data?.choices?.[0]?.message;
    if (message?.refusal) {
      logger.warn('LLM refused a request (openai)');
      return notGenerated('REFUSED');
    }

    const text = (message?.content ?? '').trim();
    if (!text) return notGenerated('EMPTY_RESPONSE');

    return {
      text,
      generated: true,
      model: data.model ?? OPENAI_MODEL,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    return providerFailure('openai', OPENAI_MODEL, err, 'OpenAI generation failed');
  }
}

/**
 * OpenRouter's chat completions endpoint, called with fetch — it is
 * OpenAI-compatible, so no SDK is needed.
 *
 * max_tokens is capped by OPENROUTER_MAX_TOKENS because OpenRouter reserves
 * credit for the full max_tokens up front: asking for 16000 on a small
 * balance is answered 402 even when the reply would have been 200 tokens.
 */
async function openRouterGenerate({ system, content, maxTokens }) {
  if (!hasOpenRouterKey()) return notGenerated('LLM_NOT_CONFIGURED');

  const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
  const body = {
    ...(models.length > 1 ? { models } : { model: OPENROUTER_MODEL }),
    max_tokens: Math.min(maxTokens, env.OPENROUTER_MAX_TOKENS),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content },
    ],
  };

  try {
    const data = await openRouterBreaker.execute(async () => {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          // Optional attribution headers; OpenRouter uses them for its app rankings.
          ...(env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': env.OPENROUTER_SITE_URL } : {}),
          ...(env.OPENROUTER_APP_NAME ? { 'X-Title': env.OPENROUTER_APP_NAME } : {}),
        },
        body: JSON.stringify(body),
        // The breaker stops waiting at the same point; this also drops the socket.
        signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) {
        throw new Error(`HTTP ${res.status}: ${json?.error?.message ?? res.statusText}`);
      }
      return json;
    });

    const choice = data?.choices?.[0];
    if (choice?.error) {
      return providerFailure('openrouter', OPENROUTER_MODEL, new Error(choice.error.message ?? 'choice error'), 'OpenRouter generation failed');
    }

    const raw = choice?.message?.content;
    const text = (Array.isArray(raw)
      ? raw.filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
      : raw ?? '').trim();
    if (!text) return notGenerated('EMPTY_RESPONSE');

    return {
      text,
      generated: true,
      model: data.model ?? OPENROUTER_MODEL,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    return providerFailure('openrouter', OPENROUTER_MODEL, err, 'OpenRouter generation failed');
  }
}
