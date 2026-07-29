import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * LLM provider abstraction, following the same shape as the payment and
 * notification providers: real behaviour when credentials exist, an honest
 * labelled fallback when they don't.
 *
 * Deliberately NOT wired into authorization. The agent's tool layer decides
 * what a user may do; this module only turns scoped data into prose. That
 * separation is what makes a jailbroken prompt harmless — see
 * modules/ai/agent/orchestrator.js.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const MAX_TOKENS = 16000;

let client = null;

export function isLlmEnabled() {
  return env.AI_PROVIDER === 'anthropic' && Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

/**
 * Generates text from a system prompt + user message.
 *
 * Returns `{ text, generated }`. `generated: false` means no LLM ran — the
 * caller must present its own deterministic content rather than passing off
 * a placeholder as a model answer.
 */
/**
 * Reads an image alongside a prompt (used for the attendance-register OCR).
 *
 * Vision is the OCR engine here rather than a separate library: a phone photo
 * of a handwritten register is exactly the messy, skewed, mixed-handwriting
 * input classical OCR handles worst. `mediaType` must be one the API accepts.
 */
export async function generateFromImage({ system, message, imageBase64, mediaType, maxTokens = 4096 }) {
  if (!isLlmEnabled()) {
    return { text: null, generated: false, reason: 'LLM_NOT_CONFIGURED' };
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // Transcription accuracy matters more here than token thrift, and a
      // misread register writes wrong attendance onto real children.
      output_config: { effort: 'high' },
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: message },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      logger.warn(`LLM refused an image request (category: ${response.stop_details?.category ?? 'unknown'})`);
      return { text: null, generated: false, reason: 'REFUSED' };
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return { text: null, generated: false, reason: 'EMPTY_RESPONSE' };

    return { text, generated: true, model: response.model, usage: response.usage };
  } catch (err) {
    logger.error(`LLM image generation failed: ${err.message}`);
    return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
  }
}

export async function generate({ system, message, maxTokens = MAX_TOKENS }) {
  if (!isLlmEnabled()) {
    return { text: null, generated: false, reason: 'LLM_NOT_CONFIGURED' };
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // Adaptive thinking is the default on this model family; effort is the
      // cost/quality dial. Tutoring is explanation-shaped, not long-horizon
      // agentic work, so medium is the right default.
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: message }],
    });

    // A safety classifier can decline: HTTP 200 with stop_reason 'refusal'
    // and possibly empty content. Check before indexing content.
    if (response.stop_reason === 'refusal') {
      logger.warn(`LLM refused a tutor request (category: ${response.stop_details?.category ?? 'unknown'})`);
      return { text: null, generated: false, reason: 'REFUSED' };
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) return { text: null, generated: false, reason: 'EMPTY_RESPONSE' };

    return { text, generated: true, model: response.model, usage: response.usage };
  } catch (err) {
    // A provider outage must degrade the feature, not take the app down.
    logger.error(`LLM generation failed: ${err.message}`);
    return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
  }
}
