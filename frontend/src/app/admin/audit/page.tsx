'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Button, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { AuditLogDto } from '@/lib/types';

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLogDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLogs(null);
    setErr(false);
    try {
      const res = await api.auditLogs();
      setLogs(res.items);
      setCursor(res.nextCursor);
    } catch {
      setErr(true);
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.auditLogs({ cursor });
      setLogs((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch {
      toast('Could not load more logs. Please try again.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Audit Log', desc: 'Complete record of all administrative actions.' }}>
      <Card pad={false}>
        {logs === null && !err && <div style={{ padding: 20 }}><SkeletonRows rows={6} /></div>}
        {err && <EmptyState title="Couldn't load audit logs" sub="Failed to fetch logs from the server." />}
        {logs !== null && !err && logs.length === 0 && (
          <EmptyState title="No audit logs" sub="Actions will appear here once they are recorded." />
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
    </PortalShell>
  );
}
