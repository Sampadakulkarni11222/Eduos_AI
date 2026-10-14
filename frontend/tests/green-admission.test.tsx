import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { PATTERNS, code128Values, code128Widths } from '@/lib/code128';

/**
 * Sustainability: a teacher cannot verify an activity they logged, packs say
 * "evidence to support your submission", eco points mark the reader's class.
 * Library: Code 128 labels are well formed. AI drafts: the template label is
 * shown and nothing claims to be saved. Public admission form: the honeypot
 * is hidden, there is no fee, and the reference number comes back.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/teacher/sustainability',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ me: { profile: { id: 'p-teacher' }, permissions: {} as Record<string, string> } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: auth.me }) }));
const green = vi.hoisted(() => ({
  overview: vi.fn(), ecoPoints: vi.fn(), activities: vi.fn(), teams: vi.fn(), decide: vi.fn(), pack: vi.fn(), packs: vi.fn(),
}));
const drafts = vi.hoisted(() => ({ status: vi.fn(), draft: vi.fn() }));
const pub = vi.hoisted(() => ({ form: vi.fn(), upload: vi.fn(), submit: vi.fn(), requestCode: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/green-api', async (orig) => ({ ...(await orig<typeof import('@/lib/green-api')>()), greenApi: green, aiDraftsApi: drafts, admissionPublicApi: pub }));

const { SustainabilityView, EcoPointsView } = await import('@/components/ops/sustainability-view');
const { AiDraftsView } = await import('@/components/ops/ai-drafts-view');
const { PublicAdmissionForm } = await import('@/components/public-admission-form');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const activity = (over = {}) => ({
  id: 'a1', refNo: 'ECO/2026/0001', teamId: 't1', teamName: 'Class 6 A', teamKind: 'CLASS', title: 'Plastic-free lunch week', category: 'LIFE_ACTION', lifeTheme: 'SAY_NO_TO_SINGLE_USE_PLASTIC',
  date: '2026-10-10', participants: 30, description: null, evidence: [{ name: 'photo.jpg', url: '/uploads/p.jpg' }], status: 'SUBMITTED', points: 0, loggedByProfileId: 'p-teacher', loggedByName: 'Ms Iyer',
  verifiedByName: null, decisionNote: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  green.teams.mockResolvedValue([{ id: 't1', kind: 'CLASS', name: 'Class 6 A', sectionId: 's1', sectionLabel: 'Class 6 A', houseValue: null, leadNames: [], active: true }]);
});

describe('code 128 labels', () => {
  it('uses 107 distinct 11-module symbols (stop 13) and the mod-103 check', () => {
    expect(PATTERNS).toHaveLength(107);
    expect(new Set(PATTERNS).size).toBe(107);
    PATTERNS.forEach((p, i) => expect(p.split('').reduce((s, d) => s + Number(d), 0)).toBe(i === 106 ? 13 : 11));
    const v = code128Values('ACC-000001');
    expect(v[0]).toBe(104);
    expect(v[v.length - 1]).toBe(106);
    const data = v.slice(1, -2);
    expect(data).toEqual([...'ACC-000001'].map((c) => c.charCodeAt(0) - 32));
    expect(v[v.length - 2]).toBe((104 + data.reduce((s, x, i) => s + x * (i + 1), 0)) % 103);
    // Start + 10 characters + check = 12 symbols of 11 modules, plus the 13-module stop.
    expect(code128Widths('ACC-000001').reduce((s, w) => s + w, 0)).toBe(12 * 11 + 13);
    expect(() => code128Values('ACC\n1')).toThrow();
  });
});

describe('sustainability', () => {
  it('a teacher cannot verify an activity they logged; someone else can', async () => {
    auth.me.permissions = { 'sustainability.read': 'ALL', 'sustainability.manage': 'OWN', 'sustainability.verify': 'OWN' };
    green.overview.mockResolvedValue({ period: { from: '', to: '', label: 'Academic year' }, students: 4, waste: { totalKg: 0, byStreamKg: {}, records: 0, segregationPct: null, compostedKg: 0, perStudentKg: null }, trees: { planted: 0, alive: 0, survivalPct: null, records: 0 }, water: { kL: 0, months: 0, perStudentKL: null, rainwaterHarvestedKL: 0 }, energy: { kWh: 0, months: 0, perStudentKWh: null, solarKWh: 0 }, pendingVerification: 2, sanitation: { duties: 0, openTasks: 0 }, canManageAll: false });
    green.activities.mockResolvedValue([activity(), activity({ id: 'a2', refNo: 'ECO/2026/0002', title: 'Leak hunt', loggedByProfileId: 'p-other', loggedByName: 'Mr Khan' })]);
    green.decide.mockResolvedValue(activity({ status: 'VERIFIED' }));
    inApp(<SustainabilityView />);
    // Teachers get no evidence-pack or setup tabs.
    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Evidence packs' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Activities & points' }));
    await screen.findByText('Plastic-free lunch week');
    expect(screen.getByText('Someone else verifies')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Verify' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(green.decide).toHaveBeenCalledWith('a2', expect.objectContaining({ decision: 'VERIFY' })));
  });

  it('evidence packs say they support a submission and never that they file one', async () => {
    auth.me.permissions = { 'sustainability.read': 'ALL', 'sustainability.manage': 'ALL', 'sustainability.verify': 'ALL' };
    green.overview.mockResolvedValue(null);
    green.pack.mockResolvedValue({ key: 'cse', title: 'CSE Green Schools Programme audit', fieldsNote: 'The audit\'s individual questions are not encoded in EduOS.', disclaimer: 'Evidence to support your submission.', period: { from: '2026-04-01', to: '2026-10-15', label: 'Academic year 2026-27 (so far)' }, students: 4, generatedAt: '', sections: [{ key: 'air', title: 'Air', rows: [], evidence: [], gaps: ['EduOS does not record air-quality data.'], evidenceCount: 0 }] });
    inApp(<SustainabilityView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Evidence packs' }));
    expect(screen.getByText(/Evidence to support your submission/)).toBeTruthy();
    expect(screen.getByText(/does not file or submit anything/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await screen.findByText('CSE Green Schools Programme audit');
    expect(screen.getByText(/does not record air-quality/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/submitted to|filed with/i);
  });

  it('eco points mark the reader\'s own class and show only team totals', async () => {
    green.ecoPoints.mockResolvedValue({ schoolPoints: 42, verifiedActivities: 5, note: 'Points count only activities a staff member has verified.', teams: [{ id: 't1', kind: 'CLASS', name: 'Class 6 A', sectionLabel: 'Class 6 A', points: 30, activities: 3, mine: true }, { id: 't2', kind: 'HOUSE', name: 'Red House', sectionLabel: null, points: 12, activities: 2, mine: false }], recent: [] });
    inApp(<EcoPointsView />);
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText('(your class)')).toBeTruthy();
    expect(screen.getByText(/only activities a staff member has verified/)).toBeTruthy();
  });
});

describe('AI drafts', () => {
  it('labels a template draft and says nothing was saved', async () => {
    drafts.status.mockResolvedValue({ aiConfigured: false, kinds: ['LETTER', 'CIRCULAR', 'MINUTES', 'LESSON_PLAN', 'REPORT_REMARK'], bands: ['A1', 'B1'], label: 'Template draft (no AI key configured)' });
    drafts.draft.mockResolvedValue({ kind: 'LETTER', text: 'Dear parents,', source: 'TEMPLATE', label: 'Template draft (no AI key configured)', redactions: 1, saved: false, note: 'Nothing has been sent, published or saved.' });
    inApp(<AiDraftsView />);
    expect(await screen.findByText(/No AI key is configured/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(await screen.findByText('Template draft (no AI key configured)', { selector: 'p.drafts-label' })).toBeTruthy();
    expect(screen.getByText(/1 restricted or contact detail/)).toBeTruthy();
    expect((screen.getByLabelText('Draft text') as HTMLTextAreaElement).value).toBe('Dear parents,');
    expect(screen.queryByRole('button', { name: /send|publish|save/i })).toBeNull();
  });
});

describe('public admission form', () => {
  it('hides the honeypot, takes no fee, and returns the reference number', async () => {
    pub.form.mockResolvedValue({ school: { slug: 'oakridge', name: 'Oakridge Academy' }, grades: ['Class 1', 'Class 6'], documentKinds: ['BIRTH_CERTIFICATE'], files: { extensions: ['pdf', 'jpg', 'jpeg', 'png'], maxBytes: 2097152, maxFiles: 5 }, captcha: { required: false, siteKey: null }, feePayment: false, notice: 'No fee is collected through this form.' });
    pub.submit.mockResolvedValue({ refNo: 'APP/2026/0007', status: 'Received', message: 'ok', acknowledgement: [{ channel: 'SMS', status: 'SIMULATED' }] });
    render(<PublicAdmissionForm school="oakridge" />);
    expect(await screen.findByText('Oakridge Academy')).toBeTruthy();
    expect(screen.getByText('No fee is collected through this form.')).toBeTruthy();
    const hp = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(hp.tabIndex).toBe(-1);
    const send = screen.getByRole('button', { name: 'Send application' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(send);
    expect(await screen.findByText('APP/2026/0007')).toBeTruthy();
    expect(pub.submit).toHaveBeenCalledWith('oakridge', expect.objectContaining({ consent: true, website: '' }));
    expect(screen.getByText(/no SMS or email was sent/)).toBeTruthy();
  });
});
