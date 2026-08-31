import { PortalShell } from '@/components/shell';
import { AccessPermissionsContent } from '@/components/access-permissions';

export default function SuperAdminPermissionsPage() {
  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{ title: 'Access & Permissions', desc: 'Control what each role can see and do across the platform.' }}
    >
      <AccessPermissionsContent />
    </PortalShell>
  );
}
