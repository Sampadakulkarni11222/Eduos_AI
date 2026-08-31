'use client';
import { PortalShell } from '@/components/shell';
import { AuditLogView } from '@/components/audit-log-view';

export default function PrincipalAudit() {
  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Audit Log', desc: 'Record of important actions in the school portal.' }}>
      <AuditLogView />
    </PortalShell>
  );
}
