'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { FinanceDashboardDto } from '@/lib/types';

// ─── Status color config (#1) ─────────────────────────────────────────────────
// PENDING = red (action needed), OVERDUE = red (urgent), PARTIAL = amber, PAID = green
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'red', OVERDUE: 'red', CANCELLED: 'gray',
};
const STATUS_LEFT_BORDER: Record<string, string> = {
  PAID: '#2E6B4F', PARTIAL: '#916112', PENDING: '#A8322E', OVERDUE: '#A8322E', CANCELLED: '#ccc',
};

// ─── Due-date helper (#2) ─────────────────────────────────────────────────────
function dueDateText(dueOn: string, status: string): { text: string; color: string } {
  if (status === 'PAID' || status === 'CANCELLED') return { text: '—', color: 'var(--text-faint)' };
  if (!dueOn) return { text: '—', color: 'var(--text-faint)' };
  const due = new Date(dueOn);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, color: 'var(--red)' };
  if (diffDays === 0) return { text: 'Due today', color: 'var(--amber)' };
  if (diffDays <= 7) return { text: `Due in ${diffDays}d`, color: 'var(--amber)' };
  return {
    text: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    color: 'var(--text-faint)',
  };
}

// ─── Remind action helpers (#5) ──────────────────────────────────────────────
function buildReminderMsg(inv: RecentInvoice): string {
  const amt = `₹${(inv.dueAmount).toLocaleString('en-IN')}`;
  return `Dear parent of ${inv.studentName}, your fee invoice ${inv.invoiceNo} for ${amt} is ${inv.status.toLowerCase()}. Kindly arrange payment at the earliest. — School Finance Office`;
}

// ─── Local invoice type alias ─────────────────────────────────────────────────
type RecentInvoice = FinanceDashboardDto['recentInvoices'][number];

const PAGE_SIZE = 10;

