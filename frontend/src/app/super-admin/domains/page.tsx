'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, EmptyState, Field, Input, Modal, Pill, SkeletonRows, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { clearActingSchool } from '@/lib/acting-school';
import type {
  DomainListDto, DomainSslStatus, DomainVerificationStatus, PendingProfileChange, ProfileDomainDto,
  SchoolDomainDto, SchoolDomainSummaryDto,
} from '@/lib/types';

/**
 * Super Admin — Domain Management.
 *
 * Each school is reached at a platform subdomain or at a domain it bought. The
 * table shows where each one stands, and every action maps to one server call.
 *
 * Nothing here decides that a domain works. Verify asks real DNS, Check SSL does
 * a real TLS handshake, and Activate is refused by the server until both have
 * passed — this page only avoids offering a button whose answer would be a 409,
 * and shows the server's own message when one comes back anyway.
 */

const VERIFY_TONE: Record<DomainVerificationStatus, 'green' | 'amber' | 'red'> = {
  PENDING: 'amber',
  VERIFIED: 'green',
  FAILED: 'red',
};
const SSL_TONE: Record<DomainSslStatus, 'green' | 'gray' | 'red'> = {
  NOT_CHECKED: 'gray',
  ACTIVE: 'green',
  FAILED: 'red',
};

const words = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/** What the School Admin profile gives, in the words the table uses. Never a guess. */
function profileLabel(status: SchoolDomainSummaryDto['profileDomainStatus'], hostname: string | null): string {
  if (status === 'FOUND' && hostname) return hostname;
  if (status === 'INVALID') return 'Invalid website';
  if (status === 'CONFLICT') return 'Admins disagree';
  return 'Not Provided';
}

