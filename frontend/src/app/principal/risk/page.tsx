'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { RiskItem, RiskScan } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  ACADEMIC_DECLINE: 'Academic', DROPOUT: 'Dropout', FEE_DEFAULT: 'Fee default', ATTENDANCE: 'Attendance',
};
const TYPE_TONE: Record<string, { bg: string; color: string; border: string }> = {
  ACADEMIC_DECLINE: { bg: '#E8EBF8', color: '#3a4da8', border: '#b8c0e8' },
  DROPOUT:          { bg: '#FCE8DF', color: '#8a3320', border: '#f0b8a0' },
  FEE_DEFAULT:      { bg: '#FDF5D8', color: '#7a5200', border: '#f5d98a' },
  ATTENDANCE:       { bg: '#E8F5EC', color: '#1e5c38', border: '#9ed4b3' },
};

// Visual badges — larger, clearer than plain Pill (#11)
const LEVEL_BADGE: Record<string, { bg: string; color: string; border: string; label: string; icon: string }> = {
  HIGH:   { bg: '#F6E1DF', color: '#8a2020', border: '#e8aaaa', label: 'High',   icon: '🔴' },
  MEDIUM: { bg: '#FFF3CD', color: '#856404', border: '#ffe599', label: 'Medium', icon: '🟡' },
  LOW:    { bg: '#E3EFE6', color: '#1a5c34', border: '#9ed4b3', label: 'Low',    icon: '🟢' },
};
const LEVEL_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// ─── Types ────────────────────────────────────────────────────────────────────
interface StudentRiskGroup {
  studentName: string;
  class: string;
  enrollmentId: string;
  worstLevel: string;           // for sorting / filtering
  flags: RiskItem[];            // all flags for this student
  probability: number;          // max probability across flags
}

const PAGE_SIZE = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Display probability — shows "< 1%" when near-zero on a non-LOW flag. */
function fmtProb(prob: number, level: string): string {
  if (prob === 0 && level !== 'LOW') return '< 1%';
  if (prob === 0) return '—';
  return `${Math.round(prob * 100)}%`;
}

function RiskLevelBadge({ level }: { level: string }) {
  const b = LEVEL_BADGE[level] ?? { bg: '#eee', color: '#555', border: '#ccc', label: level, icon: '⚪' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
      background: b.bg, color: b.color, border: `1px solid ${b.border}`,
    }}>
      {b.icon} {b.label}
    </span>
  );
}

