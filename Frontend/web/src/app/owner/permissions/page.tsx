import { PortalShell } from '@/components/shell';
import { AccessPermissionsContent } from '@/components/access-permissions';

export default function OwnerPermissionsPage() {
  return (
    <PortalShell
      expectedSlug="owner"
      topbar={{ title: 'Access & Permissions', desc: 'Control what each role can see and do across EduOS.' }}
    >
      <AccessPermissionsContent />
    </PortalShell>
  );
}
