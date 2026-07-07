'use client';
import { PortalShell } from '@/components/shell';
import { AnnouncementsView } from '@/components/announcements-view';

export default function WardenAnnouncements() {
  return (
    <PortalShell expectedSlug="warden" topbar={{ title: 'Notice Board', desc: 'School notices and hostel circulars.' }}>
      <AnnouncementsView canPublish={false} />
    </PortalShell>
  );
}
