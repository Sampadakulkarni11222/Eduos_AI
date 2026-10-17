/**
 * Typed client for opportunities and the weekly / monthly newsletter
 * (/newsletter) and the public one-click unsubscribe (/public/newsletter).
 * The server enforces every rule: family scoping, the official-link
 * allowlist, editor-only publishing, comment moderation, one quiz attempt.
 */
import { request } from './api';
import { qs, post, put, patch, del } from './ops-api';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type Verdict = 'YES' | 'NO' | 'CHECK';
export type Reaction = 'USEFUL' | 'INSPIRING' | 'ENTERING' | 'CURIOUS';
export const REACTIONS: Array<{ key: Reaction; label: string; icon: string }> = [
  { key: 'USEFUL', label: 'Useful', icon: '✓' }, { key: 'INSPIRING', label: 'Inspiring', icon: '✦' },
  { key: 'ENTERING', label: 'We are entering', icon: '➚' }, { key: 'CURIOUS', label: 'Curious', icon: '?' },
];
export const OPP_TYPES = ['COMPETITION', 'OLYMPIAD', 'SCHOLARSHIP', 'ENTRANCE_EXAM', 'HACKATHON', 'SCIENCE_FAIR', 'RESEARCH_PROGRAMME', 'INNOVATION_CHALLENGE', 'SPORTS_TRIAL', 'ARTS_CONTEST', 'MUN_DEBATE', 'GOVT_SCHEME', 'TEACHER_PROGRAMME'] as const;
export const OPP_LEVELS = ['SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'] as const;
export const OPP_DOMAINS = ['SCIENCE', 'MATHS', 'CODING_AI', 'ROBOTICS', 'ENVIRONMENT', 'ARTS', 'SPORTS', 'COMMERCE', 'HUMANITIES', 'ENTREPRENEURSHIP'] as const;
export const DOMAIN_LABELS: Record<string, string> = {
  SCIENCE: 'Science', MATHS: 'Maths', CODING_AI: 'Coding and AI', ROBOTICS: 'Robotics', ENVIRONMENT: 'Environment', ARTS: 'Arts',
  SPORTS: 'Sports', COMMERCE: 'Commerce', HUMANITIES: 'Humanities', ENTREPRENEURSHIP: 'Entrepreneurship',
};

