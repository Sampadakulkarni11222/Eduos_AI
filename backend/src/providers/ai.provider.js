import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

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

let anthropicClient = null;
let geminiClient = null;

export function isLlmEnabled() {
  if (env.AI_PROVIDER === 'gemini') {
    return Boolean(process.env.GEMINI_API_KEY);
  }
  return env.AI_PROVIDER === 'anthropic' && Boolean(process.env.ANTHROPIC_API_KEY);
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
 * Generates text from a system prompt + user message.
 *
 * Returns `{ text, generated }`. `generated: false` means no LLM ran — the
 * caller must present its own deterministic content rather than passing off
 * a placeholder as a model answer.
 */
export async function generate({ system, message, maxTokens = MAX_TOKENS }) {
  if (!isLlmEnabled()) {
    return { text: null, generated: false, reason: 'LLM_NOT_CONFIGURED' };
  }

  if (env.AI_PROVIDER === 'gemini') {
    try {
      const client = getGeminiClient();
      const modelName = GEMINI_MODEL;
      const genModel = client.getGenerativeModel({
        model: modelName,
        systemInstruction: system,
      });

      const response = await genModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      });

      const text = response.response.text();
      if (!text) return { text: null, generated: false, reason: 'EMPTY_RESPONSE' };

      return {
        text,
        generated: true,
        model: modelName,
        usage: {
          input_tokens: response.response.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: response.response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      logger.error(`Gemini generation failed: ${err.message}`);
      return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
    }
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: message }],
    });

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
    logger.error(`LLM generation failed: ${err.message}`);
    return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
  }
}

/**
 * Reads an image alongside a prompt (used for the attendance-register OCR).
 *
 * Vision is the OCR engine here rather than a separate library.
 */
export async function generateFromImage({ system, message, imageBase64, mediaType, maxTokens = 4096 }) {
  if (!isLlmEnabled()) {
    return { text: null, generated: false, reason: 'LLM_NOT_CONFIGURED' };
  }

  if (env.AI_PROVIDER === 'gemini') {
    try {
      const client = getGeminiClient();
      const modelName = GEMINI_MODEL;
      const genModel = client.getGenerativeModel({
        model: modelName,
        systemInstruction: system,
      });

      const response = await genModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: imageBase64,
                  mimeType: mediaType,
                },
              },
              { text: message },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      });

      const text = response.response.text();
      if (!text) return { text: null, generated: false, reason: 'EMPTY_RESPONSE' };

      return {
        text,
        generated: true,
        model: modelName,
        usage: {
          input_tokens: response.response.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: response.response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      logger.error(`Gemini image generation failed: ${err.message}`);
      return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
    }
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
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