const PENDING_WORDS: Record<PendingProfileChange, string> = {
  CHANGED: 'profile domain changed',
  REMOVED: 'profile website removed',
  INVALID: 'profile website invalid',
  CONFLICT: 'profiles disagree',
  DUPLICATE: 'profile domain used by another school',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

type Dialog =
  | { kind: 'subdomain'; school: SchoolDomainSummaryDto }
  | { kind: 'custom'; school: SchoolDomainSummaryDto }
  | { kind: 'view'; tenantId: string }
  | { kind: 'deactivate'; school: SchoolDomainSummaryDto }
  | { kind: 'replace'; school: SchoolDomainSummaryDto };

export default function SuperAdminDomainsPage() {
  const [data, setData] = useState<DomainListDto | null>(null);
  const [err, setErr] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(false);
    // The table spans every school; a leftover X-School-Id would narrow it.
    clearActingSchool();
    try {
      setData(await api.listSchoolDomains());
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Runs one action for a row, reports the server's answer, and refreshes. */
  const run = async (tenantId: string, action: () => Promise<string>) => {
    setBusy(tenantId);
    try {
      toast(await action(), 'success');
    } catch (e) {
      toast(errorMessage(e, 'That did not work.'), 'error');
    } finally {
      setBusy(null);
      await load();
    }
  };

  const verify = (s: SchoolDomainSummaryDto) => run(s.tenantId, async () => {
    const result = await api.verifyDomain(s.tenantId);
    if (result.outcome === 'VERIFIED') return `${result.domain.hostname} is verified.`;
    // A failed or inconclusive check is an answer, not an error — but it is not
    // good news either, so it is shown as one.
    throw new Error(result.error ?? `Verification ${words(result.outcome)}.`);
  });

  const checkSsl = (s: SchoolDomainSummaryDto) => run(s.tenantId, async () => {
    const result = await api.checkDomainSsl(s.tenantId);
    if (result.outcome === 'ACTIVE') return `A valid certificate is served for ${result.domain.hostname}.`;
    throw new Error(result.error ?? `Certificate check ${words(result.outcome)}.`);
  });

  const activate = (s: SchoolDomainSummaryDto) => run(s.tenantId, async () => {
    const result = await api.activateDomain(s.tenantId);
    return `${result.domain.hostname} is now live for ${s.tenantName}.`;
  });

  /**
   * Applies the profile's domain. Replacing a LIVE domain takes it offline, so
   * that goes through a confirmation first; the server refuses it without one.
   */
  const importFromProfile = (s: SchoolDomainSummaryDto, confirmReplace = false) => {
    if (s.active && !confirmReplace) {
      setDialog({ kind: 'replace', school: s });
      return Promise.resolve();
    }
    return run(s.tenantId, async () => {
      const result = await api.importProfileDomain(s.tenantId, confirmReplace);
      return result.changed
        ? `${result.domain.hostname} imported from the School Admin profile — pending verification.`
        : 'The configuration already matches the School Admin profile.';
    });
  };

  const settings = data?.settings;

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'Domain Management',
        desc: 'The address each school is served at — a platform subdomain or its own domain.',
      }}
    >
      {settings && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Platform domain</div>
              <code>{settings.platformDomain ?? 'not configured'}</code>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Custom domains point at</div>
              <code>{settings.cnameTarget ?? 'not configured'}</code>
            </div>
          </div>
          {!settings.subdomainsEnabled && (
            <p role="note" style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '12px 0 0' }}>
              Subdomains are unavailable because this deployment has no <code>PLATFORM_DOMAIN</code>. Custom
              domains can still be configured.
            </p>
          )}
        </Card>
      )}

      <Card pad={false}>
        {data === null && !err && <div style={{ padding: 18 }}><SkeletonRows rows={4} /></div>}
        {err && <EmptyState title="Couldn't load domains" sub="Failed to fetch from the server." />}
        {data && data.schools.length === 0 && (
          <EmptyState title="No schools yet" sub="Register a school before giving it an address." />
        )}
        {data && data.schools.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>School</th>
                <th>Domain Type</th>
                <th>Domain</th>
                <th>Verification Status</th>
                <th>SSL Status</th>
                <th>Active Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.schools.map((s) => {
                const rowBusy = busy === s.tenantId;
                return (
                  <tr key={s.tenantId}>
                    <td className="cell-primary" data-label="School">
                      <div style={{ fontWeight: 600 }}>{s.tenantName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {s.tenantId}{s.schoolStatus !== 'ACTIVE' ? ' · suspended' : ''}
                      </div>
                    </td>
                    <td data-label="Domain Type">
                      {s.type ? (s.type === 'CUSTOM' ? 'Custom domain' : 'Subdomain') : '—'}
                    </td>
                    <td data-label="Domain">
                      {s.hostname ? <code style={{ fontSize: 12.5 }}>{s.hostname}</code> : (
                        <span style={{ color: 'var(--text-faint)' }}>Not configured</span>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }} data-testid={`profile-domain-${s.tenantId}`}>
                        Profile: {profileLabel(s.profileDomainStatus, s.profileDomain)}
                        {s.source === 'PROFILE' ? ' · source' : ''}
                      </div>
                      {s.pendingProfileChange && (
                        <div style={{ marginTop: 4 }}>
                          <Pill tone="amber">{PENDING_WORDS[s.pendingProfileChange]}</Pill>
                        </div>
                      )}
                    </td>
                    <td data-label="Verification Status">
                      {s.verificationStatus ? <Pill tone={VERIFY_TONE[s.verificationStatus]}>{words(s.verificationStatus)}</Pill> : '—'}
                    </td>
                    <td data-label="SSL Status">
                      {s.sslStatus ? <Pill tone={SSL_TONE[s.sslStatus]}>{words(s.sslStatus)}</Pill> : '—'}
                    </td>
                    <td data-label="Active Status">
                      {s.configured ? <Pill tone={s.active ? 'green' : 'gray'}>{s.active ? 'active' : 'inactive'}</Pill> : '—'}
                    </td>
                    <td data-label="Actions">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {s.configured && (
                          <Button variant="soft" small onClick={() => setDialog({ kind: 'view', tenantId: s.tenantId })}>
                            View
                          </Button>
                        )}
                        <Button
                          variant="ghost" small disabled={rowBusy || !settings?.subdomainsEnabled}
                          onClick={() => setDialog({ kind: 'subdomain', school: s })}
                        >
                          Subdomain
                        </Button>
                        <Button variant="ghost" small disabled={rowBusy} onClick={() => setDialog({ kind: 'custom', school: s })}>
                          Custom domain
                        </Button>
                        {(s.profileDomainSync === 'NOT_CONFIGURED' || s.profileDomainSync === 'CHANGED') && (
                          <Button variant="soft" small disabled={rowBusy} onClick={() => void importFromProfile(s)}>
                            Import from profile
                          </Button>
                        )}
                        {s.configured && (
                          <Button variant="ghost" small disabled={rowBusy} onClick={() => void verify(s)}>
                            {rowBusy ? 'Checking…' : 'Verify'}
                          </Button>
                        )}
                        {s.verificationStatus === 'VERIFIED' && (
                          <Button variant="ghost" small disabled={rowBusy} onClick={() => void checkSsl(s)}>
                            Check SSL
                          </Button>
                        )}
                        {s.configured && !s.active && (
                          <Button
                            small
                            disabled={rowBusy || s.verificationStatus !== 'VERIFIED' || s.sslStatus !== 'ACTIVE' || s.schoolStatus !== 'ACTIVE'}
                            title={
                              s.verificationStatus !== 'VERIFIED' ? 'Verify the domain first'
                                : s.sslStatus !== 'ACTIVE' ? 'Check SSL first'
                                  : s.schoolStatus !== 'ACTIVE' ? 'The school is suspended' : undefined
                            }
                            onClick={() => void activate(s)}
                          >
                            Activate
                          </Button>
                        )}
                        {s.active && (
                          <Button variant="ghost" small disabled={rowBusy} onClick={() => setDialog({ kind: 'deactivate', school: s })}>
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {dialog?.kind === 'subdomain' && (
        <SubdomainDialog
          school={dialog.school}
          platformDomain={settings?.platformDomain ?? ''}
          onClose={() => setDialog(null)}
          onSaved={async (tenantId) => { await load(); setDialog({ kind: 'view', tenantId }); }}
        />
      )}
      {dialog?.kind === 'custom' && (
        <CustomDomainDialog
          school={dialog.school}
          onClose={() => setDialog(null)}
          onSaved={async (tenantId) => { await load(); setDialog({ kind: 'view', tenantId }); }}
        />
      )}
      {dialog?.kind === 'view' && (
        <DomainDetails tenantId={dialog.tenantId} onClose={() => setDialog(null)} onChanged={() => void load()} />
      )}
      {dialog?.kind === 'replace' && (
        <Modal
          title={`Replace ${dialog.school.hostname}?`}
          onClose={() => setDialog(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>Keep the live domain</Button>
              <Button
                onClick={() => {
                  const school = dialog.school;
                  setDialog(null);
                  void importFromProfile(school, true);
                }}
              >
                Replace with {dialog.school.profileDomain}
              </Button>
            </>
          )}
        >
          <p role="alert" style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
            <code>{dialog.school.hostname}</code> is live for {dialog.school.tenantName}. Replacing it with the School
            Admin profile&rsquo;s <code>{dialog.school.profileDomain}</code> takes it offline immediately, and the new
            domain stays inactive until it is verified, has a certificate, and is activated.
          </p>
        </Modal>
      )}
      {dialog?.kind === 'deactivate' && (
        <DeactivateDialog
          school={dialog.school}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            setDialog(null);
            await run(dialog.school.tenantId, async () => {
              const result = await api.deactivateDomain(dialog.school.tenantId, reason || undefined);
              return `${result.domain.hostname} is no longer live.`;
            });
          }}
        />
      )}
    </PortalShell>
  );
}

/** A warning shown before replacing an address that already exists. */
function ReplaceWarning({ school }: { school: SchoolDomainSummaryDto }) {
  if (!school.configured) return null;
  return (
    <p role="alert" style={{ fontSize: 12.5, color: 'var(--red)', margin: '0 0 12px' }}>
      {school.tenantName} is currently configured as <code>{school.hostname}</code>
      {school.active ? ', which is live' : ''}. Saving a different address replaces it and starts verification
      again{school.active ? ' — the current address stops working immediately' : ''}.
    </p>
  );
}

function SubdomainDialog({
  school, platformDomain, onClose, onSaved,
}: {
  school: SchoolDomainSummaryDto; platformDomain: string;
  onClose: () => void; onSaved: (tenantId: string) => Promise<void>;
}) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.suggestSubdomain(school.tenantId)
      .then((s) => { setSuggested(s.subdomain); setValue(s.subdomain); })
      .catch((e) => setError(errorMessage(e, 'Could not generate a subdomain.')));
  }, [school.tenantId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Sending the generated label unchanged lets the server re-derive it, so
      // a label claimed by another school in the meantime is skipped rather than
      // refused.
      await api.configureSubdomain(school.tenantId, value.trim() === suggested ? undefined : value.trim());
      await onSaved(school.tenantId);
    } catch (e) {
      setError(errorMessage(e, 'Could not configure this subdomain.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Subdomain for ${school.tenantName}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !value.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Configure subdomain'}
          </Button>
        </>
      )}
    >
      <ReplaceWarning school={school} />
      <Field
        label="Subdomain"
        hint="Generated from the school name. Lowercase letters, digits and hyphens; 3-63 characters."
        error={error ?? undefined}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value.toLowerCase())} placeholder={suggested ?? ''} />
      </Field>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0' }}>
        Address: <code>{value.trim() || '…'}.{platformDomain}</code>
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '8px 0 0' }}>
        It will be saved as pending. It goes live only after it resolves in DNS, a certificate is served for
        it, and you activate it.
      </p>
    </Modal>
  );
}

