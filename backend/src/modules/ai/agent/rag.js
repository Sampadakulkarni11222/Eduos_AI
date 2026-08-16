import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../../config/env.js';
import * as announcements from '../../announcements/announcement.service.js';
import { chunkText } from '../../../utils/chunker.js';

export async function handleRagFallback(message, actor, lang) {
  // 1. Fetch unstructured data
  const anns = await announcements.list();
  
  // 2. Chunk it
  let allChunks = [];
  for (const a of anns) {
     const text = `Announcement: ${a.title}\n${a.content}`;
     const chunks = chunkText(text, 200, 20);
     allChunks.push(...chunks);
  }
  
  // Simple TF-IDF / Keyword search
  const queryWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const scoredChunks = allChunks.map(chunk => {
      let score = 0;
      const lowerChunk = chunk.toLowerCase();
      for (const w of queryWords) {
          if (lowerChunk.includes(w)) score++;
      }
      return { chunk, score };
  });
  
  scoredChunks.sort((a, b) => b.score - a.score);
  // Keep chunks that have a score > 0. If no query words (like "hi"), keep nothing.
  const bestChunks = scoredChunks.slice(0, 3).filter(c => c.score > 0).map(c => c.chunk);
  
  // Use Gemini LLM to answer the question
  try {
      if (!env.GEMINI_API_KEY) {
         return null; // Let the orchestrator return agent.unsure if no LLM is configured
      }
      const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `You are a helpful school assistant. Answer the user's message.
      If the user is just saying hello, greet them back and ask how you can help.
      Otherwise, use the provided context from the school's unstructured data to answer. Keep it concise.
      
      Context:
      ${bestChunks.length > 0 ? bestChunks.join('\n---\n') : 'No relevant school data found for this query.'}
      
      User Message: ${message}
      `;
      const result = await model.generateContent(prompt);
      return result.response.text();
  } catch (err) {
      console.error('RAG Fallback error:', err);
      return null;
  }
}
