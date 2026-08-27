'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, cx } from '@/components/ui';
import { api } from '@/lib/api';
import type { GrowthScore, StudentListItem } from '@/lib/types';

export default function StudentView() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [gs, setGs] = useState<GrowthScore | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => setKids([])); }, []);
  const kid = kids?.[active];
  useEffect(() => {
    if (!kid?.enrollment) { setGs(null); return; }
    setLoading(true);
    api.growthScore(kid.enrollment.id).then(setGs).catch(() => setGs(null)).finally(() => setLoading(false));
  // Intentionally narrower than the rule wants: this effect reads only the
  // enrollment id, so widening the dependency to the whole `kid` object would
  // refetch on unrelated changes to the selected child.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kid?.enrollment?.id]);

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Student View', desc: kid ? `${kid.name} · growth at a glance` : 'Growth at a glance' }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : '#fff', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}
      {(kids === null || loading) && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your wards to this number." />}
      {!loading && gs && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
          <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <GrowthRing score={gs.score} band={gs.band} />
            <div style={{ marginTop: 14 }}>
              <span className="xp-pill">★ {Math.round(gs.score * 12)} XP</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 10 }}>
              Updated {new Date(gs.computedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </Card>
          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>How this score is built</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 12 }}>Every point is explained — nothing is a black box.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {gs.components.map((c) => (
                <div key={c.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{c.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{c.points} / {Math.round(c.weight * 100)} pts</span>
                  </div>
                  <div style={{ height: 7, background: 'var(--hairline-2,#E2E7E2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${c.normalized * 100}%`, height: '100%', background: barColor(c.normalized) }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3 }}>{c.detail}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}

function GrowthRing({ score, band }: { score: number; band: string }) {
  const r = 68, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const color = score >= 85 ? 'var(--green)' : score >= 70 ? '#4a7c59' : score >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="growth-ring">
      <svg width="160" height="160">
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--hairline-2,#E2E7E2)" strokeWidth="12" />
        <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="gr-center"><div className="gr-score">{score}</div><div className="gr-band">{band}</div></div>
    </div>
  );
}
function barColor(n: number) { return n >= 0.75 ? 'var(--green)' : n >= 0.5 ? 'var(--amber)' : 'var(--red)'; }
