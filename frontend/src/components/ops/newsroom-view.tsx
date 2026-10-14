'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button, EmptyState, Field, Modal, Pill, SearchInput, useToast } from '@/components/ui';
import { api, fileHref, request } from '@/lib/api';
import { opsApi, patch, del, post as apiPost } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { CircleDto, MentorshipDto, PostDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Newsroom & community. Every post has an explicit audience; students' posts
 * and comments are moderated, and so are outside adults' comments wherever
 * students read them; pictured students appear only where their consent
 * allows, and withdrawing consent removes the picture everywhere at once.
 * Circles are moderated, alumni circles are adults-only, school circles take
 * outside adults only by staff invitation, and mentoring with students is
 * always supervised. No popularity rankings.
 */

// ── types the newer API fields add ─────────────────────────────────────
type MediaItem = PostDto['media'][number] & { hidden?: boolean };
export type NewsPost = Omit<PostDto, 'media' | 'comments'> & {
  media: MediaItem[];
  commentPolicy?: CommentPolicy; canComment?: boolean; canModerate?: boolean; commentCount?: number; audienceRef?: string[] | null;
  comments?: Array<{ id: string; authorName: string | null; authorRole?: string | null; body: string; status: string; createdAt: string; isMine: boolean; edited?: boolean }>;
};
type NewsCircle = CircleDto & { adultsWelcome?: boolean; canJoin?: boolean };
type Mentorship = MentorshipDto & { mentorName?: string | null; menteeName?: string | null; supervisorName?: string | null };
type CommentPolicy = 'OFF' | 'STAFF_ONLY' | 'PRE_MODERATED' | 'OPEN';
type ReportRow = {
  id: string; targetType: string; targetId: string; reason: string; detail: string | null; status: string; createdAt: string; reporterName?: string | null; openOnTarget?: number;
  target?: { exists: boolean; title?: string | null; excerpt?: string; status?: string; author?: string | null; postId?: string; link?: string; mediaHidden?: boolean };
};
type TaggableStudent = { id: string; name: string; className: string | null; consent: 'NONE' | 'INTERNAL' | 'PUBLIC' };
type FeedPage = { items: NewsPost[]; page: number; pageSize: number; hasMore?: boolean };

/** Calls the newer community endpoints that the shared client does not list yet. */
export const newsApi = {
  feed: (p: Record<string, string | number | undefined>) => opsApi.feed(p) as unknown as Promise<FeedPage>,
  post: (id: string) => opsApi.postById(id) as unknown as Promise<NewsPost>,
  updatePost: (id: string, body: unknown) => patch<NewsPost>(`/community/posts/${id}`, body),
  withdrawPost: (id: string) => del<{ status: string }>(`/community/posts/${id}`),
  editComment: (id: string, body: string) => patch<{ status: string }>(`/community/comments/${id}`, { body }),
  deleteComment: (id: string) => del<{ status: string }>(`/community/comments/${id}`),
  leaveCircle: (id: string) => apiPost<{ status: string }>(`/community/circles/${id}/leave`),
  students: (q: string) => request<TaggableStudent[]>(`/community/students?q=${encodeURIComponent(q)}`),
  reports: () => opsApi.communityReports() as unknown as Promise<ReportRow[]>,
  consentOverride: (body: { studentId: string; level: string; evidence: string }) => apiPost('/community/consents', body),
};

const REACTIONS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'CLAP', label: 'Applaud', icon: '👏' }, { key: 'HEART', label: 'Love', icon: '❤️' }, { key: 'CELEBRATE', label: 'Celebrate', icon: '🎉' }, { key: 'INSPIRED', label: 'Inspired', icon: '✨' },
];
const REPORT_REASONS: Array<[string, string]> = [['INAPPROPRIATE', 'Inappropriate'], ['BULLYING', 'Bullying'], ['PRIVACY', 'Privacy'], ['CONSENT', 'A pictured student did not consent'], ['SPAM', 'Spam'], ['OTHER', 'Other']];
const POLICY_LABEL: Record<CommentPolicy, string> = { OPEN: 'Comments on (students\' and visitors\' comments are checked first)', PRE_MODERATED: 'Every comment checked by a moderator first', STAFF_ONLY: 'Only staff can reply', OFF: 'Comments off' };
const OUTSIDE_ADULTS = ['PARENT', 'ALUMNUS', 'TRUSTEE'];
const ROLE_CHOICES = ['STUDENT', 'PARENT', 'TEACHER', 'ALUMNUS', 'ADMIN', 'PRINCIPAL', 'LIBRARIAN', 'WARDEN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE'];
const isStaffRole = (role: string | undefined) => !['STUDENT', ...OUTSIDE_ADULTS].includes(role ?? '');

const STYLE = `
.news-chip-btn{background:none;border:0;cursor:pointer;padding:0 0 0 4px;color:inherit}
.news-held{outline:3px dashed var(--amber, #b7791f);outline-offset:-3px;opacity:.85}
.news-comment-meta{font-size:12px;color:var(--text-2)}
.news-react:focus-visible,.news-chip-btn:focus-visible{outline:2px solid var(--accent, #2563eb);outline-offset:2px}
.news-feed-wrap{max-width:760px;width:100%}
`;

