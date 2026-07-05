'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { AssignmentDto, OfferingDto } from '@/lib/types';

export default function AssignmentsPage() {
  const [items, setItems] = useState<AssignmentDto[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[]>([]);
  const [showForm, setShowForm] = useState(false);

  const reload = () => api.assignments().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); api.myOfferings().then(setOfferings).catch(() => {}); }, []);

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Assignments', desc: 'Homework, projects and worksheets for your classes.',
      actions: <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New assignment'}</Button>,
    }}>
      {showForm && <NewAssignment offerings={offerings} onCreated={() => { setShowForm(false); void reload(); }} />}
      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && <EmptyState title="No assignments yet" sub="Create your first assignment — submissions are seeded for every student in the section." />}
      {items && items.length > 0 && (
        <Card pad={false}>
          <table className="data-table">
            <thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Due</th><th>Type</th><th>Students</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="cell-primary">{a.title}</td>
                  <td>{a.class}</td>
                  <td>{a.subject}</td>
                  <td>{fmtDue(a.dueAt)}</td>
                  <td><Pill tone="blue">{a.type.toLowerCase()}</Pill></td>
                  <td>{a.submissionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}

function NewAssignment({ offerings, onCreated }: { offerings: OfferingDto[]; onCreated: () => void }) {
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('HOMEWORK');
  const [dueAt, setDueAt] = useState('');
  const [maxMarks, setMaxMarks] = useState('20');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!offeringId && offerings[0]) setOfferingId(offerings[0].id); }, [offerings, offeringId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.createAssignment({
        subjectOfferingId: offeringId, title, type,
        dueAt: new Date(dueAt).toISOString(), maxMarks: maxMarks ? parseInt(maxMarks, 10) : undefined,
      });
      onCreated();
    } catch { setErr('Could not create. Check the fields and try again.'); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.7fr', gap: 12 }}>
          <div>
            <div className="field-label">Title</div>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Algebra worksheet" />
          </div>
          <div>
            <div className="field-label">Class &amp; subject</div>
            <select className="field-input" value={offeringId} onChange={(e) => setOfferingId(e.target.value)} required>
              {offerings.map((o) => <option key={o.id} value={o.id}>{o.sectionName} · {o.subject}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Due</div>
            <input className="field-input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
          </div>
          <div>
            <div className="field-label">Max marks</div>
            <input className="field-input" type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
          </div>
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy || !offeringId}>{busy ? 'Creating…' : 'Create assignment'}</Button>
      </form>
    </Card>
  );
}

function fmtDue(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}
