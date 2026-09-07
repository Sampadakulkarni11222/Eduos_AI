'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows } from './ui';
import { ExpandableText } from './expandable-text';
import { AnnouncementPreview } from './announcement-preview';
import { api, ApiError, fileHref } from '@/lib/api';
import { useCachedResource } from '@/lib/cache';
import { useAuth } from '@/lib/auth';
import type {
  AnnouncementDraft, AnnouncementDto, AnnouncementPreviewDto, GradeDto, SectionDto, SubjectDto,
} from '@/lib/types';

export function AnnouncementsView({ canPublish }: { canPublish: boolean }) {
  const [showForm, setShowForm] = useState(false);
  // This view is mounted in every portal, so returning to it should show the
  // notices already fetched rather than a skeleton over a fresh request.
  const { data, error, refresh } = useCachedResource<AnnouncementDto[]>(
    'announcements', () => api.announcements(),
  );
  const items: AnnouncementDto[] | null = data ?? (error ? [] : null);
  const reload = refresh;

  return (
    <>
      {canPublish && (
        <div style={{ marginBottom: 16 }}>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New announcement'}</Button>
        </div>
      )}
      {showForm && <NewAnnouncement onDone={() => { setShowForm(false); void reload(); }} />}
      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && <EmptyState title="No announcements" sub="School notices appear here." />}
      {items && items.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((a) => (
            <Card key={a.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, color: 'var(--text-1b)' }}>{a.title}</strong>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
              {/* Long circulars are clamped with the full text one click away,
                  and their original line breaks are preserved. */}
              <ExpandableText text={a.content} clampLines={3} />
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <Pill tone={a.audience?.all ? 'gray' : 'blue'}>{a.audienceLabel}</Pill>
                {a.channels?.email && <Pill tone="amber">Email</Pill>}
                {a.channels?.whatsapp && <Pill tone="green">WhatsApp</Pill>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

type AudienceMode = 'ALL' | 'CLASS' | 'SUBJECT';

function NewAnnouncement({ onDone }: { onDone: () => void }) {
  const { me } = useAuth();
  const isTeacherScope = me?.profile?.role === 'TEACHER';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // A teacher reaches the classes and subjects they teach, never the school,
  // so "All classes" is not theirs to pick — the API refuses it.
  const [mode, setMode] = useState<AudienceMode>('ALL');

  // Admin/principal: pick from the school-wide grade/section/subject lists.
  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  // Teacher: restricted to the sections/subjects they actually teach.
  const [myOfferings, setMyOfferings] = useState<{ sectionId: string; sectionName: string; gradeName?: string; subjectId?: string; subject: string }[]>([]);

  const [sectionId, setSectionId] = useState(''); // teacher path: a specific class they teach
  const [classSelection, setClassSelection] = useState(''); // admin/principal path: `grade:<id>` or `section:<id>`
  const [subjectId, setSubjectId] = useState('');

  const [emailOn, setEmailOn] = useState(false);
  const [whatsappOn, setWhatsappOn] = useState(false);
  const [attachments, setAttachments] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  // The draft is previewed before it is sent: `preview` holds the server's
  // answer to "what would this send, and to whom", and its presence is what
  // switches the card from the form to the preview.
  const [preview, setPreview] = useState<AnnouncementPreviewDto | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Posting twice fans out duplicate app/email/WhatsApp notices, and `busy`
  // alone loses the race when two submits land in one React batch.
  const busyRef = useRef(false);

  // A teacher lands on their own classes, since "All classes" is not offered.
  useEffect(() => {
    if (isTeacherScope) setMode('CLASS');
  }, [isTeacherScope]);

  useEffect(() => {
    if (isTeacherScope) {
      api.myOfferings().then((offerings) =>
        setMyOfferings(offerings.map((o) => ({ sectionId: o.sectionId, sectionName: o.sectionName, gradeName: o.gradeName, subjectId: o.subjectId, subject: o.subject })))
      ).catch(() => {});
    } else {
      api.listGrades().then(setGrades).catch(() => {});
      api.allSections().then(setSections).catch(() => {});
      api.listSubjects().then(setSubjects).catch(() => {});
    }
  }, [isTeacherScope]);

  const myOwnSections = useMemo(() => {
    const seen = new Map<string, string>();
    myOfferings.forEach((o) => seen.set(o.sectionId, o.gradeName ? `${o.gradeName} - ${o.sectionName}` : o.sectionName));
    return [...seen.entries()];
  }, [myOfferings]);
  const myOwnSubjects = useMemo(() => {
    const seen = new Map<string, string>();
    myOfferings.forEach((o) => { if (o.subjectId) seen.set(o.subjectId, o.subject); });
    return [...seen.entries()];
  }, [myOfferings]);
  // One <select> with a "whole grade" option plus every section, grouped by grade — mirrors the merged class filter in Assignments.
  const gradeGroups = useMemo(() => grades.map((g) => ({
    grade: g,
    sections: sections.filter((s) => s.gradeName === g.name),
  })), [grades, sections]);

  /** The draft exactly as both the preview and the publish call receive it. */
  const draft = (): AnnouncementDraft => ({
    title,
    content,
    audience:
      mode === 'ALL' ? { all: true } :
      mode === 'CLASS' ? (
        isTeacherScope
          ? { sectionIds: sectionId ? [sectionId] : [] }
          : classSelection.startsWith('section:') ? { sectionIds: [classSelection.slice('section:'.length)] }
          : classSelection.startsWith('grade:') ? { gradeIds: [classSelection.slice('grade:'.length)] }
          : { all: true }
      ) :
      { subjectIds: subjectId ? [subjectId] : [] },
    channels: { app: true, email: emailOn, whatsapp: whatsappOn },
    attachments: attachments.map((a) => a.url),
  });

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const res = await api.uploadFile(file);
      setAttachments((prev) => [...prev, { url: res.fileUrl, name: res.filename ?? file.name }]);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not attach that file.');
    } finally { setUploading(false); }
  };

  /**
   * Step one. Nothing is published here — the server resolves the audience and
   * renders the channels, and refuses the draft now if it would refuse it at
   * send time.
   */
  const requestPreview = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setErr(null);
    try {
      setPreview(await api.previewAnnouncement(draft()));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not build a preview. Please try again.');
    } finally { setBusy(false); busyRef.current = false; }
  };

  /** Step two, from the preview only. */
  const publish = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setErr(null);
    try {
      await api.createAnnouncement(draft());
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Failed to post announcement. Please try again.');
    } finally { setBusy(false); busyRef.current = false; }
  };

  const audienceModes: AudienceMode[] = isTeacherScope ? ['CLASS', 'SUBJECT'] : ['ALL', 'CLASS', 'SUBJECT'];

  const canSubmit =
    mode === 'ALL' ||
    (mode === 'CLASS' && (isTeacherScope ? !!sectionId : !!classSelection)) ||
    (mode === 'SUBJECT' && !!subjectId);

  if (preview) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <AnnouncementPreview
          preview={preview}
          attachmentNames={attachments}
          busy={busy}
          error={err}
          onEdit={() => { setPreview(null); setErr(null); }}
          onPublish={() => void publish()}
        />
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={requestPreview}>
        <div className="field-label">Title</div>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="field-label">Content</div>
        <textarea className="field-input" rows={3} value={content} onChange={(e) => setContent(e.target.value)} required />

        <div className="field-label" style={{ marginTop: 10 }}>Audience</div>
        <div style={{ display: 'flex', gap: 16, margin: '6px 0 10px' }}>
          {audienceModes.map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name="audience-mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'ALL' ? 'All classes' : m === 'CLASS' ? 'Class-wise' : 'Subject-wise'}
            </label>
          ))}
        </div>

        {mode === 'CLASS' && (
          isTeacherScope ? (
            <select className="field-input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} required>
              <option value="">Select your class…</option>
              {myOwnSections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          ) : (
            <select className="field-input" value={classSelection} onChange={(e) => setClassSelection(e.target.value)} required>
              <option value="">Select a class…</option>
              {gradeGroups.map(({ grade, sections: gradeSections }) => (
                <optgroup key={grade.id} label={grade.name}>
                  <option value={`grade:${grade.id}`}>{grade.name} — all sections</option>
                  {gradeSections.map((s) => <option key={s.id} value={`section:${s.id}`}>{grade.name} - {s.name}</option>)}
                </optgroup>
              ))}
            </select>
          )
        )}

        {mode === 'SUBJECT' && (
          isTeacherScope ? (
            <select className="field-input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
              <option value="">Select subject…</option>
              {myOwnSubjects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          ) : (
            <select className="field-input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
              <option value="">Select subject…</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )
        )}

        <div className="field-label" style={{ marginTop: 12 }}>Notify via</div>
        <div style={{ display: 'flex', gap: 16, margin: '6px 0 4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked readOnly disabled />
            App
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            Email
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={whatsappOn} onChange={(e) => setWhatsappOn(e.target.checked)} />
            WhatsApp
          </label>
        </div>

        <div className="field-label" style={{ marginTop: 12 }}>Attachments (optional)</div>
        <input
          type="file"
          className="field-input"
          onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }}
          disabled={uploading}
          aria-label="Attach a file"
        />
        {uploading && <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '6px 0 0' }}>Uploading…</p>}
        {attachments.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {attachments.map((a) => (
              <li key={a.url}>
                <a href={fileHref(a.url)} target="_blank" rel="noopener noreferrer">{a.name}</a>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8, marginBottom: 8 }}>{err}</p>}
        {/* Create → Preview → Edit → Send: the composer never publishes
            directly, so nobody discovers the audience was wrong afterwards. */}
        <Button type="submit" disabled={busy || uploading || !canSubmit} style={{ marginTop: 12 }}>
          {busy ? 'Preparing…' : 'Preview'}
        </Button>
      </form>
    </Card>
  );
}
