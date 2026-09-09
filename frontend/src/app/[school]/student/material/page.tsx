'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, DateRangeFilter, EmptyState, FilterBar, SearchInput, SkeletonRows, matchesSearch, withinDateRange } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import type { DocumentDto } from '@/lib/types';

export default function StudentMaterial() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  useEffect(() => {
    api.listDocuments()
      .then((res) => setDocs(res.filter((d) => d.type === 'CUSTOM')))
      .catch(() => setDocs([]));
  }, []);

  // Across every column on screen, not the title alone.
  const filtered = docs?.filter((d) =>
    withinDateRange(d.issuedAt, range.from, range.to)
    && matchesSearch(search, [d.title, d.studentName, fmtShared(d.issuedAt)])) ?? [];

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Course Material', desc: 'Study materials shared by your teachers.' }}>
      <FilterBar>
        <SearchInput
          label="Search materials"
          value={search}
          onChange={setSearch}
          placeholder="Title or date…"
        />
        <DateRangeFilter label="Shared on" from={range.from} to={range.to} onChange={setRange} />
      </FilterBar>

      <Card pad={false}>
        {docs === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {docs !== null && filtered.length === 0 && (
          <EmptyState title="No course materials yet" sub="Materials your teachers share for your class will appear here." />
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
                  <td style={{ color: 'var(--text-faint)' }} data-label="Shared On">{fmtShared(d.issuedAt)}</td>
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

function fmtShared(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN');
}
