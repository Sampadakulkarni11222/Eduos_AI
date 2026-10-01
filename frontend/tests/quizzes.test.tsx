import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { api } from '@/lib/api';
import { PORTALS } from '@/lib/portals';
import type { QuizListItem, QuizPaper, QuizResult, QuizDetail } from '@/lib/quiz-types';
import type { OfferingDto } from '@/lib/types';

/**
 * Quiz module screens. The shell (auth, sidebar, theming) is replaced by a
 * pass-through so the pages themselves are what is under test; the API is
 * spied on, so these check what the page sends and shows — authorization and
 * grading are covered by the backend suite.
 */

vi.mock('@/components/shell', () => ({
  PortalShell: ({ topbar, children }: { topbar: { title: string; actions?: React.ReactNode }; children: React.ReactNode }) => (
    <div><h1>{topbar.title}</h1>{topbar.actions}{children}</div>
  ),
}));

const { default: StudentQuizzesPage } = await import('@/app/[school]/student/quizzes/page');
const { default: TeacherQuizzesPage } = await import('@/app/[school]/teacher/quizzes/page');

const listItem = (over: Partial<QuizListItem> = {}): QuizListItem => ({
  id: 'quiz-1', title: 'Java Basics', description: 'Answer all.', status: 'PUBLISHED', subject: 'Java', subjectId: 'sub-1',
  class: 'SY BTech A', sectionId: 'sec-1', gradeName: 'SY BTech', sectionName: 'A', subjectOfferingId: 'off-1',
  teacher: 'Ms Rao', questionCount: 2, totalMarks: 2, durationMinutes: null, publishedAt: null, createdAt: null, myAttempt: null,
  ...over,
});

const paper: QuizPaper = {
  quiz: listItem(),
  attempt: { id: 'att-1', status: 'IN_PROGRESS', startedAt: null, submittedAt: null, score: null, totalMarks: null, percentage: null },
  deadline: null,
  serverNow: new Date().toISOString(),
  questions: [
    { id: 'q1', text: 'What is Java?', marks: 1, order: 0, options: [{ id: 'o11', text: 'A language', order: 0 }, { id: 'o12', text: 'A coffee only', order: 1 }] },
    { id: 'q2', text: 'JVM stands for?', marks: 1, order: 1, options: [{ id: 'o21', text: 'Java Virtual Machine', order: 0 }, { id: 'o22', text: 'Just Very Mad', order: 1 }] },
  ],
};

const result: QuizResult = {
  attemptId: 'att-1', quizId: 'quiz-1', quizTitle: 'Java Basics', subject: 'Java', status: 'SUBMITTED',
  score: 1, totalMarks: 2, percentage: 50, correctCount: 1, wrongCount: 1, unansweredCount: 0, totalQuestions: 2,
  startedAt: null, submittedAt: null, answers: [],
};

beforeEach(() => vi.restoreAllMocks());

describe('quiz navigation', () => {
  const hrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items).map((i) => i.href);

  it('is in the teacher and student portals only', () => {
    expect(hrefs('teacher')).toContain('/teacher/quizzes');
    expect(hrefs('student')).toContain('/student/quizzes');
    for (const slug of Object.keys(PORTALS).filter((s) => s !== 'teacher' && s !== 'student')) {
      expect(hrefs(slug).some((h) => h.includes('quizzes'))).toBe(false);
    }
  });
});

describe('student quiz flow', () => {
  it('lists, starts, answers and submits, then shows the result immediately', async () => {
    vi.spyOn(api, 'quizzes').mockResolvedValue([listItem()]);
    vi.spyOn(api, 'myQuizAttempts').mockResolvedValue([]);
    vi.spyOn(api, 'quizOverview').mockResolvedValue({ quiz: listItem(), myAttempt: null });
    vi.spyOn(api, 'startQuiz').mockResolvedValue(paper);
    const submit = vi.spyOn(api, 'submitQuiz').mockResolvedValue(result);

    render(<ToastProvider><StudentQuizzesPage /></ToastProvider>);

    expect(await screen.findByText('Java Basics')).toBeInTheDocument();
    expect(screen.getByText('Ms Rao')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start Quiz' }));

    // Instructions, then the paper.
    fireEvent.click(await screen.findByRole('button', { name: 'Start Quiz' }));
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/A language/));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Just Very Mad/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quiz' }));

    expect(await screen.findByText('Quiz Completed')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    // Only the choices are sent — never a score.
    expect(submit).toHaveBeenCalledWith('quiz-1', [{ questionId: 'q1', optionId: 'o11' }, { questionId: 'q2', optionId: 'o22' }]);
    expect(screen.getByRole('button', { name: 'Back to Quizzes' })).toBeInTheDocument();
  });

  it('offers View Result instead of Start for a completed quiz', async () => {
    vi.spyOn(api, 'quizzes').mockResolvedValue([listItem({
      myAttempt: { id: 'a', status: 'SUBMITTED', startedAt: null, submittedAt: null, score: 2, totalMarks: 2, percentage: 100 },
    })]);
    vi.spyOn(api, 'myQuizAttempts').mockResolvedValue([]);
    render(<ToastProvider><StudentQuizzesPage /></ToastProvider>);
    expect(await screen.findByRole('button', { name: 'View Result' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Quiz' })).not.toBeInTheDocument();
  });
});

describe('teacher quiz builder', () => {
  const offerings: OfferingDto[] = [
    { id: 'off-1', subject: 'Java', sectionId: 'sec-1', sectionName: 'A', gradeName: 'SY BTech' },
    { id: 'off-2', subject: 'DBMS', sectionId: 'sec-2', sectionName: 'A', gradeName: 'TY BTech' },
  ];

  it('offers only the classes and subjects the teacher is assigned', async () => {
    vi.spyOn(api, 'quizzes').mockResolvedValue([]);
    vi.spyOn(api, 'myOfferings').mockResolvedValue(offerings);
    render(<ToastProvider><TeacherQuizzesPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Create Quiz' }));

    const classSelect = await screen.findByLabelText('Class');
    await waitFor(() => expect(within(classSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['SY BTech A', 'TY BTech A']));
    // Subjects follow the chosen class.
    expect(within(screen.getByLabelText('Subject')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Java']);
    fireEvent.change(classSelect, { target: { value: 'sec-2' } });
    await waitFor(() => expect(within(screen.getByLabelText('Subject')).getAllByRole('option').map((o) => o.textContent)).toEqual(['DBMS']));
  });

  it('will not save a question without a correct answer', async () => {
    const draft: QuizDetail = { ...listItem({ status: 'DRAFT', questionCount: 0, totalMarks: 0 }), attemptCount: 0, inProgressCount: 0, editable: true, questions: [] };
    vi.spyOn(api, 'quizzes').mockResolvedValue([listItem({ status: 'DRAFT' })]);
    vi.spyOn(api, 'myOfferings').mockResolvedValue(offerings);
    vi.spyOn(api, 'quiz').mockResolvedValue(draft);
    const add = vi.spyOn(api, 'addQuizQuestion');

    render(<ToastProvider><TeacherQuizzesPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));

    fireEvent.change(await screen.findByLabelText('Question'), { target: { value: 'What is Java?' } });
    ['A', 'B', 'C', 'D'].forEach((l, i) => fireEvent.change(screen.getByLabelText(`Option ${l}`), { target: { value: `Choice ${i}` } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Question' }));

    expect(await screen.findByText('Select the correct answer.')).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
    // Publishing is unavailable until there is a question.
    expect(screen.getByRole('button', { name: 'Publish Quiz' })).toBeDisabled();
  });
});