export interface Opportunity {
  id: string; title: string; summary: string; type: string; typeLabel: string; level: string; levelLabel: string; audience: string;
  domains: string[]; domainLabels: string[];
  eligibility: { gradeMin?: number | null; gradeMax?: number | null; ageMin?: number | null; ageMax?: number | null; streams?: string[]; note?: string | null };
  registrationOpens: string | null; registrationCloses: string | null; eventDate: string | null;
  datesConfirmed: boolean; datesCheckedByName: string | null; typicalWindow: string | null; typicalMonths: number[]; dateText: string;
  daysLeft: number | null; closingSoon: boolean; fee: string | null; mode: string; officialUrl: string | null; organiser: string | null; region: string | null;
  howToApply: string[]; pastWinnerNotes: string | null; facts: Array<{ front: string; back: string }>; status: string; publishedAt: string | null;
  source: { kind: string; sourceTitle: string | null };
  submittedByName?: string | null; reviewedByName?: string | null; reviewNote?: string | null; clicks?: number; catalogueKey?: string | null;
  saved?: boolean; reason?: string | null; eligibilityVerdict?: Verdict | null; inEdition?: boolean; forStudents?: boolean;
}
export interface MatchGroup { kind: 'STUDENT' | 'TEACHER'; studentId: string | null; name: string | null; className: string | null; items: Array<Opportunity & { reason: string | null; eligibility: Verdict | null }> }
export interface Preferences {
  weekly: boolean; monthly: boolean; email: boolean; emailAllowed: boolean; domains: string[]; stream: string | null; cpdInterests: string[];
  leaderboardOptIn: boolean; language: 'en' | 'hi'; textSize: 'S' | 'M' | 'L'; unsubscribed: boolean; streak: { count: number; best: number; lastDay?: string | null };
  options: { domains: Array<{ key: string; label: string }>; streams: string[] };
}
export interface EditionSummary { id: string; cadence: 'WEEKLY' | 'MONTHLY'; periodLabel: string; title: string; hook?: string | { text: string }; publishedAt: string | null; items?: number; myProgress: number; myQuizScore: number | null; status?: string; periodKey?: string; delivery?: { inApp: number; emailQueued: number; byStatus: Record<string, number> } | null; generatedBy?: string; opportunityIds?: string[]; flashcards?: number; quiz?: number; poll?: string | null; publishedByName?: string | null; createdAt?: string }
export interface Flashcard { key: string; front: string; back: string; domain: string | null; box: number | null; lastResult?: string | null; edition?: string }
export interface QuizQuestion { key: string; question: string; options: string[]; answerIndex?: number; explain?: string; yourAnswer?: number | null }
export interface PollResults { total: number; options: Array<{ key: string; label: string; votes: number; pct: number }> }
export interface Leaderboard { byClass: Array<{ group: string; participants: number; averageScore: number }>; byHouse: Array<{ group: string; participants: number; averageScore: number }>; minGroup: number; note: string }
export interface CommentDto { id: string; opportunityId: string | null; displayName: string; text: string; status: string; mine: boolean; at: string; rejectReason: string | null }
export interface Edition {
  id: string; cadence: 'WEEKLY' | 'MONTHLY'; periodLabel: string; title: string; status: string; intro: string | null; publishedAt: string | null;
  hook: { text: string; question: string | null; textHi: string | null };
  items: Opportunity[]; forYou: MatchGroup[]; deadlines: Array<{ id: string; title: string; daysLeft: number; closes: string; saved: boolean }>;
  flashcards: Flashcard[];
  quiz: { questions: QuizQuestion[]; answered: boolean; score: number | null; onBoard: boolean; canJoinBoard: boolean; boardOptIn: boolean };
  poll: { question: string; options: Array<{ key: string; label: string }>; myChoice: string | null; results: PollResults | null } | null;
  spotlight: Array<{ title: string; detail: string | null; category: string; level: string | null; name: string | null }>;
  reactions: Record<string, { counts: Record<Reaction, number>; mine: Reaction | null }>;
  comments: CommentDto[]; leaderboard: Leaderboard | null;
  progress: { pct: number; lastSection: string | null; completed: boolean };
  reader: { language: 'en' | 'hi'; textSize: 'S' | 'M' | 'L'; streak: { count: number; best: number } };
}
export interface NewsletterHome {
  weekly: { id: string; title: string; periodLabel: string; hook: string } | null; monthly: { id: string; title: string; periodLabel: string; hook: string } | null;
  continueReading: { id: string; title: string; periodLabel: string; pct: number; lastSection: string | null } | null;
  flashcardsDue: number; streak: { count: number; best: number }; closingSoon: Array<{ id: string; title: string; daysLeft: number; forName: string | null }>; savedCount: number;
}
export interface SavedRow { saveId: string; remind: boolean; note: string | null; studentId: string | null; forName: string | null; opportunity: Opportunity }
export interface QuestionRow { id: string; opportunityId: string; opportunity: string | null; text: string; from: string; status: string; answer: string | null; answeredByName: string | null; answeredAt: string | null; createdAt: string }
export interface EligibilityOut { opportunity: string; for?: string | null; verdict?: Verdict; reasons?: string[]; results?: Array<{ for: string; studentId: string | null; verdict: Verdict; reasons: string[] }> }
export interface MapOut { month: number; total: number; byLevel: Record<string, number>; byRegion: Array<{ region: string; count: number }>; items: Array<{ id: string; title: string; level: string; region: string | null }> }
export interface AnalyticsOut {
  editions: Array<{ id: string; title: string; cadence: string; periodLabel: string; status: string; publishedAt: string | null; delivered: number; emailed: number; emailByStatus: Record<string, number>; opens: number; opensByRole: Record<string, number>; completed: number; clicks: number; quizParticipants: number; averageQuizScore: number | null; pollVotes: number; saves: number; comments: Record<string, number> }>;
  totals: { opens: number; clicks: number; quizParticipants: number; saves: number }; topClicked: Array<{ id: string; title: string; clicks: number }>; note: string;
}
export interface PendingComment { id: string; edition: string | null; editionId: string; displayName: string; authorRole: string; text: string; at: string }

