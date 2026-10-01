/**
 * Shapes returned by the /quizzes API (backend/src/modules/quizzes).
 * Kept beside types.ts rather than in it so the quiz module stays self-contained.
 */

export type QuizStatus = 'DRAFT' | 'PUBLISHED';
export type QuizAttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'LATE';

export interface QuizAttemptSummary {
  id: string;
  status: QuizAttemptStatus;
  startedAt: string | null;
  submittedAt: string | null;
  score: number | null;
  totalMarks: number | null;
  percentage: number | null;
}

export interface QuizListItem {
  id: string;
  title: string;
  description: string;
  status: QuizStatus;
  subject: string;
  subjectId: string;
  class: string;
  sectionId: string;
  gradeName: string | null;
  sectionName: string | null;
  subjectOfferingId: string;
  teacher: string | null;
  questionCount: number;
  totalMarks: number;
  durationMinutes: number | null;
  publishedAt: string | null;
  createdAt: string | null;
  /** Staff lists: students who have submitted. */
  attemptCount?: number;
  /** Student lists: the student's own attempt, if any. */
  myAttempt?: QuizAttemptSummary | null;
}

export interface QuizOption { id: string; text: string; order: number; isCorrect?: boolean }
export interface QuizQuestion { id: string; text: string; marks: number; order: number; options: QuizOption[] }

/** Teacher view — includes the answer key. */
export interface QuizDetail extends QuizListItem {
  /** Students who have submitted — the module's single meaning of "attempts". */
  attemptCount: number;
  /** Started but not yet submitted. */
  inProgressCount: number;
  /** False once anyone has started; the paper is then locked. */
  editable: boolean;
  questions: QuizQuestion[];
}

export interface QuizQuestionInput {
  text: string;
  marks: number;
  options: Array<{ text: string; isCorrect: boolean }>;
}

export interface QuizInput {
  title: string;
  description?: string;
  subjectOfferingId?: string;
  durationMinutes?: number | null;
}

export interface QuizOverview { quiz: QuizListItem; myAttempt: QuizAttemptSummary | null }

export interface QuizPaper {
  quiz: QuizListItem;
  attempt: QuizAttemptSummary;
  deadline: string | null;
  serverNow: string;
  questions: QuizQuestion[];
}

export interface QuizResult {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  subject: string | null;
  status: QuizAttemptStatus;
  score: number;
  totalMarks: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  totalQuestions: number;
  startedAt: string | null;
  submittedAt: string | null;
  answers: Array<{
    questionId: string;
    questionText: string;
    marks: number | null;
    selectedOptionId: string | null;
    selectedOptionText: string | null;
    isCorrect: boolean;
    marksAwarded: number;
  }>;
}

export interface QuizMyAttempt extends QuizAttemptSummary {
  quizId: string;
  quizTitle: string;
  subject: string | null;
  teacher: string | null;
  correctCount: number;
  wrongCount: number;
}

export interface QuizResultRow {
  studentId: string | null;
  admissionNo: string | null;
  rollNo: number | null;
  studentName: string;
  status: QuizAttemptStatus | 'NOT_ATTEMPTED';
  score: number | null;
  totalMarks: number;
  percentage: number | null;
  correctCount: number | null;
  wrongCount: number | null;
  submittedAt: string | null;
}

export interface QuizResults {
  quiz: QuizListItem;
  summary: {
    rosterSize: number;
    attemptedCount: number;
    inProgressCount: number;
    averageScore: number | null;
    averagePercentage: number | null;
    highestScore: number | null;
    lowestScore: number | null;
  };
  rows: QuizResultRow[];
}
