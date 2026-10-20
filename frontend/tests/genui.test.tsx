import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * Generated UI (OpenUI Lang subset): fixed programs render through the
 * registered library only. Unknown or invalid components are dropped, raw
 * HTML never renders, links stay inside the app, an action card only opens
 * the assistant with a question (it never acts), and a program with nothing
 * renderable falls back to the plain text.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/principal',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ ask: vi.fn(), pinned: vi.fn(), pin: vi.fn(), render: vi.fn(), unpin: vi.fn() }));
vi.mock('@/lib/genui-api', () => ({ genuiApi: api }));

const { GenUiPanel, inspectProgram, REGISTERED, ASK_EVENT } = await import('@/components/genui/genui');
const { parseProgram, safeHref } = await import('@/lib/genui/parse');
const { AskDashboard } = await import('@/components/genui/ask-dashboard');

const ui = (program: string) => ({ format: 'openui-lang' as const, program, by: 'code' as const });

const FEES = `root = Panel("Net fee collections", [c1, c2, c3, c4], "Academic year 2026-27 (so far)")
c1 = MetricCompare("Net fee collections", 1000000, 250000, "paise", "Academic year 2026-27 (so far)", "Same period last year", "/fees")
c2 = LineChart("Net fee collections by month", ["Apr 26", "May 26"], [Series("This year", [0, 700000]), Series("Same period last year", [0, 250000])], "paise", "/fees")
c3 = ActionCard("Remind families with overdue fees", "The assistant drafts it first.", "Draft a fee reminder for overdue invoices")
c4 = Evidence([Source("Analytics: Net fee collections · 2 records", "/fees")])`;

