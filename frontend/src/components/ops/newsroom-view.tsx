'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button, EmptyState, Field, Modal, SearchInput, useToast } from '@/components/ui';
import { fileHref } from '@/lib/api';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { CircleDto, PostDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Newsroom & community. Every post has an explicit audience; students' posts
 * and comments are moderated; pictured students appear only where their
 * consent allows, and withdrawing consent removes the picture everywhere at
 * once. Circles are moderated, alumni circles are adults-only, and mentoring
 * with students is always supervised. No popularity rankings.
 */
const REACTIONS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'CLAP', label: 'Applaud', icon: '👏' }, { key: 'HEART', label: 'Love', icon: '❤️' }, { key: 'CELEBRATE', label: 'Celebrate', icon: '🎉' }, { key: 'INSPIRED', label: 'Inspired', icon: '✨' },
];

function PostCard({ p, onChanged, moderator }: { p: PostDto; onChanged: () => void; moderator: boolean }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [prompt, setPrompt] = useState<null | 'reject' | 'takedown' | 'report'>(null);
  const [reason, setReason] = useState('INAPPROPRIATE');
  const full = useLoad(() => (open ? opsApi.postById(p.id) : Promise.resolve(null)), [open, p.id]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <article className="news-post" aria-label={p.title ?? 'Post'}>
      {p.media.length > 0 && (
        <div className="news-media">{p.media.map((m) => m.kind === 'VIDEO'
          // Uploaded videos carry no caption track, so they open in a new tab
          // with their description rather than playing inline uncaptioned.
          ? <a key={m.id} href={fileHref(m.url)} target="_blank" rel="noreferrer" className="ops-callout">▶ Watch video{m.altText ? ` — ${m.altText}` : ''}{m.caption ? ` (${m.caption})` : ''}</a>
          : m.kind === 'IMAGE'
            // eslint-disable-next-line @next/next/no-img-element -- an uploaded file on the API origin, signed per response; next/image has no loader for it
            ? <img key={m.id} src={fileHref(m.url)} alt={m.altText ?? ''} loading="lazy" />
            : <a key={m.id} href={fileHref(m.url)} target="_blank" rel="noreferrer">📎 {m.caption ?? 'Document'}</a>)}</div>
      )}
      <div className="news-post-body">
        <div className="news-post-head"><span>{humanize(p.kind)} · {p.authorName}{p.publishedAt ? ` · ${fmtDateTime(p.publishedAt)}` : ''}{p.pinned ? ' · 📌' : ''}</span><span>{p.audience === 'PUBLIC' ? '🌐 Public' : p.audience === 'CIRCLE' ? '◎ Circle' : humanize(p.audience)}{p.status !== 'PUBLISHED' && <> · <StatusPill status={p.status} /></>}</span></div>
        {p.title && <h2 className="news-post-title">{p.title}</h2>}
        <div className="news-post-text">{p.body}</div>
        {p.mediaWithheld > 0 && <p className="ops-muted">{p.mediaWithheld} photo(s) hidden for privacy.</p>}
        {p.moderationNote && <p className="ops-callout is-warn">Moderator: {p.moderationNote}</p>}
        {p.tags.length > 0 && <div className="ops-inline">{p.tags.map((t) => <span key={t} className="ops-chip">#{t}</span>)}</div>}
      </div>
      {p.status === 'PUBLISHED' && (
        <div className="news-actions">
          {REACTIONS.map((r) => <button key={r.key} type="button" className={`news-react${p.myReaction === r.key ? ' is-on' : ''}`} aria-pressed={p.myReaction === r.key} aria-label={`${r.label}${p.reactions[r.key] ? ` (${p.reactions[r.key]})` : ''}`} onClick={() => void run(async () => { await opsApi.react(p.id, p.myReaction === r.key ? null : r.key); onChanged(); })}>{r.icon} {p.reactions[r.key] ?? ''}</button>)}
          <button type="button" className="news-react" aria-pressed={p.bookmarked} onClick={() => void run(async () => { await opsApi.bookmark(p.id); onChanged(); })}>{p.bookmarked ? '★ Saved' : '☆ Save'}</button>
          {p.commentsEnabled && <button type="button" className="news-react" aria-expanded={open} onClick={() => setOpen((v) => !v)}>💬 Comments</button>}
          <button type="button" className="news-react" onClick={() => setPrompt('report')}>⚑ Report</button>
          {moderator && <><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.moderatePost(p.id, p.pinned ? 'UNPIN' : 'PIN'); onChanged(); })}>{p.pinned ? 'Unpin' : 'Pin'}</Button><Button small variant="ghost" onClick={() => setPrompt('takedown')}>Take down</Button></>}
        </div>
      )}
      {p.status === 'PENDING_REVIEW' && moderator && <div className="news-actions"><Button small disabled={busy} onClick={() => void run(async () => { await opsApi.moderatePost(p.id, 'PUBLISH'); toast('Published', 'success'); onChanged(); })}>Publish</Button><Button small variant="soft" onClick={() => setPrompt('reject')}>Send back</Button></div>}
      {['DRAFT', 'REJECTED'].includes(p.status) && p.isMine && <div className="news-actions"><Button small disabled={busy} onClick={() => void run(async () => { const r = await opsApi.submitPost(p.id); toast(r.status === 'PUBLISHED' ? 'Published' : 'Sent for review', 'success'); onChanged(); })}>Submit</Button></div>}
      {open && (
        <div className="news-post-body" style={{ borderTop: '1px solid var(--hairline)' }}>
          <Loadable state={full}>{(d) => d && (
            <ul className="ops-list">{(d.comments ?? []).map((c) => <li key={c.id} className="ops-row"><div className="ops-row-main"><b>{c.authorName}</b> {c.body}<div className="ops-row-sub">{fmtDateTime(c.createdAt)}{c.status === 'PENDING' ? ' · awaiting moderation' : ''}</div></div></li>)}</ul>
          )}</Loadable>
          <div className="ops-inline"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a kind comment…" aria-label="Comment" style={{ flex: 1 }} /><Button small disabled={busy || !comment.trim()} onClick={() => void run(async () => { const r = await opsApi.comment(p.id, comment); setComment(''); toast(r.status === 'PENDING' ? 'Comment sent for moderation' : 'Comment posted', 'success'); await full.reload(); })}>Post</Button></div>
        </div>
      )}
      <ErrorNote error={error} />
      {prompt === 'reject' && <PromptModal title="Send back to the author" label="What to change" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moderatePost(p.id, 'REJECT', v).then(onChanged)} />}
      {prompt === 'takedown' && <PromptModal title="Take down this post" label="Reason" danger onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moderatePost(p.id, 'TAKE_DOWN', v).then(onChanged)} />}
      {prompt === 'report' && <PromptModal title="Report this post" label="Details (optional)" required={false} onClose={() => setPrompt(null)} extra={<Field label="Reason"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="INAPPROPRIATE">Inappropriate</option><option value="BULLYING">Bullying</option><option value="PRIVACY">Privacy</option><option value="CONSENT">A pictured student did not consent</option><option value="SPAM">Spam</option><option value="OTHER">Other</option></select></Field>} onSubmit={(v) => opsApi.reportContent({ targetType: 'POST', targetId: p.id, reason, detail: v || undefined }).then(() => toast(reason === 'CONSENT' ? 'Reported — photos hidden while it is reviewed' : 'Reported to moderators', 'info'))} />}
    </article>
  );
}

