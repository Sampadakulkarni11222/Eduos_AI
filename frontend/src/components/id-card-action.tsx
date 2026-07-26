'use client';
import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/**
 * Self-contained "ID Card" action card, shared by the student and parent
 * Documents pages. Always generates the card live from current student/
 * enrollment data (GET /students/:id/id-card) instead of trusting any
 * stored Document row — that's what let a stray manually-pasted external
 * URL masquerade as an "ID Card" before.
 */
export function IdCardPanel({ studentId }: { studentId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (!studentId) return;
    setBusy(true);
    setError(null);
    try {
      await api.openIdCard(studentId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open the ID card. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>🪪 Student ID Card</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 2 }}>
          {error ?? 'Generated fresh from your current enrollment details.'}
        </div>
      </div>
      <Button variant="soft" onClick={open} disabled={busy || !studentId}>
        {busy ? 'Preparing…' : 'View / Download ID Card'}
      </Button>
    </Card>
  );
}
