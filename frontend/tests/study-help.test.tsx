import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LearningBuddyPanel, EMPTY_STATE_GROUNDING } from '@/components/study-help/learning-buddy-panel';
import { TutorPanel } from '@/components/tutor-panel';
import { ResultView } from '@/components/study-help/results/result-view';
import { toOutline } from '@/components/study-help/results/mindmap-view';
import { api, ApiError } from '@/lib/api';
import type { LearnReplyDto, LearnResult, LearnStatusDto, TutorSyllabusDto } from '@/lib/types';

/**
 * Student Study Help (Student Learning Buddy) — the panel, every result view,
 * and the guarantees carried over from TutorPanel: model text is rendered as
 * text, a study plan is labelled as one, and the parent page is untouched.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ school: 'oakridge' }),
  usePathname: () => '/oakridge/student/study-help',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const MODES: LearnStatusDto['modes'] = [
  { key: 'explain', label: 'Explanation', description: 'The core idea, a familiar example and why it works.' },
  { key: 'worked', label: 'Step-by-step', description: 'One problem worked through step by step.' },
  { key: 'questions', label: 'Practice', description: 'Practice questions one at a time.' },
  { key: 'quiz', label: 'Quiz', description: 'Multiple-choice questions.' },
  { key: 'flashcards', label: 'Flashcards', description: 'Cards to test recall.' },
  { key: 'notes', label: 'Revision notes', description: 'Condensed notes.' },
  { key: 'mindmap', label: 'Mind map', description: 'A collapsible tree.' },
  { key: 'exam', label: 'Exam answer', description: 'Exam-style questions.' },
];
const STATUS: LearnStatusDto = { llmEnabled: true, modes: MODES, skill: { name: 'Student Learning Buddy', version: '3.0' } };
const SYLLABUS: TutorSyllabusDto = {
  enrollmentId: 'e1', className: 'Class 6 A', gradeName: 'Class 6',
  subjects: [{ id: 's1', name: 'Mathematics', code: 'MAT' }, { id: 's2', name: 'Science', code: 'SCI' }],
};

const reply = (structured: LearnResult | null, over: Partial<LearnReplyDto> = {}): LearnReplyDto => ({
  mode: (structured && structured.type !== 'redirect' ? structured.type : 'explain') as LearnReplyDto['mode'],
  modeLabel: 'Explanation',
  subject: 'Mathematics', topic: 'fractions', className: 'Class 6 A',
  language: 'en', languageName: 'English',
  skill: { name: 'Student Learning Buddy', version: '3.0' },
  generated: structured !== null,
  structured,
  content: 'plain text',
  attempts: 1,
  groundedOn: {
    subjects: ['Mathematics', 'Science'],
    performance: null,
    syllabus: { available: true, chapters: ['Chapter 7: Fractions'], materialTitles: ['Fractions notes'], materialCount: 1 },
  },
  credits: structured && structured.type !== 'redirect' ? { charged: 1, source: 'FREE', remaining: 41 } : undefined,
  ...over,
});

function mockApis({ status = STATUS as LearnStatusDto | Error, learn }: { status?: LearnStatusDto | Error; learn?: LearnReplyDto | Error } = {}) {
  if (status instanceof Error) vi.spyOn(api, 'learnStatus').mockRejectedValue(status);
  else vi.spyOn(api, 'learnStatus').mockResolvedValue(status);
  vi.spyOn(api, 'tutorSyllabus').mockResolvedValue(SYLLABUS);
  vi.spyOn(api, 'aiCredits').mockResolvedValue({ metered: true, totalRemaining: 42 } as never);
  const learnSpy = vi.spyOn(api, 'learn');
  if (learn instanceof Error) learnSpy.mockRejectedValue(learn);
  else if (learn) learnSpy.mockResolvedValue(learn);
  return learnSpy;
}

beforeEach(() => vi.restoreAllMocks());

/* ── The form ─────────────────────────────────────────────── */
describe('LearningBuddyPanel — form', () => {
  it('lists only the student\'s subjects and the eight approved modes', async () => {
    mockApis();
    render(<LearningBuddyPanel />);
    const subject = await screen.findByLabelText(/Subject/);
    expect(within(subject).getAllByRole('option').map((o) => o.textContent)).toEqual(['Mathematics', 'Science']);
    const group = screen.getByRole('group', { name: 'Learning mode' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent?.replace(/^\W+/u, '').trim())).toEqual(
      ['Explanation', 'Step-by-step', 'Practice', 'Quiz', 'Flashcards', 'Revision notes', 'Mind map', 'Exam answer']
    );
    expect(screen.getByRole('button', { name: /Explanation/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the approved empty-state grounding wording', async () => {
    mockApis();
    render(<LearningBuddyPanel />);
    await screen.findByText('Pick a topic to get started');
    expect(EMPTY_STATE_GROUNDING).toBe('Grounded in your class, subjects and course material on record.');
    expect(screen.getByText(/Grounded in your class, subjects and course material on record\./)).toBeInTheDocument();
  });

  it('keeps Get help disabled until there is a topic, and blocks an over-long one', async () => {
    const learn = mockApis();
    render(<LearningBuddyPanel />);
    const button = await screen.findByRole('button', { name: 'Get help' });
    expect(button).toBeDisabled();

    const input = screen.getByPlaceholderText('What do you want help with?');
    fireEvent.change(input, { target: { value: 'x'.repeat(201) } });
    expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/under 200 characters/);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(learn).not.toHaveBeenCalled();
  });

  it('sends the chosen subject, topic and mode to /ai/tutor/learn — never the old tutor endpoint', async () => {
    const learn = mockApis({ learn: reply({ type: 'flashcards', cards: [{ front: 'Numerator', back: 'Top number' }] }) });
    const tutor = vi.spyOn(api, 'tutor');
    render(<LearningBuddyPanel />);
    fireEvent.change(await screen.findByLabelText(/Subject/), { target: { value: 'Science' } });
    fireEvent.change(screen.getByPlaceholderText('What do you want help with?'), { target: { value: '  evaporation  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Flashcards/ }));
    expect(screen.getByRole('button', { name: /Flashcards/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));

    await screen.findByText('Numerator');
    expect(learn).toHaveBeenCalledWith({ topic: 'evaporation', subject: 'Science', mode: 'flashcards' });
    expect(tutor).not.toHaveBeenCalled();
    expect(screen.getByText('AI answer')).toBeInTheDocument();
    expect(screen.getByText(/1 credit used · 41 left/)).toBeInTheDocument();
  });

  it('shows the grounding honestly when nothing is on record', async () => {
    mockApis({
      learn: reply(
        { type: 'flashcards', cards: [{ front: 'A', back: 'B' }] },
        { groundedOn: { subjects: ['Mathematics'], performance: null, syllabus: { available: false, chapters: [], materialTitles: [], materialCount: 0 } } }
      ),
    });
    render(<LearningBuddyPanel />);
    fireEvent.change(await screen.findByPlaceholderText('What do you want help with?'), { target: { value: 'fractions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
    expect(await screen.findByText(/No chapters or course material on record for Mathematics yet/)).toBeInTheDocument();
  });

  it('states that grounding is titles, not file contents, when material is on record', async () => {
    mockApis({ learn: reply({ type: 'flashcards', cards: [{ front: 'A', back: 'B' }] }) });
    render(<LearningBuddyPanel />);
    fireEvent.change(await screen.findByPlaceholderText('What do you want help with?'), { target: { value: 'fractions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
    expect(await screen.findByText(/Chapter 7: Fractions .*titles on record, not the files' contents/)).toBeInTheDocument();
  });
});

/* ── Errors ───────────────────────────────────────────────── */
describe('LearningBuddyPanel — error states', () => {
  const submit = async () => {
    fireEvent.change(await screen.findByPlaceholderText('What do you want help with?'), { target: { value: 'fractions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
  };

  it('shows the server\'s message for a rejected request (e.g. unsupported mode)', async () => {
    mockApis({ learn: new ApiError(400, 'UNSUPPORTED_MODE', 'Unknown learning mode "x".') });
    render(<LearningBuddyPanel />);
    await submit();
    expect(await screen.findByText('That did not work')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown learning mode "x".');
  });

  it('offers a top-up on the credits paywall', async () => {
    mockApis({ learn: new ApiError(402, 'AI_CREDITS_EXHAUSTED', 'You have used all 50 free AI answers.') });
    render(<LearningBuddyPanel />);
    await submit();
    expect(await screen.findByText('Credits needed to continue')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/oakridge/student/ai-credits');
    expect(screen.getByText('0 credits')).toBeInTheDocument();
  });

  it('labels an LLM failure / invalid output fallback as a study plan, never an AI answer', async () => {
    mockApis({
      learn: reply(null, {
        generated: false, structured: null, content: null, reason: 'INVALID_OUTPUT',
        reasonMessage: 'The AI answer failed our quality checks twice, so it was not shown.',
        scaffold: 'Topic: fractions\n1. Write the topic in one sentence.', credits: undefined,
      }),
    });
    render(<LearningBuddyPanel />);
    await submit();
    expect(await screen.findByText('study plan')).toBeInTheDocument();
    expect(screen.queryByText('AI answer')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/quality checks twice.*not an AI-written answer/);
    expect(screen.getByText(/Write the topic in one sentence/)).toBeInTheDocument();
    expect(screen.queryByText(/credit used/)).not.toBeInTheDocument();
  });

  it('explains a 403 instead of showing a form that would refuse', async () => {
    mockApis({ status: new ApiError(403, 'STUDENT_ONLY', 'Student Study Help is only available to students.') });
    render(<LearningBuddyPanel />);
    expect(await screen.findByText('Study help is not available yet')).toBeInTheDocument();
    expect(screen.getByText('Student Study Help is only available to students.')).toBeInTheDocument();
  });

  it('still renders the eight modes if the status call fails for another reason', async () => {
    mockApis({ status: new Error('network') });
    render(<LearningBuddyPanel />);
    const group = await screen.findByRole('group', { name: 'Learning mode' });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
  });
});

/* ── Result views ─────────────────────────────────────────── */
const show = (structured: LearnResult) => render(<ResultView reply={reply(structured)} />);

describe('Explanation — comprehension check', () => {
  it('hides the check answer until the student asks, and echoes their attempt', () => {
    show({
      type: 'explain', idea: 'A fraction is part of a whole.', example: 'A quarter of a roti.',
      steps: ['Bottom counts parts', 'Top counts taken'], takeaway: 'Parts of a whole.',
      checkQuestion: { prompt: 'What is 3 of 4 parts?', answer: '3/4' },
    });
    expect(screen.getByText('A quarter of a roti.')).toBeInTheDocument();
    expect(screen.queryByText('3/4')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'three quarters' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText(/Compare it with what you wrote/)).toHaveTextContent('three quarters');
  });

  it('omits the check when the model gave none', () => {
    show({ type: 'explain', idea: 'i', example: 'e', steps: ['s'], takeaway: 't', checkQuestion: null });
    expect(screen.queryByText('Check your understanding')).not.toBeInTheDocument();
  });
});

describe('Step-by-step — progressive reveal', () => {
  it('reveals one step at a time and the answer only at the end', () => {
    show({ type: 'worked', problem: 'Add 1/2 + 1/3', method: 'Common denominator', steps: ['LCM is 6', '3/6 + 2/6'], finalAnswer: '5/6', verification: '≈ 0.83' });
    expect(screen.queryByText('LCM is 6')).not.toBeInTheDocument();
    expect(screen.queryByText('5/6')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show first step' }));
    expect(screen.getByText('LCM is 6')).toBeInTheDocument();
    expect(screen.queryByText('3/6 + 2/6')).not.toBeInTheDocument();
    expect(screen.queryByText('5/6')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show next step' }));
    expect(screen.getByText('3/6 + 2/6')).toBeInTheDocument();
    expect(screen.getByText('5/6')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show next step' })).not.toBeInTheDocument();
  });

  it('can show every step at once', () => {
    show({ type: 'worked', problem: 'p', method: 'm', steps: ['one', 'two', 'three'], finalAnswer: 'done', verification: null });
    fireEvent.click(screen.getByRole('button', { name: 'Show all steps' }));
    expect(screen.getByText('three')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });
});

describe('Practice — hint ladder and self-check', () => {
  const practice: LearnResult = {
    type: 'questions',
    questions: [
      { prompt: 'Simplify 4/8', hints: ['Divide both', 'By 4'], solution: '1/2' },
      { prompt: 'Add 1/4 + 2/4', hints: ['Same bottom'], solution: '3/4' },
    ],
  };

  it('shows one question, hints in order, then the solution, then moves on', () => {
    show(practice);
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Add 1/4 + 2/4')).not.toBeInTheDocument();
    expect(screen.queryByText('Divide both')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show a hint' }));
    expect(screen.getByText('Divide both')).toBeInTheDocument();
    expect(screen.queryByText('By 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show another hint' }));
    expect(screen.getByText('By 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hint/ })).not.toBeInTheDocument();

    expect(screen.queryByText('1/2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I got it' }));

    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.getByText(/You marked 1 of 2 as got it/)).toBeInTheDocument();
  });

  it('keeps the student\'s working in the browser — no AI check exists', () => {
    const learn = vi.spyOn(api, 'learn');
    show(practice);
    fireEvent.change(screen.getByLabelText('Your working'), { target: { value: '4/8 = 1/2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    expect(learn).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /check my answer/i })).not.toBeInTheDocument();
  });
});

describe('Quiz — scoring', () => {
  const quiz: LearnResult = {
    type: 'quiz',
    questions: [
      { prompt: 'Which equals 1/2?', options: ['2/3', '2/4', '1/4', '3/4'], correctIndex: 1, explanation: '2/4 simplifies.' },
      { prompt: 'Largest?', options: ['1/2', '1/3', '1/4', '1/5'], correctIndex: 0, explanation: 'Fewer parts.' },
    ],
  };

  it('scores answers, explains in words, locks each question, and totals at the end', () => {
    show(quiz);
    expect(screen.queryByText('2/4 simplifies.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /B\) 2\/4/ }));
    expect(screen.getByText('Correct.')).toBeInTheDocument();
    expect(screen.getByText('2/4 simplifies.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A\) 2\/3/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /B\) 1\/3/ }));
    expect(screen.getByText('Not quite — the answer is A.')).toBeInTheDocument();

    expect(screen.getByText(/You scored/)).toHaveTextContent('You scored 1 out of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(/You scored/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A\) 2\/3/ })).not.toBeDisabled();
  });
});

describe('Flashcards — flip', () => {
  it('flips, advances, and offers the "again" pile at the end', () => {
    show({ type: 'flashcards', cards: [{ front: 'Numerator', back: 'Top number' }, { front: 'Denominator', back: 'Bottom number' }] });
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Top number')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flip card' }));
    expect(screen.getByText('Top number')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    expect(screen.getByText('Denominator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Card front/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.getByText(/You knew 1 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review the 1 to go again' }));
    expect(screen.getByText('Numerator')).toBeInTheDocument();
    expect(screen.getByText('Card 1 of 1')).toBeInTheDocument();
  });
});

describe('Revision notes — recall prompts', () => {
  it('shows notes and hides recall answers until asked', () => {
    show({
      type: 'notes',
      sections: [{ heading: 'Parts', points: ['Numerator on top'] }],
      commonConfusion: '1/2 + 1/3 is not 2/5',
      recallPrompts: [{ prompt: 'What does the denominator count?', answer: 'Equal parts in the whole' }],
    });
    expect(screen.getByRole('heading', { name: 'Parts' })).toBeInTheDocument();
    expect(screen.getByText('1/2 + 1/3 is not 2/5')).toBeInTheDocument();
    expect(screen.queryByText('Equal parts in the whole')).not.toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Show answer' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(screen.getByText('Equal parts in the whole')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide answer' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Mind map — collapsible tree', () => {
  const map: Extract<LearnResult, { type: 'mindmap' }> = {
    type: 'mindmap',
    root: {
      label: 'Fractions',
      children: [
        { label: 'Parts', children: [{ label: 'Numerator', children: [{ label: 'Top', children: [] }] }] },
        { label: 'Operations', children: [] },
      ],
    },
  };

  it('starts with branches open and deeper levels closed, and toggles', () => {
    show(map);
    expect(screen.getByRole('list', { name: 'Mind map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Parts' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Expand Numerator' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Numerator')).toBeInTheDocument();
    expect(screen.queryByText('Top')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Numerator' }));
    expect(screen.getByText('Top')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Parts' }));
    expect(screen.queryByText('Numerator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('Top')).toBeInTheDocument();
  });

  it('offers the same structure as a plain text outline', () => {
    show(map);
    fireEvent.click(screen.getByRole('button', { name: 'Show as text outline' }));
    expect(screen.getByLabelText('Mind map outline').textContent).toBe(toOutline(map.root));
    expect(toOutline(map.root)).toBe('Fractions\n    • Parts\n        • Numerator\n            • Top\n    • Operations');
  });
});

describe('Exam answer — reveal', () => {
  it('hides the model answer until asked, and carries the fixed disclaimer', () => {
    show({ type: 'exam', questions: [{ prompt: 'Define a fraction.', marks: 2, formalAnswer: 'A part of a whole, a/b with b ≠ 0.', plainExplanation: 'How many equal parts you have.' }] });
    expect(screen.getByText(/not from a past paper/)).toBeInTheDocument();
    expect(screen.getByText(/no marks are guaranteed/)).toBeInTheDocument();
    expect(screen.getByText('2 marks')).toBeInTheDocument();
    expect(screen.queryByText('A part of a whole, a/b with b ≠ 0.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show model answer' }));
    expect(screen.getByText('A part of a whole, a/b with b ≠ 0.')).toBeInTheDocument();
    expect(screen.getByText('How many equal parts you have.')).toBeInTheDocument();
  });
});

describe('Redirects', () => {
  it('shows an off-topic redirect as a message, marked free', () => {
    show({ type: 'redirect', kind: 'off_topic', message: 'I am here for study help.' });
    expect(screen.getByText('I am here for study help.')).toBeInTheDocument();
    expect(screen.getByText(/No credit was used/)).toBeInTheDocument();
  });

  it('gives a safety reply as support, with no nudge back to studying', () => {
    show({ type: 'redirect', kind: 'safety', message: 'Please talk to a trusted adult right now.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Please talk to a trusted adult right now.');
    expect(screen.queryByText(/Try a topic/)).not.toBeInTheDocument();
  });

  it('labels a redirect as "not a lesson" in the panel header', async () => {
    mockApis({ learn: reply({ type: 'redirect', kind: 'off_topic', message: 'Back to maths?' }) });
    render(<LearningBuddyPanel />);
    fireEvent.change(await screen.findByPlaceholderText('What do you want help with?'), { target: { value: 'restaurants' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
    expect(await screen.findByText('not a lesson')).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated/)).not.toBeInTheDocument();
  });
});

/* ── XSS ──────────────────────────────────────────────────── */
describe('model output is rendered as text, never HTML', () => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script><b>bold</b>';
  const cases: LearnResult[] = [
    { type: 'explain', idea: evil, example: evil, steps: [evil], takeaway: evil, checkQuestion: { prompt: evil, answer: evil } },
    { type: 'worked', problem: evil, method: evil, steps: [evil], finalAnswer: evil, verification: evil },
    { type: 'questions', questions: [{ prompt: evil, hints: [evil], solution: evil }] },
    { type: 'quiz', questions: [{ prompt: evil, options: [evil, 'b', 'c', 'd'], correctIndex: 0, explanation: evil }] },
    { type: 'flashcards', cards: [{ front: evil, back: evil }] },
    { type: 'notes', sections: [{ heading: evil, points: [evil] }], commonConfusion: evil, recallPrompts: [{ prompt: evil, answer: evil }] },
    { type: 'mindmap', root: { label: evil, children: [{ label: evil, children: [] }, { label: 'x', children: [] }] } },
    { type: 'exam', questions: [{ prompt: evil, marks: 1, formalAnswer: evil, plainExplanation: evil }] },
    { type: 'redirect', kind: 'off_topic', message: evil },
  ];

  it.each(cases.map((c) => [c.type, c] as const))('%s', (_type, structured) => {
    const { container } = show(structured);
    // Open everything that can be opened, so hidden fields are rendered too.
    // Only reveal-type buttons: advancing buttons (Got it, Again, I got it…) would move past the content under test.
    for (const b of screen.queryAllByRole('button')) {
      if (!(b as HTMLButtonElement).disabled && /^(Show|Check|Flip|Expand)/.test(b.textContent ?? '')) fireEvent.click(b);
    }
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('no Study Help source file uses dangerouslySetInnerHTML (comments that name the rule are fine)', () => {
    const dir = join(process.cwd(), 'src', 'components', 'study-help');
    const files = ['learning-buddy-panel.tsx', ...[
      'shared', 'explanation-view', 'worked-view', 'practice-view', 'quiz-view', 'flashcards-view',
      'notes-view', 'mindmap-view', 'exam-view', 'redirect-view', 'study-plan-view', 'result-view',
    ].map((f) => join('results', `${f}.tsx`))];
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/dangerouslySetInnerHTML\s*[=:{]/);
  });
});

/* ── Parent protection ────────────────────────────────────── */
describe('Parent Study Help is unchanged', () => {
  it('the parent page still renders the original TutorPanel', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'app', '[school]', 'parent', 'study-help', 'page.tsx'), 'utf8');
    expect(src).toContain("import { TutorPanel } from '@/components/tutor-panel'");
    expect(src).toContain('<TutorPanel portalSlug="parent" />');
    expect(src).not.toContain('LearningBuddyPanel');
  });

  it('TutorPanel still calls /ai/tutor with its dropdown modes, never /ai/tutor/learn', async () => {
    vi.spyOn(api, 'tutorStatus').mockResolvedValue({ llmEnabled: true, modes: [{ key: 'explain', label: 'Explanation' }, { key: 'mindmap', label: 'Mind map' }] });
    vi.spyOn(api, 'tutorSyllabus').mockResolvedValue(SYLLABUS);
    vi.spyOn(api, 'aiCredits').mockResolvedValue({ metered: true, totalRemaining: 5 } as never);
    const learn = vi.spyOn(api, 'learn');
    const learnStatus = vi.spyOn(api, 'learnStatus');
    const tutor = vi.spyOn(api, 'tutor').mockResolvedValue({
      mode: 'explain', modeLabel: 'Explanation', subject: 'Mathematics', topic: 'fractions', className: 'Class 6 A',
      language: 'en', languageName: 'English', content: 'Parts of a whole.', generated: true,
      groundedOn: { subjects: ['Mathematics'], performance: null },
    });

    render(<TutorPanel portalSlug="parent" />);
    // Still the original dropdown, not the student mode grid.
    const selects = await screen.findAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(screen.queryByRole('group', { name: 'Learning mode' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('What do you want help with?'), { target: { value: 'fractions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
    await waitFor(() => expect(screen.getByText('Parts of a whole.')).toBeInTheDocument());
    expect(tutor).toHaveBeenCalledWith({ topic: 'fractions', subject: 'Mathematics', mode: 'explain' });
    expect(learn).not.toHaveBeenCalled();
    expect(learnStatus).not.toHaveBeenCalled();
  });
});
