import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * Part 7: the Automations page (school automations with on/off, hour,
 * audience and a message preview; drafts to confirm; personal reminders;
 * opt-ins) and the assistant's suggested-next-step chips.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/principal/automations',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));

const auto = vi.hoisted(() => ({
  list: vi.fn(), update: vi.fn(), runNow: vi.fn(), today: vi.fn(), drafts: vi.fn(), confirmDraft: vi.fn(), dismissDraft: vi.fn(),
  optIns: vi.fn(), setOptIn: vi.fn(), reminders: vi.fn(), addReminder: vi.fn(), stopReminder: vi.fn(),
}));
vi.mock('@/lib/automations-api', async (orig) => ({ ...(await orig<typeof import('@/lib/automations-api')>()), automationsApi: auto }));

const agentAsk = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    agentAsk: (...args: unknown[]) => agentAsk(...args),
    agentContinue: vi.fn(), agentConfirm: vi.fn(), importUpload: vi.fn(), downloadProtectedFile: vi.fn(),
    whatsappAssistantLink: () => Promise.resolve({ enabled: false, reason: 'UNAVAILABLE' }),
    trackWhatsappAssistantClick: vi.fn(),
  },
  request: vi.fn(() => Promise.reject(new Error('not in this test'))),
  errorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
  fileHref: (p: string) => p,
  ApiError: class ApiError extends Error { status = 500; },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: 'PRINCIPAL' } } }) }));

const automation = (over: Record<string, unknown> = {}) => ({
  key: 'feeReminders', label: 'Fee due and overdue reminders, with escalation', description: 'Daily reminders.',
  enabled: false, effective: false, featureOn: true, feature: null, cadence: 'DAILY', hour: 10, weekday: null,
  schedule: 'Every day from 10:00', audience: ['PARENT', 'FINANCE'], audiences: ['PARENT', 'FINANCE'], familyFacing: true, optIn: false,
  channels: 'In-app and WhatsApp (if opted in)', preview: 'Reminder: a fee payment is due on 20 Oct 2026.', defaultEnabled: false, customised: false, lastRun: null,
  ...over,
});

const { AutomationsView } = await import('@/components/ops/automations-view');
const { AskEduOS } = await import('@/components/ask-eduos');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  auto.today.mockResolvedValue({ date: '2026-10-19', items: [{ kind: 'REGISTER', title: 'Attendance not marked yet for Class 6 A', link: '/attendance' }] });
  auto.drafts.mockResolvedValue([{ id: 'd1', automationKey: 'staffCoverSuggestions', title: 'Cover for Ms Rao (1 period(s)) on 2026-10-19', status: 'DRAFT', link: '/cover', createdAt: '2026-10-19', detail: { kind: 'COVER', date: '2026-10-19', periods: [{ periodNo: 2, class: 'Class 6 A', subject: 'Maths', suggested: { name: 'Mr Iyer' } }] } }]);
  auto.optIns.mockResolvedValue([]);
  auto.reminders.mockResolvedValue([{ id: 'r1', kind: 'REMINDER', text: 'submit lesson plans', reportKey: null, when: 'every Friday at 4 pm', active: true, nextRunAt: '2026-10-23T10:30:00Z', lastRunAt: null, runs: 0, createdVia: 'ASK_AI' }]);
  auto.list.mockResolvedValue({ automations: [automation(), automation({ key: 'weeklyParentDigest', label: 'Weekly digest per child (parents who opt in)', cadence: 'WEEKLY', weekday: 5, enabled: true, effective: true, optIn: true, audience: ['PARENT'], audiences: ['PARENT'], preview: 'This week for Aarav: present 4 of 5 days.' })], builtIn: [{ key: 'absenteeAlerts', label: 'Absent or late: parents told after the register is saved', where: 'Attendance', link: '/attendance' }], quietHours: { from: 21, to: 7 }, canManage: true });
});

