import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ChatMarkdown, parseBlocks } from '@/components/chat-markdown';

/**
 * The assistant's replies, as a person sees them.
 *
 * The server formats answers centrally (backend agent/present.js) as Markdown.
 * What matters here: the formatting is rendered (a heading, bold labels, a real
 * table), nothing arrives as raw Markdown or JSON, and text is never treated as
 * HTML -- a reply can show "<script>" but cannot run it.
 */

const MONTH_TABLE = [
  '**September Attendance**',
  '',
  '| Status | Days |',
  '| --- | ---: |',
  '| Present | 18 |',
  '| Absent | 4 |',
  '| Total Marked | 22 |',
  '| Attendance | **81.82%** |',
].join('\n');

const SUMMARY = [
  '**Attendance Summary**',
  '',
  '- **Attendance:** 82%',
  '- **Present:** 41 days',
  '- **Absent:** 9 days',
  '- **Total Marked:** 50 days',
].join('\n');

describe('ChatMarkdown', () => {
  it('renders a monthly attendance table with right-aligned figures', () => {
    render(<ChatMarkdown text={MONTH_TABLE} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Status', 'Days']);
    const rows = within(table).getAllByRole('row').slice(1).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(rows).toEqual([['Present', '18'], ['Absent', '4'], ['Total Marked', '22'], ['Attendance', '81.82%']]);
    expect(within(table).getByText('81.82%').tagName).toBe('STRONG');
    expect(within(table).getByText('18')).toHaveStyle({ textAlign: 'right' });
    expect(screen.getByText('September Attendance').tagName).toBe('STRONG');
  });

  it('renders a summary as a list with bold labels, and no Markdown syntax survives', () => {
    const { container } = render(<ChatMarkdown text={SUMMARY} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Attendance: 82%', 'Present: 41 days', 'Absent: 9 days', 'Total Marked: 50 days',
    ]);
    expect(within(items[0]).getByText('Attendance:').tagName).toBe('STRONG');
    expect(container.textContent).not.toMatch(/\*\*|\|/);
  });

  it('keeps plain sentences plain, with line breaks', () => {
    const { container } = render(<ChatMarkdown text={'First line.\nSecond line.'} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.textContent).toBe('First line.Second line.');
  });

  it('renders numbered lists, inline code and headings', () => {
    render(<ChatMarkdown text={'## Steps\n\n1. Open `Attendance`\n2. Pick a month'} />);
    expect(screen.getByRole('heading', { name: 'Steps' })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getByText('Attendance').tagName).toBe('CODE');
  });

  it('never interprets the text as HTML', () => {
    const { container } = render(<ChatMarkdown text={'<img src=x onerror="alert(1)"> **<b>hi</b>**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('does not mistake arithmetic or underscores in words for formatting', () => {
    const { container } = render(<ChatMarkdown text={'2 * 3 * 4 and snake_case_name'} />);
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('2 * 3 * 4 and snake_case_name');
  });

  it('renders a timetable as a period table, breaks in italics', () => {
    render(<ChatMarkdown text={[
      '**Timetable — Tomorrow (Monday)**',
      '',
      '| Period | Time | Subject | Teacher |',
      '| ---: | --- | --- | --- |',
      '| 1 | 08:30–09:15 | **Science** | Priya Patel (Science) |',
      '| 2 | 09:15–09:30 | _Break_ |  |',
    ].join('\n')} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Period', 'Time', 'Subject', 'Teacher']);
    expect(within(table).getByText('Science').tagName).toBe('STRONG');
    expect(within(table).getByText('Break').tagName).toBe('EM');
    expect(within(table).getByText('Priya Patel (Science)')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('parses the blocks the assistant produces', () => {
    expect(parseBlocks(MONTH_TABLE).map((b) => b.kind)).toEqual(['paragraph', 'table']);
    expect(parseBlocks(SUMMARY).map((b) => b.kind)).toEqual(['paragraph', 'ul']);
  });
});

/* ── The panel itself ─────────────────────────────────────── */

const agentAsk = vi.fn();
const agentContinue = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    agentAsk: (...args: unknown[]) => agentAsk(...args),
    agentContinue: (...args: unknown[]) => agentContinue(...args),
    agentConfirm: vi.fn(),
    whatsappAssistantLink: () => Promise.resolve({ enabled: false, reason: 'UNAVAILABLE' }),
    trackWhatsappAssistantClick: vi.fn(),
  },
  ApiError: class ApiError extends Error { status = 500; },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { role: 'STUDENT' } } }) }));

const { AskEduOS } = await import('@/components/ask-eduos');

describe('Ask Agent panel', () => {
  beforeEach(() => {
    agentAsk.mockReset();
    agentContinue.mockReset();
    // jsdom has no layout, so no Element.scrollTo; the panel scrolls to the
    // newest message on every update.
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  });

  it('renders the assistant reply formatted, and the student\'s own words as typed', async () => {
    agentAsk.mockResolvedValue({ reply: MONTH_TABLE, action: null });
    render(<AskEduOS />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Agent/ }));
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Show my attendance for **September**' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('81.82%')).toBeInTheDocument();
    // The user's message is not Markdown-rendered.
    expect(screen.getByText('Show my attendance for **September**')).toBeInTheDocument();
    // Nothing raw reached the transcript.
    const log = screen.getByRole('log');
    expect(log.textContent).not.toMatch(/\| ---|\{"|enrollmentId/);
  });

  it('"Load more" fetches the next window until every record has been shown', async () => {
    const windowOf = (from: number, to: number) =>
      ['**2500 students**', '', ...Array.from({ length: to - from + 1 }, (_, i) => `${from + i}. Learner ${from + i}`)].join('\n');
    const cont = (from: number, to: number, total = 2500) => ({ token: `t${from}`, shown: { from: from - 1000, to: from - 1 }, next: { from, to }, total });
    agentAsk.mockResolvedValue({ reply: windowOf(1, 1000), action: null, continuation: cont(1001, 2000) });
    agentContinue
      .mockResolvedValueOnce({ reply: windowOf(1001, 2000), action: null, continuation: cont(2001, 2500) })
      .mockResolvedValueOnce({ reply: windowOf(2001, 2500), action: null, continuation: null });

    render(<AskEduOS />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Agent/ }));
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Show all students' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    fireEvent.click(await screen.findByRole('button', { name: /Load more \(1001–2000 of 2500\)/ }));
    expect(agentContinue).toHaveBeenLastCalledWith('t1001', expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: /Load more \(2001–2500 of 2500\)/ }));
    expect(agentContinue).toHaveBeenLastCalledWith('t2001', expect.anything());

    // The last window offers nothing more, and earlier buttons are gone.
    await waitFor(() => expect(screen.getAllByRole('list').filter((l) => l.tagName === 'OL')).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    // Three windows, each starting where the last ended.
    const lists = screen.getAllByRole('list').filter((l) => l.tagName === 'OL');
    expect(lists.map((l) => l.getAttribute('start'))).toEqual(['1', '1001', '2001']);
  });

  it('offers role suggestions as ERP-styled buttons', () => {
    render(<AskEduOS />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Agent/ }));
    const suggestion = screen.getByRole('button', { name: "What's my attendance percentage?" });
    expect(suggestion).toHaveClass('ai-suggestion');
    expect(suggestion.getAttribute('style')).toBeNull();
  });
});
