'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { StudentListItem } from '@/lib/types';

interface Room {
  id: string;
  roomNo: string;
  block: string;
  capacity: number;
  type: 'AC' | 'NON_AC';
  students: { id: string; name: string }[];
}

const DEFAULT_ROOMS: Room[] = [
  { id: 'r1', roomNo: '101', block: 'Block A', capacity: 2, type: 'AC', students: [] },
  { id: 'r2', roomNo: '102', block: 'Block A', capacity: 2, type: 'AC', students: [] },
  { id: 'r3', roomNo: '201', block: 'Block B', capacity: 4, type: 'NON_AC', students: [] },
  { id: 'r4', roomNo: '202', block: 'Block B', capacity: 4, type: 'NON_AC', students: [] },
];

export default function WardenRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [searchBlock, setSearchBlock] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [newRoom, setNewRoom] = useState({ roomNo: '', block: 'Block A', capacity: 2, type: 'AC' as const });

  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [allocateForm, setAllocateForm] = useState({ studentId: '', roomId: '' });

  useEffect(() => {
    // Load rooms from localStorage or set defaults
    const saved = localStorage.getItem('eduos.warden.rooms');
    if (saved) {
      try {
        setRooms(JSON.parse(saved));
      } catch {
        setRooms(DEFAULT_ROOMS);
      }
    } else {
      setRooms(DEFAULT_ROOMS);
      localStorage.setItem('eduos.warden.rooms', JSON.stringify(DEFAULT_ROOMS));
    }
    setLoading(false);

    // Fetch students list
    api.students()
      .then((r) => setStudents(r.items))
      .catch(() => setStudents([]));
  }, []);

  const saveRooms = (updated: Room[]) => {
    setRooms(updated);
    localStorage.setItem('eduos.warden.rooms', JSON.stringify(updated));
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoom.roomNo) return;
    const room: Room = {
      id: 'room_' + Date.now(),
      roomNo: newRoom.roomNo,
      block: newRoom.block,
      capacity: newRoom.capacity,
      type: newRoom.type,
      students: [],
    };
    const updated = [...rooms, room];
    saveRooms(updated);
    setShowRoomModal(false);
    setNewRoom({ roomNo: '', block: 'Block A', capacity: 2, type: 'AC' });
  };

  const handleAllocate = (e: React.FormEvent) => {
    e.preventDefault();
    const { studentId, roomId } = allocateForm;
    if (!studentId || !roomId) return;

    // Find student details
    const student = students?.find((s) => s.id === studentId);
    if (!student) return;

    // Check if student is already allocated somewhere
    const alreadyAllocated = rooms.some((r) => r.students.some((s) => s.id === studentId));
    if (alreadyAllocated) {
      alert('This student is already allocated to a room.');
      return;
    }

    const updated = rooms.map((r) => {
      if (r.id === roomId) {
        if (r.students.length >= r.capacity) {
          alert('Room is already at full capacity.');
          return r;
        }
        return {
          ...r,
          students: [...r.students, { id: student.id, name: student.name }],
        };
      }
      return r;
    });

    saveRooms(updated);
    setShowAllocateModal(false);
    setAllocateForm({ studentId: '', roomId: '' });
  };

  const handleDeallocate = (roomId: string, studentId: string) => {
    if (!confirm('Are you sure you want to remove this student from the room?')) return;
    const updated = rooms.map((r) => {
      if (r.id === roomId) {
        return {
          ...r,
          students: r.students.filter((s) => s.id !== studentId),
        };
      }
      return r;
    });
    saveRooms(updated);
  };

  const filteredRooms = rooms.filter((r) =>
    r.block.toLowerCase().includes(searchBlock.toLowerCase()) ||
    r.roomNo.toLowerCase().includes(searchBlock.toLowerCase())
  );

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Room Management', desc: 'Hostel room allocations and layouts.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" style={{ maxWidth: 300 }} placeholder="Search Room or Block..." value={searchBlock} onChange={(e) => setSearchBlock(e.target.value)} />
          <Button variant="soft" onClick={() => {
            const allAvailable = rooms.map(r => ({...r, students: []}));
            saveRooms(allAvailable);
          }}>Clear All Allocations</Button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="soft" onClick={() => setShowAllocateModal(true)}>Allocate Student</Button>
          <Button onClick={() => setShowRoomModal(true)}>Add Room</Button>
        </div>
      </div>

      <Card pad={false}>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {!loading && filteredRooms.length === 0 && (
          <EmptyState title="No rooms found" sub="Refine your search or register a new room." />
        )}
        {!loading && filteredRooms.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Room / Block</th>
                <th>Bed Type</th>
                <th>Occupancy</th>
                <th>Occupants</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((r) => {
                const pct = (r.students.length / r.capacity) * 100;
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="cell-primary">Room {r.roomNo}</span>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.block}</div>
                    </td>
                    <td>
                      <Pill tone={r.type === 'AC' ? 'blue' : 'gray'}>{r.type}</Pill>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{r.students.length} / {r.capacity}</span>
                        <div style={{ width: 60, height: 6, background: '#ECE7DB', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--red)' : 'var(--green)' }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      {r.students.length === 0 && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>— Vacant —</span>}
                      {r.students.map((st) => (
                        <div key={st.id} style={{ display: 'inline-flex', alignItems: 'center', background: '#F3ECDC', padding: '2px 8px', borderRadius: 4, marginRight: 6, marginBottom: 4, fontSize: 12 }}>
                          {st.name}
                          <button onClick={() => handleDeallocate(r.id, st.id)} style={{ border: 'none', background: 'none', marginLeft: 6, cursor: 'pointer', color: 'var(--red)', fontWeight: 'bold' }}>×</button>
                        </div>
                      ))}
                    </td>
                    <td>
                      <Button variant="soft" small disabled={r.students.length >= r.capacity} onClick={() => {
                        setAllocateForm({ ...allocateForm, roomId: r.id });
                        setShowAllocateModal(true);
                      }}>Allocate</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Add Room Modal */}
      {showRoomModal && (
        <div className="modal-overlay" onClick={() => setShowRoomModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Hostel Room</div>
              <button className="modal-close" onClick={() => setShowRoomModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateRoom}>
              <div className="field-label">Room Number *</div>
              <input className="field-input" required value={newRoom.roomNo} onChange={(e) => setNewRoom({ ...newRoom, roomNo: e.target.value })} placeholder="e.g. 104" />

              <div className="field-label">Block / Wing *</div>
              <select className="field-input" value={newRoom.block} onChange={(e) => setNewRoom({ ...newRoom, block: e.target.value })}>
                <option value="Block A">Block A</option>
                <option value="Block B">Block B</option>
                <option value="Girls Hostel">Girls Hostel</option>
                <option value="Boys Hostel">Boys Hostel</option>
              </select>

              <div className="field-label">Capacity (Beds)</div>
              <input className="field-input" type="number" required min={1} value={newRoom.capacity} onChange={(e) => setNewRoom({ ...newRoom, capacity: Number(e.target.value) })} />

              <div className="field-label">Bed Type</div>
              <select className="field-input" value={newRoom.type} onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value as any })}>
                <option value="AC">Air Conditioned (AC)</option>
                <option value="NON_AC">Non-AC</option>
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Room</Button>
                <Button variant="ghost" type="button" onClick={() => setShowRoomModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Allocate Student Modal */}
      {showAllocateModal && (
        <div className="modal-overlay" onClick={() => setShowAllocateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Allocate Student to Room</div>
              <button className="modal-close" onClick={() => setShowAllocateModal(false)}>×</button>
            </div>
            <form onSubmit={handleAllocate}>
              <div className="field-label">Select Student *</div>
              <select className="field-input" required value={allocateForm.studentId} onChange={(e) => setAllocateForm({ ...allocateForm, studentId: e.target.value })}>
                <option value="">-- Choose Student --</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.enrollment?.class ?? 'No Class'})</option>
                ))}
              </select>

              <div className="field-label">Select Room *</div>
              <select className="field-input" required value={allocateForm.roomId} onChange={(e) => setAllocateForm({ ...allocateForm, roomId: e.target.value })}>
                <option value="">-- Choose Room --</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.students.length >= r.capacity}>{r.roomNo} ({r.block}) — {r.capacity - r.students.length} beds left</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <Button type="submit">Allocate Student</Button>
                <Button variant="ghost" type="button" onClick={() => setShowAllocateModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
