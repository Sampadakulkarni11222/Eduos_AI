'use client';
/**
 * Staff Directory — the people, not the syllabus.
 *
 * This page used to list subjects with the sections each one runs in, which
 * rendered as "A, B, A, B, A, B…" because section names repeat across grades
 * and carried no staff information at all. It now lists teaching staff, and
 * joins their subject offerings on `teacherId` so a shared display name can't
 * merge two people. Classes are grouped by grade ("Grade 5 — A, B") so the
 * repeated section letters become meaningful again.
 */
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { formatGradeSections, groupSectionsByGrade } from '@/lib/risk-labels';
import type { OfferingDto, SectionDto, StaffAccountDto } from '@/lib/types';

interface StaffRow {
  profileId: string;
  name: string;
  subjects: string[];
  classGroups: Array<{ grade: string; sections: string[] }>;
  sectionCount: number;
  phone: string | null;
  email: string | null;
  status: string;
  classTeacherOf: string[];
}

const PAGE_SIZES = [10, 25, 50];

export default function PrincipalStaff() {
  const [teachers, setTeachers] = useState<StaffAccountDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[] | null>(null);
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    api.listTeachers().then(setTeachers).catch(() => setTeachers([]));
    api.myOfferings().then(setOfferings).catch(() => setOfferings([]));
    api.mySections().then(setSections).catch(() => setSections([]));
  }, []);

  const loading = teachers === null || offerings === null || sections === null;

  const rows: StaffRow[] = useMemo(() => {
    if (!teachers || !offerings || !sections) return [];

    // Offerings carry the profile id of the teacher, so group on that.
    const byTeacher = new Map<string, OfferingDto[]>();
    for (const o of offerings) {
      if (!o.teacherId) continue;
      if (!byTeacher.has(o.teacherId)) byTeacher.set(o.teacherId, []);
      byTeacher.get(o.teacherId)!.push(o);
    }

    // Sections name their class teacher by profile id too.
    const classTeacherOf = new Map<string, string[]>();
    for (const s of sections) {
      if (!s.classTeacherId) continue;
      const label = s.gradeName ? `${s.gradeName} ${s.name}` : s.name;
      if (!classTeacherOf.has(s.classTeacherId)) classTeacherOf.set(s.classTeacherId, []);
      classTeacherOf.get(s.classTeacherId)!.push(label);
    }

    return teachers.flatMap((account) =>
      (account.profiles ?? [])
        .filter((p) => p.role === 'TEACHER')
        .map((p) => {
          const mine = byTeacher.get(p.profileId) ?? [];
          const groups = groupSectionsByGrade(
            mine.map((o) => ({ gradeName: o.gradeName, sectionName: o.sectionName })),
          );
          return {
            profileId: p.profileId,
            name: p.displayName || account.displayName || '—',
            subjects: [...new Set(mine.map((o) => o.subject).filter(Boolean))].sort(),
            classGroups: groups,
            sectionCount: groups.reduce((n, g) => n + g.sections.length, 0),
            phone: account.phone ?? null,
            email: account.email ?? null,
            status: account.status ?? 'ACTIVE',
            classTeacherOf: classTeacherOf.get(p.profileId) ?? [],
          };
        }),
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [teachers, offerings, sections]);

  const allSubjects = useMemo(
    () => [...new Set(rows.flatMap((r) => r.subjects))].sort(),
    [rows],
  );

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (subjectFilter && !r.subjects.includes(subjectFilter)) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q)
      || r.subjects.some((s) => s.toLowerCase().includes(q))
      || r.classGroups.some((g) => `${g.grade} ${g.sections.join(' ')}`.toLowerCase().includes(q))
      || (r.email ?? '').toLowerCase().includes(q)
      || (r.phone ?? '').toLowerCase().includes(q);
  });

  useEffect(() => { setPage(1); }, [search, subjectFilter, pageSize]);

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const unassigned = rows.filter((r) => r.sectionCount === 0).length;

  return (
    <PortalShell expectedSlug="principal" topbar={{
      title: 'Staff Directory',
      desc: 'Teaching staff, the subjects they teach, their classes and how to reach them.',
    }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
          <div className="field-label">Search</div>
          <input
            className="field-input" style={{ marginBottom: 0 }} type="search"
            placeholder="Name, subject, class or contact…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label="Search staff"
          />
        </div>
        <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
          <div className="field-label">Subject</div>
          <select className="field-input" style={{ marginBottom: 0 }} value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
            <option value="">All subjects</option>
            {allSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {!loading && (
          <span style={{ fontSize: 12.5, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {rows.length} teaching staff{unassigned > 0 ? ` · ${unassigned} with no classes assigned` : ''}
          </span>
        )}
      </div>

      {loading && <Card><SkeletonRows rows={6} /></Card>}
      {!loading && rows.length === 0 && (
        <EmptyState title="No teaching staff" sub="Staff appear here once teacher accounts are created." />
      )}
      {!loading && rows.length > 0 && filtered.length === 0 && (
        <EmptyState title="No match" sub="No staff match your search or subject filter." />
      )}

      {paged.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Department / Subjects</th>
                <th>Assigned classes</th>
                <th>Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.profileId}>
                  <td className="cell-primary" data-label="Staff member">
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    {r.classTeacherOf.length > 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                        Class teacher · {r.classTeacherOf.join(', ')}
                      </div>
                    )}
                  </td>
                  <td data-label="Department / Subjects">
                    {r.subjects.length === 0
                      ? <span style={{ color: 'var(--text-faint)' }}>—</span>
                      : (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {r.subjects.map((s) => <Pill key={s} tone="blue">{s}</Pill>)}
                        </div>
                      )}
                  </td>
                  <td data-label="Assigned classes">
                    {r.sectionCount === 0 ? (
                      <span style={{ color: 'var(--amber)', fontSize: 12.5 }}>No classes assigned</span>
                    ) : (
                      <>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>
                          {r.sectionCount} section{r.sectionCount === 1 ? '' : 's'} assigned
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                          {formatGradeSections(r.classGroups)}
                        </div>
                      </>
                    )}
                  </td>
                  <td data-label="Contact">
                    {r.phone && (
                      <div style={{ fontSize: 12.5 }}>
                        <a href={`tel:${r.phone}`} style={{ color: 'var(--accent)' }}>{r.phone}</a>
                      </div>
                    )}
                    {r.email && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                        <a href={`mailto:${r.email}`} style={{ color: 'inherit' }}>{r.email}</a>
                      </div>
                    )}
                    {!r.phone && !r.email && <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                  <td data-label="Status">
                    <Pill tone={r.status === 'ACTIVE' ? 'green' : 'gray'}>{r.status.toLowerCase()}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={filtered.length}
            totalPages={totalPages}
            pageSizes={PAGE_SIZES}
            label="staff"
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </Card>
      )}
    </PortalShell>
  );
}
