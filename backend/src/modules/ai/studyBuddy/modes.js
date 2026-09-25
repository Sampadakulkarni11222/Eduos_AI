/**
 * The Student Study Help learning modes.
 *
 * Each one is a response shape the Student Learning Buddy package actually
 * defines (SKILL.md §5 "Answer structure" and §7 "Choose the right learning
 * mode"), turned into a JSON contract the page can render interactively. Modes
 * the package does not support are deliberately absent: "important questions"
 * would be exam prediction, which the package forbids, and a study plan needs
 * time and topic-list inputs this form does not collect.
 *
 * Keys `explain`, `questions`, `flashcards`, `notes` and `mindmap` match the
 * parent-facing /ai/tutor modes on purpose, so the same word means the same
 * thing in both places. `fallbackMode` is the /ai/tutor mode whose study-plan
 * scaffold is closest, used when no valid model answer can be shown.
 *
 * `contract` is the host output instruction appended after the skill prompt.
 * The counts it asks for are narrower than what validate.js accepts, so a model
 * that gives one card too many is not rejected over it.
 */
export const LEARN_MODES = {
  explain: {
    label: 'Explanation',
    description: 'The core idea, a familiar example and why it works — with a quick check.',
    fallbackMode: 'explain',
    contract: `Requested format: Explanation (the package's "Explain/why/how" shape).
Reply with exactly this JSON shape:
{"type":"explain","idea":"the core idea in one or two sentences","example":"one concrete, familiar example, explicitly mapped to the concept","steps":["why or how it works — one short step per item, 2 to 6 items"],"takeaway":"a one-sentence summary","checkQuestion":{"prompt":"one small prediction or application question","answer":"its answer with a one-line reason"}}
Set "checkQuestion" to null if a question would not help with this topic.`,
  },

  worked: {
    label: 'Step-by-step',
    description: 'One problem worked through step by step, with the reason for each step.',
    fallbackMode: 'explain',
    contract: `Requested format: Step-by-step worked example (the package's "Numerical/worked problem" shape).
Reply with exactly this JSON shape:
{"type":"worked","problem":"one representative problem on the topic at this class level, with every value needed to solve it","method":"which method to use and why","steps":["one step per item, each with its reason — 2 to 10 items"],"finalAnswer":"the final result, with units where relevant","verification":"a quick check that the result is right"}
For a non-numerical topic, make the problem a typical question and the steps the reasoning that answers it. Check every calculation before replying.`,
  },

  questions: {
    label: 'Practice',
    description: 'Practice questions one at a time, with hints before the full solution.',
    fallbackMode: 'questions',
    contract: `Requested format: Practice (the package's "Practise" mode — the page shows ONE question at a time and reveals hints, then the solution, only when the student asks).
Reply with exactly this JSON shape:
{"type":"questions","questions":[{"prompt":"the question","hints":["a targeted hint","a partial step"],"solution":"the full worked solution"}]}
Give 3 to 5 questions in increasing difficulty, each with 1 to 3 hints. Every question must be solvable from the information given. Never put the answer inside "prompt" or a hint.`,
  },

  quiz: {
    label: 'Quiz',
    description: 'Multiple-choice questions, scored as you go, with explanations.',
    fallbackMode: 'questions',
    contract: `Requested format: Quiz (single-answer multiple choice, following the package's answer-key rules).
Reply with exactly this JSON shape:
{"type":"quiz","questions":[{"prompt":"the question","options":["option","option","option","option"],"correctIndex":0,"explanation":"why the correct option is right and why the most tempting wrong option is wrong"}]}
Give 5 to 8 questions. Each has exactly four distinct options and exactly ONE correct option; "correctIndex" is its 0-based position. Vary the correct position. No "all of the above" or "none of the above". Verify each key before replying.`,
  },

  flashcards: {
    label: 'Flashcards',
    description: 'Cards to test recall — think of the answer, then flip.',
    fallbackMode: 'flashcards',
    contract: `Requested format: Flashcards (retrieval practice from the package's "Revise" mode).
Reply with exactly this JSON shape:
{"type":"flashcards","cards":[{"front":"a question, term or cue","back":"the answer in at most two sentences"}]}
Give 6 to 12 cards covering the key facts, definitions and formulas a student must recall for this topic.`,
  },

  notes: {
    label: 'Revision notes',
    description: 'Condensed notes, the common confusion, and prompts to test yourself.',
    fallbackMode: 'notes',
    contract: `Requested format: Revision notes (the package's "Revision" shape: key ideas, then the common confusion, then retrieval prompts).
Reply with exactly this JSON shape:
{"type":"notes","sections":[{"heading":"a short heading","points":["a key point"]}],"commonConfusion":"one common mistake on this topic and how to fix it","recallPrompts":[{"prompt":"a retrieval question","answer":"its short answer"}]}
Give 2 to 6 sections of 2 to 6 points each, and 2 to 5 recall prompts. Put each formula in its own point. Set "commonConfusion" to null only if there genuinely is none.`,
  },

  mindmap: {
    label: 'Mind map',
    description: 'The topic as a tree of branches you can expand and collapse.',
    fallbackMode: 'mindmap',
    contract: `Requested format: Mind map (a structured outline the page draws as a collapsible tree; the tree is also its own text alternative).
Reply with exactly this JSON shape:
{"type":"mindmap","root":{"label":"the topic","children":[{"label":"a main branch","children":[{"label":"a sub-branch or key fact","children":[]}]}]}}
Give the root 3 to 6 branches, each with at most 5 children, and at most 3 levels below the root. Keep every label to a few words.`,
  },

  exam: {
    label: 'Exam answer',
    description: 'Exam-style questions with a formal model answer and a plain explanation.',
    fallbackMode: 'questions',
    contract: `Requested format: Exam answer (the package's "Exam wording" mode: a formal answer in exam register, kept separate from the friendly explanation).
Reply with exactly this JSON shape:
{"type":"exam","questions":[{"prompt":"an exam-style question","marks":3,"formalAnswer":"a concise formal answer of the length that many marks would need","plainExplanation":"a friendly explanation of why that answer is right"}]}
Give 2 to 4 questions. "marks" is an integer from 1 to 10, or null. No slang in "formalAnswer". These are generated practice questions: never describe them as previous-year, important or likely questions, and never promise marks.`,
  },
};

export const LEARN_MODE_KEYS = Object.keys(LEARN_MODES);

/** What /ai/tutor/learn/status advertises — labels and descriptions, never the contracts. */
export const LEARN_MODE_LIST = Object.entries(LEARN_MODES).map(([key, m]) => ({
  key,
  label: m.label,
  description: m.description,
}));
