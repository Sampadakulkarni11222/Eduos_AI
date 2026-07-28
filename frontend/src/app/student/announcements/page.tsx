'use client';
import { PortalShell } from '@/components/shell';
import { AnnouncementsView } from '@/components/announcements-view';
import { useAuth } from '@/lib/auth';

export default function StudentAnnouncements() {
  const { me } = useAuth();
  const canPublish = ['ADMIN','OWNER','PRINCIPAL','TEACHER'].includes(me?.profile?.role ?? '');
  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Announcements', desc: 'School notices and circulars.' }}>
      <AnnouncementsView canPublish={canPublish} />
    </PortalShell>
  );
}
