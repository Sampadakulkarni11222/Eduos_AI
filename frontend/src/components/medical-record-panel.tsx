'use client';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Input, SkeletonRows } from '@/components/ui';
import { ConfirmModal } from '@/components/confirm-modal';
import { FileOrUrlInput } from '@/components/file-input';
import { api, fileHref, ApiError } from '@/lib/api';
import type { MedicalDto } from '@/lib/types';

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
  attachments: Array<{ name: string; fileUrl: string }>;
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
    attachments: rec?.attachments ?? [],
  };
}

/**
 * Shared medical-record viewer/editor for a single student, used by the
 * parent portal (their own children, full CRUD) and the admin portal (any
 * student, full CRUD). Read-only viewing for roles without manage rights
 * (e.g. teacher, warden) is handled by those pages calling GET /medical
 * directly — this component is only mounted where canManage is meaningful.
 */
export function MedicalRecordPanel({ studentId, canManage = true }: { studentId: string | undefined; canManage?: boolean }) {
  const [rec, setRec] = useState<MedicalDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditState>(recToEdit(null));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!studentId) { setRec(null); setEditing(false); return; }
    setLoading(true); setEditing(false); setSuccessMsg(''); setSaveErr(null); setNotFound(false);
    api.medical(studentId)
      .then((r) => { setRec(r); setForm(recToEdit(r)); })
      .catch((e) => { setRec(null); setForm(recToEdit(null)); setNotFound(!(e instanceof ApiError) || e.status === 404); })
      .finally(() => setLoading(false));
  }, [studentId]);

  const set = (field: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setSuccessMsg('');
  };

  const save = async () => {
    if (!studentId) return;

    if (form.heightCm && (isNaN(parseFloat(form.heightCm)) || parseFloat(form.heightCm) <= 0 || parseFloat(form.heightCm) > 300)) {
      setSaveErr('Height must be a positive number between 0 and 300 cm');
      return;
    }
    if (form.weightKg && (isNaN(parseFloat(form.weightKg)) || parseFloat(form.weightKg) <= 0 || parseFloat(form.weightKg) > 300)) {
      setSaveErr('Weight must be a positive number between 0 and 300 kg');
      return;
    }
    if (form.ecPhone && !/^\+?[0-9\s\-()]{7,20}$/.test(form.ecPhone)) {
      setSaveErr('Invalid emergency contact phone number');
      return;
    }
    if ((form.ecName || form.ecPhone || form.ecRelation) && (!form.ecName || !form.ecPhone || !form.ecRelation)) {
      setSaveErr('All emergency contact fields (Name, Phone, Relation) must be filled if any are provided.');
      return;
    }

    setSaving(true); setSaveErr(null); setSuccessMsg('');
    try {
      const body: Record<string, unknown> = { studentId };
      body.bloodGroup = form.bloodGroup || null;
      body.heightCm = form.heightCm ? parseFloat(form.heightCm) : null;
      body.weightKg = form.weightKg ? parseFloat(form.weightKg) : null;
      body.emergencyContact = (form.ecName || form.ecPhone || form.ecRelation)
        ? { name: form.ecName, phone: form.ecPhone, relation: form.ecRelation }
        : null;
      body.allergies = form.allergies.trim() ? form.allergies.split(',').map((s) => s.trim()).filter(Boolean) : [];
      body.medications = form.medications.trim() ? form.medications.split(',').map((s) => s.trim()).filter(Boolean) : [];
      body.history = form.history.trim() || null;
      body.attachments = form.attachments;

      await api.saveMedical(studentId, body);

      const fresh = await api.medical(studentId);
      setRec(fresh);
      setForm(recToEdit(fresh));
      setNotFound(false);
      setSuccessMsg('Medical record saved successfully.');
      setEditing(false);
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : 'Save failed. Please try again.');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!studentId || !rec) return;
    setDeleting(true); setSaveErr(null); setSuccessMsg('');
    try {
      await api.deleteMedical(studentId);
      setRec(null);
      setForm(recToEdit(null));
      setNotFound(true);
      setSuccessMsg('Medical record deleted successfully.');
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : 'Delete failed. Please try again.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const section = (title: string, body: React.ReactNode) => (
    <Card style={{ marginBottom: 12 }}>
      <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>{title}</strong>
      <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text-2)' }}>{body}</div>
    </Card>
  );
  const orEmpty = (v: React.ReactNode, empty: string) => v || <span style={{ color: 'var(--text-faint)' }}>{empty}</span>;

  if (!studentId) return null;
  if (loading) return <Card><SkeletonRows rows={4} /></Card>;

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          {editing ? (
            <>
              <Button variant="soft" small onClick={() => { setEditing(false); setForm(recToEdit(rec)); setSaveErr(null); }}>Cancel</Button>
              <Button small onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </>
          ) : (
            <>
              {rec && <Button variant="soft" small onClick={() => setConfirmDelete(true)} disabled={deleting} style={{ color: 'var(--red)' }}>Delete record</Button>}
              <Button small onClick={() => { setEditing(true); setSuccessMsg(''); setSaveErr(null); }}>{rec ? 'Edit record' : 'Setup record'}</Button>
            </>
          )}
        </div>
      )}

      {saveErr && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13.5 }}>{saveErr}</div>}
      {successMsg && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, color: '#166534', fontSize: 13.5 }}>{successMsg}</div>}

      {editing ? (
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
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Medical Documents &amp; Reports</strong>
            <div style={{ marginTop: 12 }}>
              {form.attachments.map((file, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '8px 12px', background: 'var(--surface-2, #f7f3ea)', borderRadius: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{file.name}</span>
                  <Button variant="ghost" small onClick={() => {
                    setForm((f) => ({ ...f, attachments: f.attachments.filter((_, i) => i !== idx) }));
                  }} style={{ color: 'var(--red)', padding: 0 }}>Remove</Button>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Upload a report / file</label>
                <FileOrUrlInput
                  value={{ fileUrl: '' }}
                  onChange={(v) => {
                    if (v.fileUrl) {
                      setForm((f) => ({
                        ...f,
                        attachments: [...f.attachments, { name: v.filename || 'Uploaded Document', fileUrl: v.fileUrl }],
                      }));
                    }
                  }}
                />
              </div>
            </div>
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
      ) : rec ? (
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
          {section('Medical Documents / Reports', rec.attachments && rec.attachments.length > 0 ? (
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              {rec.attachments.map((file, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  <a href={fileHref(file.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 500 }}>
                    {file.name || 'View document'}
                  </a>
                </li>
              ))}
            </ul>
          ) : orEmpty(null, 'None recorded'))}
        </>
      ) : (
        <EmptyState
          icon="✚"
          title="No medical record setup yet"
          sub={canManage ? "Click 'Setup record' above to create a medical profile." : notFound ? 'No medical record has been created for this student yet.' : 'Could not load this medical record.'}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete medical record?"
          body="This will permanently remove all medical data for this student — emergency contacts, allergies, medications, and history. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
