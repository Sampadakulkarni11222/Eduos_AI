'use client';
import { useState } from 'react';
import { Button, Pill, useToast } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { OfferingDto } from '@/lib/types';

/**
 * Inline elective controls for one subject offering.
 *
 * `isElective` and `capacity` decide what students see on /student/subjects,
 * but until now they were reachable only by creating the offering with them or
 * re-seeding the database — so the registration feature could not be operated
 * by the staff it was built for.
 */
export function ElectiveControls({ offering, onChanged }: { offering: OfferingDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editingCap, setEditingCap] = useState(false);
  const [cap, setCap] = useState(offering.capacity == null ? '' : String(offering.capacity));
  const toast = useToast();

  const save = async (body: { isElective?: boolean; capacity?: number | null }, okMsg: string) => {
    setBusy(true);
    try {
      await api.updateOffering(offering.id, body);
      toast(okMsg, 'success');
      setEditingCap(false);
      onChanged();
    } catch (err: unknown) {
      // The server explains a refused capacity change precisely (how many seats
      // are already taken), so its message beats anything generic here.
      toast(errorMessage(err, 'Could not update the offering.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => save(
    { isElective: !offering.isElective },
    offering.isElective ? 'No longer an elective.' : 'Marked as an elective — students can now register.',
  );

  const saveCap = () => {
    const trimmed = cap.trim();
    if (trimmed === '') return save({ capacity: null }, 'Seat limit removed.');
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1) {
      toast('Enter a whole number of seats, or leave it empty for unlimited.', 'error');
      return;
    }
    return save({ capacity: n }, `Seat limit set to ${n}.`);
  };

  if (!offering.isElective) {
    return (
      <Button variant="ghost" small disabled={busy} onClick={toggle}>
        {busy ? '…' : 'Make elective'}
      </Button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Pill tone="blue">Elective</Pill>

      {editingCap ? (
        <>
          <input
            className="field-input"
            style={{ width: 90 }}
            type="number"
            min={1}
            value={cap}
            placeholder="∞"
            aria-label={`Seat limit for ${offering.subject}`}
            onChange={(e) => setCap(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveCap(); }}
          />
          <Button small disabled={busy} onClick={saveCap}>{busy ? '…' : 'Save'}</Button>
          <Button variant="ghost" small onClick={() => { setEditingCap(false); setCap(offering.capacity == null ? '' : String(offering.capacity)); }}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="ghost" small onClick={() => setEditingCap(true)}>
          {offering.capacity == null ? 'No seat limit' : `${offering.capacity} seats`}
        </Button>
      )}

      <Button variant="ghost" small disabled={busy} onClick={toggle}>Remove</Button>
    </div>
  );
}
