'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Card, Input, Button } from '@/components/ui';
import { useSchoolHref } from '@/lib/school-path';
import type { GuideTopic, RoleGuide } from '@/lib/guides/types';

const panel = { padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' } as const;
const stepBadge = {
  minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12,
} as const;
const pill = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 20, color: 'var(--on-accent)', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', backdropFilter: 'blur(4px)', transition: 'background 0.2s',
} as const;
const newBadge = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 8,
  background: 'var(--accent)', color: 'var(--on-accent)', textTransform: 'uppercase',
} as const;

/** Everything a topic says, flattened, so search finds a topic by any word in it. */
export function topicText(t: GuideTopic): string {
  return [
    t.title, t.category, t.summary, t.openLabel ?? '',
    ...(t.highlights ?? []).flatMap((h) => [h.label, h.text]),
    ...(t.workflow ?? []), ...(t.steps ?? []), ...(t.tips ?? []),
    t.isNew ? 'new' : '',
  ].join(' ').toLowerCase();
}

export const quickLabel = (t: GuideTopic): string =>
  t.shortTitle ?? t.openLabel?.replace(/^Open /, '') ?? t.title;

export function filterTopics(topics: GuideTopic[], query: string): GuideTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return topics;
  return topics.filter((t) => {
    const text = topicText(t);
    return words.every((w) => text.includes(w));
  });
}

function TopicBody({ topic, open }: { topic: GuideTopic; open: (href: string) => void }) {
  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 16 }}>{topic.summary}</p>

      {topic.workflow && topic.workflow.length > 0 && (
        <div style={{ padding: 16, background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <strong style={{ color: 'var(--blue)' }}>Workflow</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
            {topic.workflow.map((w, i) => (
              <span key={w} style={{ display: 'contents' }}>
                {i > 0 && <span aria-hidden="true">→</span>}
                <span>{w}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {topic.highlights && topic.highlights.length > 0 && (
        <div style={{ ...panel, marginBottom: 20 }}>
          <strong>What you&apos;ll find here</strong>
          <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topic.highlights.map((h) => (
              <li key={h.label}><strong>{h.label}:</strong> {h.text}</li>
            ))}
          </ul>
        </div>
      )}

      {topic.steps && topic.steps.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <strong style={{ display: 'block', marginBottom: 10 }}>How to do it</strong>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {topic.steps.map((s, i) => (
              <li key={s} style={{ display: 'flex', gap: 12 }}>
                <span style={stepBadge} aria-hidden="true">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {topic.tips && topic.tips.length > 0 && (
        <div style={{ ...panel, marginBottom: 20 }}>
          <strong>Good to know</strong>
          <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topic.tips.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}

      {topic.href && (
        <div style={{ marginTop: 8 }}>
          <Button variant="soft" onClick={() => open(topic.href!)}>{topic.openLabel ?? `Open ${topic.title}`}</Button>
        </div>
      )}
    </>
  );
}

export function GuidePage({ guide }: { guide: RoleGuide }) {
  const router = useRouter();
  const link = useSchoolHref();
  const open = (href: string) => router.push(link(href));

  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(guide.topics[0]?.id ?? '');

  const filtered = useMemo(() => filterTopics(guide.topics, search), [guide.topics, search]);
  const categories = Array.from(new Set(filtered.map((t) => t.category)));
  const current = filtered.find((t) => t.id === activeId) ?? filtered[0];
  const newTopics = guide.topics.filter((t) => t.isNew);
  const quick = guide.quickActions
    .map((id) => guide.topics.find((t) => t.id === id))
    .filter((t): t is GuideTopic => Boolean(t));

  const contentRef = useRef<HTMLDivElement>(null);
  // When topics stack above the content (narrow screens), the chosen topic would
  // otherwise open off-screen, below the whole topic list.
  const select = (id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1100px)').matches) {
      requestAnimationFrame(() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const show = (id: string) => { setSearch(''); select(id); };

  return (
    <PortalShell expectedSlug={guide.slug} topbar={{ title: guide.hubTitle, desc: guide.hubDesc }}>
      <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40, minHeight: 'calc(100vh - 120px)' }}>

        <div className="guide-hero" style={{ background: 'var(--accent)', borderRadius: 12, padding: '40px 32px', color: 'var(--on-accent)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em' }}>
            Everything you need, right here.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 32, fontSize: 16, opacity: 0.9, fontWeight: 400 }}>{guide.heroText}</p>

          <div style={{ width: '100%', maxWidth: 600 }}>
            <Input
              type="search"
              aria-label="Search the guide"
              placeholder="What do you want to do?"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', textAlign: 'center', padding: '16px 20px', fontSize: 16, borderRadius: 24, background: 'var(--bg)', color: 'var(--text)', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            {quick.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => show(t.id)}
                style={pill}
                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
                onBlur={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
              >
                <span aria-hidden="true">{t.icon}</span> {quickLabel(t)}
              </button>
            ))}
          </div>

          {newTopics.length > 0 && (
            <p style={{ marginTop: 20, marginBottom: 0, fontSize: 13.5, opacity: 0.95 }}>
              <strong>New: </strong>
              {newTopics.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <button
                    type="button"
                    onClick={() => show(t.id)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                  >
                    {t.title}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="guide-body">
          <Card pad={false} className="guide-topics">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', fontWeight: 600, fontSize: 14 }}>
              Topics <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({filtered.length})</span>
            </div>
            <nav aria-label="Guide topics" style={{ padding: '12px 8px' }}>
              {categories.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--text-faint)', fontSize: 13 }}>No results found.</div>
              ) : (
                categories.map((category) => (
                  <div key={category} style={{ marginBottom: 12 }}>
                    <div style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-faint)', letterSpacing: '0.05em' }}>
                      {category}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {filtered.filter((t) => t.category === category).map((t) => {
                        const active = current?.id === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            aria-current={active ? 'true' : undefined}
                            onClick={() => select(t.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '8px 12px',
                              borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, transition: 'all 0.1s ease',
                              background: active ? 'var(--blue-dim)' : 'transparent',
                              color: active ? 'var(--blue)' : 'var(--text-1)',
                              fontWeight: active ? 600 : 400,
                            }}
                          >
                            <span aria-hidden="true" style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{t.icon}</span>
                            <span style={{ flex: 1 }}>{t.title}</span>
                            {t.isNew && <span style={newBadge}>New</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </nav>
          </Card>

          <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 32, minWidth: 0, scrollMarginTop: 80 }}>
            {current ? (
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--hairline)' }}>
                  <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    {current.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                      {current.category}
                      {current.isNew && <span style={newBadge}>New</span>}
                    </div>
                    <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, fontFamily: 'Newsreader, serif' }}>{current.title}</h2>
                  </div>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-1)' }}>
                  <TopicBody topic={current} open={open} />
                </div>
              </Card>
            ) : (
              <Card>
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
                  <div aria-hidden="true" style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                  <h3 style={{ margin: 0, color: 'var(--text)', marginBottom: 8 }}>No results found</h3>
                  <p style={{ margin: 0, fontSize: 14 }}>Try a different word, like the name of a menu item.</p>
                  <Button variant="soft" onClick={() => setSearch('')} style={{ marginTop: 20 }}>Clear search</Button>
                </div>
              </Card>
            )}

            <Card style={{ background: 'var(--panel-bg)', borderColor: 'var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{guide.help.title}</h3>
                  <p style={{ margin: 0, marginTop: 4, fontSize: 14.5, color: 'var(--text-2)' }}>{guide.help.text}</p>
                </div>
                <Button variant="soft" onClick={() => open(guide.help.href)}>{guide.help.label}</Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
