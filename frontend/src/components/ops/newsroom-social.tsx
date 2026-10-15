'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { request } from '@/lib/api';
import { post } from '@/lib/ops-api';
import { PORTALS, ROLE_TO_SLUG } from '@/lib/portals';
import { useSchoolSegment, withSchool } from '@/lib/school-path';
import { Button, Modal, Pill, useToast } from '@/components/ui';
import { ErrorNote, useAction } from './kit';

/**
 * "Also post to social media" in the newsroom.
 *
 * Shown only to staff holding social.publish (the server decides and refuses
 * everyone else, families included). Each network says whether the school's
 * account is connected or posts are simulated. When the school has the
 * feature switched off, an administrator sees where to switch it on.
 */
export type SocialNetworkOption = { key: string; label: string; state: 'CONNECTED' | 'SIMULATED' | 'NOT_CONNECTED'; handle: string | null; note: string };
export type SocialOptions = { available: boolean; enabled: boolean; canPublish: boolean; canConnect?: boolean; canSwitch?: boolean; hint?: string | null; networks?: SocialNetworkOption[]; simulatedNote?: string; rules?: string };
export type SocialStatusRow = { network: string; label: string; status: string; display: string; reason: string | null; at: string | null };

export const newsroomSocialApi = {
  options: () => request<SocialOptions>('/newsroom-social/options'),
  statuses: (ids: string[]) => request<Record<string, SocialStatusRow[]>>(`/newsroom-social/statuses?ids=${encodeURIComponent(ids.join(','))}`),
  share: (postId: string, networks: string[]) => post<{ postId: string; networks: SocialStatusRow[] }>(`/newsroom-social/stories/${postId}/share`, { networks }),
};

const FAMILY = ['PARENT', 'STUDENT', 'ALUMNUS', 'TRUSTEE'];

/** The composer's options, fetched once; families never ask. */
export function useSocialOptions(): SocialOptions | null {
  const { me } = useAuth();
  const role = me?.profile?.role ?? '';
  const [opts, setOpts] = useState<SocialOptions | null>(null);
  useEffect(() => {
    if (!role || FAMILY.includes(role)) { setOpts(null); return undefined; }
    let live = true;
    newsroomSocialApi.options().then((o) => { if (live) setOpts(o); }).catch(() => { if (live) setOpts(null); });
    return () => { live = false; };
  }, [role]);
  return opts;
}

/** A link to a page of this portal, when the portal's menu has it. */
function usePortalLink(page: string): string | null {
  const { me } = useAuth();
  const school = useSchoolSegment();
  const slug = me?.profile?.role ? ROLE_TO_SLUG[me.profile.role] : null;
  if (!slug) return null;
  const href = `/${slug}/${page}`;
  const has = PORTALS[slug]?.nav.some((g) => g.items.some((i) => i.href === href));
  return has ? withSchool(school, href) : null;
}

const STATE_PILL: Record<SocialNetworkOption['state'], { tone: 'green' | 'amber' | 'gray'; text: string }> = {
  CONNECTED: { tone: 'green', text: 'Connected' }, SIMULATED: { tone: 'amber', text: 'Simulated' }, NOT_CONNECTED: { tone: 'gray', text: 'Not connected · simulated' },
};

export function NetworkChecklist({ options, value, onChange }: { options: SocialOptions; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="nsocial-networks">
      {(options.networks ?? []).map((n) => (
        <label key={n.key} className="nsocial-net" title={n.note}>
          <input type="checkbox" checked={value.includes(n.key)} onChange={(e) => onChange(e.target.checked ? [...value, n.key] : value.filter((x) => x !== n.key))} />
          <span className="nsocial-net-name">{n.label}</span>
          <Pill tone={STATE_PILL[n.state].tone}>{STATE_PILL[n.state].text}</Pill>
        </label>
      ))}
    </div>
  );
}

/** The composer section. `audience` is the story's audience; only PUBLIC stories can go out. */
export function SocialShareSection({ options, value, onChange, audience }: { options: SocialOptions | null; value: string[]; onChange: (v: string[]) => void; audience: string }) {
  const connectHref = usePortalLink('social');
  const settingsHref = usePortalLink('settings');
  if (!options) return null;
  if (!options.available) {
    if (!options.enabled && options.hint) {
      return (
        <div className="ops-callout nsocial-hint" role="note">
          <b>Also post to social media</b> — {options.hint}{' '}
          {settingsHref && <Link href={settingsHref}>Open Tenant Settings</Link>}
        </div>
      );
    }
    return null;
  }
  const isPublic = audience === 'PUBLIC';
  return (
    <fieldset className="nsocial">
      <legend className="field-label">Also post to social media</legend>
      {!isPublic && <p className="ops-muted">Only a story for <b>Public (anyone)</b> can be shared outside the school. Choose that under “Who can see it” to post it.</p>}
      {isPublic && <NetworkChecklist options={options} value={value} onChange={onChange} />}
      <p className="ops-muted">
        {options.rules} Networks without a connected account are <b>simulated</b>: nothing is posted, and the story says so.
        {connectHref && <> <Link href={connectHref}>Connect accounts</Link></>}
      </p>
    </fieldset>
  );
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = { SENT: 'green', SIMULATED: 'amber', FAILED: 'red', BLOCKED: 'red', QUEUED: 'gray', SENDING: 'blue' };

/** Per-network status on a news item. */
export function SocialStatusStrip({ rows }: { rows: SocialStatusRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="nsocial-strip" aria-label="Social media">
      <span className="ops-muted">Social:</span>
      {rows.map((r) => <span key={`${r.network}-${r.status}`} title={r.reason ?? r.display}><Pill tone={STATUS_TONE[r.status] ?? 'gray'}>{r.label}: {r.display}</Pill></span>)}
    </div>
  );
}

/** "Share to social" on a published public story. */
export function ShareToSocialButton({ postId, options, already, onDone }: { postId: string; options: SocialOptions; already: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [nets, setNets] = useState<string[]>([]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <>
      <Button small variant="ghost" onClick={() => { setNets([]); setOpen(true); }}>⇪ Share to social</Button>
      {open && (
        <Modal title="Share this story to social media" onClose={() => setOpen(false)} footer={<>
          <Button variant="soft" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !nets.length} onClick={() => void run(async () => {
            const r = await newsroomSocialApi.share(postId, nets);
            const sim = r.networks.filter((n) => nets.includes(n.network) && n.status === 'SIMULATED').length;
            toast(sim ? `Done — ${sim} network(s) simulated, nothing posted` : 'Shared', sim ? 'info' : 'success');
            setOpen(false); onDone();
          })}>Share</Button>
        </>}>
          {already.length > 0 && <p className="ops-muted">Already shared to {already.join(', ')}. Choosing one again only retries it if it failed.</p>}
          <NetworkChecklist options={options} value={nets} onChange={setNets} />
          <p className="ops-muted">{options.rules}</p>
          <ErrorNote error={error} />
        </Modal>
      )}
    </>
  );
}
