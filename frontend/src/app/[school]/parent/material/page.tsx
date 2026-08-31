'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

export default function ParentMaterial() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.listDocuments()
      .then((res) => setDocs(res.filter((d) => d.type === 'CUSTOM')))
      .catch(() => setDocs([]));
  }, []);

  const filtered = docs?.filter((d) => d.title.toLowerCase().includes(search.toLowerCase())) ?? [];

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Course Material', desc: "Study materials shared by your child's teachers." }}>
      <div style={{ marginBottom: 16 }}>
        <input
          className="input search-input"
          style={{ maxWidth: 280 }}
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card pad={false}>
        {docs === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {docs !== null && filtered.length === 0 && (
          <EmptyState title="No course materials yet" sub="Materials shared for your child's class will appear here." />
        )}
        {docs !== null && filtered.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Title</th>
                <th>Shared On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td className="cell-primary" data-label="Title">{d.title}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Shared On">{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td data-label="Actions">
                    <a href={fileHref(d.fileUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-soft btn-sm">
                      Download / View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
