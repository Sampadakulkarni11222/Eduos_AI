'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, Pill, SkeletonRows } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import type { SchoolCustomizationDto, SchoolDomainDetailDto } from '@/lib/types';

export default function AdminSettings() {
  const [ctx, setCtx] = useState<{ tenantName: string; tenantId: string } | null>(null);
  // This school's own look, read-only. Changing it is `customization.manage`,
  // which only the platform holds; the backend confines this read to the
  // caller's school, so there is no way to ask for another's.
  const [look, setLook] = useState<SchoolCustomizationDto | null | 'error'>(null);
  // This school's portal address, read-only. Configuring, verifying and
  // activating it is `domains.manage`, which only the platform holds.
  const [address, setAddress] = useState<SchoolDomainDetailDto | null>(null);

  useEffect(() => {
    api.me().then((m) => {
      const profile = m.profile;
      setCtx({ tenantName: profile?.tenantName ?? 'Unknown', tenantId: profile?.tenantId ?? '' });
    }).catch(() => {});
    api.myCustomization().then(setLook).catch(() => setLook('error'));
    api.myDomain().then(setAddress).catch(() => setAddress(null));
  }, []);

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Settings', desc: 'Tenant configuration and school preferences.' }}>
      {!ctx && <Card><SkeletonRows rows={4} /></Card>}
      {ctx && (
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>School Information</strong>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>School Name</div>
              <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{ctx.tenantName}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Tenant ID</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{ctx.tenantId}</div>
            </div>
          </div>
          <div style={{ marginTop: 20, padding: '12px 14px', background: '#f5f5f0', borderRadius: 8, fontSize: 13, color: 'var(--text-2)' }}>
            Advanced settings (branding, academic year, notification templates, fee configuration) are managed by the EduOS platform team. Contact support to make changes.
          </div>
        </Card>
      )}
      {look && look !== 'error' && <SchoolLook config={look} />}
      {address && <SchoolAddress detail={address} />}
    </PortalShell>
  );
}

const label = { fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 } as const;

/** How the platform has configured this school — visible here, changed there. */
function SchoolLook({ config }: { config: SchoolCustomizationDto }) {
  const colours: Array<[string, string | null]> = [
    ['Primary', config.theme.primaryColor],
    ['Secondary', config.theme.secondaryColor],
    ['Accent', config.theme.accentColor],
  ];
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Branding &amp; dropdowns</strong>
        <Pill tone={config.customized ? 'green' : 'gray'}>{config.customized ? 'customised' : 'default look'}</Pill>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        {colours.map(([name, value]) => (
          <div key={name}>
            <div style={label}>{name} colour</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontFamily: 'monospace' }}>
              {value && <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, background: value, border: '1px solid var(--hairline-2)' }} />}
              {value ?? 'Portal default'}
            </div>
          </div>
        ))}
        <div>
          <div style={label}>Display name</div>
          <div style={{ fontSize: 13 }}>{config.branding.displayName ?? 'Registered name'}</div>
        </div>
        <div>
          <div style={label}>Logo</div>
          {config.branding.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={fileHref(config.branding.logoUrl)} alt="School logo" style={{ maxHeight: 36, maxWidth: 120, objectFit: 'contain' }} />
            : <div style={{ fontSize: 13 }}>None</div>}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={label}>Dropdown values</div>
        {config.dropdowns.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No lists configured.</div>}
        {config.dropdowns.map((d) => (
          <div key={d.key} style={{ fontSize: 13, marginTop: 4 }}>
            <strong>{d.label}:</strong> {d.options.map((o) => o.label).join(', ') || '—'}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Where the portal is served, and the DNS records still outstanding. */
function SchoolAddress({ detail }: { detail: SchoolDomainDetailDto }) {
  const domain = detail.domain;
  const profile = detail.profileDomain;
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Portal address</strong>
        {domain && <Pill tone={domain.active ? 'green' : 'gray'}>{domain.active ? 'live' : 'not live'}</Pill>}
      </div>
      <div style={{ marginTop: 10, fontSize: 13 }} data-testid="profile-website-domain">
        <span style={label}>Domain from the School Admin profile website: </span>
        {profile.status === 'FOUND' && profile.hostname
          ? <code>{profile.hostname}</code>
          : profile.status === 'CONFLICT' ? 'School Admin profiles disagree'
            : profile.status === 'INVALID' ? 'Not a usable website' : 'Not Provided'}
        {profile.sync === 'CHANGED' && ' · differs from the configured address; awaiting platform review'}
      </div>
      {!domain && (
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '10px 0 0' }}>
          No subdomain or custom domain has been set up. Contact the EduOS platform team to request one.
        </p>
      )}
      {domain && (
        <>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, fontSize: 13 }}>
            <div><div style={label}>Address</div><code>{domain.hostname}</code></div>
            <div><div style={label}>Type</div>{domain.type === 'CUSTOM' ? 'Custom domain' : 'Platform subdomain'}</div>
            <div><div style={label}>Verification</div>{domain.verificationStatus.toLowerCase()}</div>
            <div><div style={label}>Certificate</div>{domain.sslStatus.toLowerCase().replace(/_/g, ' ')}</div>
          </div>
          {domain.lastVerificationError && (
            <p role="alert" style={{ fontSize: 12.5, color: 'var(--red)', margin: '10px 0 0' }}>{domain.lastVerificationError}</p>
          )}
          {domain.dnsInstructions && domain.dnsInstructions.records.some((r) => r.managedBy === 'SCHOOL') && (
            <div style={{ marginTop: 14 }}>
              <div style={label}>DNS records your school must create</div>
              {domain.dnsInstructions.records.filter((r) => r.managedBy === 'SCHOOL').map((r) => (
                <div key={`${r.type}-${r.name}`} style={{ fontSize: 12.5, marginTop: 6, wordBreak: 'break-all' }}>
                  <code>{r.type}</code> <code>{r.name}</code> → <code>{r.value ?? 'ask the platform team'}</code>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
