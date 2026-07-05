'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Input, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { MedicalDto, StudentListItem } from '@/lib/types';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

interface EditState {
  bloodGroup: string;
  heightCm: string;
  weightKg: string;
  ecName: string;
  ecPhone: string;
  ecRelation: string;
  allergies: string;
  medications: string;
  history: string;
}

function recToEdit(rec: MedicalDto | null): EditState {
  return {
    bloodGroup: rec?.bloodGroup ?? '',
    heightCm: rec?.heightCm != null ? String(rec.heightCm) : '',
    weightKg: rec?.weightKg != null ? String(rec.weightKg) : '',
    ecName: rec?.emergencyContact?.name ?? '',
    ecPhone: rec?.emergencyContact?.phone ?? '',
    ecRelation: rec?.emergencyContact?.relation ?? '',
    allergies: rec?.allergies?.join(', ') ?? '',
    medications: rec?.medications?.join(', ') ?? '',
    history: rec?.history ?? '',
  };
}

export default function ParentMedical() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [rec, setRec] = useState<MedicalDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditState>(recToEdit(null));
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => setKids([])); }, []);

  const kid = kids?.[active];

  useEffect(() => {
    if (!kid) { setRec(null); setEditing(false); return; }
    setLoading(true); setEditing(false); setSaveOk(false); setSaveErr(null);
    api.medical(kid.id).then((r) => { setRec(r); setForm(recToEdit(r)); }).catch(() => { setRec(null); setForm(recToEdit(null)); }).finally(() => setLoading(false));
  }, [kid?.id]);

  const set = (field: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setSaveOk(false);
  };

  const save = async () => {
    if (!kid) return;
    setSaving(true); setSaveErr(null); setSaveOk(false);
    try {
      const body: Record<string, unknown> = { studentId: kid.id };
      if (form.bloodGroup) body.bloodGroup = form.bloodGroup;
      if (form.heightCm) body.heightCm = parseFloat(form.heightCm);
      if (form.weightKg) body.weightKg = parseFloat(form.weightKg);
      if (form.ecName || form.ecPhone || form.ecRelation) {
        body.emergencyContact = { name: form.ecName, phone: form.ecPhone, relation: form.ecRelation };
      }
      if (form.allergies.trim()) body.allergies = form.allergies.split(',').map((s) => s.trim()).filter(Boolean);
      if (form.medications.trim()) body.medications = form.medications.split(',').map((s) => s.trim()).filter(Boolean);
      if (form.history.trim()) body.history = form.history.trim();

      await api.saveMedical(body);

      // Reload from server to confirm persisted data.
      const fresh = await api.medical(kid.id);
      setRec(fresh);
      setForm(recToEdit(fresh));
      setSaveOk(true);
      setEditing(false);
    } catch (err: any) {
      setSaveErr(err?.message ?? 'Save failed. Please try again.');
    } finally { setSaving(false); }
  };

  const section = (title: string, body: React.ReactNode) => (
    <Card style={{ marginBottom: 12 }}>
      <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>{title}</strong>
      <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text-2)' }}>{body}</div>
    </Card>
  );
  const orEmpty = (v: React.ReactNode, empty: string) => v || <span style={{ color: 'var(--text-faint)' }}>{empty}</span>;

  return (
    <PortalShell expectedSlug="parent" topbar={{
      title: 'Medical Records',
      desc: kid ? `${kid.name} · health information` : 'Health information',
      actions: kid && !loading ? (
        editing
          ? <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="soft" small onClick={() => { setEditing(false); setForm(recToEdit(rec)); setSaveErr(null); }}>Cancel</Button>
              <Button small onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          : <Button small onClick={() => { setEditing(true); setSaveOk(false); setSaveErr(null); }}>Edit record</Button>
      ) : undefined,
    }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : '#fff', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {(kids === null || loading) && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your wards to this number." />}

      {saveErr && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13.5 }}>{saveErr}</div>}
      {saveOk && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, color: '#166534', fontSize: 13.5 }}>Medical record saved successfully.</div>}

      {!loading && kid && (
        editing ? (
          <>
            <Card style={{ marginBottom: 12 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Basic Info</strong>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Blood group</label>
                  <select className="input" value={form.bloodGroup} onChange={set('bloodGroup')} style={{ width: '100%' }}>
                    <option value="">—</option>
                    {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Height (cm)</label>
                  <Input type="number" min={0} max={300} step={0.1} value={form.heightCm} onChange={set('heightCm')} placeholder="e.g. 145" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Weight (kg)</label>
                  <Input type="number" min={0} max={300} step={0.1} value={form.weightKg} onChange={set('weightKg')} placeholder="e.g. 42" />
                </div>
              </div>
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Emergency Contact</strong>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Name</label>
                  <Input value={form.ecName} onChange={set('ecName')} placeholder="e.g. Ravi Kumar" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Phone</label>
                  <Input type="tel" value={form.ecPhone} onChange={set('ecPhone')} placeholder="+91 98765 43210" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Relation</label>
                  <Input value={form.ecRelation} onChange={set('ecRelation')} placeholder="e.g. Father" />
                </div>
              </div>
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Allergies</strong>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>Separate multiple entries with commas</div>
              <Input value={form.allergies} onChange={set('allergies')} placeholder="e.g. Peanuts, Penicillin, Dust" />
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Regular Medications</strong>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>Separate multiple entries with commas</div>
              <Input value={form.medications} onChange={set('medications')} placeholder="e.g. Cetirizine, Vitamin D" />
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Medical History</strong>
              <div style={{ marginTop: 10 }}>
                <textarea
                  className="input"
                  rows={4}
                  value={form.history}
                  onChange={set('history')}
                  placeholder="Any past surgeries, chronic conditions, or relevant history…"
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13.5 }}
                />
              </div>
            </Card>
          </>
        ) : (
          rec && (
            <>
              {section('Basic Info', (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <div><div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Blood group</div>{orEmpty(rec.bloodGroup, 'Not recorded')}</div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Height</div>{orEmpty(rec.heightCm ? `${rec.heightCm} cm` : null, 'Not recorded')}</div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Weight</div>{orEmpty(rec.weightKg ? `${rec.weightKg} kg` : null, 'Not recorded')}</div>
                </div>
              ))}
              {section('Emergency Contact', rec.emergencyContact
                ? `${rec.emergencyContact.name} (${rec.emergencyContact.relation}) · ${rec.emergencyContact.phone}`
                : orEmpty(null, 'None recorded'))}
              {section('Allergies', rec.allergies.length ? rec.allergies.join(', ') : orEmpty(null, 'None recorded'))}
              {section('Regular Medications', rec.medications.length ? rec.medications.join(', ') : orEmpty(null, 'None recorded'))}
              {section('Medical History', orEmpty(rec.history, 'None recorded'))}
            </>
          )
        )
      )}
    </PortalShell>
  );
}
