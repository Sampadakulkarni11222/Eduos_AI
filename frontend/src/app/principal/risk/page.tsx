'use client';
/**
 * Performance & Risk — the detailed, filterable drill-down.
 *
 * Every filter, the sort and the paging are applied server-side (GET
 * /risk/scan), so the browser only ever holds one page. That matters here:
 * the engine scores every active enrollment against every signal it has data
 * for, so a school of a few hundred students produces well over a thousand
 * rows, the large majority of which sit at 0% probability.
 *
 * Those 0% rows are "checked, nothing wrong" — not findings. The default view
 * therefore shows flagged signals only (medium and high); the level filter
 * still reaches the low ones, and nothing is deleted server-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, cx } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { RiskDetailDrawer } from '@/components/risk-detail-drawer';
import { api } from '@/lib/api';
import { RISK_CATEGORY_LABEL, RISK_CATEGORY_LONG, RISK_LEVEL_TONE, featureLabel, featureValue } from '@/lib/risk-labels';
import type { GradeDto, RiskItem, RiskScan, RiskScanParams } from '@/lib/types';

/**
 * Only the categories the scoring rules actually emit. DROPOUT exists in the
 * label map for older persisted rows, but the engine never produces it today,
 * so offering it as a filter would just be a control that always finds nothing.
 */
const CATEGORIES = ['ATTENDANCE', 'ACADEMIC_DECLINE', 'FEE_DEFAULT'];
const PAGE_SIZES = [10, 25, 50, 100];

type SortKey = NonNullable<RiskScanParams['sortBy']>;

