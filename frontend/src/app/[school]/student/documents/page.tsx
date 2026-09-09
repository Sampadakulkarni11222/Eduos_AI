'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, DateRangeFilter, EmptyState, FilterBar, Pill, SearchInput, SkeletonRows, matchesSearch, useToast, withinDateRange } from '@/components/ui';
import { IdCardPanel } from '@/components/id-card-action';
import { api, ApiError } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

const DOC_TYPES = ['ALL', 'REPORT_CARD', 'TC', 'LETTER', 'CUSTOM'];

export default function StudentDocuments() {
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [ownStudentId, setOwnStudentId] = useState<string | undefined>(undefined);
  const [activeTypeFilter, setActiveTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.listDocuments()
      // ID cards are generated live from the /students/:id/id-card endpoint,
      // never from a stored fileUrl — legacy rows of this type are ignored.
      .then((docs) => setDocuments(docs.filter((d) => d.type !== 'ID_CARD')))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
    api.students().then((r) => setOwnStudentId(r.items[0]?.id)).catch(() => {});
  }, []);

  // One box across every column on screen, rather than a field per column.
  const filteredDocs = useMemo(() => (documents ?? []).filter((d) => {
    if (activeTypeFilter !== 'ALL' && d.type !== activeTypeFilter) return false;
    if (!withinDateRange(d.issuedAt, range.from, range.to)) return false;
    return matchesSearch(search, [d.title, d.type.replace('_', ' '), fmtIssued(d.issuedAt)]);
  }), [documents, activeTypeFilter, range, search]);

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
    <PortalShell expectedSlug="student" topbar={{ title: 'My Documents', desc: 'Your ID card, report cards, and personal letters.' }}>
      <IdCardPanel studentId={ownStudentId} />

      <FilterBar>
        <SearchInput
          label="Search documents"
          value={search}
          onChange={setSearch}
          placeholder="Name, type, date…"
        />
        <DateRangeFilter label="Issued date" from={range.from} to={range.to} onChange={setRange} />
      </FilterBar>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
                  <td data-label="Issued Date">{fmtIssued(d.issuedAt)}</td>
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
    </PortalShell>
  );
}

function fmtIssued(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN');
}
