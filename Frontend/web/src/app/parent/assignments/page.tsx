'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AssignmentDto } from '@/lib/types';

const TYPE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'maroon'> = {
  HOMEWORK: 'blue', PROJECT: 'maroon', TEST: 'red', QUIZ: 'amber', CLASSWORK: 'green',
};

export default function ParentAssignments() {
  const [assignments, setAssignments] = useState<AssignmentDto[] | null>(null);

  useEffect(() => {
    api.assignments().then(setAssignments).catch(() => setAssignments([]));
  }, []);

  const now = new Date();
  const upcoming = assignments?.filter((a) => new Date(a.dueAt) >= now) ?? [];
  const past = assignments?.filter((a) => new Date(a.dueAt) < now) ?? [];

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Assignments', desc: "Your child's assignments and homework." }}>
      {assignments === null && <Card><SkeletonRows rows={5} /></Card>}
      {assignments?.length === 0 && <EmptyState title="No assignments" sub="Assignments posted by teachers appear here." />}

      {assignments && assignments.length > 0 && (
        <>
          {upcoming.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Upcoming</div>
              <Card pad={false} style={{ marginBottom: 20 }}>
                <table className="data-table">
                  <thead><tr><th>Subject</th><th>Title</th><th>Type</th><th>Due</th><th>Class</th></tr></thead>
                  <tbody>
                    {upcoming.map((a) => (
                      <tr key={a.id}>
                        <td style={{ color: 'var(--text-faint)' }}>{a.subject}</td>
                        <td className="cell-primary">{a.title}</td>
                        <td><Pill tone={TYPE_TONE[a.type] ?? 'gray'}>{a.type.toLowerCase()}</Pill></td>
                        <td style={{ color: isOverdue(a.dueAt) ? 'var(--red)' : 'var(--text-2)' }}>{fmtDate(a.dueAt)}</td>
                        <td>{a.class}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
          {past.length > 0 && (
            <>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Past</div>
              <Card pad={false}>
                <table className="data-table">
                  <thead><tr><th>Subject</th><th>Title</th><th>Type</th><th>Was Due</th><th>Class</th></tr></thead>
                  <tbody>
                    {past.map((a) => (
                      <tr key={a.id} style={{ opacity: 0.7 }}>
                        <td style={{ color: 'var(--text-faint)' }}>{a.subject}</td>
                        <td className="cell-primary">{a.title}</td>
                        <td><Pill tone={TYPE_TONE[a.type] ?? 'gray'}>{a.type.toLowerCase()}</Pill></td>
                        <td>{fmtDate(a.dueAt)}</td>
                        <td>{a.class}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}
    </PortalShell>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function isOverdue(iso: string) {
  return new Date(iso) < new Date();
}
