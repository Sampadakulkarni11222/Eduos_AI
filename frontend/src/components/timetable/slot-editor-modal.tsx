'use client';
import { useState } from 'react';
import { Button, useToast } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { OfferingDto, TimetableSlotDto } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SlotEditorModal({
  sectionId, sectionOfferings, initialDayOfWeek, initialPeriodNo,
  initialStartTime, initialEndTime, existing, onClose, onSaved,
}: {
  sectionId: string;
  sectionOfferings: OfferingDto[];
  initialDayOfWeek: number;
  initialPeriodNo: number;
  /** Where in the day the user clicked, for a new slot. Falls back to 09:00. */
  initialStartTime?: string;
  initialEndTime?: string;
  existing?: TimetableSlotDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dayOfWeek, setDayOfWeek] = useState(initialDayOfWeek);
  const [periodNo, setPeriodNo] = useState(initialPeriodNo);
  const [startTime, setStartTime] = useState(existing?.startTime ?? initialStartTime ?? '09:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? initialEndTime ?? '09:45');
  const [subjectOfferingId, setSubjectOfferingId] = useState(existing?.subjectOfferingId ?? '');
  const [room, setRoom] = useState(existing?.room ?? '');
  const [liveClassLink, setLiveClassLink] = useState(existing?.liveClassLink ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.upsertTimetableSlot({
        sectionId,
        dayOfWeek,
        periodNo,
        startTime,
        endTime,
        subjectOfferingId: subjectOfferingId || null,
        room: room.trim() || null,
        liveClassLink: liveClassLink.trim() || null,
      });
      onSaved();
    } catch (err: unknown) {
      toast(errorMessage(err, 'Could not save the timetable slot.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Configure Timetable Slot</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="field-label">Day of Week *</div>
          <select className="field-input" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DAYS.map((name, index) => (
              <option key={index} value={index + 1}>{name}</option>
            ))}
          </select>

          <div className="field-label">Period Number (1 - 12) *</div>
          <input className="field-input" type="number" required min={1} max={12} value={periodNo} onChange={(e) => setPeriodNo(Number(e.target.value))} />

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">Start Time (HH:MM) *</div>
              <input className="field-input" type="text" required pattern="^\\d{2}:\\d{2}$" placeholder="09:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">End Time (HH:MM) *</div>
              <input className="field-input" type="text" required pattern="^\\d{2}:\\d{2}$" placeholder="09:45" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="field-label">Subject Offering (Select blank for Break)</div>
          <select className="field-input" value={subjectOfferingId} onChange={(e) => setSubjectOfferingId(e.target.value)}>
            <option value="">-- Mark as Break / Free Period --</option>
            {sectionOfferings.map((o) => (
              <option key={o.id} value={o.id}>{o.subject}</option>
            ))}
          </select>

          <div className="field-label">Room Number</div>
          <input className="field-input" type="text" placeholder="e.g. Room 204" value={room} onChange={(e) => setRoom(e.target.value)} />

          <div className="field-label">Live Class Link (optional)</div>
          <input className="field-input" type="url" placeholder="https://meet.google.com/..." value={liveClassLink} onChange={(e) => setLiveClassLink(e.target.value)} />

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Slot'}</Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