function Composer({ circles, onDone, onClose }: { circles: CircleDto[]; onDone: () => void; onClose: () => void }) {
  const { me } = useAuth();
  const staff = !['STUDENT', 'PARENT', 'ALUMNUS'].includes(me?.profile?.role ?? '');
  const [f, setF] = useState({ kind: 'STORY', title: '', body: '', audience: 'INSTITUTION', circleId: '', tags: '' });
  const [media, setMedia] = useState<Array<{ url: string; kind: string; altText: string; caption: string; studentIds: string; metadataStripped: boolean }>>([]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title="New story" onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.body.trim()} onClick={() => void run(async () => {
      const r = await opsApi.createPost({ ...f, circleId: f.circleId || undefined, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), media: media.map((m) => ({ ...m, studentIds: m.studentIds.split(',').map((s) => s.trim()).filter(Boolean) })), submit: true });
      toast(r.status === 'PUBLISHED' ? 'Published' : 'Sent to a moderator for review', 'success'); onDone(); onClose();
    })}>{staff ? 'Publish / submit' : 'Submit for review'}</Button></>}>
      <div className="ops-form-grid">
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['STORY', 'ACHIEVEMENT', 'EVENT_HIGHLIGHT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Who can see it"><select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{staff && <option value="PUBLIC">Public (anyone)</option>}<option value="INSTITUTION">Everyone in the institution</option>{circles.filter((c) => c.myStatus === 'ACTIVE').length > 0 && <option value="CIRCLE">A circle</option>}</select></Field>
        {f.audience === 'CIRCLE' && <Field label="Circle"><select className="input" value={f.circleId} onChange={(e) => setF({ ...f, circleId: e.target.value })}><option value="">Choose…</option>{circles.filter((c) => c.myStatus === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      </div>
      <Field label="Story" required><textarea className="input" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ width: '100%' }} /></Field>
      <Field label="Tags (comma separated)"><input className="input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      <AttachUpload label="Add a photo or video" accept=".jpg,.jpeg,.png,.webp,.mp4" hint="Remove location data from photos before uploading." onUploaded={(a) => setMedia((x) => [...x, { url: a.url, kind: a.mimeType.startsWith('video') ? 'VIDEO' : 'IMAGE', altText: '', caption: '', studentIds: '', metadataStripped: false }])} />
      {media.map((m, i) => (
        <div key={i} className="ops-callout">
          <div className="ops-form-grid">
            <Field label="Describe the image (alt text)" required><input className="input" value={m.altText} onChange={(e) => setMedia(media.map((y, j) => (j === i ? { ...y, altText: e.target.value } : y)))} /></Field>
            <Field label="Caption"><input className="input" value={m.caption} onChange={(e) => setMedia(media.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} /></Field>
            {staff && <Field label="Pictured student IDs (comma separated)" hint="Their media consent decides who can see the photo."><input className="input" value={m.studentIds} onChange={(e) => setMedia(media.map((y, j) => (j === i ? { ...y, studentIds: e.target.value } : y)))} /></Field>}
          </div>
          <label className="ops-inline"><input type="checkbox" checked={m.metadataStripped} onChange={(e) => setMedia(media.map((y, j) => (j === i ? { ...y, metadataStripped: e.target.checked } : y)))} /> Location / EXIF data removed</label>
          <Button small variant="ghost" onClick={() => setMedia(media.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <ErrorNote error={error} />
    </Modal>
  );
}

function Circles() {
  const { me } = useAuth();
  const staff = !['STUDENT', 'PARENT', 'ALUMNUS'].includes(me?.profile?.role ?? '');
  const state = useLoad(() => opsApi.circles(), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'CLUB', description: '', joinPolicy: 'APPROVAL' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Circles" sub="Moderated groups for classes, clubs, projects, careers and alumni. Alumni and parent circles are adults-only." actions={(staff || me?.profile?.role === 'ALUMNUS') ? <Button small onClick={() => setCreating(true)}>+ Circle</Button> : undefined}>
        {!rows.length ? <EmptyState title="No circles yet" sub="A teacher can start one for a club or project." /> : (
          <ul className="ops-list">{rows.map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{c.name}</div><div className="ops-row-sub">{humanize(c.kind)} · {c.memberCount} members · {humanize(c.joinPolicy)}{c.adultsOnly ? ' · adults only' : ''}{c.description ? ` · ${c.description}` : ''}</div>
                {c.isModerator && c.members?.filter((m) => m.status === 'PENDING').map((m) => <div key={m.profileId} className="ops-inline">Request: {m.name} <Button small onClick={() => void run(async () => { await opsApi.circleMember(c.id, { profileId: m.profileId, action: 'APPROVE' }); await state.reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.circleMember(c.id, { profileId: m.profileId, action: 'REMOVE' }); await state.reload(); })}>Decline</Button></div>)}
              </div>
              {c.myStatus ? <StatusPill status={c.myStatus === 'ACTIVE' ? 'ACTIVE' : c.myStatus} label={c.isModerator ? 'Moderator' : humanize(c.myStatus)} /> : c.joinPolicy !== 'INVITE' && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await opsApi.joinCircle(c.id); toast(r.status === 'ACTIVE' ? 'Joined' : 'Request sent', 'success'); await state.reload(); })}>Join</Button>}
            </li>
          ))}</ul>
        )}
        {creating && (
          <Modal title="New circle" onClose={() => setCreating(false)} footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.name} onClick={() => void run(async () => { await opsApi.createCircle(f); setCreating(false); await state.reload(); })}>Create</Button></>}>
            <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: '100%' }} /></Field>
            <div className="ops-form-grid">
              <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{(me?.profile?.role === 'ALUMNUS' ? ['ALUMNI'] : ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS']).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
              <Field label="Joining"><select className="input" value={f.joinPolicy} onChange={(e) => setF({ ...f, joinPolicy: e.target.value })}><option value="APPROVAL">On approval</option><option value="OPEN">Open</option><option value="INVITE">By invitation</option></select></Field>
            </div>
            <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
            <ErrorNote error={error} />
          </Modal>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

function Mentoring() {
  const { me } = useAuth();
  const { permissions } = usePermissions();
  const canMentor = Boolean(permissions['mentoring.participate']);
  const moderator = Boolean(permissions['community.moderate']);
  const state = useLoad(() => Promise.all([opsApi.mentors({ all: moderator ? 'true' : undefined }), opsApi.mentoring()]), [moderator]);
  const [profile, setProfile] = useState({ headline: '', topics: '', availability: '', batch: '' });
  const [ask, setAsk] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{([mentors, requests]) => (
      <div className="ops-stack">
        <SectionCard title="Seniors & alumni mentors" sub="Verified alumni and seniors who chose to help. Sessions with students are group or staff-supervised; there is no private messaging with students.">
          {!mentors.length ? <p className="ops-muted">No mentors listed yet.</p> : <ul className="ops-list">{mentors.map((m) => <li key={m.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{m.name}{m.batch ? ` · ${m.batch}` : ''}</div><div className="ops-row-sub">{m.headline}{m.topics.length ? ` · ${m.topics.join(', ')}` : ''}{m.availability ? ` · ${m.availability}` : ''}</div></div>{!m.verified && moderator && <Button small variant="soft" onClick={() => void run(async () => { await opsApi.verifyMentor(m.id); await state.reload(); })}>Verify affiliation</Button>}{m.verified && canMentor && m.profileId !== me?.profile?.id && <Button small onClick={() => setAsk(m.id)}>Ask for mentoring</Button>}</li>)}</ul>}
        </SectionCard>
        {canMentor && (
          <SectionCard title="Offer to mentor" sub="Visible after staff verify your affiliation. Share only what you are comfortable with — no contact details are shown.">
            <div className="ops-form-grid">
              <Field label="Headline"><input className="input" value={profile.headline} onChange={(e) => setProfile({ ...profile, headline: e.target.value })} placeholder="Civil engineer · Batch of 2015" /></Field>
              <Field label="Topics (comma separated)"><input className="input" value={profile.topics} onChange={(e) => setProfile({ ...profile, topics: e.target.value })} /></Field>
              <Field label="Availability"><input className="input" value={profile.availability} onChange={(e) => setProfile({ ...profile, availability: e.target.value })} placeholder="Saturdays" /></Field>
              <Field label="Batch / year"><input className="input" value={profile.batch} onChange={(e) => setProfile({ ...profile, batch: e.target.value })} /></Field>
            </div>
            <Button small disabled={busy} onClick={() => void run(async () => { await opsApi.saveMentorProfile({ ...profile, topics: profile.topics.split(',').map((t) => t.trim()).filter(Boolean) }); toast('Saved — staff will verify your affiliation', 'success'); await state.reload(); })}>Save mentor profile</Button>
          </SectionCard>
        )}
        <SectionCard title="Mentoring requests">
          {!requests.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{requests.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.topic}</div><div className="ops-row-sub">{r.supervised ? 'Supervised' : 'Adults'}{r.supervised && !r.supervisorProfileId ? ' · needs a staff supervisor' : ''}{r.sessions.length ? ` · next ${fmtDateTime(r.sessions.at(-1)!.at)} (${humanize(r.sessions.at(-1)!.mode)})` : ''}</div></div><StatusPill status={r.status} />
            {r.mentorProfileId === me?.profile?.id && r.status === 'REQUESTED' && <><Button small onClick={() => void run(async () => { await opsApi.mentoringAction(r.id, { action: 'ACCEPT' }); await state.reload(); })}>Accept</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.mentoringAction(r.id, { action: 'DECLINE' }); await state.reload(); })}>Decline</Button></>}
            {moderator && r.supervised && !r.supervisorProfileId && <Button small variant="soft" onClick={() => void run(async () => { await opsApi.mentoringAction(r.id, { action: 'ASSIGN_SUPERVISOR' }); await state.reload(); })}>Supervise</Button>}
            {(r.mentorProfileId === me?.profile?.id || r.supervisorProfileId === me?.profile?.id) && ['ACCEPTED', 'SCHEDULED'].includes(r.status) && <Button small variant="soft" onClick={() => { const at = window.prompt('Session date & time (YYYY-MM-DD HH:MM)'); if (at) void run(async () => { await opsApi.mentoringAction(r.id, { action: 'SCHEDULE', at: new Date(at.replace(' ', 'T') + ':00+05:30').toISOString(), mode: r.supervised ? 'GROUP_ONLINE' : 'ONE_TO_ONE' }); await state.reload(); }); }}>Schedule session</Button>}
          </li>)}</ul>}
        </SectionCard>
        <ErrorNote error={error} />
        {ask && <PromptModal title="Ask for mentoring" label="What would you like help with?" onClose={() => setAsk(null)} onSubmit={(v) => opsApi.requestMentoring({ mentorId: ask, topic: v.slice(0, 120), message: v }).then(() => { toast('Request sent', 'success'); return state.reload(); })} />}
      </div>
    )}</Loadable>
  );
}