export const newsletterApi = {
  home: () => get<NewsletterHome>('/newsletter/home'),
  preferences: () => get<Preferences>('/newsletter/preferences'),
  setPreferences: (body: Partial<Pick<Preferences, 'weekly' | 'monthly' | 'email' | 'domains' | 'stream' | 'cpdInterests' | 'leaderboardOptIn' | 'language' | 'textSize'>>) => put<Preferences>('/newsletter/preferences', body),
  opportunities: (p: Q = {}) => get<{ items: Opportunity[]; counts?: Record<string, number> }>('/newsletter/opportunities', p),
  opportunity: (id: string) => get<Opportunity>(`/newsletter/opportunities/${id}`),
  map: () => get<MapOut>('/newsletter/opportunities/map'),
  matches: (p: Q = {}) => get<{ contexts: MatchGroup[] }>('/newsletter/matches', p),
  eligibility: (id: string, p: Q = {}) => get<EligibilityOut>(`/newsletter/opportunities/${id}/eligibility`, p),
  save: (id: string, body: { studentId?: string | null; remind?: boolean }) => post<{ id: string; saved: boolean; remind: boolean; reminder: string | null }>(`/newsletter/opportunities/${id}/save`, body),
  unsave: (id: string, studentId?: string | null) => del<{ removed: boolean }>(`/newsletter/opportunities/${id}/save${qs({ studentId })}`),
  saved: () => get<SavedRow[]>('/newsletter/saved'),
  calendar: (id: string) => get<{ filename: string; ics: string; confirmed: boolean }>(`/newsletter/opportunities/${id}/calendar`),
  click: (id: string) => post<{ officialUrl: string | null }>(`/newsletter/opportunities/${id}/click`),
  ask: (id: string, body: { text: string; studentId?: string | null }) => post<{ id: string; sentTo: string[] }>(`/newsletter/opportunities/${id}/ask`, body),
  questions: () => get<QuestionRow[]>('/newsletter/questions'),
  answer: (id: string, answer: string) => post<{ id: string }>(`/newsletter/questions/${id}/answer`, { answer }),
  create: (body: Record<string, unknown>) => post<Opportunity>('/newsletter/opportunities', body),
  update: (id: string, body: Record<string, unknown>) => patch<Opportunity>(`/newsletter/opportunities/${id}`, body),
  review: (id: string, body: { decision: 'PUBLISH' | 'REJECT' | 'ARCHIVE'; note?: string }) => post<Opportunity>(`/newsletter/opportunities/${id}/review`, body),
  importCatalogue: () => post<{ added: number; total: number }>('/newsletter/catalogue/import'),
  scanFeeds: () => post<{ scanned: number; added: number }>('/newsletter/feeds/scan'),
  settings: () => get<{ allowedDomains: string[]; defaults: string[] }>('/newsletter/settings'),
  setSettings: (allowedDomains: string[]) => put<{ allowedDomains: string[]; defaults: string[] }>('/newsletter/settings', { allowedDomains }),
  editions: (p: Q = {}) => get<EditionSummary[]>('/newsletter/editions', p),
  edition: (id: string, p: Q = {}) => get<Edition>(`/newsletter/editions/${id}`, p),
  progress: (id: string, body: { pct: number; section: string }) => post<{ pct: number; lastSection: string | null; completed: boolean }>(`/newsletter/editions/${id}/progress`, body),
  quiz: (id: string, answers: number[]) => post<{ score: number; outOf: number; onBoard: boolean; feedback: Array<{ key: string; correct: boolean; yourAnswer: number; answerIndex: number; explain: string }> }>(`/newsletter/editions/${id}/quiz`, { answers }),
  vote: (id: string, option: string) => post<PollResults>(`/newsletter/editions/${id}/poll`, { option }),
  react: (id: string, target: string, kind: Reaction) => post<{ counts: Record<Reaction, number>; mine: Reaction | null }>(`/newsletter/editions/${id}/react`, { target, kind }),
  comment: (id: string, body: { text: string; opportunityId?: string | null }) => post<{ id: string; status: string; displayName: string; note: string | null }>(`/newsletter/editions/${id}/comments`, body),
  clickFromEdition: (id: string, opportunityId: string) => post<{ officialUrl: string | null }>(`/newsletter/editions/${id}/click/${opportunityId}`),
  flashcards: () => get<{ due: Flashcard[]; fresh: Flashcard[]; streak: { count: number; best: number }; stats: { learning: number; mastered: number } }>('/newsletter/flashcards'),
  reviewCard: (cardKey: string, result: 'KNEW' | 'REVIEW') => post<{ cardKey: string; box: number; dueAt: string; streak: { count: number; best: number } }>('/newsletter/flashcards/review', { cardKey, result }),
  pendingComments: () => get<PendingComment[]>('/newsletter/comments/pending'),
  moderate: (id: string, body: { decision: 'APPROVE' | 'REJECT'; reason?: string }) => post<{ id: string; status: string }>(`/newsletter/comments/${id}/moderate`, body),
  generate: (cadence: 'WEEKLY' | 'MONTHLY', force = false) => post<{ created: boolean; rebuilt?: boolean; edition: { id: string; title: string; status: string } }>('/newsletter/editions/generate', { cadence, force }),
  updateDraft: (id: string, body: Record<string, unknown>) => patch<EditionSummary>(`/newsletter/editions/${id}`, body),
  publish: (id: string) => post<{ delivered: boolean; delivery?: { inApp: number; emailQueued: number; byStatus: Record<string, number> } }>(`/newsletter/editions/${id}/publish`),
  withdraw: (id: string, reason: string) => post<EditionSummary>(`/newsletter/editions/${id}/withdraw`, { reason }),
  analytics: () => get<AnalyticsOut>('/newsletter/analytics'),
};
