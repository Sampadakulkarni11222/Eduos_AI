'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';

export default function AdminSettings() {
  const [ctx, setCtx] = useState<{ tenantName: string; tenantId: string } | null>(null);

  useEffect(() => {
    api.me().then((m) => {
      const profile = m.profile;
      setCtx({ tenantName: profile?.tenantName ?? 'Unknown', tenantId: profile?.tenantId ?? '' });
    }).catch(() => {});
  }, []);

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Settings', desc: 'Tenant configuration and school preferences.' }}>
      {!ctx && <Card><SkeletonRows rows={4} /></Card>}
      {ctx && (
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>School Information</strong>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>School Name</div>
              <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{ctx.tenantName}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Tenant ID</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{ctx.tenantId}</div>
            </div>
          </div>
          <div style={{ marginTop: 20, padding: '12px 14px', background: '#f5f5f0', borderRadius: 8, fontSize: 13, color: 'var(--text-2)' }}>
            Advanced settings (branding, academic year, notification templates, fee configuration) are managed by the EduOS platform team. Contact support to make changes.
          </div>
        </Card>
      )}
    </PortalShell>
  );
}