export default function FinanceDashboard() {
  const router = useRouter();
  const [data, setData] = useState<FinanceDashboardDto | null>(null);
  const [err, setErr] = useState(false);

  // Search + filter (#4)
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Remind popover state (#5)
  const [remindId, setRemindId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const remindRef = useRef<HTMLDivElement>(null);

  const debRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.financeDashboard().then(setData).catch(() => setErr(true));
  }, []);

  // Close remind popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (remindRef.current && !remindRef.current.contains(e.target as Node)) {
        setRemindId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Deduplicate recent + pending invoices into one list (#4)
  const allInvoices = useMemo<RecentInvoice[]>(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: RecentInvoice[] = [];
    for (const inv of [...(data.recentInvoices ?? []), ...(data.pendingInvoices ?? [])]) {
      if (!seen.has(inv._id)) { seen.add(inv._id); out.push(inv); }
    }
    // Sort: overdue first, then pending, then partial, then paid
    const ORDER: Record<string, number> = { OVERDUE: 0, PENDING: 1, PARTIAL: 2, PAID: 3, CANCELLED: 4 };
    return out.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  }, [data]);

  // Apply search + status filter
  const filtered = useMemo(() => {
    let list = allInvoices;
    if (filterStatus !== 'ALL') list = list.filter((inv) => inv.status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((inv) =>
        inv.studentName.toLowerCase().includes(q) ||
        (inv.admissionNo ?? '').toLowerCase().includes(q) ||
        inv.invoiceNo.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allInvoices, filterStatus, search]);

  const paginated = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const onSearch = (val: string) => {
    setSearch(val);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setVisible(PAGE_SIZE), 250);
  };

  // Collection rate trend (#8)
  const rate = data?.collectionRate ?? 0;
  const trendColor = rate >= 80 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red)';
  const trendLabel = rate >= 80 ? '↑ On track' : rate >= 50 ? '→ Moderate' : '↓ Needs attention';

  const handleRemind = async (inv: RecentInvoice) => {
    const msg = buildReminderMsg(inv);
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(inv._id);
      setTimeout(() => { setCopied(null); setRemindId(null); }, 2000);
    } catch {
      // Fallback: select-all in a temp textarea
      const ta = document.createElement('textarea');
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(inv._id);
      setTimeout(() => { setCopied(null); setRemindId(null); }, 2000);
    }
  };

  return (
    <PortalShell
      expectedSlug="finance"
      topbar={{ title: 'Finance Overview', desc: 'Payments, fees, and financial health.' }}
    >
      {err && <EmptyState title="Couldn't load dashboard" sub="The server didn't respond. Reload to try again." />}

      {!err && (
        <>
          {/* ── Stat cards ── */}
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard
              label="Pending Amount"
              value={data ? rupees(data.pendingAmountPaise) : '—'}
              delta={data ? `${data.pendingInvoices.length} unpaid invoice(s)` : undefined}
              deltaDir={data && data.pendingAmountPaise > 0 ? 'down' : 'flat'}
            />
            {/* Collected + trend indicator (#8) */}
            <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
              <div className="stat-label">Collected</div>
              <div className="stat-value">{data ? rupees(data.collectedAmountPaise) : '—'}</div>
              {data && (
                <>
                  <div className="stat-delta flat" style={{ color: trendColor, marginBottom: 8 }}>
                    {trendLabel} · {rate}% collection rate
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, borderRadius: 4, background: 'var(--hairline)', overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ height: '100%', width: `${Math.min(rate, 100)}%`, background: trendColor, borderRadius: 4, transition: 'width .4s ease' }} />
                  </div>
                </>
              )}
            </div>
            <StatCard
              label="Total Invoices"
              value={data ? data.invoiceCount : '—'}
              delta="total raised"
              deltaDir="flat"
            />
          </div>

          {/* ── Invoice table card ── */}
          <Card pad={false}>
            {/* Card header with "View all" link (#3) */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Invoices</strong>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button variant="soft" small onClick={() => router.push('/finance/payments')}>
                  View all invoices →
                </Button>
              </div>
            </div>

            {/* Search + filter toolbar (#4) */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--hairline)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
                <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}
                  width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Search student or invoice no…"
                  style={{ width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7, border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)' }}
                  aria-label="Search invoices"
                />
              </div>
              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setVisible(PAGE_SIZE); }}
                style={{ padding: '7px 10px', border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer' }}
                aria-label="Filter by status"
              >
                <option value="ALL">All statuses</option>
                <option value="OVERDUE">Overdue</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 'auto' }}>
                {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Invoice list */}
            <div style={{ padding: data === null ? 20 : 0 }}>
              {data === null && <SkeletonRows rows={4} />}
              {data !== null && filtered.length === 0 && (
                <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13.5 }}>
                  {search || filterStatus !== 'ALL' ? 'No invoices match the current filters.' : 'No fee invoices have been generated yet.'}
                </div>
              )}

              {paginated.map((inv, i) => {
                const { text: dueText, color: dueColor } = dueDateText(inv.dueOn, inv.status);
                const isPendingAction = inv.status === 'PENDING' || inv.status === 'OVERDUE' || inv.status === 'PARTIAL';
                const leftBorder = STATUS_LEFT_BORDER[inv.status] ?? '#ccc';
                const isCopied = copied === inv._id;
                const isRemindOpen = remindId === inv._id;

                return (
                  <div
                    key={inv._id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none',
                      borderLeft: `3px solid ${leftBorder}`,
                      cursor: 'pointer', transition: 'background .1s',
                      position: 'relative',
                    }}
                    /* Row hover (#6) */
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,.022)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    onClick={() => router.push('/finance/payments')}
                    title={`${inv.studentName} · ${inv.invoiceNo} · ${rupees(inv.dueAmount)} due`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/finance/payments'); }}
                  >
                    {/* Student + invoice info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.studentName}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 1 }}>
                        {inv.invoiceNo}{inv.admissionNo ? ` · Adm: ${inv.admissionNo}` : ''}
                      </div>
                    </div>

                    {/* Due date text (#2) */}
                    <div style={{ fontSize: 12, color: dueColor, textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
                      {dueText}
                    </div>

                    {/* Amount */}
                    <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', flexShrink: 0, minWidth: 72 }}>
                      {rupees(inv.dueAmount)}
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)' }}>of {rupees(inv.totalAmount)}</div>
                    </div>

                    {/* Status pill (#1) */}
                    <Pill tone={STATUS_TONE[inv.status] ?? 'gray'}>{inv.status.toLowerCase()}</Pill>

                    {/* Remind button (#5) — only for actionable statuses */}
                    {isPendingAction && (
                      <div style={{ position: 'relative', flexShrink: 0 }} ref={isRemindOpen ? remindRef : undefined}>
                        <Button
                          small
                          variant="soft"
                          onClick={(e) => { e.stopPropagation(); setRemindId(isRemindOpen ? null : inv._id); }}
                          style={{ fontSize: 11.5, padding: '4px 10px' }}
                          title="Send a payment reminder"
                        >
                          {isCopied ? '✓ Copied!' : 'Remind'}
                        </Button>
                        {/* Popover */}
                        {isRemindOpen && !isCopied && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50,
                              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                              padding: 12, minWidth: 220,
                            }}
                          >
                            <div style={{ fontSize: 12, color: 'var(--text-2b)', marginBottom: 8, lineHeight: 1.4 }}>
                              Copy a reminder message for:
                              <br /><strong>{inv.studentName}</strong>
                            </div>
                            <Button
                              small
                              style={{ width: '100%', justifyContent: 'center' }}
                              onClick={() => handleRemind(inv)}
                            >
                              📋 Copy reminder message
                            </Button>
                            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6, textAlign: 'center' }}>
                              Paste in WhatsApp or SMS
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Chevron (#6) */}
                    <span style={{ color: 'var(--text-faint)', fontSize: 11, flexShrink: 0 }}>▶</span>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {hasMore && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--hairline)', textAlign: 'center' }}>
                <Button variant="soft" small onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Load more ({filtered.length - visible} remaining)
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}
