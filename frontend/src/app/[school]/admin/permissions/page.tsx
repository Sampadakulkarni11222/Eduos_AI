import { PortalShell } from '@/components/shell';
import { AccessPermissionsContent } from '@/components/access-permissions';

export default function AdminPermissionsPage() {
  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{ title: 'Access & Permissions', desc: 'Control what each role can see and do in your school.' }}
    >
      <AccessPermissionsContent />
    </PortalShell>
  );
}
