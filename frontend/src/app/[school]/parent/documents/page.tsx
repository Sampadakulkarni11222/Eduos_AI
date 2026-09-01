'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { IdCardPanel } from '@/components/id-card-action';
import { api, ApiError } from '@/lib/api';
import type { DocumentDto, StudentListItem } from '@/lib/types';

const DOC_TYPES = ['ALL', 'REPORT_CARD', 'TC', 'LETTER', 'CUSTOM'];

export default function ParentDocuments() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.students().then((r) => setKids(r.items)).catch(() => setKids([]));
  }, []);

  const kid = kids?.[active];

  useEffect(() => {
    if (!kid) { setDocuments(null); return; }
    setLoading(true);
    api.listDocuments(kid.id)
      .then((docs) => setDocuments(docs.filter((d) => d.type !== 'ID_CARD')))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  // Intentionally narrower than the rule wants: this effect reads only the
  // enrollment id, so widening the dependency to the whole `kid` object would
  // refetch on unrelated changes to the selected child.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kid?.id]);

  const filteredDocs = documents?.filter((d) => {
    if (activeTypeFilter === 'ALL') return true;
    return d.type === activeTypeFilter;
  }) ?? [];

  const openDoc = async (d: DocumentDto) => {
    setOpeningId(d.id);
    try {
      await api.openDocumentFile(d.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't open this document.", 'error');
    } finally {
      setOpeningId(null);
    }
  };

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
      {kids?.length === 0 && <EmptyState icon="👨‍👩‍👧" title="No children linked" sub="Ask the office to link your children to your account." />}

      {kid && (
        <>
          <IdCardPanel studentId={kid.id} />

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {DOC_TYPES.map((t) => (
              <button key={t} className={`chip-tab ${activeTypeFilter === t ? 'active' : ''}`} onClick={() => setActiveTypeFilter(t)}>
                {t === 'ALL' ? 'All Files' : t.replace('_', ' ')}
              </button>
            ))}
          </div>

          <Card pad={false}>
            {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
            {!loading && filteredDocs.length === 0 && (
              <EmptyState icon="📄" title="No documents found" sub="Files published by the school will appear here." />
            )}
            {!loading && filteredDocs.length > 0 && (
              <table className="data-table data-table-cards">
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
                      <td className="cell-primary" data-label="Document Name">{d.title}</td>
                      <td data-label="Type"><Pill tone="blue">{d.type}</Pill></td>
                      <td data-label="Issued Date">{new Date(d.issuedAt).toLocaleDateString('en-IN')}</td>
                      <td data-label="Action">
                        <button className="btn btn-soft btn-sm" onClick={() => openDoc(d)} disabled={openingId === d.id}>
                          {openingId === d.id ? 'Opening…' : 'Download / View'}
                        </button>
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
