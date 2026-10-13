import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChatMarkdown } from '@/components/chat-markdown';
import { COLLAPSE_AFTER, PREVIEW_COUNT, REVEAL_STEP } from '@/components/expandable-result';

/**
 * "Read more" for long assistant answers.
 *
 * The server now sends every record the person may see; this is the one
 * place that decides how many are DRAWN at first. Every role's reply passes
 * through ChatMarkdown, so these tests cover all of them: the collapsing knows
 * nothing about roles or tools, only list and table length.
 */

const numbered = (n: number, title = 'You have %n students:') =>
  [title.replace('%n', String(n)), '', ...Array.from({ length: n }, (_, i) => `${i + 1}. **Student ${i + 1}** — Class 6 A`)].join('\n');

const table = (n: number) => [
  `**Students (${n})**`,
  '',
  '| Name | Class | Section | Status |',
  '| --- | --- | --- | --- |',
  ...Array.from({ length: n }, (_, i) => `| Student ${i + 1} | 6 | A | Active |`),
].join('\n');

const readMore = () => screen.queryByRole('button', { name: /read more/i });

/**
 * The drawn list items and table parts, for the tests with thousands of rows.
 *
 * `getAllByRole` works out the accessible role of every element it visits,
 * which costs about a millisecond and a half each: one query over 2,500 items
 * took 3.5 s of a 5 s test, while rendering them took 40 ms. So those tests
 * timed out on a busy machine without the component being slow at all.
 *
 * An `li` directly inside an `ol`/`ul` is a listitem, a `tr` is a row and a
 * `th` a columnheader — these select the same elements by what makes them so.
 * The smaller tests above keep their role queries, which is what holds that
 * equivalence in place.
 */
const listItems = () => Array.from(document.querySelectorAll<HTMLElement>('ol > li, ul > li'));
const tableParts = () => {
  const t = document.querySelector('table');
  expect(t).not.toBeNull();
  return {
    headers: Array.from(t!.querySelectorAll('thead th')).map((th) => th.textContent),
    rows: Array.from(t!.querySelectorAll('tr')),
  };
};

