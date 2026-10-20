import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 4, teacher audit: the lesson plans, question bank, CPD and class-result
 * screens render the API's data, a suggestion fills the editor without saving,
 * and HR alone sees the all-staff CPD tab.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/teacher/lesson-plans',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ perms: { 'staffleave.apply': 'OWN' } as Record<string, string> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: 'TEACHER', displayName: 'Asha Rao' }, permissions: auth.perms } }) }));

const calls = vi.hoisted(() => ({ get: [] as string[], post: [] as Array<[string, unknown]> }));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plan = {
  id: 'pl1', subjectOfferingId: 'o1', courseModuleId: null, class: 'Class 6 A', subject: 'Mathematics', module: null, date: today, periodNo: 2, durationMinutes: 40,
  title: 'Fractions: comparing', topicIds: [], objectives: ['Compare fractions'], learningOutcomes: null, pedagogies: ['TOY_BASED'], materials: null,
  steps: [{ phase: 'ENGAGE', minutes: 40, activity: 'Pizza slices' }], plannedMinutes: 40, timingWarning: null, differentiation: null, assessment: null,
  competencyCheck: 'A recipe case', homework: 'Two sums', status: 'READY', reflection: null, homeworkAssignmentId: null, source: 'MANUAL', feedback: [],
};
const DATA: Record<string, unknown> = {
  '/syllabus/offerings': [{ id: 'o1', label: 'Class 6 A · Mathematics' }, { id: 'o2', label: 'Class 6 B · Mathematics' }],
  '/teaching/lesson-plans': { items: [plan], totals: { plans: 1, taught: 0, ready: 1, draft: 0, pastNotTaught: 0, withCompetencyCheck: 1 }, canReviewAll: false },
  '/teaching/question-bank/scopes': [{ subjectId: 's1', subject: 'Mathematics', gradeId: 'g1', grade: 'Class 6', chapters: ['Fractions'], questions: 1 }],
  '/teaching/question-bank': { items: [{ id: 'q1', chapter: 'Fractions', type: 'CASE_BASED', typeLabel: 'Case-based', marks: 4, bloom: 'APPLY', competencyBased: true, difficulty: 'MEDIUM', text: 'A pizza is shared…', options: [], author: 'Asha Rao', mine: true, timesUsed: 0 }], totals: { questions: 1, competencyBased: 1, marks: 4 } },
  '/teaching/papers': [],
  '/teaching/cpd': { year: '2026-27', from: '2026-04-01', to: '2027-03-31', entries: [{ id: 'c1', source: 'LOGGED', title: 'CBSE COE workshop', provider: 'CBSE', mode: 'EXTERNAL', area: 'KNOWLEDGE_PRACTICE', hours: 12, date: '2026-07-20', verified: false }], summary: { total: 12, target: 50, pct: 24, byMode: { EXTERNAL: 12, IN_HOUSE: 0 }, targets: { EXTERNAL: 25, IN_HOUSE: 25 }, byArea: [{ area: 'KNOWLEDGE_PRACTICE', label: 'Knowledge and practice', hours: 12, target: 24 }], unverifiedHours: 12, gaps: ['38 more hours to reach 50.'], met: false }, areas: { KNOWLEDGE_PRACTICE: 'Knowledge and practice' } },
  '/teaching/cpd/overview': { year: '2026-27', rows: [{ profileId: 'p2', name: 'Ravi Kumar', role: 'TEACHER', total: 8, external: 8, inHouse: 0, unverifiedHours: 8, met: false, pct: 16 }], pendingVerification: [], totals: { staff: 1, met: 0, under25: 1 } },
  '/teaching/paper-results': { paper: { examName: 'PT 1', subject: 'Mathematics', class: 'Class 6 A', maxMarks: 40, held: true }, total: 3, entered: 3, absent: 0, medical: 0, pending: 0, average: 62.5, averageMarks: 25, highest: 38, lowest: 10, passPct: 67, bands: [{ grade: 'A1', count: 1 }, { grade: 'E', count: 1 }], remedial: [{ rollNo: 3, name: 'Aman Gupta', marks: 10, pct: 25 }], notes: [], published: false },
};
vi.mock('@/lib/api', () => ({
  request: vi.fn(async (path: string) => { calls.get.push(path); const key = path.split('?')[0]; return DATA[key]; }),
}));
vi.mock('@/lib/ops-api', () => ({
  qs: (p: Record<string, unknown> = {}) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); const s = q.toString(); return s ? `?${s}` : ''; },
  post: vi.fn(async (path: string, body: unknown) => {
    calls.post.push([path, body]);
    if (path === '/teaching/lesson-plans/suggest') return { label: 'Suggested draft from your syllabus plan', evidence: ['Module "Fractions"'], plan: { ...plan, id: undefined, title: 'Fractions: like and unlike', status: 'DRAFT' } };
    return {};
  }),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

const views = await import('@/components/ops/p4-teacher-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { calls.get = []; calls.post = []; auth.perms = { 'staffleave.apply': 'OWN' }; });

describe('lesson plans', () => {
  it('lists the week and fills the editor from a suggestion without saving it', async () => {
    inApp(<views.LessonPlansView />);
    expect(await screen.findByText(/Fractions: comparing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ New plan' }));
    fireEvent.click(await screen.findByRole('button', { name: /Suggest from my syllabus plan/ }));
    await waitFor(() => expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Fractions: like and unlike'));
    expect(screen.getByText('Suggested draft from your syllabus plan')).toBeTruthy();
    // Only the suggestion was requested: nothing was saved.
    expect(calls.post.map(([p]) => p)).toEqual(['/teaching/lesson-plans/suggest']);
  });
});

describe('question bank', () => {
  it('shows the bank for the teacher\'s subject with the competency tag', async () => {
    inApp(<views.QuestionBankView />);
    expect(await screen.findByText('A pizza is shared…')).toBeTruthy();
    expect(screen.getByText('Competency')).toBeTruthy();
  });
});

describe('CPD hours', () => {
  it('shows progress and gaps to a teacher, with no all-staff tab', async () => {
    inApp(<views.CpdView />);
    expect(await screen.findByText('12 / 50 h')).toBeTruthy();
    expect(screen.getByText('38 more hours to reach 50.')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /All staff/ })).toBeNull();
    expect(calls.get.some((p) => p.startsWith('/teaching/cpd/overview'))).toBe(false);
  });

  it('gives HR the all-staff tab', async () => {
    auth.perms = { 'staffleave.apply': 'OWN', 'staffleave.manage': 'ALL' };
    inApp(<views.CpdView />);
    fireEvent.click(await screen.findByText('All staff'));
    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
  });
});

describe('class result', () => {
  it('shows the average, the grade spread and the suggested remedial group', async () => {
    inApp(<views.PaperResultsPanel examSubjectId="es1" />);
    expect(await screen.findByText(/62.5% \(25\/40\)/)).toBeTruthy();
    expect(screen.getByText(/Suggested remedial group \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Aman Gupta \(10\)/)).toBeTruthy();
  });
});
