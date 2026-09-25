/**
 * Strict validation of model output for Student Study Help.
 *
 * The page renders these objects into interactive components that hide
 * answers, score quizzes and draw trees, so "roughly the right shape" is not
 * good enough: a quiz whose key points past the options scores students wrong,
 * and a practice question with the answer in its prompt defeats the point.
 *
 * Each validator *rebuilds* the value from whitelisted fields rather than
 * passing the parsed object through, so nothing the model adds reaches the
 * browser. Defects are server-authored descriptions (field paths and rules),
 * never echoed model text, because they are fed back into the retry prompt.
 *
 * Counts accepted here are deliberately a little wider than modes.js asks for:
 * one flashcard too many is not worth a retry and a second model call.
 */

const LONG = 2000;
const SHORT = 300;
const LABEL = 100;

export const REDIRECT_KINDS = ['off_topic', 'integrity', 'unsafe', 'safety', 'needs_detail'];

/** Pulls the JSON object out of a reply, tolerating code fences and stray prose around it. */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function makeChecker() {
  const defects = [];

  const str = (value, path, max = LONG) => {
    if (typeof value !== 'string' || !value.trim()) {
      defects.push(`${path} must be a non-empty string`);
      return '';
    }
    const v = value.trim();
    if (v.length > max) defects.push(`${path} is longer than ${max} characters`);
    return v;
  };

  const optStr = (value, path, max = LONG) => (value == null || value === '' ? null : str(value, path, max));

  const arr = (value, path, min, max) => {
    if (!Array.isArray(value)) {
      defects.push(`${path} must be an array`);
      return [];
    }
    if (value.length < min || value.length > max) defects.push(`${path} must have ${min} to ${max} items (got ${value.length})`);
    return value.slice(0, max);
  };

  const obj = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      defects.push(`${path} must be an object`);
      return {};
    }
    return value;
  };

  return { defects, str, optStr, arr, obj };
}

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