export function ConsentsPanel() {
  const state = useLoad(() => opsApi.consents(), []);
  const { run, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(rows) => !rows.length ? null : (
      <SectionCard title="Photo & media consent" sub="Decide where photos of your child (or you, as an adult student) may appear. You can change this at any time; it takes effect immediately, including on posts already published.">
        {rows.map((c) => (
          <div key={c.studentId} className="ops-row"><div className="ops-row-main"><b>{c.name}</b></div>
            {(['NONE', 'INTERNAL', 'PUBLIC'] as const).map((lvl) => <label key={lvl} className="ops-chip"><input type="radio" name={`consent-${c.studentId}`} checked={c.level === lvl} onChange={() => void run(async () => { await opsApi.setConsent(c.studentId, lvl); toast('Consent updated', 'success'); await state.reload(); })} />{lvl === 'NONE' ? 'Not shown' : lvl === 'INTERNAL' ? 'School community only' : 'Also public pages'}</label>)}
          </div>
        ))}
        <ErrorNote error={error} />
      </SectionCard>
    )}</Loadable>
  );
}

export function NewsroomView({ initialTab }: { initialTab?: 'feed' | 'circles' | 'mentoring' | 'consent' } = {}) {
  const { permissions } = usePermissions();
  const moderator = Boolean(permissions['community.moderate']);
  const canPost = Boolean(permissions['community.post']);
  const queryTab = useQueryParam('tab') as 'review' | 'mine' | 'circles' | null;
  const [tab, setTab] = useState<'feed' | 'saved' | 'mine' | 'review' | 'circles' | 'mentoring' | 'consent'>(initialTab ?? queryTab ?? 'feed');
  const [q, setQ] = useState('');
  const [composing, setComposing] = useState(false);
  const feed = useLoad(() => (['feed', 'saved', 'mine', 'review'].includes(tab) ? opsApi.feed({ tab: tab === 'feed' ? undefined : tab, q }) : Promise.resolve(null)), [tab, q]);
  const circles = useLoad(() => opsApi.circles(), []);
  const pending = useLoad(() => (moderator && tab === 'review' ? opsApi.pendingComments() : Promise.resolve([])), [moderator, tab]);
  const reports = useLoad(() => (moderator && tab === 'review' ? opsApi.communityReports() : Promise.resolve([])), [moderator, tab]);
  const { run } = useAction();
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <Tabs tabs={[{ key: 'feed', label: 'Newsroom' }, { key: 'saved', label: 'Saved' }, ...(canPost ? [{ key: 'mine' as const, label: 'My posts' }] : []), ...(moderator ? [{ key: 'review' as const, label: 'Moderation' }] : []), { key: 'circles', label: 'Circles' }, { key: 'mentoring', label: 'Mentoring' }, { key: 'consent', label: 'Consent' }]} value={tab} onChange={setTab} />
        {canPost && <Button onClick={() => setComposing(true)}>+ Share a story</Button>}
      </div>
      {['feed', 'saved', 'mine', 'review'].includes(tab) && (
        <>
          {tab === 'feed' && <SearchInput value={q} onChange={setQ} placeholder="Search stories, events, achievements" />}
          {tab === 'review' && (
            <div className="ops-grid-2">
              <Loadable state={pending}>{(rows) => <SectionCard title={`Comments awaiting moderation (${rows.length})`}>{!rows.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{rows.map((c) => <li key={c.id} className="ops-row"><div className="ops-row-main"><b>{c.authorName}</b> {c.body}</div><Button small onClick={() => void run(async () => { await opsApi.moderateComment(c.id, 'APPROVE'); await pending.reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.moderateComment(c.id, 'HIDE', 'Not suitable'); await pending.reload(); })}>Hide</Button></li>)}</ul>}</SectionCard>}</Loadable>
              <Loadable state={reports}>{(rows) => <SectionCard title={`Reports (${rows.length})`}>{!rows.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{rows.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><b>{humanize(r.reason)}</b> on {humanize(r.targetType)}{r.detail ? ` — ${r.detail}` : ''}</div><Button small variant="soft" onClick={() => { const res = window.prompt('Resolution'); if (res) void run(async () => { await opsApi.resolveReport(r.id, { status: 'ACTIONED', resolution: res }); await reports.reload(); }); }}>Actioned</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.resolveReport(r.id, { status: 'DISMISSED', resolution: 'Reviewed, no action needed' }); await reports.reload(); })}>Dismiss</Button></li>)}</ul>}</SectionCard>}</Loadable>
            </div>
          )}
          <Loadable state={feed}>{(d) => !d?.items.length ? <EmptyState title={tab === 'review' ? 'Nothing waiting' : 'No stories yet'} sub={tab === 'feed' ? 'Events, ceremonies, achievements and club news appear here.' : 'Nothing here yet.'} /> : (
            <div className="news-feed" style={{ maxWidth: 760 }}>{d.items.map((p) => <PostCard key={p.id} p={p} moderator={moderator} onChanged={() => void feed.reload()} />)}</div>
          )}</Loadable>
        </>
      )}
      {tab === 'circles' && <Circles />}
      {tab === 'mentoring' && <Mentoring />}
      {tab === 'consent' && <ConsentsPanel />}
      <DataNote>Posts never show phone numbers, addresses, attendance, health or whereabouts. Reports are reviewed by a person.</DataNote>
      {composing && <Composer circles={circles.data ?? []} onClose={() => setComposing(false)} onDone={() => void feed.reload()} />}
    </div>
  );
}