function CategoryChip({ type }: { type: string }) {
  const t = TYPE_TONE[type] ?? { bg: '#eee', color: '#555', border: '#ccc' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
    }}>
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PrincipalRisk() {
  const [scan, setScan] = useState<RiskScan | null>(null);
  const [err, setErr] = useState(false);

  // Filters (#10)
  const [search, setSearch] = useState('');        // #9
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterClass, setFilterClass] = useState('ALL');

  // Collapse LOW by default (#6)
  const [showLow, setShowLow] = useState(false);

  // Pagination (#4)
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Expanded rows (#12)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { api.riskScan().then(setScan).catch(() => setErr(true)); }, []);

  // ── Group items by student (#1) ─────────────────────────────────────────────
  const studentGroups = useMemo<StudentRiskGroup[]>(() => {
    if (!scan) return [];
    const map = new Map<string, StudentRiskGroup>();
    for (const it of scan.items) {
      const key = it.enrollmentId || it.studentName;
      if (!map.has(key)) {
        map.set(key, { studentName: it.studentName, class: it.class, enrollmentId: key, worstLevel: it.level, flags: [], probability: 0 });
      }
      const g = map.get(key)!;
      g.flags.push(it);
      if ((LEVEL_ORDER[it.level] ?? 9) < (LEVEL_ORDER[g.worstLevel] ?? 9)) g.worstLevel = it.level;
      if (it.probability > g.probability) g.probability = it.probability;
    }
    // Sort HIGH → MEDIUM → LOW (#5)
    return [...map.values()].sort((a, b) => (LEVEL_ORDER[a.worstLevel] ?? 9) - (LEVEL_ORDER[b.worstLevel] ?? 9));
  }, [scan]);

  // ── Available filter options ────────────────────────────────────────────────
  const classes = useMemo(() => [...new Set(studentGroups.map((g) => g.class))].sort(), [studentGroups]);
  const categories = useMemo(() => [...new Set(scan?.items.map((it) => it.type) ?? [])], [scan]);

  // ── Apply filters + search (#9, #10) ───────────────────────────────────────
  const filtered = useMemo(() => {
    let list = studentGroups;
    // Low-risk collapse (#6)
    if (!showLow) list = list.filter((g) => g.worstLevel !== 'LOW');
    // Level filter
    if (filterLevel !== 'ALL') list = list.filter((g) => g.worstLevel === filterLevel);
    // Category filter
    if (filterCategory !== 'ALL') list = list.filter((g) => g.flags.some((f) => f.type === filterCategory));
    // Class filter
    if (filterClass !== 'ALL') list = list.filter((g) => g.class === filterClass);
    // Search (#9)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((g) => g.studentName.toLowerCase().includes(q));
    }
    return list;
  }, [studentGroups, showLow, filterLevel, filterCategory, filterClass, search]);

  const lowCount = useMemo(() => studentGroups.filter((g) => g.worstLevel === 'LOW').length, [studentGroups]);
  const paginated = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const onSearch = (val: string) => {
    setSearch(val);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setVisible(PAGE_SIZE), 200);
  };

  const toggleRow = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  if (err) return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Performance & Risk', desc: 'Predictive flags with the reasons behind them.' }}>
      <EmptyState title="Couldn't run the scan" sub="The risk engine didn't respond. Reload to try again." />
    </PortalShell>
  );

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Performance & Risk', desc: 'Predictive flags with the reasons behind them.' }}>

      {/* ── Stat cards ── */}
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <StatCard label="High risk" value={scan ? (scan.counts.HIGH ?? 0) : '—'} deltaDir="down" />
        <StatCard label="Medium risk" value={scan ? (scan.counts.MEDIUM ?? 0) : '—'} deltaDir="flat" />
        <StatCard label="Flagged students" value={scan ? studentGroups.length : '—'} />
      </div>

      {scan === null && !err && <Card><SkeletonRows rows={5} /></Card>}
      {scan && studentGroups.length === 0 && (
        <EmptyState icon="✓" title="No students flagged" sub="No academic, attendance, dropout or fee-default risks detected." />
      )}

      {scan && studentGroups.length > 0 && (
        <Card pad={false}>
          {/* ── Toolbar: search + filters (#9, #10) ── */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--hairline)',
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
              <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.45, pointerEvents: 'none' }}
                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search student…"
                style={{
                  width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7,
                  border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13,
                  fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)',
                }}
                aria-label="Search by student name"
              />
            </div>

            {/* Level filter */}
            <select
              value={filterLevel}
              onChange={(e) => { setFilterLevel(e.target.value); setVisible(PAGE_SIZE); }}
              style={{ padding: '7px 10px', border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer' }}
              aria-label="Filter by risk level"
            >
              <option value="ALL">All levels</option>
              <option value="HIGH">🔴 High</option>
              <option value="MEDIUM">🟡 Medium</option>
              <option value="LOW">🟢 Low</option>
            </select>

            {/* Category filter */}
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setVisible(PAGE_SIZE); }}
              style={{ padding: '7px 10px', border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer' }}
              aria-label="Filter by category"
            >
              <option value="ALL">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{TYPE_LABEL[c] ?? c}</option>)}
            </select>

            {/* Class filter */}
            <select
              value={filterClass}
              onChange={(e) => { setFilterClass(e.target.value); setVisible(PAGE_SIZE); }}
              style={{ padding: '7px 10px', border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer' }}
              aria-label="Filter by class"
            >
              <option value="ALL">All classes</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {filtered.length} student{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* LOW-risk collapse banner (#6) */}
          {!showLow && lowCount > 0 && filterLevel === 'ALL' && (
            <div style={{
              padding: '8px 16px', background: 'var(--panel-bg)', borderBottom: '1px solid var(--hairline)',
              fontSize: 12.5, color: 'var(--text-2b)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>🟢 {lowCount} low-risk student{lowCount !== 1 ? 's' : ''} hidden</span>
              <button
                onClick={() => setShowLow(true)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                Show all
              </button>
            </div>
          )}

          {/* ── Table with sticky headers + fixed-height scroll (#2, #3) ── */}
          <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13.5 }}>
                No students match the current filters.
              </div>
            ) : (
              <table className="data-table" style={{ minWidth: 680 }}>
                {/* Sticky header (#3) */}
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card-bg)' }}>
                  <tr>
                    <th style={{ width: 28, padding: '12px 8px 12px 16px' }} aria-label="Expand" />
                    <th>Student</th>
                    <th>Class</th>
                    <th>Risk Level</th>
                    <th>Categories</th>
                    <th>Max Probability</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Paginated (#4) */}
                  {paginated.map((g) => {
                    const expanded = expandedId === g.enrollmentId;
                    return (
                      <>
                        {/* Main row (#12 — hover + chevron affordance) */}
                        <tr
                          key={g.enrollmentId}
                          onClick={() => toggleRow(g.enrollmentId)}
                          style={{
                            cursor: 'pointer',
                            background: expanded ? 'var(--panel-bg)' : undefined,
                            transition: 'background .12s',
                          }}
                          onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,.025)'; }}
                          onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = ''; }}
                          aria-expanded={expanded}
                        >
                          {/* Chevron */}
                          <td style={{ padding: '12px 4px 12px 16px', color: 'var(--text-faint)', fontSize: 11, transition: 'transform .15s', textAlign: 'center' }}>
                            <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s ease' }}>▶</span>
                          </td>
                          <td className="cell-primary" data-label="Student">{g.studentName}</td>
                          <td data-label="Class" style={{ color: 'var(--text-2b)' }}>{g.class}</td>
                          <td data-label="Risk Level">
                            {/* Clear level badge (#11) */}
                            <RiskLevelBadge level={g.worstLevel} />
                          </td>
                          <td data-label="Categories">
                            {/* One row per student with category badges (#1) */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {g.flags.map((f, i) => <CategoryChip key={i} type={f.type} />)}
                            </div>
                          </td>
                          <td data-label="Max Probability" style={{ fontWeight: 600, fontSize: 13.5 }}>
                            {/* Fix 0% display (#7) */}
                            <span
                              title={g.probability === 0 ? 'Probability is based on behavioural signals; very low values indicate early-stage flags with incomplete data' : undefined}
                            >
                              {fmtProb(g.probability, g.worstLevel)}
                            </span>
                          </td>
                        </tr>

                        {/* Expanded detail row (#12) */}
                        {expanded && (
                          <tr key={`${g.enrollmentId}-detail`} style={{ background: 'var(--panel-bg)' }}>
                            <td />
                            <td colSpan={5} style={{ paddingBottom: 16, paddingTop: 0, paddingLeft: 16, paddingRight: 20 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {g.flags.map((f, fi) => (
                                  <div key={fi} style={{ borderLeft: `3px solid ${LEVEL_BADGE[f.level]?.border ?? '#ccc'}`, paddingLeft: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                      <CategoryChip type={f.type} />
                                      <RiskLevelBadge level={f.level} />
                                      <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 'auto' }}>
                                        {fmtProb(f.probability, f.level)}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 6 }}>{f.summary}</div>
                                    {/* Top features */}
                                    {f.topFeatures.length > 0 && (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {f.topFeatures.map((feat, i) => (
                                          <span key={i} style={{ fontSize: 11, color: 'var(--text-2)', background: 'var(--hairline)', borderRadius: 6, padding: '2px 7px' }}>
                                            {feat.feature}: <b>{feat.value}</b>
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Load More (#4) ── */}
          {hasMore && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--hairline)', textAlign: 'center' }}>
              <Button variant="soft" small onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Load more ({filtered.length - visible} remaining)
              </Button>
            </div>
          )}

          {/* Show low toggle when low is shown */}
          {showLow && lowCount > 0 && filterLevel === 'ALL' && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--hairline)', fontSize: 12.5, color: 'var(--text-faint)', textAlign: 'center' }}>
              <button
                onClick={() => { setShowLow(false); setVisible(PAGE_SIZE); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                Hide low-risk students
              </button>
            </div>
          )}
        </Card>
      )}
    </PortalShell>
  );
}
