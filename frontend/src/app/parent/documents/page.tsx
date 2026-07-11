'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto, StudentListItem } from '@/lib/types';

export default function ParentDocuments() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.students().then((r) => setKids(r.items)).catch(() => setKids([]));
  }, []);

  const kid = kids?.[active];

  useEffect(() => {
    if (!kid) { setDocuments(null); return; }
    setLoading(true);
    api.listDocuments(kid.id)
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [kid?.id]);

  const filteredDocs = documents?.filter((d) => {
    if (activeTypeFilter === 'ALL') return true;
    return d.type === activeTypeFilter;
  }) ?? [];

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Documents & Circulars', desc: kid ? `Reports and letters for ${kid.name}` : 'School documents' }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : '#fff', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your children." />}

      {kid && (
        <>
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
        </>
      )}
    </PortalShell>
  );
}
