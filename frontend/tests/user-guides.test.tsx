import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PORTALS } from '@/lib/portals';
import { GUIDES } from '@/lib/guides';
import { filterTopics, quickLabel } from '@/components/guide-layout';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/teacher/guide',
  useParams: () => ({ school: 'oakridge' }),
}));
vi.mock('@/components/shell', () => ({
  PortalShell: ({ topbar, children }: { topbar: { title: string }; children: React.ReactNode }) => (
    <div><h1>{topbar.title}</h1>{children}</div>
  ),
}));

const { GuidePage } = await import('@/components/guide-layout');

const navHrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items.map((i) => i.href));

describe('user guides cover every portal feature', () => {
  for (const slug of Object.keys(PORTALS)) {
    describe(slug, () => {
      const guide = GUIDES[slug];

      it('has a guide, linked from its own sidebar', () => {
        expect(guide, `no guide for portal "${slug}"`).toBeDefined();
        expect(guide.slug).toBe(slug);
        expect(navHrefs(slug)).toContain(`/${slug}/guide`);
      });

      it('explains every sidebar item', () => {
        const covered = new Set(guide.topics.map((t) => t.href).filter(Boolean));
        const missing = navHrefs(slug).filter((h) => h !== `/${slug}/guide` && !covered.has(h));
        expect(missing, `sidebar items with no guide topic in ${slug}`).toEqual([]);
      });

      it('only links to pages in its own sidebar', () => {
        const nav = new Set(navHrefs(slug));
        const broken = guide.topics.filter((t) => t.href && !nav.has(t.href)).map((t) => `${t.id} → ${t.href}`);
        expect(broken).toEqual([]);
        expect(nav.has(guide.help.href), `help link ${guide.help.href}`).toBe(true);
      });

      it('has unique topic ids and valid quick actions', () => {
        const ids = guide.topics.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const q of guide.quickActions) expect(ids).toContain(q);
        const labels = guide.quickActions.map((q) => quickLabel(guide.topics.find((t) => t.id === q)!));
        expect(new Set(labels).size, `duplicate quick-action labels: ${labels.join(', ')}`).toBe(labels.length);
      });
    });
  }
});

describe('newly added features are in the guides and marked New', () => {
  const isNew = (slug: string, href: string) =>
    GUIDES[slug].topics.some((t) => t.href === href && t.isNew === true);

  it.each([
    ['teacher', '/teacher/quizzes'],
    ['student', '/student/quizzes'],
    ['student', '/student/study-help'],
    ['admin', '/admin/document-requests'],
    ['admin', '/admin/document-types'],
    ['admin', '/admin/seats'],
    ['super-admin', '/super-admin/seats'],
    ['super-admin', '/super-admin/pricing'],
    ['super-admin', '/super-admin/customization'],
    ['super-admin', '/super-admin/domains'],
  ])('%s %s', (slug, href) => {
    expect(isNew(slug, href)).toBe(true);
  });

  it('students can find how to request a document', () => {
    const hits = filterTopics(GUIDES.student.topics, 'bonafide certificate');
    expect(hits.map((t) => t.id)).toContain('document-requests');
  });
});

describe('GuidePage', () => {
  beforeEach(() => push.mockClear());

  it('shows the first topic and opens its page under the school address', () => {
    render(<GuidePage guide={GUIDES.teacher} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Your teaching dashboard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Dashboard' }));
    expect(push).toHaveBeenCalledWith('/oakridge/teacher');
  });

  it('searches inside topic text, not just titles', () => {
    render(<GuidePage guide={GUIDES.teacher} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the guide' }), { target: { value: 'locked to keep results fair' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Create auto-graded quizzes' })).toBeInTheDocument();
    expect(screen.getByText('Topics').parentElement).toHaveTextContent('(1)');
  });

  it('says so when nothing matches, and clearing restores every topic', () => {
    render(<GuidePage guide={GUIDES.teacher} />);
    const box = screen.getByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(box, { target: { value: 'zzzz-no-such-thing' } });
    expect(screen.getByRole('heading', { name: 'No results found' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Topics').parentElement).toHaveTextContent(`(${GUIDES.teacher.topics.length})`);
  });

  it('lists new features in the hero and jumps to them', () => {
    render(<GuidePage guide={GUIDES.admin} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Handle document requests' })[0]);
    expect(screen.getByRole('heading', { level: 2, name: 'Handle document requests' })).toBeInTheDocument();
    expect(screen.getByText(/Ready \(issued\)/)).toBeInTheDocument();
  });
});
