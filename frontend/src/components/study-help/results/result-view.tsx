'use client';
import type { LearnReplyDto } from '@/lib/types';
import { ExplanationView } from './explanation-view';
import { WorkedView } from './worked-view';
import { PracticeView } from './practice-view';
import { QuizView } from './quiz-view';
import { FlashcardsView } from './flashcards-view';
import { NotesView } from './notes-view';
import { MindMapView } from './mindmap-view';
import { ExamView } from './exam-view';
import { RedirectView } from './redirect-view';
import { StudyPlanView } from './study-plan-view';

/** Picks the renderer for a Study Help reply. */
export function ResultView({ reply }: { reply: LearnReplyDto }) {
  const r = reply.structured;
  if (!reply.generated || !r) return <StudyPlanView reasonMessage={reply.reasonMessage} scaffold={reply.scaffold} />;

  switch (r.type) {
    case 'explain': return <ExplanationView result={r} />;
    case 'worked': return <WorkedView result={r} />;
    case 'questions': return <PracticeView result={r} />;
    case 'quiz': return <QuizView result={r} />;
    case 'flashcards': return <FlashcardsView result={r} />;
    case 'notes': return <NotesView result={r} />;
    case 'mindmap': return <MindMapView result={r} />;
    case 'exam': return <ExamView result={r} />;
    case 'redirect': return <RedirectView result={r} />;
    default:
      // A type this build does not know: show the server's plain-text version rather than nothing.
      return <StudyPlanView reasonMessage="This answer could not be displayed here." scaffold={reply.content ?? undefined} />;
  }
}
