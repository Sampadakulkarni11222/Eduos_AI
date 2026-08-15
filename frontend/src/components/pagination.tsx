'use client';
/**
 * Shared pagination footer for the admin tables.
 *
 * Every list that uses it is paginated server-side, so this is a pure control:
 * it reports the range being shown out of the real total and asks the page to
 * fetch a different page/size. It renders nothing when there is a single page
 * and the caller isn't offering page-size options, so short lists stay clean.
 */
import { Button } from './ui';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES,
  label = 'records',
  busy,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  label?: string;
  busy?: boolean;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
        justifyContent: 'space-between', padding: '12px 16px',
        borderTop: '1px solid var(--hairline)',
      }}
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }} aria-live="polite">
        Showing <strong>{first}–{last}</strong> of <strong>{total}</strong> {label}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {onPageSizeChange && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-faint)' }}>
            Rows
            <select
              className="field-input"
              style={{ marginBottom: 0, padding: '4px 8px', width: 'auto' }}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button small variant="soft" onClick={() => onPageChange(1)} disabled={busy || page <= 1} aria-label="First page">«</Button>
          <Button small variant="soft" onClick={() => onPageChange(page - 1)} disabled={busy || page <= 1} aria-label="Previous page">‹ Prev</Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', padding: '0 4px', whiteSpace: 'nowrap' }}>
            Page {page} of {totalPages}
          </span>
          <Button small variant="soft" onClick={() => onPageChange(page + 1)} disabled={busy || page >= totalPages} aria-label="Next page">Next ›</Button>
          <Button small variant="soft" onClick={() => onPageChange(totalPages)} disabled={busy || page >= totalPages} aria-label="Last page">»</Button>
        </div>
      </div>
    </div>
  );
}