describe('Automations page', () => {
  it('lists each school automation with its schedule and a preview of the message, and the built-in ones', async () => {
    render(<AutomationsView />);
    const card = await screen.findByTestId('automation-feeReminders');
    expect(within(card).getByText('Every day from 10:00')).toBeInTheDocument();
    expect(within(card).getByLabelText('Message preview')).toHaveTextContent('Reminder: a fee payment is due on 20 Oct 2026.');
    expect(within(card).getByText('Reaches families')).toBeInTheDocument();
    expect(screen.getByText('Absent or late: parents told after the register is saved')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent between 21:00 and 07:00/)).toBeInTheDocument();
    expect(await screen.findByText('Attendance not marked yet for Class 6 A')).toBeInTheDocument();
  });

  it('a manager switches one on, changes its hour and weekday', async () => {
    auto.update.mockResolvedValue({});
    render(<AutomationsView />);
    const card = await screen.findByTestId('automation-feeReminders');
    fireEvent.click(within(card).getByLabelText(/on or off/));
    await waitFor(() => expect(auto.update).toHaveBeenCalledWith('feeReminders', { enabled: true }));
    fireEvent.change(within(card).getByLabelText(/hour/), { target: { value: '9' } });
    await waitFor(() => expect(auto.update).toHaveBeenCalledWith('feeReminders', { hour: 9 }));
    const weekly = screen.getByTestId('automation-weeklyParentDigest');
    fireEvent.change(within(weekly).getByLabelText(/day/), { target: { value: '6' } });
    await waitFor(() => expect(auto.update).toHaveBeenCalledWith('weeklyParentDigest', { weekday: 6 }));
    // Hours offered never include the quiet window.
    const hours = within(card).getByLabelText(/hour/).querySelectorAll('option');
    expect([...hours].map((o) => o.textContent)).not.toContain('22:00');
  });

  it('someone who does not manage settings sees the automations but no controls', async () => {
    auto.list.mockResolvedValue({ automations: [automation()], builtIn: [], quietHours: { from: 21, to: 7 }, canManage: false });
    render(<AutomationsView />);
    const card = await screen.findByTestId('automation-feeReminders');
    expect(within(card).queryByLabelText(/on or off/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
  });

  it('shows what a draft would do, and only does it on Confirm', async () => {
    auto.confirmDraft.mockResolvedValue({ outcome: { created: [{}], failed: [] } });
    render(<AutomationsView />);
    expect(await screen.findByText('Period 2 · Class 6 A (Maths) → Mr Iyer')).toBeInTheDocument();
    expect(auto.confirmDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(auto.confirmDraft).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText(/Done: 1 carried out/)).toBeInTheDocument();
  });

  it('lists personal reminders, adds one and stops one', async () => {
    auto.addReminder.mockResolvedValue({});
    auto.stopReminder.mockResolvedValue({ stopped: 1 });
    render(<AutomationsView />);
    expect(await screen.findByText('submit lesson plans')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Remind me to'), { target: { value: 'check the gate register' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(auto.addReminder).toHaveBeenCalledWith(expect.objectContaining({ kind: 'REMINDER', text: 'check the gate register', frequency: 'WEEKLY', weekdays: [5], hour: 16 })));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(auto.stopReminder).toHaveBeenCalledWith('r1'));
  });
});

describe('Ask AI suggested next steps', () => {
  it('shows chips under the latest answer and sends the chosen one', async () => {
    agentAsk
      .mockResolvedValueOnce({ reply: '1 student absent today: Rahul Sharma.', action: null, nextSteps: [{ label: 'Message their parents', ask: 'message their parents' }, { label: 'Send me this every morning', ask: 'every morning send me the list of absent students' }] })
      .mockResolvedValueOnce({ reply: 'Whose parents should I write to?', action: null });
    render(<AskEduOS />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Agent/ }));
    // Every role can start from "what needs me today".
    expect(screen.getByRole('button', { name: 'What needs me today?' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'who is absent today' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const chips = await screen.findByRole('group', { name: 'Suggested next steps' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Message their parents' }));
    await waitFor(() => expect(agentAsk).toHaveBeenLastCalledWith('message their parents', expect.anything(), expect.anything(), undefined, undefined));
    // The new answer has no chips, and the old ones are gone.
    await screen.findByText('Whose parents should I write to?');
    expect(screen.queryByRole('group', { name: 'Suggested next steps' })).toBeNull();
  });
});
