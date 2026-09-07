import * as announcements from '../../announcements/announcement.service.js';
import { chunkText } from '../../../utils/chunker.js';
import { generate } from '../../../providers/ai.provider.js';
import { logger } from '../../../utils/logger.js';

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
export async function handleRagFallback(message, actor, lang) {
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
  const queryWords = message.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = allChunks.map((chunk) => {
    const lower = chunk.toLowerCase();
    return { chunk, score: queryWords.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  // Only chunks that actually matched something. A greeting ("hi") has no
  // query words, so it retrieves nothing rather than the three newest notices.
  const best = scored.slice(0, 3).filter((c) => c.score > 0).map((c) => c.chunk);

  const system = [
    'You are a helpful school assistant. Answer the user\'s message.',
    'If the user is just saying hello, greet them back and ask how you can help.',
    'Otherwise answer from the context below, and keep it concise.',
    'The context is the school\'s own material. If it does not contain the answer,',
    'say you do not know rather than inventing one.',
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
    return result.generated ? result.text : null;
  } catch (err) {
    logger.warn(`RAG fallback failed: ${err.message}`);
    return null;
  }
}
