'use client';
import { PortalShell } from '@/components/shell';
import { AnnouncementsView } from '@/components/announcements-view';
import { useAuth } from '@/lib/auth';
export default function Announcements() {
  const { me } = useAuth();
  const canPublish = ['ADMIN','OWNER','PRINCIPAL','TEACHER'].includes(me?.roleKey ?? '');
  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Announcements', desc: 'School notices and circulars.' }}>
      <AnnouncementsView canPublish={canPublish} />
    </PortalShell>
  );
}