function CustomDomainDialog({
  school, onClose, onSaved,
}: { school: SchoolDomainSummaryDto; onClose: () => void; onSaved: (tenantId: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.configureCustomDomain(school.tenantId, value);
      await onSaved(school.tenantId);
    } catch (e) {
      // The server is the validator: protocol, path, port and malformed names
      // all come back with a message that says which.
      setError(errorMessage(e, 'That is not a domain this school can use.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Custom domain for ${school.tenantName}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !value.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Configure custom domain'}
          </Button>
        </>
      )}
    >
      <ReplaceWarning school={school} />
      <Field
        label="Domain name"
        hint="The domain name only, e.g. www.abcschool.com — no https://, path or port."
        error={error ?? undefined}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="www.abcschool.com" autoComplete="off" />
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '8px 0 0' }}>
        After saving you will see the DNS records the school has to create. The domain stays inactive until they
        are verified.
      </p>
    </Modal>
  );
}

function DeactivateDialog({
  school, onClose, onConfirm,
}: { school: SchoolDomainSummaryDto; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={`Deactivate ${school.hostname}?`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void onConfirm(reason.trim())}>Deactivate</Button>
        </>
      )}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
        {school.tenantName}&rsquo;s portal stops being served at this address immediately. Its configuration and
        verification are kept, so it can be activated again.
      </p>
      <Field label="Reason" hint="Optional. Recorded in the audit log.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </Field>
    </Modal>
  );
}