function ReportModal({ targetType, targetId, onClose }: { targetType: 'POST' | 'COMMENT'; targetId: string; onClose: () => void }) {
  const [reason, setReason] = useState('INAPPROPRIATE');
  const toast = useToast();
  return (
    <PromptModal title={targetType === 'POST' ? 'Report this post' : 'Report this comment'} label="Details (optional)" required={false} onClose={onClose}
      extra={<Field label="Reason"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.filter(([k]) => targetType === 'POST' || k !== 'CONSENT').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      onSubmit={(v) => opsApi.reportContent({ targetType, targetId, reason, detail: v || undefined }).then((r) => {
        const res = r as { duplicate?: boolean; mediaHidden?: boolean };
        toast(res.duplicate ? 'You have already reported this; a moderator will look at it.' : res.mediaHidden ? 'Reported — photos are held while it is reviewed' : 'Reported to moderators', 'info');
      })} />
  );
}

function Comments({ p, onCount }: { p: NewsPost; onCount: () => void }) {
  const full = useLoad(() => newsApi.post(p.id), [p.id]);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await full.reload(); onCount(); };
  return (
    <div className="news-post-body" style={{ borderTop: '1px solid var(--hairline)' }}>
      <Loadable state={full}>{(d) => (
        !(d.comments ?? []).length ? <p className="ops-muted">No comments yet.</p> : (
          <ul className="ops-list">{(d.comments ?? []).map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main">
                {editing?.id === c.id ? (
                  <div className="ops-inline"><input className="input" aria-label="Edit comment" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} style={{ flex: 1 }} />
                    <Button small disabled={busy || !editing.body.trim()} onClick={() => void run(async () => { const r = await newsApi.editComment(c.id, editing.body); setEditing(null); toast(r.status === 'PENDING' ? 'Edit sent for moderation' : 'Comment updated', 'success'); await reload(); })}>Save</Button>
                    <Button small variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                ) : <><b>{c.authorName}</b>{c.authorRole && <> <Pill tone={c.authorRole === 'STUDENT' ? 'blue' : isStaffRole(c.authorRole) ? 'green' : 'gray'}>{humanize(c.authorRole)}</Pill></>} {c.body}</>}
                <div className="news-comment-meta">{fmtDateTime(c.createdAt)}{c.edited ? ' · edited' : ''}{c.status === 'PENDING' ? ' · awaiting moderation' : ''}{c.status === 'HIDDEN' ? ' · hidden by a moderator' : ''}</div>
              </div>
              {c.isMine && c.status !== 'HIDDEN' && editing?.id !== c.id && <><Button small variant="ghost" onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</Button><Button small variant="ghost" onClick={() => void run(async () => { await newsApi.deleteComment(c.id); await reload(); })}>Delete</Button></>}
              {!c.isMine && c.status === 'VISIBLE' && <Button small variant="ghost" onClick={() => setReporting(c.id)}>Report</Button>}
              {p.canModerate && c.status === 'PENDING' && <><Button small onClick={() => void run(async () => { await opsApi.moderateComment(c.id, 'APPROVE'); await reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => setHiding(c.id)}>Hide</Button></>}
            </li>
          ))}</ul>
        )
      )}</Loadable>
      {p.canComment === false ? <p className="ops-muted">{p.commentPolicy === 'STAFF_ONLY' ? 'Only staff can reply to this post.' : 'Comments are closed.'}</p> : (
        <div className="ops-inline"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a kind comment…" aria-label="Comment" style={{ flex: 1 }} /><Button small disabled={busy || !comment.trim()} onClick={() => void run(async () => { const r = await opsApi.comment(p.id, comment); setComment(''); toast(r.status === 'PENDING' ? 'Comment sent for moderation' : 'Comment posted', 'success'); await reload(); })}>Post</Button></div>
      )}
      <ErrorNote error={error} />
      {reporting && <ReportModal targetType="COMMENT" targetId={reporting} onClose={() => setReporting(null)} />}
      {hiding && <PromptModal title="Hide this comment" label="Reason (kept on record)" onClose={() => setHiding(null)} onSubmit={(v) => opsApi.moderateComment(hiding, 'HIDE', v).then(reload)} />}
    </div>
  );
}

