'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';

/**
 * Shown under a "safety" reply from the study buddy. The AI only noticed that
 * the message sounded like danger, abuse or self-harm; it files nothing on its
 * own. Here the student can choose, in two taps, to tell the school's
 * safeguarding team. Nothing is sent unless they press "Send to the safeguarding team".
 * Their typed words go only to the designated officers (encrypted); the officers'
 * alert says nothing about what was written.
 */
export function SafetyHelp() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [urgent, setUrgent] = useState<'IMMEDIATE_DANGER' | 'URGENT'>('URGENT');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ refNo: string; officersNotified: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p style={{ marginTop: 10, fontSize: 13.5 }} role="status">
        Sent. Your reference is <strong>{done.refNo}</strong>. {done.officersNotified > 0
          ? 'A trusted adult on the school safeguarding team has been told and will reach out to you.'
          : 'Please also tell your class teacher or another adult you trust today.'} If you are in danger right now, call 112.
      </p>
    );
  }
  if (!open) {
    return (
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button small onClick={() => setOpen(true)}>Tell someone at school</Button>
        <span style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>Only the school&apos;s safeguarding team will see it. In danger right now: call 112. Childline: 1098.</span>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
      <label style={{ fontSize: 13 }}>
        In your own words (you can keep it short)
        <textarea className="input" rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <label><input type="radio" checked={urgent === 'IMMEDIATE_DANGER'} onChange={() => setUrgent('IMMEDIATE_DANGER')} /> I am not safe right now</label>
        <label><input type="radio" checked={urgent === 'URGENT'} onChange={() => setUrgent('URGENT')} /> I want to talk to someone soon</label>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button small disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            const out = await opsApi.reportConcern({ category: 'OTHER', urgency: urgent, description: text.trim() || 'A student asked for help through Study Help and would like a trusted adult to reach out.' });
            setDone(out);
          } catch (e) { setError(e instanceof Error ? e.message : 'Could not send. Please tell your class teacher.'); } finally { setBusy(false); }
        }}>Send to the safeguarding team</Button>
        <Button small variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
      </div>
    </div>
  );
}
