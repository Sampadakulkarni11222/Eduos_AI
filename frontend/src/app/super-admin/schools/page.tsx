'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SkeletonRows, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { SchoolDto, SchoolAdminDto } from '@/lib/types';

/**
 * Super Admin — schools and their School Admin accounts.
 *
 * Everything on this page goes through /api/v1/schools, which is gated by the
 * `schools.read` / `schools.manage` permissions in the existing permission
 * system. A School Admin is an ordinary ADMIN profile: what those accounts can
 * do once created is unchanged.
 */
export default function SuperAdminSchoolsPage() {
  const [schools, setSchools] = useState<SchoolDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [admins, setAdmins] = useState<SchoolAdminDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);

  const loadSchools = useCallback(async () => {
    setSchools(null);
    setErr(false);
    try {
      const rows = await api.listSchools();
      setSchools(rows);
      setSelected((cur) => cur ?? rows[0]?.tenantId ?? null);
    } catch {
      setErr(true);
      setSchools([]);
    }
  }, []);

  const loadAdmins = useCallback(async (tenantId: string) => {
    setAdmins(null);
    try {
      setAdmins(await api.listSchoolAdmins(tenantId));
    } catch (e) {
      setAdmins([]);
      toast(errorMessage(e, 'Could not load School Admins.'), 'error');
    }
  }, [toast]);

  useEffect(() => { void loadSchools(); }, [loadSchools]);
  useEffect(() => { if (selected) void loadAdmins(selected); }, [selected, loadAdmins]);

  const setAdminStatus = async (admin: SchoolAdminDto, status: 'ACTIVE' | 'SUSPENDED') => {
    setBusy(true);
    try {
      await api.updateSchoolAdmin(admin.tenantId, admin.profileId, { status });
      toast(`${admin.displayName} is now ${status.toLowerCase()}.`, 'success');
      await loadAdmins(admin.tenantId);
      await loadSchools();
    } catch (e) {
      toast(errorMessage(e, 'Could not update this School Admin.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const current = schools?.find((s) => s.tenantId === selected) ?? null;

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'Schools & Admins',
        desc: 'Register schools and manage the School Admin accounts that run them.',
        actions: (
          <Button small onClick={() => setShowSchoolModal(true)}>+ New School</Button>
        ),
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16, alignItems: 'start' }}>
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Schools</strong>
          </div>
          {schools === null && <div style={{ padding: 18 }}><SkeletonRows rows={4} /></div>}
          {err && <EmptyState title="Couldn't load schools" sub="Failed to fetch the school list." />}
          {schools !== null && !err && schools.length === 0 && (
            <EmptyState title="No schools yet" sub="Create the first school and its School Admin." />
          )}
          {schools?.map((s) => (
            <button
              key={s.tenantId}
              type="button"
              onClick={() => setSelected(s.tenantId)}
              aria-current={s.tenantId === selected ? 'true' : undefined}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 18px',
                border: 0, borderBottom: '1px solid var(--hairline)', cursor: 'pointer',
                background: s.tenantId === selected ? 'var(--surface-2, rgba(0,0,0,0.04))' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.tenantName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'monospace' }}>/{s.slug}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                {s.activeAdminCount} active admin{s.activeAdminCount === 1 ? '' : 's'} · {s.profileCount} profiles
              </div>
            </button>
          ))}
        </Card>

        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
                {current ? `School Admins — ${current.tenantName}` : 'School Admins'}
              </strong>
              {current && <SchoolAddress slug={current.slug} />}
            </div>
            {current && <Button variant="soft" small onClick={() => setShowAdminModal(true)}>+ Add School Admin</Button>}
          </div>

          {!current && <EmptyState title="Select a school" sub="Pick a school on the left to see its administrators." />}
          {current && admins === null && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
          {current && admins !== null && admins.length === 0 && (
            <EmptyState title="No School Admins" sub="This school has no administrator accounts yet." />
          )}
          {current && admins && admins.length > 0 && (
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.profileId}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Name">{a.displayName}</td>
                    <td data-label="Contact">
                      <div>{a.email ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{a.phone}</div>
                    </td>
                    <td data-label="Status">
                      <Pill tone={a.status === 'ACTIVE' ? 'green' : a.status === 'SUSPENDED' ? 'red' : 'gray'}>{a.status}</Pill>
                    </td>
                    <td data-label="Actions">
                      {a.status === 'ACTIVE' ? (
                        <Button variant="ghost" small disabled={busy} onClick={() => void setAdminStatus(a, 'SUSPENDED')}>
                          Suspend
                        </Button>
                      ) : (
                        <Button variant="soft" small disabled={busy} onClick={() => void setAdminStatus(a, 'ACTIVE')}>
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {showSchoolModal && (
        <NewSchoolModal
          onClose={() => setShowSchoolModal(false)}
          onCreated={async (tenantId) => {
            setShowSchoolModal(false);
            await loadSchools();
            setSelected(tenantId);
          }}
        />
      )}

      {showAdminModal && current && (
        <NewAdminModal
          school={current}
          onClose={() => setShowAdminModal(false)}
          onCreated={async () => {
            setShowAdminModal(false);
            await loadAdmins(current.tenantId);
            await loadSchools();
          }}
        />
      )}
    </PortalShell>
  );
}

/** Where this school's people sign in — the link a platform admin hands over. */
function SchoolAddress({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  // Rendered after mount: the origin differs between dev, staging and
  // production, and the server has no way to know which one this is.
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, or the user said no) — the link is
      // on screen and selectable, so there is nothing to recover from.
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
      <span style={{ color: 'var(--text-2)' }}>Sign-in address:</span>
      <a
        href={`/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontFamily: 'monospace', color: 'var(--accent)', textDecoration: 'underline' }}
      >
        {origin ? `${origin}/${slug}` : `/${slug}`}
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)', padding: 0 }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function NewSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: (tenantId: string) => void }) {
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const slugPreview = tenantId.trim().toLowerCase();

  const submit = async () => {
    setBusy(true);
    try {
      await api.createSchool({
        tenantId: tenantId.trim().toLowerCase(),
        tenantName: tenantName.trim(),
        admin: { displayName: displayName.trim(), phone: phone.trim(), email: email.trim() || undefined, password: password || undefined },
      });
      toast('School created.', 'success');
      onCreated(tenantId.trim().toLowerCase());
    } catch (e) {
      toast(errorMessage(e, 'Could not create this school.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New School"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" small onClick={onClose}>Cancel</Button>
          <Button small disabled={busy} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create School'}</Button>
        </>
      }
    >
      <Field
        label="School address"
        required
        hint="Lowercase letters, digits and hyphens. This becomes the school's sign-in link, and cannot be changed afterwards without moving all of its data."
      >
        <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="oakridge-north" />
      </Field>
      {/* Show the link being minted, so it is a decision rather than a
          side effect discovered later. */}
      <div style={{ marginTop: -6, marginBottom: 12, fontSize: 12, color: 'var(--text-2)' }}>
        Its people will sign in at{' '}
        <span style={{ fontFamily: 'monospace', color: slugPreview ? 'var(--accent)' : 'var(--text-faint)' }}>
          {origin}/{slugPreview || '…'}
        </span>
      </div>
      <Field label="School Name" required>
        <Input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Oakridge North Campus" />
      </Field>
      <div style={{ margin: '14px 0 8px', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-2)' }}>
        FIRST SCHOOL ADMIN
      </div>
      <Field label="Full Name" required>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Phone" required hint="E.164 format, e.g. +919876543210">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint="Needed for email + password sign-in.">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}

function NewAdminModal({ school, onClose, onCreated }: { school: SchoolDto; onClose: () => void; onCreated: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.createSchoolAdmin(school.tenantId, {
        displayName: displayName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        password: password || undefined,
      });
      toast('School Admin created.', 'success');
      onCreated();
    } catch (e) {
      toast(errorMessage(e, 'Could not create this School Admin.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add School Admin — ${school.tenantName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" small onClick={onClose}>Cancel</Button>
          <Button small disabled={busy} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create'}</Button>
        </>
      }
    >
      <Field label="Full Name" required>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Phone" required hint="E.164 format, e.g. +919876543210">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint="Needed for email + password sign-in.">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}
