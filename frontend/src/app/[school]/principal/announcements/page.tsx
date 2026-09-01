'use client';
import { PortalShell } from '@/components/shell';
import { AnnouncementsView } from '@/components/announcements-view';

export default function PrincipalAnnouncements() {
  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Announcements', desc: 'Publish and manage school-wide announcements.' }}>
      <AnnouncementsView canPublish={true} />
    </PortalShell>
  );
}
