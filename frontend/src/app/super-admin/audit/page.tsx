'use client';
import { PortalShell } from '@/components/shell';
import { AuditLogView } from '@/components/audit-log-view';

export default function SuperAdminAudit() {
  return (
    <PortalShell expectedSlug="super-admin" topbar={{ title: 'Audit Log', desc: 'Complete record of all administrative actions.' }}>
      <AuditLogView />
    </PortalShell>
  );
}
