'use client';
import { StatCard, rupees } from '../ui';
import type { FeeSummary } from '@/lib/types';

export function FeeDashboardCards({ summary }: { summary: FeeSummary | null }) {
  return (
    <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
      <StatCard label="Total Fees" value={summary ? rupees(summary.totalBilledPaise) : '—'} />
      <StatCard
        label="Paid"
        value={summary ? rupees(summary.totalCollectedPaise) : '—'}
        delta={summary ? `${summary.collectionPct}% collected` : undefined}
        deltaDir="up"
      />
      <StatCard
        label="Pending"
        value={summary ? rupees(summary.pendingPaise) : '—'}
        delta={summary ? `${summary.pendingCount} invoice(s)` : undefined}
        deltaDir={summary && summary.pendingCount > 0 ? 'down' : 'flat'}
      />
      <StatCard
        label="Overdue"
        value={summary ? rupees(summary.overduePaise) : '—'}
        delta={summary ? `${summary.overdueCount} invoice(s)` : undefined}
        deltaDir={summary && summary.overdueCount > 0 ? 'down' : 'flat'}
      />
    </div>
  );
}