export default function PrincipalRisk() {
  const [scan, setScan] = useState<RiskScan | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [openItem, setOpenItem] = useState<RiskItem | null>(null);

  // Filters — "flagged only" is the default, which is what hides the 0% noise.
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [gradeName, setGradeName] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((refresh = false) => {
    setBusy(true);
    setErr(false);
    api.riskScan({
      // Only the explicit Rescan re-runs the expensive scoring pass; filter,
      // sort and page changes read the predictions already stored.
      ...(refresh ? { refresh: true } : {}),
      // An explicit level filter wins; otherwise "flagged only" is expressed
      // as a probability floor, which keeps both medium and high in view.
      ...(level ? { level } : flaggedOnly ? { minProbability: 0.4 } : {}),
      type: category || undefined,
      gradeName: gradeName || undefined,
      search: appliedSearch || undefined,
      sortBy: sortBy || undefined,
      sortDir,
      page,
      pageSize,
    })
      .then((r) => {
        setScan(r);
        if (r.page && r.page !== page) setPage(r.page);
      })
      .catch(() => setErr(true))
      .finally(() => setBusy(false));
  }, [level, flaggedOnly, category, gradeName, appliedSearch, sortBy, sortDir, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.listGrades().then(setGrades).catch(() => setGrades([])); }, []);

  /**
   * Applies a filter change and resets to page 1 in the SAME event, so React
   * batches them into one render and the table fetches once. The previous
   * version reset the page from an effect, which fired a second request for
   * every filter interaction.
   */
  const applyFilter = (fn: () => void) => { fn(); setPage(1); };

  const onSearch = (q: string) => {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); setAppliedSearch(q.trim()); }, 300);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(key); setSortDir('desc'); }
    setPage(1);
  };
  const sortArrow = (key: SortKey) => (sortBy === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');

  const summary = scan?.summary;
  const items = scan?.items ?? [];
  const hasFilters = !!(level || category || gradeName || appliedSearch || !flaggedOnly);
  const clearFilters = () => {
    setLevel(''); setCategory(''); setGradeName('');
    setSearch(''); setAppliedSearch(''); setFlaggedOnly(true); setPage(1);
  };

  return (
    <PortalShell expectedSlug="principal" topbar={{
      title: 'Performance & Risk',
      desc: 'Every flagged signal, with the reasons behind it — filter, sort and drill into any student.',
      actions: <Button variant="soft" onClick={() => load(true)} disabled={busy}>{busy ? '↻ Scanning…' : '↻ Rescan'}</Button>,
    }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard
          label="Students at high risk"
          value={summary ? summary.studentsAtHighRisk : '—'}
          delta={summary ? `${summary.byLevel.HIGH ?? 0} high-risk signal${(summary.byLevel.HIGH ?? 0) === 1 ? '' : 's'}` : undefined}
          deltaDir="down"
        />
        <StatCard
          label="Students at medium risk"
          value={summary ? summary.studentsAtMediumRisk : '—'}
          delta={summary ? `${summary.byLevel.MEDIUM ?? 0} medium signal${(summary.byLevel.MEDIUM ?? 0) === 1 ? '' : 's'}` : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Flagged students"
          value={summary ? summary.flaggedStudents : '—'}
          delta={summary ? `of ${summary.activeEnrollments} enrolled` : undefined}
          deltaDir="flat"
        />
        <StatCard
          label="Flagged signals"
          value={summary ? summary.flaggedSignals : '—'}
          delta={summary ? `from ${summary.signalsEvaluated} checks run` : undefined}
          deltaDir="flat"
        />
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px', maxWidth: 280 }}>
            <div className="field-label">Search</div>
            <input
              className="field-input" style={{ marginBottom: 0 }} type="search"
              placeholder="Student or class…" value={search}
              onChange={(e) => onSearch(e.target.value)} aria-label="Search risk alerts"
            />
          </div>
          <div style={{ flex: '1 1 150px', maxWidth: 190 }}>
            <div className="field-label">Grade / Class</div>
            <select className="field-input" style={{ marginBottom: 0 }} value={gradeName} onChange={(e) => applyFilter(() => setGradeName(e.target.value))}>
              <option value="">All grades</option>
              {grades.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
            <div className="field-label">Category</div>
            <select className="field-input" style={{ marginBottom: 0 }} value={category} onChange={(e) => applyFilter(() => setCategory(e.target.value))}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{RISK_CATEGORY_LABEL[c] ?? c}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 140px', maxWidth: 180 }}>
            <div className="field-label">Risk level</div>
            <select
              className="field-input" style={{ marginBottom: 0 }} value={level}
              onChange={(e) => applyFilter(() => { setLevel(e.target.value); if (e.target.value) setFlaggedOnly(false); })}
            >
              <option value="">{flaggedOnly ? 'High & medium' : 'All levels'}</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low / monitoring</option>
            </select>
          </div>
          {hasFilters && <Button variant="soft" small onClick={clearFilters}>Clear filters</Button>}
        </div>

        {/* Low-priority records are filtered out of the default view, never removed. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!flaggedOnly}
            disabled={!!level}
            onChange={(e) => applyFilter(() => setFlaggedOnly(!e.target.checked))}
          />
          Include low / 0% monitoring records
          {summary && (
            <span style={{ color: 'var(--text-faint)' }}>
              ({summary.byLevel.LOW ?? 0} checks came back clear)
            </span>
          )}
        </label>
      </Card>

      {scan === null && !err && <Card><SkeletonRows rows={5} /></Card>}
      {err && (
        <EmptyState
          title="Couldn't run the scan"
          sub="The risk engine didn't respond. Retry to run it again."
          action={<Button variant="soft" small onClick={() => load()}>Retry</Button>}
        />
      )}
      {scan && items.length === 0 && (
        hasFilters
          ? <EmptyState title="No matching alerts" sub="No risk signals match these filters. Clear them to widen the search." />
          : <EmptyState icon="✓" title="No students flagged" sub="No attendance, academic, dropout or fee-default risks crossed a threshold." />
      )}

      {scan && items.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th><SortHeader label="Student" onClick={() => toggleSort('student')} arrow={sortArrow('student')} /></th>
                <th><SortHeader label="Class" onClick={() => toggleSort('class')} arrow={sortArrow('class')} /></th>
                <th><SortHeader label="Category" onClick={() => toggleSort('category')} arrow={sortArrow('category')} /></th>
                <th><SortHeader label="Level" onClick={() => toggleSort('level')} arrow={sortArrow('level')} /></th>
                <th><SortHeader label="Probability" onClick={() => toggleSort('probability')} arrow={sortArrow('probability')} /></th>
                <th>Why</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr
                  key={`${it.enrollmentId}-${it.type}-${i}`}
                  onClick={() => setOpenItem(it)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenItem(it); }
                  }}
                  tabIndex={0}
                  role="button"
                  style={{ cursor: 'pointer' }}
                  title={`Open details for ${it.studentName}`}
                >
                  <td className="cell-primary" data-label="Student">{it.studentName}</td>
                  <td data-label="Class">{it.class}</td>
                  <td data-label="Category">{RISK_CATEGORY_LABEL[it.type] ?? it.type}</td>
                  <td data-label="Level"><Pill tone={RISK_LEVEL_TONE[it.level] ?? 'gray'}>{it.level.toLowerCase()}</Pill></td>
                  <td style={{ fontWeight: 600 }} data-label="Probability">{Math.round(it.probability * 100)}%</td>
                  <td data-label="Why">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {it.topFeatures.map((f, fi) => (
                        <span key={fi} style={{ fontSize: 11.5, color: 'var(--text-2)', background: 'var(--panel-bg,#F3ECDC)', borderRadius: 6, padding: '3px 8px' }}>
                          {featureLabel(f.feature)}: <b>{featureValue(f.feature, f.value)}</b>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="">
                    <Button small variant="soft" onClick={(e) => { e.stopPropagation(); setOpenItem(it); }}>Details</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={scan.page ?? 1}
            pageSize={scan.pageSize ?? pageSize}
            total={scan.total ?? items.length}
            totalPages={scan.totalPages ?? 1}
            pageSizes={PAGE_SIZES}
            busy={busy}
            label="risk signals"
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </Card>
      )}

      {openItem && <RiskDetailDrawer item={openItem} onClose={() => setOpenItem(null)} />}
    </PortalShell>
  );
}

function SortHeader({ label, onClick, arrow }: { label: string; onClick: () => void; arrow: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('sort-header')}
      aria-label={`Sort by ${label}`}
    >
      {label}<span aria-hidden="true">{arrow}</span>
    </button>
  );
}
