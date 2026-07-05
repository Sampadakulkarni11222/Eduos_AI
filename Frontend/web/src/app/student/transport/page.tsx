'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { MyBusDto } from '@/lib/types';

export default function StudentTransport() {
  const [bus, setBus] = useState<MyBusDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.myBus()
      .then(setBus)
      .catch(() => setBus(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'My School Bus', desc: 'Real-time routing and transport contact.' }}>
      {loading && <Card><SkeletonRows rows={4} /></Card>}
      {!loading && !bus && (
        <EmptyState title="Not enrolled in transport" sub="You are not configured for school bus transport. Contact admin to register." />
      )}

      {!loading && bus && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Bus Route" value={bus.route.name} />
            <StatCard label="Vehicle Number" value={bus.route.vehicleNo ?? '—'} />
            <StatCard label="My Stop" value={bus.stop.name} delta={`Stop #${bus.stop.sequenceNo}`} deltaDir="flat" />
            <StatCard label="Live ETA (A.M.)" value={bus.nextEta ? new Date(bus.nextEta).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'} />
          </div>

          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Driver & Route Contact Info</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Driver Name</div>
                <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{bus.route.driverName ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Driver Contact</div>
                <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>{bus.route.driverPhone ?? '—'}</div>
              </div>
            </div>
          </Card>
        </>
      )}
    </PortalShell>
  );
}
