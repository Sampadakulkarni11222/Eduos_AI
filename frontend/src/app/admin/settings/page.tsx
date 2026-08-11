'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { SchoolSettingsDto } from '@/lib/types';

export default function AdminSettings() {
  const [settings, setSettings] = useState<SchoolSettingsDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Editable form state
  const [schoolName, setSchoolName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [currentAcademicYearId, setCurrentAcademicYearId] = useState('');

  const load = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setSchoolName(s.schoolName ?? '');
      setAddress(s.address ?? '');
      setPhone(s.phone ?? '');
      setEmail(s.email ?? '');
      setWebsite(s.website ?? '');
      setTimezone(s.timezone ?? 'Asia/Kolkata');
      setCurrentAcademicYearId(
        typeof s.currentAcademicYearId === 'string'
          ? s.currentAcademicYearId
          : (s.currentAcademicYearId as any)?._id ?? ''
      );
    } catch {
      // settings API may not be available yet — fail silently
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.updateSettings({
        schoolName: schoolName || undefined,
        address: address || undefined,
        phone: phone || undefined,
        email: email || undefined,
        website: website || undefined,
        timezone,
        currentAcademicYearId: currentAcademicYearId || null,
      });
      setSettings(updated);
      setEditing(false);
      toast('Settings saved.', 'success');
    } catch (err: any) {
      toast(err.message ?? 'Could not save settings.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const academicYears = settings?.academicYears ?? [];

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Settings',
      desc: 'School information and configuration.',
      actions: !editing ? (
        <Button onClick={() => setEditing(true)}>Edit Settings</Button>
      ) : undefined,
    }}>
      {!settings && <Card><SkeletonRows rows={6} /></Card>}

      {settings && !editing && (
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>School Information</strong>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="School Name" value={settings.schoolName} />
            <Field label="Timezone" value={settings.timezone} />
            <Field label="Address" value={settings.address} />
            <Field label="Phone" value={settings.phone} />
            <Field label="Email" value={settings.email} />
            <Field label="Website" value={settings.website} />
            <Field
              label="Current Academic Year"
              value={
                academicYears.find(
                  (y) => y._id === (
                    typeof settings.currentAcademicYearId === 'string'
                      ? settings.currentAcademicYearId
                      : (settings.currentAcademicYearId as any)?._id
                  )
                )?.name ?? '—'
              }
            />
          </div>
        </Card>
      )}

      {settings && editing && (
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Edit School Information</strong>
          <form onSubmit={handleSave} style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="field-label">School Name</div>
                <input className="field-input" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Springfield Academy" />
              </div>
              <div>
                <div className="field-label">Timezone</div>
                <select className="field-input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="field-label">Address</div>
                <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 42 School Lane, Bangalore 560001" />
              </div>
              <div>
                <div className="field-label">Phone</div>
                <input className="field-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +918012345678" />
              </div>
              <div>
                <div className="field-label">Email</div>
                <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. admin@school.edu" />
              </div>
              <div>
                <div className="field-label">Website</div>
                <input className="field-input" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://school.edu" />
              </div>
              {academicYears.length > 0 && (
                <div>
                  <div className="field-label">Current Academic Year</div>
                  <select className="field-input" value={currentAcademicYearId} onChange={(e) => setCurrentAcademicYearId(e.target.value)}>
                    <option value="">— not set —</option>
                    {academicYears.map((y) => (
                      <option key={y._id} value={y._id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Settings'}</Button>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
    </PortalShell>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: value ? 600 : 400 }}>{value || '—'}</div>
    </div>
  );
}
