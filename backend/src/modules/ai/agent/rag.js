import * as announcements from '../../announcements/announcement.service.js';
import { chunkText } from '../../../utils/chunker.js';
import { generate } from '../../../providers/ai.provider.js';
import { logger } from '../../../utils/logger.js';
import { ungroundedFacts } from './grounding.js';

const STOP_WORDS = new Set(['the', 'and', 'for', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'does',
  'did', 'are', 'was', 'were', 'will', 'can', 'could', 'would', 'should', 'there', 'their', 'this', 'that', 'these', 'those',
  'with', 'from', 'about', 'into', 'have', 'has', 'had', 'any', 'all', 'you', 'your', 'our', 'tell', 'show', 'give', 'please',
  'time', 'day', 'date', 'start', 'starts', 'end', 'ends', 'school', 'today', 'tomorrow', 'get', 'know', 'want', 'need']);

const GREETING = /^\s*(?:hi+|hello|hey|hii+|good\s+(?:morning|afternoon|evening)|namaste|namaskar|thanks?|thank\s+you)\b[\s!.,]*(?:there|eduos)?[\s!.]*$/i;

/**
 * The retrieval fallback: answer from the school's own written material when
 * no tool matches the question.
 *
 * Retrieval is keyword scoring over announcement text rather than embeddings —
 * a school's notice board is small, and an exact-word match over a few hundred
 * chunks is both adequate and free.
 *
 * The model call goes through the shared provider rather than a client built
 * here. This file used to construct its own Gemini client pinned to
 * `gemini-1.5-flash`, a model that has been retired: every call 404'd, so the
 * fallback silently never answered, whatever the school had configured. Going
 * through the provider means one model id, one timeout, and one place to
 * change when the id moves again.
 */
export async function handleRagFallback(message, actor, _lang) {
  // 1. Fetch unstructured data — as the caller, not as nobody. Called with no
  // actor, the announcement list applies the audience filter for a reader with
  // no role and no classes, so the retrieval context was missing every notice
  // addressed to the very person asking about it.
  const anns = await announcements.list(actor);

  // 2. Chunk it
  const allChunks = [];
  for (const a of anns) {
    const text = `Announcement: ${a.title}\n${a.content}`;
    allChunks.push(...chunkText(text, 200, 20));
  }

  // 3. Score by keyword overlap.
  // Words that say nothing about the subject ("what time does the ...") match
  // every notice, so a question about something no notice mentions used to
  // retrieve the newest notices anyway and the model answered from those.
  const queryWords = message.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const scored = allChunks.map((chunk) => {
    const lower = chunk.toLowerCase();
    return { chunk, score: queryWords.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  // Only chunks that actually matched something. A greeting ("hi") has no
  // query words, so it retrieves nothing rather than the three newest notices.
  const best = scored.slice(0, 3).filter((c) => c.score > 0).map((c) => c.chunk);

  // Nothing in the school's material matched: there is nothing to answer
  // FROM, and a model asked anyway answers from what it imagines (a parent
  // asking when the annual day starts was told a time no notice gives). Only a
  // greeting is answered without material.
  const greeting = GREETING.test(String(message ?? ''));
  if (!best.length && !greeting) return null;

  const system = [
    'You are a helpful school assistant. Answer the user\'s message.',
    'If the user is just saying hello, greet them back and ask how you can help.',
    'Otherwise answer from the context below, and keep it concise.',
    'The context is the school\'s own material. If it does not contain the answer,',
    'say you do not know rather than inventing one.',
    'Never say you have done, booked, sent or changed anything: you cannot act.',
    'Never offer to do something; only report what the context says.',
    '',
    'Context:',
    best.length > 0 ? best.join('\n---\n') : 'No relevant school data found for this query.',
  ].join('\n');

  // Null, not a thrown error: the orchestrator's next step is a deterministic
  // answer listing what the assistant can do, which is a better outcome than a
  // failed request.
  try {
    // Same reasoning as the routing budget: the allowance has to cover the
    // model's own thinking, or the answer comes back truncated mid-thought.
    const result = await generate({ system, message, maxTokens: 4096 });
    if (!result.generated || !result.text?.trim()) return null;
    // The answer may say only what the notices say: a time, a date or an
    // amount that is not in them, a name nobody wrote, or a claim to have
    // done something (this tier performs nothing) and it is not given.
    const problems = ungroundedFacts(result.text, { texts: [...best, message], strictNumbers: true });
    if (problems.length) {
      logger.warn(`Knowledge answer rejected (not in the school's material: ${problems.slice(0, 3).join(', ')})`);
      return null;
    }
    return result.text;
  } catch (err) {
    logger.warn(`RAG fallback failed: ${err.message}`);
    return null;
  }
}