describe('small results are shown whole', () => {
  it('a short list has every item and no Read more', () => {
    render(<ChatMarkdown text={'You have 3 subjects:\n\n1. **Mathematics** — Arjun Sharma\n2. **Science** — Priya Patel\n3. **English** — Amit Joshi'} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(readMore()).toBeNull();
    // The subject formatting is intact.
    expect(screen.getByText('Mathematics').tagName).toBe('STRONG');
  });

  it(`a list of exactly ${COLLAPSE_AFTER} is not collapsed`, () => {
    render(<ChatMarkdown text={numbered(COLLAPSE_AFTER)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(COLLAPSE_AFTER);
    expect(readMore()).toBeNull();
  });

  it('an empty state is just its message', () => {
    render(<ChatMarkdown text={"You currently don't have any subjects assigned."} />);
    expect(screen.getByText("You currently don't have any subjects assigned.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('large lists', () => {
  it('show a preview and Read more, then every item, numbered in order', () => {
    render(<ChatMarkdown text={numbered(100)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(PREVIEW_COUNT);
    expect(readMore()).toHaveTextContent(`Read more (${100 - PREVIEW_COUNT} more items)`);

    fireEvent.click(readMore()!);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(100);
    expect(items.map((li) => li.textContent)).toEqual(
      Array.from({ length: 100 }, (_, i) => `Student ${i + 1} — Class 6 A`),
    );
    // An ordered list keeps its numbering from 1.
    expect(screen.getByRole('list').getAttribute('start')).toBe('1');
    expect(readMore()).toBeNull();

    // And collapses again.
    fireEvent.click(screen.getByRole('button', { name: /show less/i }));
    expect(screen.getAllByRole('listitem')).toHaveLength(PREVIEW_COUNT);
  });

  it('bullet lists collapse the same way', () => {
    const text = ['**Absent**', '', ...Array.from({ length: 30 }, (_, i) => `- Pupil ${i + 1}`)].join('\n');
    render(<ChatMarkdown text={text} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(PREVIEW_COUNT);
    fireEvent.click(readMore()!);
    expect(screen.getAllByRole('listitem')).toHaveLength(30);
  });

  it('a very large list is revealed progressively, and every item is reachable', () => {
    const n = 1200;
    render(<ChatMarkdown text={numbered(n)} />);
    expect(listItems()).toHaveLength(PREVIEW_COUNT);
    fireEvent.click(readMore()!);
    expect(listItems()).toHaveLength(PREVIEW_COUNT + REVEAL_STEP);
    fireEvent.click(readMore()!);
    fireEvent.click(readMore()!);
    const items = listItems();
    expect(items).toHaveLength(n);
    expect(items[n - 1]).toHaveTextContent(`Student ${n} — Class 6 A`);
    expect(readMore()).toBeNull();
  });
});

describe('large tables', () => {
  it('keep their headers, show a preview, and expand to every row', () => {
    render(<ChatMarkdown text={table(150)} />);
    const t = screen.getByRole('table');
    const headers = () => within(t).getAllByRole('columnheader').map((th) => th.textContent);
    const bodyRows = () => within(t).getAllByRole('row').slice(1);

    expect(headers()).toEqual(['Name', 'Class', 'Section', 'Status']);
    expect(bodyRows()).toHaveLength(PREVIEW_COUNT);
    expect(readMore()).toHaveTextContent(`(${150 - PREVIEW_COUNT} more rows)`);

    fireEvent.click(readMore()!);
    expect(headers()).toEqual(['Name', 'Class', 'Section', 'Status']);
    const rows = bodyRows();
    expect(rows).toHaveLength(150);
    // No record disappears: every row, in order, with its cells.
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual(Array.from({ length: 150 }, (_, i) => `Student ${i + 1}`));
    expect(within(rows[149]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Student 150', '6', 'A', 'Active']);
  });

  it('a small table is shown whole', () => {
    render(<ChatMarkdown text={table(5)} />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
    expect(readMore()).toBeNull();
  });
});

describe('every size: nothing lost, numbering unbroken, the UI stays usable', () => {
  /**
   * The Read more button, found among the buttons rather than by role: the
   * role query visits every row on each call, and this is called once per
   * click with thousands of rows already drawn.
   */
  const readMoreButton = () =>
    Array.from(document.querySelectorAll('button')).find((b) => /read more/i.test(b.textContent ?? '')) ?? null;

  /** Clicks Read more until it is gone, counting clicks. */
  const expandFully = () => {
    let clicks = 0;
    for (let b = readMoreButton(); b && clicks < 50; b = readMoreButton()) { fireEvent.click(b); clicks++; }
    return clicks;
  };

  for (const n of [10, 100, 999, 1000, 1001, 2500]) {
    it(`${n} list items`, () => {
      const { unmount } = render(<ChatMarkdown text={numbered(n)} />);
      // Never more than PREVIEW_COUNT drawn at first for a long list.
      expect(listItems()).toHaveLength(n > COLLAPSE_AFTER ? PREVIEW_COUNT : n);
      expandFully();
      const items = listItems();
      expect(items).toHaveLength(n);
      // Ordered, no duplicate, no gap.
      expect(items[0]).toHaveTextContent('Student 1 — Class 6 A');
      expect(items[n - 1]).toHaveTextContent(`Student ${n} — Class 6 A`);
      expect(new Set(items.map((li) => li.textContent)).size).toBe(n);
      unmount();
    });
  }

  for (const n of [999, 1000, 1001]) {
    it(`${n} table rows keep their headers`, () => {
      const { unmount } = render(<ChatMarkdown text={table(n)} />);
      expandFully();
      const { headers, rows } = tableParts();
      expect(headers).toEqual(['Name', 'Class', 'Section', 'Status']);
      expect(rows).toHaveLength(n + 1);
      unmount();
    });
  }

  it('a later window of a long answer keeps its own numbering (1001, 1002, …)', () => {
    const text = ['**2604 students**', '', ...Array.from({ length: 20 }, (_, i) => `${1001 + i}. Learner ${1001 + i}`)].join('\n');
    render(<ChatMarkdown text={text} />);
    expect(screen.getByRole('list').getAttribute('start')).toBe('1001');
  });
});

describe('several collections in one answer', () => {
  it('each collapses on its own', () => {
    render(<ChatMarkdown text={`${numbered(20)}\n\n${table(30)}`} />);
    const buttons = screen.getAllByRole('button', { name: /read more/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(31);
    expect(screen.getAllByRole('listitem')).toHaveLength(PREVIEW_COUNT);
  });
});
