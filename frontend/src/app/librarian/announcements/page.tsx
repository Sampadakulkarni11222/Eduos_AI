'use client';
import { PortalShell } from '@/components/shell';
import { AnnouncementsView } from '@/components/announcements-view';

export default function LibrarianAnnouncements() {
  return (
    <PortalShell expectedSlug="librarian" topbar={{ title: 'Notice Board', desc: 'School notices and librarian updates.' }}>
      <AnnouncementsView canPublish={false} />
    </PortalShell>
  );
}
