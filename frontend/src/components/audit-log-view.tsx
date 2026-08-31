'use client';
import { useEffect, useState, useCallback } from 'react';
import { Card, EmptyState, SkeletonRows, Button, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { AuditLogDto } from '@/lib/types';

/**
 * The audit trail, with the filters the log is actually read through.
 *
 * One component behind all three audit screens (admin, principal, super
 * admin), which were three byte-identical copies — a filter added to one of
 * them would otherwise have to be added to the other two by hand.
 *
 * The filters are conveniences, not access control: the server applies
 * audit.read, confines the rows to the acting school, and decides which of
 * them this reader may see, whatever the query string says.
 */

/** Roles worth filtering by. Blank means the server's default staff view. */
const ROLE_OPTIONS = [
  'TEACHER', 'ADMIN', 'PRINCIPAL', 'STUDENT', 'PARENT',
  'FINANCE', 'LIBRARIAN', 'WARDEN', 'SUPER_ADMIN',
];

const titleCase = (key: string) =>
  key.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLogDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(false);
  const toast = useToast();

  const [roleKey, setRoleKey] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState('');

  // A month names its own range, so the free-form dates are dropped when one
  // is chosen rather than silently fighting it on the server.
  const filters = month
    ? { month, roleKey, action }
    : { roleKey, action, from, to };
  const hasFilters = Boolean(roleKey || action || from || to || month);

  const load = useCallback(async () => {
    setLogs(null);
    setErr(false);
    try {
      const res = await api.auditLogs(filters);
      setLogs(res.items);
      setCursor(res.nextCursor);
    } catch {
      setErr(true);
      setLogs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey, action, from, to, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.auditLogs({ ...filters, cursor });
      setLogs((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch {
      toast('Could not load more logs. Please try again.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setRoleKey(''); setAction(''); setFrom(''); setTo(''); setMonth('');
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <select
          className="field-input"
          style={{ marginBottom: 0, width: 'auto', minWidth: 150 }}
          value={roleKey}
          onChange={(e) => setRoleKey(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="">Staff activity</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
        </select>
        <input
          className="field-input"
          style={{ marginBottom: 0, width: 'auto', minWidth: 170 }}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action, e.g. student.create"
          aria-label="Filter by action"
        />
        <input
          className="field-input"
          style={{ marginBottom: 0, width: 'auto' }}
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Filter by month"
        />
        {!month && (
          <>
            <input
              className="field-input"
              style={{ marginBottom: 0, width: 'auto' }}
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
            <input
              className="field-input"
              style={{ marginBottom: 0, width: 'auto' }}
              type="date" value={to} onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
          </>
        )}
        {hasFilters && (
          <Button variant="soft" small onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      <Card pad={false}>
        {logs === null && !err && <div style={{ padding: 20 }}><SkeletonRows rows={6} /></div>}
        {err && <EmptyState title="Couldn't load audit logs" sub="Failed to fetch logs from the server." />}
        {logs !== null && !err && logs.length === 0 && (
          <EmptyState
            title="No audit logs"
            sub={hasFilters ? 'No entries match these filters.' : 'Actions will appear here once they are recorded.'}
          />
        )}
        {logs && logs.length > 0 && (
          <>
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Target Entity</th>
                  <th>Target ID</th>
                  <th>Actor</th>
                  <th>Role</th>
                  <th>Channel</th>
                  <th>IP Address</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Action">{log.action}</td>
                    <td data-label="Target Entity">{log.entityType ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-faint)' }} data-label="Target ID">{log.entityId ?? '—'}</td>
                    <td data-label="Actor">{log.actorName ?? 'System'}</td>
                    <td data-label="Role">{log.actorRole ? titleCase(log.actorRole) : '—'}</td>
                    <td data-label="Channel">{log.channel}</td>
                    <td data-label="IP Address">{log.ip ?? '—'}</td>
                    <td style={{ color: 'var(--text-faint)' }} data-label="Timestamp">{new Date(log.createdAt).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && (
              <div style={{ padding: 14, textAlign: 'center', borderTop: '1px solid var(--hairline)' }}>
                <Button variant="ghost" small onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