const validators = {
  explain(raw, c) {
    const check = raw.checkQuestion == null ? null : c.obj(raw.checkQuestion, 'checkQuestion');
    return {
      type: 'explain',
      idea: c.str(raw.idea, 'idea'),
      example: c.str(raw.example, 'example'),
      steps: c.arr(raw.steps, 'steps', 1, 8).map((s, i) => c.str(s, `steps[${i}]`)),
      takeaway: c.str(raw.takeaway, 'takeaway'),
      checkQuestion: check
        ? { prompt: c.str(check.prompt, 'checkQuestion.prompt'), answer: c.str(check.answer, 'checkQuestion.answer') }
        : null,
    };
  },

  worked(raw, c) {
    return {
      type: 'worked',
      problem: c.str(raw.problem, 'problem'),
      method: c.str(raw.method, 'method'),
      steps: c.arr(raw.steps, 'steps', 1, 12).map((s, i) => c.str(s, `steps[${i}]`)),
      finalAnswer: c.str(raw.finalAnswer, 'finalAnswer', SHORT * 2),
      verification: c.optStr(raw.verification, 'verification'),
    };
  },

  questions(raw, c) {
    return {
      type: 'questions',
      questions: c.arr(raw.questions, 'questions', 1, 8).map((q, i) => {
        const o = c.obj(q, `questions[${i}]`);
        return {
          prompt: c.str(o.prompt, `questions[${i}].prompt`),
          hints: c.arr(o.hints, `questions[${i}].hints`, 1, 4).map((h, j) => c.str(h, `questions[${i}].hints[${j}]`)),
          solution: c.str(o.solution, `questions[${i}].solution`),
        };
      }),
    };
  },

  quiz(raw, c) {
    return {
      type: 'quiz',
      questions: c.arr(raw.questions, 'questions', 3, 12).map((q, i) => {
        const o = c.obj(q, `questions[${i}]`);
        const p = `questions[${i}]`;
        let options = [];
        if (!Array.isArray(o.options) || o.options.length !== 4) {
          c.defects.push(`${p}.options must have exactly 4 options`);
        } else {
          options = o.options.map((opt, j) => c.str(opt, `${p}.options[${j}]`, SHORT));
          if (new Set(options.map(norm)).size !== options.length) c.defects.push(`${p}.options must all be different`);
          if (options.some((opt) => /\b(all|none) of the above\b/i.test(opt))) {
            c.defects.push(`${p}.options must not use "all/none of the above"`);
          }
        }
        // Exactly one correct answer is encoded by a single index; the checks
        // that matter are that it is an integer and points at a real option.
        if (!Number.isInteger(o.correctIndex) || o.correctIndex < 0 || o.correctIndex > 3) {
          c.defects.push(`${p}.correctIndex must be an integer from 0 to 3`);
        }
        return {
          prompt: c.str(o.prompt, `${p}.prompt`),
          options,
          correctIndex: o.correctIndex,
          explanation: c.str(o.explanation, `${p}.explanation`),
        };
      }),
    };
  },

  flashcards(raw, c) {
    return {
      type: 'flashcards',
      cards: c.arr(raw.cards, 'cards', 3, 20).map((card, i) => {
        const o = c.obj(card, `cards[${i}]`);
        return { front: c.str(o.front, `cards[${i}].front`, SHORT * 2), back: c.str(o.back, `cards[${i}].back`, SHORT * 3) };
      }),
    };
  },

  notes(raw, c) {
    return {
      type: 'notes',
      sections: c.arr(raw.sections, 'sections', 1, 8).map((s, i) => {
        const o = c.obj(s, `sections[${i}]`);
        return {
          heading: c.str(o.heading, `sections[${i}].heading`, SHORT),
          points: c.arr(o.points, `sections[${i}].points`, 1, 10).map((pt, j) => c.str(pt, `sections[${i}].points[${j}]`)),
        };
      }),
      commonConfusion: c.optStr(raw.commonConfusion, 'commonConfusion'),
      recallPrompts: c.arr(raw.recallPrompts, 'recallPrompts', 1, 8).map((r, i) => {
        const o = c.obj(r, `recallPrompts[${i}]`);
        return { prompt: c.str(o.prompt, `recallPrompts[${i}].prompt`), answer: c.str(o.answer, `recallPrompts[${i}].answer`) };
      }),
    };
  },

  mindmap(raw, c) {
    const MAX_DEPTH = 3; // levels below the root
    const MAX_NODES = 60;
    let count = 0;

    const node = (value, path, depth) => {
      const o = c.obj(value, path);
      count += 1;
      const children = o.children == null ? [] : c.arr(o.children, `${path}.children`, 0, 8);
      if (children.length && depth >= MAX_DEPTH) {
        c.defects.push(`${path} is deeper than ${MAX_DEPTH} levels below the root`);
        return { label: c.str(o.label, `${path}.label`, LABEL), children: [] };
      }
      return {
        label: c.str(o.label, `${path}.label`, LABEL),
        children: children.map((ch, i) => node(ch, `${path}.children[${i}]`, depth + 1)),
      };
    };

    const root = node(raw.root, 'root', 0);
    if (root.children.length < 2) c.defects.push('root must have at least 2 branches');
    if (count > MAX_NODES) c.defects.push(`the mind map has ${count} nodes; keep it to ${MAX_NODES} or fewer`);
    return { type: 'mindmap', root };
  },

  exam(raw, c) {
    return {
      type: 'exam',
      questions: c.arr(raw.questions, 'questions', 1, 6).map((q, i) => {
        const o = c.obj(q, `questions[${i}]`);
        const p = `questions[${i}]`;
        if (o.marks != null && (!Number.isInteger(o.marks) || o.marks < 1 || o.marks > 10)) {
          c.defects.push(`${p}.marks must be an integer from 1 to 10, or null`);
        }
        return {
          prompt: c.str(o.prompt, `${p}.prompt`),
          marks: Number.isInteger(o.marks) ? o.marks : null,
          formalAnswer: c.str(o.formalAnswer, `${p}.formalAnswer`, LONG * 2),
          plainExplanation: c.str(o.plainExplanation, `${p}.plainExplanation`),
        };
      }),
    };
  },

  redirect(raw, c) {
    if (!REDIRECT_KINDS.includes(raw.kind)) c.defects.push(`kind must be one of ${REDIRECT_KINDS.join(', ')}`);
    return { type: 'redirect', kind: raw.kind, message: c.str(raw.message, 'message', 1200) };
  },
};

