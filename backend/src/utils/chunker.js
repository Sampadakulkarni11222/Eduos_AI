/**
 * Basic Recursive Character Text Splitter for chunking large text documents.
 * Splitting on double newline, single newline, then space.
 */
export function chunkText(text, maxChunkSize = 500, overlap = 50) {
  if (!text) return [];

  const chunks = [];
  const separators = ['\n\n', '\n', ' ', ''];

  function split(textToSplit, currentSize) {
    if (textToSplit.length <= currentSize) {
      if (textToSplit.trim().length > 0) {
        chunks.push(textToSplit.trim());
      }
      return;
    }

    let splitIndex = -1;
    for (const sep of separators) {
      if (sep === '') {
        splitIndex = currentSize;
        break;
      }
      const idx = textToSplit.lastIndexOf(sep, currentSize);
      if (idx !== -1) {
        splitIndex = idx;
        break;
      }
    }

    if (splitIndex === -1) {
      splitIndex = currentSize; // Force split
    }

    const chunk = textToSplit.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Advance by splitIndex - overlap, ensuring we make progress
    const step = Math.max(1, splitIndex - overlap);
    split(textToSplit.slice(step), currentSize);
  }

  split(text, maxChunkSize);
  return chunks;
}