describe('renderer: fixed OpenUI Lang samples', () => {
  it('renders a KPI comparison, a chart (with its table), an action card and the evidence footer', () => {
    render(<GenUiPanel ui={ui(FEES)} />);
    const panel = screen.getByRole('region', { name: 'Net fee collections' });
    expect(within(panel).getByText('Academic year 2026-27 (so far)', { selector: '.genui-subtitle' })).toBeInTheDocument();
    expect(within(panel).getByText('₹10,000')).toBeInTheDocument();
    expect(within(panel).getByText(/vs ₹2,500 \(same period last year\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/▲ ₹7,500 \(\+300%\)/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Show table' }));
    expect(within(panel).getByRole('table')).toHaveTextContent('May 26');
    expect(within(panel).getByRole('note', { name: 'Based on' })).toHaveTextContent('Analytics: Net fee collections · 2 records');
    expect(within(panel).getByRole('link', { name: /Analytics: Net fee collections/ })).toHaveAttribute('href', '/oakridge/principal/fees');
  });

  it('an action card only opens the assistant with the question typed in', () => {
    const heard: string[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(ASK_EVENT, on);
    render(<GenUiPanel ui={ui(FEES)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft with the assistant' }));
    window.removeEventListener(ASK_EVENT, on);
    expect(heard).toEqual(['Draft a fee reminder for overdue invoices']);
  });

  it('renders tables, record lists, timelines, donuts and callouts', () => {
    render(<GenUiPanel ui={ui(`root = Panel("Mixed", [t, l, e, d, w])
t = Table("Classes", ["Class", "Present %"], [["Class 5 A", 90], ["Class 5 B", null]], [null, "percent"])
l = RecordList("Overdue", [Record("INV-1", "₹8,000", "/fees", "OVERDUE"), Record("INV-2")])
e = Timeline("Events", [Event("2026-10-02", "Gandhi Jayanti"), Event("2026-10-20", "PTM", "Hall")])
d = DonutChart("Status", [Slice("Paid", 3), Slice("Due", 1)], "count")
w = Callout("warn", "Two classes have no register today.")`)} />);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('90%');
    expect(table).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /INV-1/ })).toHaveAttribute('href', '/oakridge/principal/fees');
    expect(screen.getByText('PTM')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Two classes have no register today.');
    expect(screen.getByRole('img', { name: /Status: Paid 3, Due 1/ })).toBeInTheDocument();
  });
});

describe('renderer: only registered, valid components', () => {
  it('drops unknown components and never renders raw HTML or script', () => {
    const program = `root = Panel("Evil", [a, b, c, k])
a = Html("<img src=x onerror=alert(1)>")
b = Script("alert(1)")
c = Kpi("<b>bold</b>", 5, "count")
k = Iframe("https://evil.example")`;
    const { container } = render(<GenUiPanel ui={ui(program)} fallback={<p>text</p>} />);
    expect(inspectProgram(program)?.outcome).toMatchObject({ rendered: 1, dropped: 3 });
    expect(container.querySelector('img, script, iframe, b')).toBeNull();
    // The label is shown as text, tags and all.
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  });

  it('drops components whose props fail validation (Zod), and extra arguments', () => {
    const out = inspectProgram(`root = Panel("t", [Kpi("ok", 1), Kpi(5, "x"), Kpi("a", 1, "count", null, "good", "/x", "extra"), Table("t", [], [])])`);
    expect(out?.outcome).toMatchObject({ rendered: 1, dropped: 3 });
  });

  it('refuses unsafe links: javascript:, protocol-relative and non-allowlisted hosts', () => {
    render(<GenUiPanel ui={ui(`root = Panel("Links", [l])
l = RecordList("Links", [Record("js", null, "javascript:alert(1)"), Record("pr", null, "//evil.example/x"), Record("ext", null, "https://evil.example/x"), Record("own", null, "/attendance")])`)} />);
    expect(screen.queryByRole('link', { name: 'js' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'pr' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'ext' })).toBeNull();
    expect(screen.getByRole('link', { name: 'own' })).toHaveAttribute('href', '/oakridge/principal/attendance');
    expect(safeHref('data:text/html,x')).toBeNull();
  });

  it('state, actions, queries and mutations are not part of the language', () => {
    expect(parseProgram('root = Panel("a", [Button("Pay", @Run(pay))])').root).toBeNull();
    expect(parseProgram('x = Input("n", $name)').root).toBeNull();
    expect(inspectProgram('root = Panel("a", [q])\nq = Query("delete_student", {id: "1"}, {})')?.blocks).toEqual([]);
    expect(inspectProgram('root = Panel("a", [Mutation("pay_invoice", {})])')?.blocks).toEqual([]);
  });

  it('falls back to the text answer when nothing renders, or the program is not a panel', () => {
    render(<GenUiPanel ui={ui('root = Panel("t", [Nope()])')} fallback={<p>The text answer</p>} />);
    expect(screen.getByText('The text answer')).toBeInTheDocument();
    render(<GenUiPanel ui={ui('root = Kpi("x", 1)')} fallback={<p>Second fallback</p>} />);
    expect(screen.getByText('Second fallback')).toBeInTheDocument();
    render(<GenUiPanel ui={{ format: 'html' as never, program: '<b>x</b>' }} fallback={<p>Third fallback</p>} />);
    expect(screen.getByText('Third fallback')).toBeInTheDocument();
  });

  it('registers the same components as the server (backend/src/modules/genui/lang.js)', () => {
    expect([...REGISTERED].sort()).toEqual(['ActionCard', 'BarChart', 'Callout', 'DonutChart', 'Event', 'Evidence', 'Kpi', 'LineChart', 'MetricCompare', 'Panel', 'Record', 'RecordList', 'Series', 'Slice', 'Source', 'Table', 'Timeline'].sort());
  });
});

describe('Ask your dashboard', () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

  it('builds a panel from a sentence and pins it', async () => {
    api.pinned.mockResolvedValue({ items: [], max: 12 });
    api.ask.mockResolvedValue({ title: 'Net fee collections', source: 'analytics', plan: null, ui: ui(FEES) });
    api.pin.mockResolvedValue({ id: 'p1', surface: 'analytics', title: 'Net fee collections', prompt: 'fee collection this year by month', childId: null, position: 0, createdAt: '' });
    api.render.mockResolvedValue({ title: 'Net fee collections', source: 'analytics', plan: null, ui: ui(FEES), panel: {} });
    render(<AskDashboard surface="analytics" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fee collection this year by month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Net fee collections' })).toBeInTheDocument());
    expect(api.ask).toHaveBeenCalledWith('fee collection this year by month', null);
    fireEvent.click(screen.getByRole('button', { name: /Pin/ }));
    await waitFor(() => expect(api.pin).toHaveBeenCalledWith('analytics', 'fee collection this year by month', 'Net fee collections', null));
    await waitFor(() => expect(api.render).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('button', { name: 'Unpin "Net fee collections"' })).toBeInTheDocument();
  });

  it('shows the server refusal as an error', async () => {
    api.pinned.mockResolvedValue({ items: [], max: 12 });
    api.ask.mockRejectedValue(new Error('Type what you want to see'));
    render(<AskDashboard surface="dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pending homework' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Type what you want to see');
  });
});