export function PostCard({ p, onChanged, moderator, circles = [] }: { p: NewsPost; onChanged: () => void; moderator: boolean; circles?: NewsCircle[] }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<null | 'reject' | 'takedown' | 'report' | 'reinstate' | 'withdraw'>(null);
  const [editing, setEditing] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const canModerate = moderator || Boolean(p.canModerate);
  return (
    <article className="news-post" aria-label={p.title ?? 'Post'}>
      {p.media.length > 0 && (
        <div className="news-media">{p.media.map((m) => {
          const held = m.hidden ? ' news-held' : '';
          return m.kind === 'VIDEO'
            // Uploaded videos carry no caption track, so they open in a new tab
            // with their description rather than playing inline uncaptioned.
            ? <a key={m.id} href={fileHref(m.url)} target="_blank" rel="noreferrer" className={`ops-callout${held}`}>▶ Watch video{m.altText ? ` — ${m.altText}` : ''}{m.caption ? ` (${m.caption})` : ''}</a>
            : m.kind === 'IMAGE'
              // eslint-disable-next-line @next/next/no-img-element -- an uploaded file on the API origin, signed per response; next/image has no loader for it
              ? <img key={m.id} src={fileHref(m.url)} alt={m.altText ?? ''} loading="lazy" className={held.trim() || undefined} />
              : <a key={m.id} href={fileHref(m.url)} target="_blank" rel="noreferrer">📎 {m.caption ?? 'Document'}</a>;
        })}</div>
      )}
      <div className="news-post-body">
        <div className="news-post-head"><span>{humanize(p.kind)} · {p.authorName}{p.authorRole ? ` (${humanize(p.authorRole)})` : ''}{p.publishedAt ? ` · ${fmtDateTime(p.publishedAt)}` : ''}{p.pinned ? ' · 📌' : ''}</span><span>{p.audience === 'PUBLIC' ? '🌐 Public' : p.audience === 'CIRCLE' ? `◎ ${circles.find((c) => c.id === p.circleId)?.name ?? 'Circle'}` : humanize(p.audience)}{p.status !== 'PUBLISHED' && <> · <StatusPill status={p.status} /></>}</span></div>
        {p.title && <h2 className="news-post-title">{p.title}</h2>}
        <div className="news-post-text">{p.body}</div>
        {p.media.some((m) => m.hidden) && <p className="ops-callout is-warn">Photos outlined are held for a consent report. Only moderators can see them.</p>}
        {p.mediaWithheld > 0 && <p className="ops-muted">{p.mediaWithheld} photo(s) hidden for privacy.</p>}
        {p.moderationNote && <p className="ops-callout is-warn">Moderator: {p.moderationNote}</p>}
        {p.tags.length > 0 && <div className="ops-inline">{p.tags.map((t) => <span key={t} className="ops-chip">#{t}</span>)}</div>}
      </div>
      {p.status === 'PUBLISHED' && (
        <div className="news-actions">
          {REACTIONS.map((r) => <button key={r.key} type="button" title={r.label} className={`news-react${p.myReaction === r.key ? ' is-on' : ''}`} aria-pressed={p.myReaction === r.key} aria-label={`${r.label}${p.reactions[r.key] ? ` (${p.reactions[r.key]})` : ''}`} onClick={() => void run(async () => { await opsApi.react(p.id, p.myReaction === r.key ? null : r.key); onChanged(); })}>{r.icon} {p.reactions[r.key] ?? ''}</button>)}
          <button type="button" className="news-react" aria-pressed={p.bookmarked} onClick={() => void run(async () => { await opsApi.bookmark(p.id); onChanged(); })}>{p.bookmarked ? '★ Saved' : '☆ Save'}</button>
          {(p.commentsEnabled || (p.commentCount ?? 0) > 0) && <button type="button" className="news-react" aria-expanded={open} onClick={() => setOpen((v) => !v)}>💬 {p.commentCount ? `${p.commentCount} comment${p.commentCount === 1 ? '' : 's'}` : 'Comments'}</button>}
          {!p.isMine && <button type="button" className="news-react" onClick={() => setPrompt('report')}>⚑ Report</button>}
          {canModerate && <><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.moderatePost(p.id, p.pinned ? 'UNPIN' : 'PIN'); onChanged(); })}>{p.pinned ? 'Unpin' : 'Pin'}</Button><Button small variant="ghost" onClick={() => setPrompt('takedown')}>Take down</Button></>}
        </div>
      )}
      {p.status === 'PENDING_REVIEW' && canModerate && !p.isMine && <div className="news-actions"><Button small disabled={busy} onClick={() => void run(async () => { await opsApi.moderatePost(p.id, 'PUBLISH'); toast('Published', 'success'); onChanged(); })}>Publish</Button><Button small variant="soft" onClick={() => setPrompt('reject')}>Send back</Button></div>}
      {['TAKEN_DOWN', 'ARCHIVED'].includes(p.status) && moderator && <div className="news-actions"><Button small variant="soft" onClick={() => setPrompt('reinstate')}>Reinstate</Button></div>}
      {p.isMine && ['DRAFT', 'REJECTED', 'PENDING_REVIEW', 'PUBLISHED'].includes(p.status) && (
        <div className="news-actions">
          {['DRAFT', 'REJECTED'].includes(p.status) && <Button small disabled={busy} onClick={() => void run(async () => { const r = await opsApi.submitPost(p.id); toast(r.status === 'PUBLISHED' ? 'Published' : 'Sent for review', 'success'); onChanged(); })}>Submit</Button>}
          <Button small variant="soft" onClick={() => setEditing(true)}>Edit</Button>
          <Button small variant="ghost" onClick={() => setPrompt('withdraw')}>Withdraw</Button>
        </div>
      )}
      {open && <Comments p={p} onCount={onChanged} />}
      <ErrorNote error={error} />
      {prompt === 'reject' && <PromptModal title="Send back to the author" label="What to change" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moderatePost(p.id, 'REJECT', v).then(onChanged)} />}
      {prompt === 'takedown' && <PromptModal title="Take down this post" label="Reason" danger onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moderatePost(p.id, 'TAKE_DOWN', v).then(onChanged)} />}
      {prompt === 'reinstate' && <PromptModal title="Reinstate this post" label="Why it can go back up" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moderatePost(p.id, 'PUBLISH', v).then(onChanged)} />}
      {prompt === 'withdraw' && <PromptModal title="Withdraw this post?" label="Type WITHDRAW to confirm" multiline={false} danger confirmLabel="Withdraw" onClose={() => setPrompt(null)} onSubmit={async (v) => { if (v.toUpperCase() !== 'WITHDRAW') throw new Error('Type WITHDRAW to confirm.'); await newsApi.withdrawPost(p.id); toast('Post withdrawn', 'success'); onChanged(); }} />}
      {prompt === 'report' && <ReportModal targetType="POST" targetId={p.id} onClose={() => setPrompt(null)} />}
      {editing && <Composer circles={circles} editing={p} onClose={() => setEditing(false)} onDone={onChanged} />}
    </article>
  );
}

type MediaDraft = { url: string; kind: string; altText: string; caption: string; metadataStripped: boolean; who: 'NONE' | 'TAGGED' | ''; students: TaggableStudent[] };