/** The full configuration and the DNS records it needs. */
function DomainDetails({ tenantId, onClose, onChanged }: { tenantId: string; onClose: () => void; onChanged: () => void }) {
  const [domain, setDomain] = useState<SchoolDomainDto | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileDomainDto | null>(null);
  const [name, setName] = useState(tenantId);
  const toast = useToast();

  const reload = useCallback(() => {
    api.schoolDomain(tenantId)
      .then((d) => { setDomain(d.domain); setProfile(d.profileDomain); setName(d.tenantName); })
      .catch(() => setDomain(null));
  }, [tenantId]);

  useEffect(() => { reload(); }, [reload]);

  const dismiss = async () => {
    try {
      await api.dismissProfileDomainChange(tenantId);
      toast('Profile change dismissed. The configuration is unchanged.', 'success');
      reload();
      onChanged();
    } catch (e) {
      toast(errorMessage(e, 'Could not dismiss the change.'), 'error');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.', 'success');
    } catch {
      toast('Could not copy — select the value instead.', 'error');
    }
  };

  const rows: Array<[string, React.ReactNode]> = domain ? [
    ['Type', domain.type === 'CUSTOM' ? 'Custom domain' : 'Subdomain'],
    ['Hostname', <code key="h">{domain.hostname}</code>],
    ['Verification', <>{words(domain.verificationStatus)}{domain.verifiedAt ? ` · since ${when(domain.verifiedAt)}` : ''}</>],
    ['Last checked', when(domain.lastVerificationAt)],
    ['SSL', <>{words(domain.sslStatus)}{domain.sslValidTo ? ` · valid to ${when(domain.sslValidTo)}` : ''}{domain.sslIssuer ? ` · ${domain.sslIssuer}` : ''}</>],
    ['SSL checked', when(domain.sslCheckedAt)],
    ['Active', domain.active ? `yes · since ${when(domain.activatedAt)}` : `no${domain.deactivationReason ? ` · ${words(domain.deactivationReason)}` : ''}`],
    ['Configured by', `${domain.configuredBy ?? '—'} · ${when(domain.createdAt)}`],
    ['Last changed by', `${domain.updatedBy ?? '—'} · ${when(domain.updatedAt)}`],
  ] : [];

  return (
    <Modal title={`${name} — domain`} onClose={onClose} wide footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {domain === undefined && <SkeletonRows rows={5} />}
      {profile && <ProfileSource profile={profile} domain={domain ?? null} onDismiss={() => void dismiss()} />}
      {domain === null && <EmptyState title="No domain configured" sub="Configure a subdomain or custom domain first." />}
      {domain && (
        <>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 13, margin: 0 }}>
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--text-faint)' }}>{label}</dt>
                <dd style={{ margin: 0 }}>{value}</dd>
              </div>
            ))}
          </dl>

          {(domain.lastVerificationError || domain.sslError) && (
            <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)' }}>
              {domain.lastVerificationError && <div>{domain.lastVerificationError}</div>}
              {domain.sslError && <div>{domain.sslError}</div>}
            </div>
          )}

          {domain.dnsInstructions && (
            <section style={{ marginTop: 18 }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 15 }}>DNS instructions</strong>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 10px' }}>{domain.dnsInstructions.summary}</p>
              {domain.dnsInstructions.warning && (
                <p role="note" style={{ fontSize: 12.5, color: 'var(--red)', margin: '0 0 10px' }}>{domain.dnsInstructions.warning}</p>
              )}
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Type</th><th>Name</th><th>Value</th><th>Created by</th></tr>
                </thead>
                <tbody>
                  {domain.dnsInstructions.records.map((r) => (
                    <tr key={`${r.type}-${r.name}`}>
                      <td data-label="Type"><code>{r.type}</code></td>
                      <td data-label="Name" style={{ wordBreak: 'break-all' }}>
                        <code>{r.name}</code>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.note}</div>
                      </td>
                      <td data-label="Value" style={{ wordBreak: 'break-all' }}>
                        {r.value ? (
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <code>{r.value}</code>
                            <Button variant="ghost" small onClick={() => void copy(r.value as string)}>Copy</Button>
                          </span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>Ask the platform team</span>}
                      </td>
                      <td data-label="Created by">{r.managedBy === 'SCHOOL' ? 'School' : 'Platform'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ol style={{ fontSize: 13, color: 'var(--text-2)', paddingLeft: 18, margin: '10px 0 0' }}>
                {domain.dnsInstructions.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}

/** What the School Admin profile says, and how it relates to the configuration. */
function ProfileSource({
  profile, domain, onDismiss,
}: { profile: ProfileDomainDto; domain: SchoolDomainDto | null; onDismiss: () => void }) {
  const pending = domain?.pendingProfileDomain ?? null;
  const syncWords: Record<ProfileDomainDto['sync'], string> = {
    NOT_PROVIDED: 'No School Admin profile has a website.',
    INVALID: `The website on the profile is not a usable domain${profile.error ? `: ${profile.error}` : '.'}`,
    CONFLICT: 'School Admin profiles name different domains; none is used.',
    DUPLICATE: 'This domain is already assigned to another school.',
    NOT_CONFIGURED: 'Not applied yet — use Import from profile.',
    IN_SYNC: 'Matches the configured domain.',
    CHANGED: 'Differs from the configured domain.',
  };

  return (
    <section aria-label="From the School Admin profile" style={{ marginBottom: 16, padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>From the School Admin profile</div>
      <div style={{ fontSize: 13 }}>
        Domain: <strong>{profile.status === 'FOUND' && profile.hostname ? profile.hostname : 'Not Provided'}</strong>
        {profile.website && (
          <span style={{ color: 'var(--text-faint)' }}> · entered as <code>{profile.website}</code>{profile.profileName ? ` by ${profile.profileName}` : ''}</span>
        )}
      </div>
      {profile.candidates && (
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          {profile.candidates.map((c) => `${c.hostname} (${c.profileName})`).join(' · ')}
        </div>
      )}
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{syncWords[profile.sync]}</div>
      {domain?.source === 'PROFILE' && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          Configuration imported from {domain.sourceWebsite ?? 'the profile'}{domain.sourceFetchedAt ? ` on ${when(domain.sourceFetchedAt)}` : ''}.
        </div>
      )}
      {pending && (
        <div role="status" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone="amber">{PENDING_WORDS[pending.change]}</Pill>
          <span style={{ fontSize: 12.5 }}>
            {pending.hostname ? <code>{pending.hostname}</code> : 'No domain'} detected {when(pending.detectedAt)} — the current
            configuration is unchanged until reviewed.
          </span>
          <Button variant="ghost" small onClick={onDismiss}>Dismiss</Button>
        </div>
      )}
    </section>
  );
}
