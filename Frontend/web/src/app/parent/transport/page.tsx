'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { MyBusDto, StudentListItem } from '@/lib/types';

export default function ParentTransport() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [bus, setBus] = useState<MyBusDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.students().then((r) => setKids(r.items)).catch(() => setKids([]));
  }, []);

  const kid = kids?.[active];

  useEffect(() => {
    if (!kid) { setBus(null); return; }
    setLoading(true);
    api.myBus(kid.id)
      .then(setBus)
      .catch(() => setBus(null))
      .finally(() => setLoading(false));
  }, [kid?.id]);

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Bus & Transport', desc: kid ? `Route and tracking for ${kid.name}` : 'Transport tracking' }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : '#fff', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your children." />}
      {loading && <Card><SkeletonRows rows={4} /></Card>}

      {!loading && kids && kids.length > 0 && !bus && (
        <EmptyState title="Not enrolled in school bus" sub="This student is not currently enrolled in any school transport route." />
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
            {bus.route.operatorName && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)' }}>
                Operated by: {bus.route.operatorName}
              </div>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}
