import { PortalShell } from '@/components/shell';
import { AccessPermissionsContent } from '@/components/access-permissions';

export default function AdminPermissionsPage() {
  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{ title: 'Access & Permissions', desc: 'What each role can see and do in your school.' }}
    >
      <AccessPermissionsContent readOnly />
    </PortalShell>
  );
}
