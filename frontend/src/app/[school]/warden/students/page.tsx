'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { HostelAllocationDto, StudentListItem } from '@/lib/types';

interface HostelStudentRow {
  allocationId: string;
  studentId: string;
  name: string;
  roomNo: string;
  block: string;
  class: string;
  admissionNo: string;
}

export default function WardenStudents() {
  const [rows, setRows] = useState<HostelStudentRow[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([api.hostelStudents(), api.students().catch(() => ({ items: [] as StudentListItem[] }))])
      .then(([allocations, studentsRes]) => {
        const classMap = new Map(studentsRes.items.map((s) => [s.id, s.enrollment?.class ?? 'No Class']));
        setRows(
          (allocations as HostelAllocationDto[])
            .filter((a) => a.status === 'ACTIVE' && a.studentId)
            .map((a) => ({
              allocationId: a._id,
              studentId: a.studentId!._id,
              name: `${a.studentId!.firstName} ${a.studentId!.lastName ?? ''}`.trim(),
              roomNo: a.roomId?.roomNo ?? '—',
              block: a.roomId?.block ?? '—',
              class: classMap.get(a.studentId!._id) ?? 'No Class',
              admissionNo: a.studentId!.admissionNo,
            }))
        );
      })
      .catch(() => setRows([]));
  }, []);

  const filtered = (rows ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.roomNo.toLowerCase().includes(search.toLowerCase()) ||
    s.block.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Hostel Students', desc: 'Directory of all students currently allocated to hostel blocks.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search student name, room, block..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card pad={false}>
        {rows === null && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {rows !== null && filtered.length === 0 && (
          <EmptyState title="No students found" sub={search ? `Nothing matches "${search}".` : 'No student allocations registered yet. Head to Room Management to assign beds.'} />
        )}
        {rows !== null && filtered.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student Name</th>
                <th>Admission No.</th>
                <th>Academic Class</th>
                <th>Hostel Block</th>
                <th>Room Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.allocationId}>
                  <td className="cell-primary" data-label="Student Name">{s.name}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Admission No.">{s.admissionNo}</td>
                  <td data-label="Academic Class">{s.class}</td>
                  <td data-label="Hostel Block">{s.block}</td>
                  <td data-label="Room Number"><strong>Room {s.roomNo}</strong></td>
                  <td data-label="Status"><Pill tone="green">In Residence</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
