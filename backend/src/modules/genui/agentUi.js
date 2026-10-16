import { logger } from '../../utils/logger.js';
import { programForAnswer } from './fromResults.js';
import { generatedUi } from './compose.js';

/**
 * Adds a generated panel (`ui`) to a website assistant answer that carries
 * data. The text reply is untouched and stays the fallback; WhatsApp never
 * passes through here, so it keeps plain text. A failure here never fails the
 * answer: it just goes out without a panel.
 */
export async function withGeneratedUi(out, { message } = {}) {
  try {
    const fallback = programForAnswer(out);
    if (!fallback) return out;
    const ui = await generatedUi({ message, data: out.data, fallback, lang: out.lang ?? 'en' });
    return ui ? { ...out, ui } : out;
  } catch (err) {
    logger.warn(`Generated UI skipped: ${err.message}`);
    return out;
  }
}
