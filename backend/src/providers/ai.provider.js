import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
// gemini-1.5-flash is retired (404). Use gemini-2.0-flash which is stable on v1.
// If GEMINI_MODEL is set in .env it takes precedence — allows pinning without a code change.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
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
      const modelName = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
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
      const modelName = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
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