/** Search the roster and tag pictured students; their consent is shown before anything is published. */
function StudentPicker({ value, onChange }: { value: TaggableStudent[]; onChange: (v: TaggableStudent[]) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TaggableStudent[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    let live = true;
    const t = setTimeout(() => { void newsApi.students(q.trim()).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const tone = (c: string) => (c === 'PUBLIC' ? 'green' : c === 'INTERNAL' ? 'amber' : 'red') as 'green' | 'amber' | 'red';
  return (
    <div>
      <div className="ops-inline">{value.map((s) => <span key={s.id} className="ops-chip">{s.name}{s.className ? ` · ${s.className}` : ''} <Pill tone={tone(s.consent)}>{s.consent === 'NONE' ? 'No consent' : s.consent === 'INTERNAL' ? 'School only' : 'Public OK'}</Pill><button type="button" className="news-chip-btn" aria-label={`Remove ${s.name}`} onClick={() => onChange(value.filter((x) => x.id !== s.id))}>✕</button></span>)}</div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a student's name…" aria-label="Find a pictured student" />
      {rows.length > 0 && <ul className="ops-list">{rows.filter((r) => !value.some((v) => v.id === r.id)).map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main">{r.name}{r.className ? ` · ${r.className}` : ''} <Pill tone={tone(r.consent)}>{humanize(r.consent)}</Pill></div><Button small variant="soft" onClick={() => { onChange([...value, r]); setQ(''); }}>Tag</Button></li>)}</ul>}
    </div>
  );
}

function Composer({ circles, onDone, onClose, editing }: { circles: NewsCircle[]; onDone: () => void; onClose: () => void; editing?: NewsPost }) {
  const { me } = useAuth();
  const role = me?.profile?.role ?? '';
  const staff = isStaffRole(role);
  const { permissions } = usePermissions();
  const moderator = Boolean(permissions['community.moderate']);
  const [f, setF] = useState({
    kind: editing?.kind ?? 'STORY', title: editing?.title ?? '', body: editing?.body ?? '', audience: editing?.audience ?? 'INSTITUTION', circleId: editing?.circleId ?? '', tags: (editing?.tags ?? []).join(', '),
    commentPolicy: (editing?.commentPolicy ?? 'OPEN') as CommentPolicy, audienceRef: (editing?.audienceRef ?? []) as string[],
  });
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const sections = useLoad(() => (staff && (role === 'TEACHER' || moderator) ? (moderator ? api.allSections() : api.mySections()) : Promise.resolve([])), [staff, role, moderator]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const myCircles = circles.filter((c) => c.myStatus === 'ACTIVE' || c.isModerator);
  const setM = (i: number, patchM: Partial<MediaDraft>) => setMedia(media.map((y, j) => (j === i ? { ...y, ...patchM } : y)));
  const payload = (submit: boolean) => ({
    kind: f.kind, title: f.title, body: f.body, audience: f.audience, commentPolicy: f.commentPolicy,
    circleId: f.audience === 'CIRCLE' ? f.circleId || undefined : undefined,
    audienceRef: ['ROLE', 'CLASS'].includes(f.audience) ? f.audienceRef : undefined,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    // On an edit the existing media stay unless new files are added.
    ...(editing && !media.length ? {} : { media: media.map((m) => ({ url: m.url, kind: m.kind, altText: m.altText, caption: m.caption, metadataStripped: m.metadataStripped, noIdentifiableStudents: m.who === 'NONE', studentIds: m.who === 'TAGGED' ? m.students.map((s) => s.id) : [] })) }),
    submit,
  });
  const save = (submit: boolean) => void run(async () => {
    const r = editing ? await newsApi.updatePost(editing.id, payload(submit)) : await opsApi.createPost(payload(submit));
    toast(r.status === 'PUBLISHED' ? (editing ? 'Saved' : 'Published') : r.status === 'PENDING_REVIEW' ? 'Sent to a moderator for review' : 'Draft saved', 'success'); onDone(); onClose();
  });
  const mediaReady = media.every((m) => (m.kind !== 'IMAGE' || (m.altText.trim() && m.metadataStripped)) && (m.who === 'NONE' || (m.who === 'TAGGED' && m.students.length > 0)));
  const audienceReady = (f.audience !== 'CIRCLE' || f.circleId) && (!['ROLE', 'CLASS'].includes(f.audience) || f.audienceRef.length > 0);
  const ready = Boolean(f.body.trim()) && mediaReady && audienceReady;
  const publishedEdit = editing?.status === 'PUBLISHED';
  return (
    <Modal title={editing ? 'Edit story' : 'New story'} onClose={onClose} wide footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      {(!editing || ['DRAFT', 'REJECTED'].includes(editing.status)) && <Button variant="soft" disabled={busy || !f.body.trim()} onClick={() => save(false)}>Save draft</Button>}
      <Button disabled={busy || !ready} onClick={() => save(!publishedEdit && editing?.status !== 'PENDING_REVIEW')}>{publishedEdit ? 'Save changes' : editing?.status === 'PENDING_REVIEW' ? 'Save' : staff ? 'Publish / submit' : 'Submit for review'}</Button>
    </>}>
      {publishedEdit && !moderator && !editing?.canModerate && <p className="ops-callout is-warn">Changing a published story sends it back to a moderator before it reappears.</p>}
      <div className="ops-form-grid">
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['STORY', 'ACHIEVEMENT', 'EVENT_HIGHLIGHT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY', 'CIRCLE_POST'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Who can see it"><select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value, audienceRef: [] })}>
          {staff && <option value="PUBLIC">Public (anyone)</option>}
          <option value="INSTITUTION">Everyone in the institution</option>
          {staff && (sections.data ?? []).length > 0 && <option value="CLASS">Particular classes</option>}
          {staff && <option value="ROLE">Particular roles</option>}
          {myCircles.length > 0 && <option value="CIRCLE">A circle</option>}
        </select></Field>
        {f.audience === 'CIRCLE' && <Field label="Circle"><select className="input" value={f.circleId} onChange={(e) => setF({ ...f, circleId: e.target.value })}><option value="">Choose…</option>{myCircles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Comments"><select className="input" value={f.commentPolicy} onChange={(e) => setF({ ...f, commentPolicy: e.target.value as CommentPolicy })}>{(Object.keys(POLICY_LABEL) as CommentPolicy[]).map((k) => <option key={k} value={k}>{POLICY_LABEL[k]}</option>)}</select></Field>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      </div>
      {f.audience === 'CLASS' && (
        <fieldset className="ops-inline" style={{ border: 0, padding: 0 }}><legend className="field-label">Classes</legend>
          {(sections.data ?? []).map((s) => <label key={s.id} className="ops-chip"><input type="checkbox" checked={f.audienceRef.includes(s.id)} onChange={(e) => setF({ ...f, audienceRef: e.target.checked ? [...f.audienceRef, s.id] : f.audienceRef.filter((x) => x !== s.id) })} /> {s.gradeName}-{s.name}</label>)}
        </fieldset>
      )}
      {f.audience === 'ROLE' && (
        <fieldset className="ops-inline" style={{ border: 0, padding: 0 }}><legend className="field-label">Roles</legend>
          {ROLE_CHOICES.map((r) => <label key={r} className="ops-chip"><input type="checkbox" checked={f.audienceRef.includes(r)} onChange={(e) => setF({ ...f, audienceRef: e.target.checked ? [...f.audienceRef, r] : f.audienceRef.filter((x) => x !== r) })} /> {humanize(r)}</label>)}
        </fieldset>
      )}
      <Field label="Story" required><textarea className="input" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ width: '100%' }} /></Field>
      <Field label="Tags (comma separated)"><input className="input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      {editing && editing.media.length > 0 && !media.length && <p className="ops-muted">{editing.media.length} existing photo(s)/video(s) are kept. Adding new files replaces them.</p>}
      <AttachUpload label="Add a photo or video" accept=".jpg,.jpeg,.png,.webp,.mp4" hint="Remove location data from photos before uploading." onUploaded={(a) => setMedia((x) => [...x, { url: a.url, kind: a.mimeType.startsWith('video') ? 'VIDEO' : 'IMAGE', altText: '', caption: '', metadataStripped: false, who: '', students: [] }])} />
      {media.map((m, i) => (
        <div key={i} className="ops-callout">
          <div className="ops-form-grid">
            <Field label={m.kind === 'IMAGE' ? 'Describe the image (alt text)' : 'Describe the video'} required={m.kind === 'IMAGE'}><input className="input" value={m.altText} onChange={(e) => setM(i, { altText: e.target.value })} /></Field>
            <Field label="Caption"><input className="input" value={m.caption} onChange={(e) => setM(i, { caption: e.target.value })} /></Field>
          </div>
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="field-label">Who is in it? <span aria-hidden="true" style={{ color: 'var(--red)' }}>*</span></legend>
            <label className="ops-inline"><input type="radio" name={`who-${i}`} checked={m.who === 'NONE'} onChange={() => setM(i, { who: 'NONE', students: [] })} /> No student can be identified</label>
            {staff
              ? <label className="ops-inline"><input type="radio" name={`who-${i}`} checked={m.who === 'TAGGED'} onChange={() => setM(i, { who: 'TAGGED' })} /> Students are pictured — tag them so their consent applies</label>
              : <p className="ops-muted">If other students can be recognised, ask a teacher to share the photo: staff check each family&apos;s consent first.</p>}
          </fieldset>
          {m.who === 'TAGGED' && staff && <StudentPicker value={m.students} onChange={(students) => setM(i, { students })} />}
          {m.kind === 'IMAGE' && <label className="ops-inline"><input type="checkbox" checked={m.metadataStripped} onChange={(e) => setM(i, { metadataStripped: e.target.checked })} /> Location / EXIF data removed</label>}
          <Button small variant="ghost" onClick={() => setMedia(media.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <ErrorNote error={error} />
    </Modal>
  );
}

function Circles({ onOpen }: { onOpen: (c: NewsCircle) => void }) {
  const { me } = useAuth();
  const role = me?.profile?.role ?? '';
  const staff = isStaffRole(role);
  const state = useLoad(() => opsApi.circles() as Promise<NewsCircle[]>, []);
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState<NewsCircle | null>(null);
  const [f, setF] = useState({ name: '', kind: 'CLUB', description: '', joinPolicy: 'APPROVAL', adultsWelcome: false });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const adultKind = ['ALUMNI', 'PARENTS'].includes(f.kind);
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Circles" sub="Moderated groups for classes, clubs, projects, careers and alumni. Alumni and parent circles are adults-only; school circles are for students and staff, with outside adults only by staff invitation." actions={(staff || role === 'ALUMNUS') ? <Button small onClick={() => setCreating(true)}>+ Circle</Button> : undefined}>
        {!rows.length ? <EmptyState title="No circles yet" sub="A teacher can start one for a club or project." /> : (
          <ul className="ops-list">{rows.map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{c.name}</div><div className="ops-row-sub">{humanize(c.kind)} · {c.memberCount} members · {humanize(c.joinPolicy)}{c.adultsOnly ? ' · adults only' : c.adultsWelcome ? ' · invited adults' : ''}{c.description ? ` · ${c.description}` : ''}</div>
                {c.isModerator && c.members?.filter((m) => m.status === 'PENDING').map((m) => <div key={m.profileId} className="ops-inline">Request: {m.name} ({humanize(m.roleKey)}) <Button small onClick={() => void run(async () => { await opsApi.circleMember(c.id, { profileId: m.profileId, action: 'APPROVE' }); await state.reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.circleMember(c.id, { profileId: m.profileId, action: 'REMOVE' }); await state.reload(); })}>Decline</Button></div>)}
              </div>
              {(c.myStatus === 'ACTIVE' || c.isModerator) && <Button small variant="soft" onClick={() => onOpen(c)}>View posts</Button>}
              {c.myStatus && c.myStatus !== 'LEFT' && <StatusPill status={c.myStatus === 'ACTIVE' ? 'ACTIVE' : c.myStatus} label={c.isModerator ? 'Moderator' : humanize(c.myStatus)} />}
              {(c.myStatus === 'ACTIVE' || c.myStatus === 'PENDING') && <Button small variant="ghost" onClick={() => setLeaving(c)}>{c.myStatus === 'PENDING' ? 'Cancel request' : 'Leave'}</Button>}
              {(c.canJoin ?? (!c.myStatus && c.joinPolicy !== 'INVITE')) && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await opsApi.joinCircle(c.id); toast(r.status === 'ACTIVE' ? 'Joined' : 'Request sent', 'success'); await state.reload(); })}>Join</Button>}
            </li>
          ))}</ul>
        )}
        <ErrorNote error={error} />
        {leaving && (
          <Modal title={`Leave ${leaving.name}?`} onClose={() => setLeaving(null)} footer={<><Button variant="soft" onClick={() => setLeaving(null)}>Stay</Button><Button disabled={busy} onClick={() => void run(async () => { await newsApi.leaveCircle(leaving.id); setLeaving(null); toast('You left the circle', 'success'); await state.reload(); })}>Leave</Button></>}>
            <p>You will stop seeing this circle&apos;s posts.{leaving.joinPolicy === 'OPEN' ? ' You can join again later.' : ' Rejoining needs a moderator\'s approval.'}</p>
          </Modal>
        )}
        {creating && (
          <Modal title="New circle" onClose={() => setCreating(false)} footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.name} onClick={() => void run(async () => { await opsApi.createCircle({ ...f, adultsWelcome: !adultKind && f.adultsWelcome }); setCreating(false); await state.reload(); })}>Create</Button></>}>
            <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: '100%' }} /></Field>
            <div className="ops-form-grid">
              <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{(role === 'ALUMNUS' ? ['ALUMNI'] : ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS']).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
              <Field label="Joining"><select className="input" value={f.joinPolicy} onChange={(e) => setF({ ...f, joinPolicy: e.target.value })}><option value="APPROVAL">On approval</option><option value="OPEN">Open</option><option value="INVITE">By invitation</option></select></Field>
            </div>
            <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
            {staff && !adultKind && <label className="ops-inline"><input type="checkbox" checked={f.adultsWelcome} onChange={(e) => setF({ ...f, adultsWelcome: e.target.checked })} /> Staff may invite alumni or parents (e.g. a careers circle). They never join by themselves and never see the student member list.</label>}
            <ErrorNote error={error} />
          </Modal>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

function ScheduleModal({ r, onClose, onDone }: { r: Mentorship; onClose: () => void; onDone: () => void }) {
  const modes = r.supervised ? ['GROUP_ONLINE', 'GROUP_ON_CAMPUS', 'ONE_TO_ONE_SUPERVISED'] : ['ONE_TO_ONE', 'GROUP_ONLINE', 'GROUP_ON_CAMPUS'];
  const [at, setAt] = useState('');
  const [mode, setMode] = useState(modes[0]);
  const [link, setLink] = useState('');
  const { run, busy, error } = useAction();
  const when = at ? new Date(at) : null;
  const valid = Boolean(when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now()) && (!link || link.startsWith('https://'));
  return (
    <Modal title="Schedule a session" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !valid} onClick={() => void run(async () => { await opsApi.mentoringAction(r.id, { action: 'SCHEDULE', at: when!.toISOString(), mode, link: link || undefined }); onDone(); onClose(); })}>Schedule</Button></>}>
      {/* datetime-local is in the viewer's own time zone; it is sent as an exact instant. */}
      <Field label="Date and time" required hint="In your local time."><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      <Field label="Format">{<select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{modes.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</select>}</Field>
      <Field label="Meeting link (optional)" hint={r.supervised ? 'Use a school-managed meeting; the supervisor attends.' : 'https:// links only.'}><input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Mentoring() {
  const { me } = useAuth();
  const myId = me?.profile?.id;
  const { permissions } = usePermissions();
  const canMentor = Boolean(permissions['mentoring.participate']);
  const moderator = Boolean(permissions['community.moderate']);
  const state = useLoad(() => Promise.all([opsApi.mentors({ all: moderator ? 'true' : undefined }), opsApi.mentoring() as Promise<Mentorship[]>]), [moderator]);
  const [profile, setProfile] = useState({ headline: '', topics: '', availability: '', batch: '' });
  const [ask, setAsk] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Mentorship | null>(null);
  const [closing, setClosing] = useState<{ r: Mentorship; action: 'COMPLETE' | 'CANCEL' } | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const act = (id: string, body: Record<string, unknown>) => void run(async () => { await opsApi.mentoringAction(id, body); await state.reload(); });
  return (
    <Loadable state={state}>{([mentors, requests]) => (
      <div className="ops-stack">
        <SectionCard title="Seniors & alumni mentors" sub="Verified alumni and seniors who chose to help. Sessions with students are group or staff-supervised; there is no private messaging with students.">
          {!mentors.length ? <EmptyState title="No mentors listed yet" sub={canMentor ? 'Offer to mentor below; staff verify your affiliation before you are listed.' : 'Verified alumni and seniors appear here once they offer to help.'} /> : <ul className="ops-list">{mentors.map((m) => <li key={m.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{m.name}{m.batch ? ` · ${m.batch}` : ''}{!m.verified && <> <Pill tone="amber">Awaiting verification</Pill></>}</div><div className="ops-row-sub">{m.headline}{m.topics.length ? ` · ${m.topics.join(', ')}` : ''}{m.availability ? ` · ${m.availability}` : ''}</div></div>{!m.verified && moderator && <Button small variant="soft" onClick={() => void run(async () => { await opsApi.verifyMentor(m.id); await state.reload(); })}>Verify affiliation</Button>}{m.verified && canMentor && m.profileId !== myId && <Button small onClick={() => setAsk(m.id)}>Ask for mentoring</Button>}</li>)}</ul>}
        </SectionCard>
        {canMentor && (
          <SectionCard title="Offer to mentor" sub="Visible after staff verify your affiliation; changing your batch, headline or topics needs a fresh check. Share only what you are comfortable with — no contact details are shown.">
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
          {!requests.length ? <EmptyState title="No mentoring requests" sub={canMentor ? 'Ask a listed mentor for help with a topic.' : 'Supervised requests appear here for staff to supervise.'} /> : <ul className="ops-list">{requests.map((r) => {
            const party = r.mentorProfileId === myId || r.menteeProfileId === myId || r.supervisorProfileId === myId;
            const open = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(r.status);
            return (
              <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.topic}</div><div className="ops-row-sub">{r.menteeName ? `${r.menteeName} → ${r.mentorName ?? 'mentor'} · ` : ''}{r.supervised ? `Supervised${r.supervisorName ? ` by ${r.supervisorName}` : ''}` : 'Adults'}{r.supervised && !r.supervisorProfileId ? ' · needs a staff supervisor' : ''}{r.sessions.length ? ` · next ${fmtDateTime(r.sessions.at(-1)!.at)} (${humanize(r.sessions.at(-1)!.mode)})` : ''}</div></div><StatusPill status={r.status} />
                {r.mentorProfileId === myId && r.status === 'REQUESTED' && <><Button small onClick={() => act(r.id, { action: 'ACCEPT' })}>Accept</Button><Button small variant="ghost" onClick={() => act(r.id, { action: 'DECLINE' })}>Decline</Button></>}
                {moderator && r.supervised && !r.supervisorProfileId && open && r.mentorProfileId !== myId && r.menteeProfileId !== myId && <Button small variant="soft" onClick={() => act(r.id, { action: 'ASSIGN_SUPERVISOR' })}>Supervise</Button>}
                {(r.mentorProfileId === myId || r.supervisorProfileId === myId) && ['ACCEPTED', 'SCHEDULED'].includes(r.status) && (!r.supervised || r.supervisorProfileId) && <Button small variant="soft" onClick={() => setScheduling(r)}>Schedule session</Button>}
                {(party || moderator) && r.status === 'SCHEDULED' && <Button small variant="soft" onClick={() => setClosing({ r, action: 'COMPLETE' })}>Mark complete</Button>}
                {(party || moderator) && open && <Button small variant="ghost" onClick={() => setClosing({ r, action: 'CANCEL' })}>Cancel</Button>}
              </li>
            );
          })}</ul>}
        </SectionCard>
        <ErrorNote error={error} />
        {ask && <PromptModal title="Ask for mentoring" label="What would you like help with?" hint="Leave out phone numbers, e-mail addresses and social handles — the school arranges sessions." onClose={() => setAsk(null)} onSubmit={(v) => opsApi.requestMentoring({ mentorId: ask, topic: v.slice(0, 120), message: v }).then(() => { toast('Request sent', 'success'); return state.reload(); })} />}
        {scheduling && <ScheduleModal r={scheduling} onClose={() => setScheduling(null)} onDone={() => void state.reload()} />}
        {closing && <PromptModal title={closing.action === 'COMPLETE' ? 'Mark mentoring complete' : 'Cancel this mentoring'} label={closing.action === 'COMPLETE' ? 'Feedback (optional)' : 'Reason (optional)'} required={false} onClose={() => setClosing(null)} onSubmit={(v) => opsApi.mentoringAction(closing.r.id, { action: closing.action, feedback: v || undefined }).then(() => state.reload())} />}
      </div>
    )}</Loadable>
  );
}

/** Staff record a signed paper consent form, with its reference. */
function ConsentOverride() {
  const [students, setStudents] = useState<TaggableStudent[]>([]);
  const [level, setLevel] = useState('INTERNAL');
  const [evidence, setEvidence] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const s = students[0];
  return (
    <SectionCard title="Record a signed consent form" sub="For families who returned a paper form. The form reference is kept with the record.">
      <StudentPicker value={students} onChange={(v) => setStudents(v.slice(-1))} />
      <div className="ops-form-grid">
        <Field label="Consent level"><select className="input" value={level} onChange={(e) => setLevel(e.target.value)}><option value="NONE">Not shown</option><option value="INTERNAL">School community only</option><option value="PUBLIC">Also public pages</option></select></Field>
        <Field label="Signed form reference" required><input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Form no. / file reference" /></Field>
      </div>
      <Button small disabled={busy || !s || !evidence.trim()} onClick={() => void run(async () => { await newsApi.consentOverride({ studentId: s!.id, level, evidence }); toast('Consent recorded', 'success'); setStudents([]); setEvidence(''); })}>Record consent</Button>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

export function ConsentsPanel({ emptyState = false }: { emptyState?: boolean } = {}) {
  const state = useLoad(() => opsApi.consents(), []);
  const { run, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(rows) => !rows.length ? (emptyState ? <EmptyState title="No consent settings for you" sub="Parents set photo consent for their children here; adult college students set their own. Staff can record a signed paper form below if they moderate the newsroom." /> : null) : (
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

function ReportsCard({ state, onOpenPost }: { state: { data: ReportRow[] | null; error: string | null; loading: boolean; reload: () => Promise<void> }; onOpenPost: (id: string) => void }) {
  const [acting, setActing] = useState<{ r: ReportRow; status: 'ACTIONED' | 'DISMISSED' | 'ESCALATED' } | null>(null);
  const [takeDown, setTakeDown] = useState(true);
  const verb = (t: string) => (t === 'POST' ? 'Take the post down' : t === 'COMMENT' ? 'Hide the comment' : t === 'CIRCLE' ? 'Archive the circle' : 'Unlist the mentor');
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title={`Reports (${rows.length})`}>
        {!rows.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{rows.map((r) => (
          <li key={r.id} className="ops-row"><div className="ops-row-main">
            <div className="ops-row-title">{humanize(r.reason)} on {humanize(r.targetType).toLowerCase()}{r.status === 'ESCALATED' ? ' · escalated' : ''}{(r.openOnTarget ?? 1) > 1 ? ` · ${r.openOnTarget} reports` : ''}</div>
            <div className="ops-row-sub">{r.reporterName ? `From ${r.reporterName} · ` : ''}{fmtDateTime(r.createdAt)}{r.detail ? ` — “${r.detail}”` : ''}</div>
            {r.target && (r.target.exists ? <div className="ops-callout">{r.target.title && <b>{r.target.title} </b>}{r.target.excerpt}{r.target.author ? ` — ${r.target.author}` : ''}{r.target.status ? <> · <StatusPill status={r.target.status} /></> : null}{r.target.mediaHidden ? ' · photos held' : ''}{r.target.postId && <> <Button small variant="ghost" onClick={() => onOpenPost(r.target!.postId!)}>Open post</Button></>}</div> : <p className="ops-muted">The reported item no longer exists.</p>)}
          </div>
            <Button small variant="soft" onClick={() => { setTakeDown(true); setActing({ r, status: 'ACTIONED' }); }}>Actioned</Button>
            {r.status !== 'ESCALATED' && <Button small variant="ghost" onClick={() => setActing({ r, status: 'ESCALATED' })}>Escalate</Button>}
            <Button small variant="ghost" onClick={() => setActing({ r, status: 'DISMISSED' })}>Dismiss</Button>
          </li>
        ))}</ul>}
        {acting && <PromptModal title={acting.status === 'ACTIONED' ? 'Act on this report' : acting.status === 'ESCALATED' ? 'Escalate to the safeguarding officer' : 'Dismiss this report'} label="Resolution (kept on record)" danger={acting.status === 'ACTIONED' && takeDown} onClose={() => setActing(null)}
          extra={acting.status === 'ACTIONED' && acting.r.target?.exists ? <label className="ops-inline"><input type="checkbox" checked={takeDown} onChange={(e) => setTakeDown(e.target.checked)} /> {verb(acting.r.targetType)}</label> : undefined}
          onSubmit={(v) => opsApi.resolveReport(acting.r.id, { status: acting.status, resolution: v, takeDown: acting.status === 'ACTIONED' ? takeDown : undefined }).then(() => state.reload())} />}
      </SectionCard>
    )}</Loadable>
  );
}

type Tab = 'feed' | 'saved' | 'mine' | 'review' | 'circles' | 'mentoring' | 'consent';

export function NewsroomView({ initialTab }: { initialTab?: 'feed' | 'circles' | 'mentoring' | 'consent' } = {}) {
  const { me } = useAuth();
  const { permissions } = usePermissions();
  const moderator = Boolean(permissions['community.moderate']);
  const canPost = Boolean(permissions['community.post']);
  const canMentor = Boolean(permissions['mentoring.participate']);
  const queryTab = useQueryParam('tab');
  const queryPost = useQueryParam('post');
  // "reports" is the name older notifications used for the moderation tab.
  const fromQuery = (queryTab === 'reports' ? 'review' : queryTab) as Tab | null;
  const [tab, setTab] = useState<Tab>(initialTab ?? fromQuery ?? 'feed');
  const [q, setQ] = useState('');
  const [circle, setCircle] = useState<NewsCircle | null>(null);
  const [focusPost, setFocusPost] = useState<string | null>(queryPost);
  const [composing, setComposing] = useState(false);
  const [more, setMore] = useState<{ items: NewsPost[]; page: number; hasMore: boolean }>({ items: [], page: 1, hasMore: false });
  const circles = useLoad(() => opsApi.circles() as Promise<NewsCircle[]>, []);
  const circleModerator = (circles.data ?? []).some((c) => c.isModerator);
  const reviewer = moderator || circleModerator;
  const listTab = ['feed', 'saved', 'mine', 'review'].includes(tab);
  const feed = useLoad(() => (listTab ? newsApi.feed({ tab: tab === 'feed' ? undefined : tab, q: q || undefined, circleId: tab === 'feed' ? circle?.id : undefined }) : Promise.resolve(null)), [tab, q, circle?.id]);
  useEffect(() => { setMore({ items: [], page: 1, hasMore: false }); }, [tab, q, circle?.id]);
  const focused = useLoad(() => (focusPost ? newsApi.post(focusPost) : Promise.resolve(null)), [focusPost]);
  const pending = useLoad(() => (reviewer ? opsApi.pendingComments() : Promise.resolve([])), [reviewer, tab]);
  const reports = useLoad(() => (moderator ? newsApi.reports() : Promise.resolve([] as ReportRow[])), [moderator, tab]);
  const reviewPosts = useLoad(() => (reviewer ? newsApi.feed({ tab: 'review', pageSize: 50 }) : Promise.resolve(null)), [reviewer, tab]);
  const reviewCount = (reviewPosts.data?.items.length ?? 0) + (pending.data?.length ?? 0) + (reports.data?.length ?? 0);
  const [hiding, setHiding] = useState<string | null>(null);
  const { run, busy } = useAction();
  const role = me?.profile?.role ?? '';
  const showMentoring = canMentor || moderator;
  const items = [...(feed.data?.items ?? []), ...more.items];
  const hasMore = more.page > 1 ? more.hasMore : Boolean(feed.data?.hasMore);
  const feedPage = (page: number) => newsApi.feed({ tab: tab === 'feed' ? undefined : tab, q: q || undefined, circleId: tab === 'feed' ? circle?.id : undefined, page });
  const loadMore = () => void run(async () => {
    const next = more.page + 1;
    const r = await feedPage(next);
    setMore({ items: [...more.items, ...r.items], page: next, hasMore: Boolean(r.hasMore) });
  });
  // Pages already loaded with "Load more" are refreshed too, so a reaction there shows at once.
  const reloadMore = async () => {
    if (more.page < 2) return;
    const pages = await Promise.all(Array.from({ length: more.page - 1 }, (_, i) => feedPage(i + 2)));
    setMore({ items: pages.flatMap((r) => r.items), page: more.page, hasMore: Boolean(pages.at(-1)?.hasMore) });
  };
  const reloadAll = () => { void feed.reload(); void reloadMore(); if (reviewer) { void reviewPosts.reload(); void pending.reload(); } if (focusPost) void focused.reload(); };
  const tabs: Array<{ key: Tab; label: string; count?: number | null }> = [
    { key: 'feed', label: 'Newsroom' }, { key: 'saved', label: 'Saved' },
    ...(canPost ? [{ key: 'mine' as const, label: 'My posts' }] : []),
    ...(reviewer ? [{ key: 'review' as const, label: 'Moderation', count: reviewCount || null }] : []),
    { key: 'circles', label: 'Circles' },
    ...(showMentoring ? [{ key: 'mentoring' as const, label: 'Mentoring' }] : []),
    { key: 'consent', label: 'Consent' },
  ];
  return (
    <div className="ops-stack">
      <style>{STYLE}</style>
      <div className="ops-inline">
        <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setFocusPost(null); }} />
        {canPost && <Button onClick={() => setComposing(true)}>+ Share a story</Button>}
      </div>
      {focusPost && (
        <Loadable state={focused}>{(p) => p && (
          <div className="news-feed-wrap">
            <div className="ops-inline"><b>Linked post</b><Button small variant="ghost" onClick={() => setFocusPost(null)}>Close</Button></div>
            <PostCard p={p} moderator={moderator} circles={circles.data ?? []} onChanged={reloadAll} />
          </div>
        )}</Loadable>
      )}
      {listTab && (
        <>
          {tab === 'feed' && <SearchInput value={q} onChange={setQ} placeholder="Search stories, events, achievements" />}
          {tab === 'feed' && circle && <div className="ops-inline"><span className="ops-chip">◎ {circle.name}<button type="button" className="news-chip-btn" aria-label="Show all posts" onClick={() => setCircle(null)}>✕</button></span></div>}
          {tab === 'review' && (
            <div className="ops-grid-2">
              <Loadable state={pending}>{(rows) => <SectionCard title={`Comments awaiting moderation (${rows.length})`}>{!rows.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{(rows as Array<{ id: string; postId: string; authorName: string; body: string; authorRole?: string | null; postTitle?: string | null }>).map((c) => <li key={c.id} className="ops-row"><div className="ops-row-main"><b>{c.authorName}</b>{c.authorRole ? ` (${humanize(c.authorRole)})` : ''} {c.body}{c.postTitle && <div className="ops-row-sub">On “{c.postTitle}” <Button small variant="ghost" onClick={() => setFocusPost(c.postId)}>Open post</Button></div>}</div><Button small disabled={busy} onClick={() => void run(async () => { await opsApi.moderateComment(c.id, 'APPROVE'); await pending.reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => setHiding(c.id)}>Hide</Button></li>)}</ul>}</SectionCard>}</Loadable>
              {moderator && <ReportsCard state={reports} onOpenPost={setFocusPost} />}
            </div>
          )}
          <Loadable state={feed}>{() => !items.length ? (
            tab === 'review'
              ? (reviewCount ? <p className="ops-muted">No posts waiting — see the comments and reports above.</p> : <EmptyState title="Nothing waiting" sub="Posts, comments and reports that need a moderator appear here." />)
              : <EmptyState title={tab === 'saved' ? 'Nothing saved yet' : tab === 'mine' ? 'You have not posted yet' : circle ? 'No posts in this circle yet' : 'No stories yet'} sub={tab === 'feed' ? 'Events, ceremonies, achievements and club news appear here.' : 'Nothing here yet.'} />
          ) : (
            <div className="news-feed news-feed-wrap">
              {items.map((p) => <PostCard key={p.id} p={p} moderator={moderator} circles={circles.data ?? []} onChanged={reloadAll} />)}
              {hasMore && <Button variant="soft" disabled={busy} onClick={loadMore}>Load more</Button>}
            </div>
          )}</Loadable>
        </>
      )}
      {tab === 'circles' && <Circles onOpen={(c) => { setCircle(c); setTab('feed'); }} />}
      {tab === 'mentoring' && showMentoring && <Mentoring />}
      {tab === 'consent' && <div className="ops-stack"><ConsentsPanel emptyState={!moderator} />{moderator && isStaffRole(role) && <ConsentOverride />}</div>}
      <DataNote>Posts never show phone numbers, addresses, attendance, health or whereabouts. Reports are reviewed by a person.</DataNote>
      {composing && <Composer circles={circles.data ?? []} onClose={() => setComposing(false)} onDone={reloadAll} />}
      {hiding && <PromptModal title="Hide this comment" label="Reason (kept on record)" onClose={() => setHiding(null)} onSubmit={(v) => opsApi.moderateComment(hiding, 'HIDE', v).then(() => pending.reload())} />}
    </div>
  );
}
