'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { HostelAllocationDto, HostelRoomDto, StudentListItem } from '@/lib/types';

export default function WardenRooms() {
  const [rooms, setRooms] = useState<HostelRoomDto[] | null>(null);
  const [allocations, setAllocations] = useState<HostelAllocationDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [searchBlock, setSearchBlock] = useState('');
  const [err, setErr] = useState(false);
  const toast = useToast();

  // Modals state
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [newRoom, setNewRoom] = useState({ roomNo: '', block: 'Block A', capacity: 2, type: 'AC' });
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [allocateForm, setAllocateForm] = useState({ studentId: '', roomId: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    Promise.all([api.hostelRooms(), api.hostelAllocations()])
      .then(([r, a]) => { setRooms(r); setAllocations(a); setErr(false); })
      .catch(() => { setRooms([]); setAllocations([]); setErr(true); });
  };

  useEffect(() => {
    load();
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const occupantsOf = (roomId: string) =>
    (allocations ?? []).filter((a) => a.status === 'ACTIVE' && a.roomId?._id === roomId);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoom.roomNo) return;
    setBusy(true);
    try {
      await api.createHostelRoom(newRoom);
      toast(`Room ${newRoom.roomNo} added.`);
      setShowRoomModal(false);
      setNewRoom({ roomNo: '', block: 'Block A', capacity: 2, type: 'AC' });
      load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Could not create the room.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { studentId, roomId } = allocateForm;
    if (!studentId || !roomId) return;
    setBusy(true);
    try {
      await api.allocateHostelRoom({ roomId, studentId });
      toast('Student allocated to the room.');
      setShowAllocateModal(false);
      setAllocateForm({ studentId: '', roomId: '' });
      load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Could not allocate the student.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleVacate = async (allocation: HostelAllocationDto) => {
    const name = allocation.studentId ? `${allocation.studentId.firstName} ${allocation.studentId.lastName ?? ''}`.trim() : 'this student';
    if (!confirm(`Remove ${name} from the room?`)) return;
    try {
      await api.vacateHostelRoom(allocation._id);
      toast(`${name} vacated.`);
      load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Could not vacate the allocation.', 'error');
    }
  };

  const filteredRooms = (rooms ?? []).filter((r) =>
    r.block.toLowerCase().includes(searchBlock.toLowerCase()) ||
    r.roomNo.toLowerCase().includes(searchBlock.toLowerCase())
  );

  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Room Management', desc: 'Hostel room allocations and layouts.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search Room or Block..." value={searchBlock} onChange={(e) => setSearchBlock(e.target.value)} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="soft" onClick={() => setShowAllocateModal(true)}>Allocate Student</Button>
          <Button onClick={() => setShowRoomModal(true)}>Add Room</Button>
        </div>
      </div>

      <Card pad={false}>
        {rooms === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
        {err && rooms !== null && (
          <EmptyState title="Couldn't load rooms" sub="The server didn't respond. Reload the page to try again." />
        )}
        {!err && rooms !== null && filteredRooms.length === 0 && (
          <EmptyState title="No rooms found" sub={rooms.length === 0 ? 'Add your first hostel room to get started.' : 'Refine your search or register a new room.'} />
        )}
        {rooms !== null && filteredRooms.length > 0 && (
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
                const occupants = occupantsOf(r._id);
                const pct = r.capacity > 0 ? (occupants.length / r.capacity) * 100 : 0;
                return (
                  <tr key={r._id}>
                    <td>
                      <span className="cell-primary">Room {r.roomNo}</span>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.block}</div>
                    </td>
                    <td>
                      <Pill tone={r.type === 'AC' ? 'blue' : 'gray'}>{r.type}</Pill>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{occupants.length} / {r.capacity}</span>
                        <div style={{ width: 60, height: 6, background: '#ECE7DB', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? 'var(--red)' : 'var(--green)' }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      {occupants.length === 0 && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>— Vacant —</span>}
                      {occupants.map((a) => (
                        <div key={a._id} style={{ display: 'inline-flex', alignItems: 'center', background: '#F3ECDC', padding: '2px 8px', borderRadius: 4, marginRight: 6, marginBottom: 4, fontSize: 12 }}>
                          {a.studentId ? `${a.studentId.firstName} ${a.studentId.lastName ?? ''}`.trim() : 'Unknown'}
                          <button onClick={() => void handleVacate(a)} title="Vacate" style={{ border: 'none', background: 'none', marginLeft: 6, cursor: 'pointer', color: 'var(--red)', fontWeight: 'bold' }}>×</button>
                        </div>
                      ))}
                    </td>
                    <td>
                      <Button variant="soft" small disabled={occupants.length >= r.capacity} onClick={() => {
                        setAllocateForm({ ...allocateForm, roomId: r._id });
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
              <select className="field-input" value={newRoom.type} onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value })}>
                <option value="AC">Air Conditioned (AC)</option>
                <option value="NON_AC">Non-AC</option>
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add Room'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowRoomModal(false)} disabled={busy}>Cancel</Button>
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
                {(rooms ?? []).map((r) => {
                  const left = r.capacity - occupantsOf(r._id).length;
                  return (
                    <option key={r._id} value={r._id} disabled={left <= 0}>
                      {r.roomNo} ({r.block}) — {left} bed{left === 1 ? '' : 's'} left
                    </option>
                  );
                })}
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <Button type="submit" disabled={busy}>{busy ? 'Allocating…' : 'Allocate Student'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowAllocateModal(false)} disabled={busy}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
