'use client';
import { Button, Pill } from './ui';
import { fileHref } from '@/lib/api';
import type { AnnouncementPreviewDto } from '@/lib/types';

/**
 * The step between writing an announcement and sending it.
 *
 * Everything shown here is the *server's* answer — the audience it resolved,
 * the people it counted, and the exact text each channel would carry. The
 * author is looking at the message as its readers will, not at a second
 * rendering the browser invented, so what they approve is what goes out.
 *
 * Nothing on this screen sends anything: the only way out is Edit or Send.
 */
export function AnnouncementPreview({
  preview, attachmentNames, busy, error, onEdit, onPublish,
}: {
  preview: AnnouncementPreviewDto;
  /** Original filenames, which the stored URL alone does not carry. */
  attachmentNames: { url: string; name: string }[];
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onPublish: () => void;
}) {
  const nameFor = (url: string) => attachmentNames.find((a) => a.url === url)?.name ?? url.split('/').pop() ?? 'attachment';

  const files = preview.attachments.length > 0 && (
    <ul className="ann-preview-files">
      {preview.attachments.map((url) => (
        <li key={url}>
          <a href={fileHref(url)} target="_blank" rel="noopener noreferrer">{nameFor(url)}</a>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ann-preview">
      <div className="ann-preview-head">
        <strong>Preview</strong>
        <span className="ann-preview-note">Nothing has been sent yet.</span>
      </div>

      <div className="ann-preview-audience">
        <Pill tone={preview.audience.all ? 'gray' : 'blue'}>{preview.audienceLabel}</Pill>
        <span className="ann-preview-count">
          {preview.recipientCount === 1 ? '1 recipient' : `${preview.recipientCount} recipients`}
        </span>
      </div>

      {/* In-app: the card exactly as the announcements list draws it. */}
      <section className="ann-preview-channel">
        <div className="ann-preview-channel-label">In the app</div>
        <div className="ann-preview-app">
          <strong className="ann-preview-title">{preview.title}</strong>
          {/* pre-wrap, so the line breaks the author typed survive the trip. */}
          <p className="ann-preview-body">{preview.content}</p>
          {files}
        </div>
      </section>

      {preview.email && (
        <section className="ann-preview-channel">
          <div className="ann-preview-channel-label">Email</div>
          <div className="ann-preview-email">
            <div className="ann-preview-email-subject"><span>Subject:</span> {preview.email.subject}</div>
            <p className="ann-preview-body">{preview.email.body}</p>
            {files}
          </div>
        </section>
      )}

      {preview.whatsapp && (
        <section className="ann-preview-channel">
          <div className="ann-preview-channel-label">WhatsApp</div>
          {/* WhatsApp renders *bold* itself; the raw text is shown because that
              is literally what leaves the server. */}
          <div className="ann-preview-whatsapp">
            <p className="ann-preview-body">{preview.whatsapp.body}</p>
            {files}
          </div>
        </section>
      )}

      {!preview.email && !preview.whatsapp && (
        <p className="ann-preview-note">Email and WhatsApp are switched off — this goes to the app only.</p>
      )}

      {error && <p style={{ color: 'var(--red)', fontSize: 13, margin: '10px 0 0' }} role="alert">{error}</p>}

      <div className="ann-preview-actions">
        <Button variant="soft" onClick={onEdit} disabled={busy}>Edit</Button>
        <Button onClick={onPublish} disabled={busy}>{busy ? 'Sending…' : 'Send announcement'}</Button>
      </div>
    </div>
  );
}