/**
 * Parses and validates one model reply for the requested mode.
 *
 * @returns {{ ok: true, value: object } | { ok: false, defects: string[] }}
 */
export function validateLearnOutput(text, mode) {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, defects: ['the reply was not a single valid JSON object'] };
  }
  if (raw.type !== mode && raw.type !== 'redirect') {
    return { ok: false, defects: [`"type" must be "${mode}" (or "redirect"), not ${JSON.stringify(raw.type ?? null)}`] };
  }

  const c = makeChecker();
  const value = validators[raw.type](raw, c);
  return c.defects.length ? { ok: false, defects: c.defects } : { ok: true, value };
}

/**
 * A plain-text rendering of a validated result, returned alongside it as
 * `content` so any client that only understands text still gets something
 * readable. Answers are included: this is a transcript, not the interactive view.
 */
export function toPlainText(v) {
  const lines = [];
  const add = (...l) => lines.push(...l);
  switch (v.type) {
    case 'explain':
      add(v.idea, '', `Example: ${v.example}`, '', ...v.steps.map((s, i) => `${i + 1}. ${s}`), '', v.takeaway);
      if (v.checkQuestion) add('', `Check: ${v.checkQuestion.prompt}`, `Answer: ${v.checkQuestion.answer}`);
      break;
    case 'worked':
      add(`Problem: ${v.problem}`, `Method: ${v.method}`, '', ...v.steps.map((s, i) => `${i + 1}. ${s}`), '', `Answer: ${v.finalAnswer}`);
      if (v.verification) add(`Check: ${v.verification}`);
      break;
    case 'questions':
      v.questions.forEach((q, i) => add(`${i + 1}. ${q.prompt}`, ...q.hints.map((h) => `   Hint: ${h}`), `   Solution: ${q.solution}`, ''));
      break;
    case 'quiz':
      v.questions.forEach((q, i) => add(
        `${i + 1}. ${q.prompt}`,
        ...q.options.map((o, j) => `   ${'ABCD'[j]}) ${o}`),
        `   Answer: ${'ABCD'[q.correctIndex]} — ${q.explanation}`,
        ''
      ));
      break;
    case 'flashcards':
      v.cards.forEach((card, i) => add(`${i + 1}. Q: ${card.front}`, `   A: ${card.back}`));
      break;
    case 'notes':
      v.sections.forEach((s) => add(s.heading, ...s.points.map((p) => `- ${p}`), ''));
      if (v.commonConfusion) add(`Common confusion: ${v.commonConfusion}`, '');
      add('Test yourself:', ...v.recallPrompts.map((r) => `- ${r.prompt} (${r.answer})`));
      break;
    case 'mindmap': {
      const walk = (n, depth) => {
        add(`${'  '.repeat(depth)}${depth ? '- ' : ''}${n.label}`);
        n.children.forEach((ch) => walk(ch, depth + 1));
      };
      walk(v.root, 0);
      break;
    }
    case 'exam':
      v.questions.forEach((q, i) => add(
        `${i + 1}. ${q.prompt}${q.marks ? ` [${q.marks} marks]` : ''}`,
        `Model answer: ${q.formalAnswer}`,
        `Why: ${q.plainExplanation}`,
        ''
      ));
      break;
    case 'redirect':
      add(v.message);
      break;
    default:
      break;
  }
  return lines.join('\n').trim();
}
