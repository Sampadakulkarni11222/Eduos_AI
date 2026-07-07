'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

export default function StudentDocuments() {
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  const filteredDocs = documents?.filter((d) => {
    if (activeTypeFilter === 'ALL') return true;
    return d.type === activeTypeFilter;
  }) ?? [];

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'My Documents', desc: 'Your report cards, ID card files, and personal letters.' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['ALL', 'REPORT_CARD', 'ID_CARD', 'TC', 'LETTER', 'CUSTOM'].map((t) => (
          <button key={t} className={`chip-tab ${activeTypeFilter === t ? 'active' : ''}`} onClick={() => setActiveTypeFilter(t)}>
            {t === 'ALL' ? 'All Files' : t.replace('_', ' ')}
          </button>
        ))}
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
        {!loading && filteredDocs.length === 0 && (
          <EmptyState title="No documents found" sub="Files published by the school will appear here." />
        )}
        {!loading && filteredDocs.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Type</th>
                <th>Issued Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((d) => (
                <tr key={d.id}>
                  <td className="cell-primary">{d.title}</td>
                  <td><Pill tone="blue">{d.type}</Pill></td>
                  <td>{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                  <td>
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
