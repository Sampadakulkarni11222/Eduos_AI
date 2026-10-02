import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';

/**
 * Request validation for the quiz module.
 *
 * Every rule here is enforced on the server because every endpoint is
 * reachable without the UI; the form checks are a courtesy that mirrors them.
 */

export const LIMITS = {
  titleMax: 200,
  descriptionMax: 5000,
  questionMax: 2000,
  optionMax: 500,
  minOptions: 2,
  maxOptions: 6,
  maxMarksPerQuestion: 100,
  maxDurationMinutes: 600,
  maxQuestions: 200,
};

const bad = (message, code) => new AppError(message, 400, [], code);

export function assertObjectId(value, label = 'id') {
  if (!value || !mongoose.isValidObjectId(String(value))) {
    throw bad(`A valid ${label} is required`, 'INVALID_ID');
  }
  return String(value);
}

export function cleanTitle(raw) {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title) throw bad('Quiz title is required', 'QUIZ_TITLE_REQUIRED');
  if (title.length > LIMITS.titleMax) throw bad(`Quiz title must be at most ${LIMITS.titleMax} characters`, 'QUIZ_TITLE_TOO_LONG');
  return title;
}

export function cleanDescription(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw bad('Description must be text', 'QUIZ_DESCRIPTION_INVALID');
  const description = raw.trim();
  if (description.length > LIMITS.descriptionMax) {
    throw bad(`Description must be at most ${LIMITS.descriptionMax} characters`, 'QUIZ_DESCRIPTION_TOO_LONG');
  }
  return description;
}

/** null/'' clears the time limit; otherwise a whole number of minutes. */
export function cleanDuration(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxDurationMinutes) {
    throw bad(`Duration must be a whole number of minutes between 1 and ${LIMITS.maxDurationMinutes}`, 'QUIZ_DURATION_INVALID');
  }
  return n;
}

function cleanMarks(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = Number(raw);
  // Half marks are allowed; anything finer is a typo rather than a scheme.
  if (!Number.isFinite(n) || n <= 0 || n > LIMITS.maxMarksPerQuestion || Math.round(n * 2) !== n * 2) {
    throw bad(`Marks must be a positive number (in steps of 0.5) no greater than ${LIMITS.maxMarksPerQuestion}`, 'QUESTION_MARKS_INVALID');
  }
  return n;
}

/**
 * Validates one MCQ and returns it in storage shape.
 *
 * Accepts options as `[{ text, isCorrect }]`, optionally with a separate
 * `correctOptionIndex` — whichever the caller finds easier — and insists on
 * exactly one correct answer either way.
 */
export function cleanQuestion(body = {}) {
  const text = typeof body.text === 'string' ? body.text.trim()
    : typeof body.questionText === 'string' ? body.questionText.trim() : '';
  if (!text) throw bad('Question text is required', 'QUESTION_TEXT_REQUIRED');
  if (text.length > LIMITS.questionMax) throw bad(`Question text must be at most ${LIMITS.questionMax} characters`, 'QUESTION_TEXT_TOO_LONG');

  const rawOptions = Array.isArray(body.options) ? body.options : null;
  if (!rawOptions || rawOptions.length < LIMITS.minOptions) {
    throw bad(`A question needs at least ${LIMITS.minOptions} options`, 'QUESTION_OPTIONS_TOO_FEW');
  }
  if (rawOptions.length > LIMITS.maxOptions) {
    throw bad(`A question can have at most ${LIMITS.maxOptions} options`, 'QUESTION_OPTIONS_TOO_MANY');
  }

  const options = rawOptions.map((o, i) => {
    const optText = typeof o === 'string' ? o.trim() : typeof o?.text === 'string' ? o.text.trim() : '';
    if (!optText) throw bad(`Option ${String.fromCharCode(65 + i)} cannot be empty`, 'QUESTION_OPTION_EMPTY');
    if (optText.length > LIMITS.optionMax) throw bad(`Options must be at most ${LIMITS.optionMax} characters`, 'QUESTION_OPTION_TOO_LONG');
    return { text: optText, order: i, isCorrect: typeof o === 'object' && o?.isCorrect === true };
  });

  const seen = new Set();
  for (const o of options) {
    const key = o.text.toLowerCase();
    if (seen.has(key)) throw bad('Two options have the same text', 'QUESTION_OPTION_DUPLICATE');
    seen.add(key);
  }

  if (body.correctOptionIndex !== undefined && body.correctOptionIndex !== null) {
    const idx = Number(body.correctOptionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      throw bad('The correct answer must be one of the options', 'QUESTION_CORRECT_INVALID');
    }
    options.forEach((o, i) => { o.isCorrect = i === idx; });
  }

  const correct = options.filter((o) => o.isCorrect).length;
  if (correct !== 1) throw bad('Select exactly one correct answer', 'QUESTION_CORRECT_REQUIRED');

  return { text, marks: cleanMarks(body.marks), options };
}

/**
 * Re-checks a stored question. Questions are validated on the way in, but a
 * publish must not rest on that alone — this is the gate that keeps an
 * incomplete question from ever reaching a student.
 */
export function isCompleteQuestion(q) {
  if (!q?.text?.trim()) return false;
  if (!(Number(q.marks) > 0)) return false;
  const options = q.options ?? [];
  if (options.length < LIMITS.minOptions) return false;
  if (options.some((o) => !o?.text?.trim())) return false;
  return options.filter((o) => o.isCorrect).length === 1;
}

/**
 * The student's answer sheet: `[{ questionId, optionId }]`, or an object
 * keyed by questionId. Anything else in the request body — a score, marks,
 * isCorrect flags — is ignored, because none of it is the student's to state.
 */
export function cleanAnswerSheet(raw) {
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.map((a) => [a?.questionId, a?.optionId ?? a?.selectedOptionId ?? null]);
  } else if (raw && typeof raw === 'object') {
    entries = Object.entries(raw);
  } else if (raw === undefined || raw === null) {
    entries = [];
  } else {
    throw bad('Answers must be a list of { questionId, optionId }', 'QUIZ_ANSWERS_INVALID');
  }

  const sheet = new Map();
  for (const [questionId, optionId] of entries) {
    if (!questionId || !mongoose.isValidObjectId(String(questionId))) {
      throw bad('Each answer must name a valid question', 'QUIZ_ANSWERS_INVALID');
    }
    if (optionId !== null && optionId !== undefined && optionId !== '' && !mongoose.isValidObjectId(String(optionId))) {
      throw bad('Each answer must name a valid option', 'QUIZ_ANSWERS_INVALID');
    }
    const key = String(questionId);
    if (sheet.has(key)) throw bad('A question was answered more than once', 'QUIZ_ANSWERS_DUPLICATE');
    sheet.set(key, optionId ? String(optionId) : null);
  }
  return sheet;
}
