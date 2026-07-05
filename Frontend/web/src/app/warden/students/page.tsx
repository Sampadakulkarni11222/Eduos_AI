'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

interface HostelStudent {
  id: string;
  name: string;
  roomNo: string;
  block: string;
  class: string;
}

export default function WardenStudents() {
  const router = useRouter();
  const [students, setStudents] = useState<HostelStudent[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all students to cross-reference class details
    api.students().then((res) => {
      const studentMap = new Map<string, StudentListItem>(res.items.map((s) => [s.id, s]));

      // Read rooms allocations from localStorage
      const saved = localStorage.getItem('eduos.warden.rooms');
      const list: HostelStudent[] = [];
      if (saved) {
        try {
          const rooms = JSON.parse(saved);
          rooms.forEach((r: any) => {
            r.students.forEach((st: any) => {
              const matched = studentMap.get(st.id);
              list.push({
                id: st.id,
                name: st.name,
                roomNo: r.roomNo,
                block: r.block,
                class: matched?.enrollment?.class ?? 'No Class',
              });
            });
          });
        } catch {}
      }
      setStudents(list);
      setLoading(false);
    }).catch(() => {
      setStudents([]);
      setLoading(false);
    });
  }, []);

  const filtered = students.filter((s) =>
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
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={5} /></div>}
        {!loading && filtered.length === 0 && (
          <EmptyState title="No students found" sub={search ? `Nothing matches "${search}".` : "No student allocations registered yet. Head to Room Management to assign beds."} />
        )}
        {!loading && filtered.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Student Name</th>
                <th>Academic Class</th>
                <th>Hostel Block</th>
                <th>Room Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="cell-primary">{s.name}</td>
                  <td>{s.class}</td>
                  <td>{s.block}</td>
                  <td>
                    <strong>Room {s.roomNo}</strong>
                  </td>
                  <td>
                    <Pill tone="green">In Residence</Pill>
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
