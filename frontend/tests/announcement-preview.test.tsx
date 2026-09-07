import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnouncementPreview } from '@/components/announcement-preview';
import type { AnnouncementPreviewDto } from '@/lib/types';

/**
 * The preview screen's contract.
 *
 * The claim worth testing is not that it renders — it is that it renders
 * *what the server resolved*, on every channel that is switched on, and that
 * it offers no way to send by accident: the only controls are Edit and Send,
 * and Send is the caller's own handler.
 */

const base: AnnouncementPreviewDto = {
  title: 'Sports day',
  content: 'Line one\nLine two',
  audience: { all: false, gradeIds: [], sectionIds: ['s1'], subjectIds: [], roleKeys: [] },
  audienceLabel: 'Class 6 - A',
  recipientCount: 34,
  channels: { app: true, email: false, whatsapp: false },
  attachments: [],
  email: null,
  whatsapp: null,
};

const show = (preview: AnnouncementPreviewDto) => render(
  <AnnouncementPreview
    preview={preview}
    attachmentNames={[{ url: '/uploads/circular.pdf', name: 'circular.pdf' }]}
    busy={false}
    error={null}
    onEdit={() => {}}
    onPublish={() => {}}
  />
);

describe('AnnouncementPreview', () => {
  it('says plainly that nothing has been sent', () => {
    show(base);
    expect(screen.getByText(/nothing has been sent yet/i)).toBeInTheDocument();
  });

  it('shows the resolved audience and the recipient count, not the raw ids', () => {
    show(base);
    expect(screen.getByText('Class 6 - A')).toBeInTheDocument();
    expect(screen.getByText('34 recipients')).toBeInTheDocument();
  });

  it('keeps the author line breaks rather than collapsing them', () => {
    show(base);
    const body = screen.getAllByText(/Line one/)[0];
    expect(body.textContent).toBe('Line one\nLine two');
  });

  it('renders only the channels the server says are on', () => {
    show(base);
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
    expect(screen.getByText(/switched off/i)).toBeInTheDocument();
  });

  it('renders the email subject and the WhatsApp body the server built', () => {
    show({
      ...base,
      channels: { app: true, email: true, whatsapp: true },
      email: { subject: 'Sports day', body: 'Line one\nLine two', attachments: [] },
      whatsapp: { body: '*Sports day*\n\nLine one\nLine two', attachments: [] },
    });
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText(/Sports day/, { selector: '.ann-preview-email-subject' })).toBeInTheDocument();
    expect(screen.getByText(/^\*Sports day\*/)).toBeInTheDocument();
  });

  it('lists attachments by their original filename', () => {
    show({ ...base, attachments: ['/uploads/circular.pdf'] });
    expect(screen.getAllByText('circular.pdf').length).toBeGreaterThan(0);
  });

  it('offers exactly two actions — edit, and send', () => {
    show(base);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Edit', 'Send announcement']);
  });
});
