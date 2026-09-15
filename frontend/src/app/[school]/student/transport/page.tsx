'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, Select, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { AvailableRoutesDto, MyBusDto, RequestStatus, TransportRequestDto } from '@/lib/types';

const TONE: Record<RequestStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

/**
 * The student's transport screen.
 *
 * It used to show the bus you were already on, and tell everyone else to
 * "contact admin to register" — a dead end for exactly the people who needed
 * to do something. Now it does both: the arrangement if you have one, and the
 * routes you can ask for if you do not.
 *
 * Asking is a request. Nothing here grants a place or charges a fare: the
 * school office decides, and the fare is only billed once the place is
 * granted, which is what the wording below is careful to say.
 */
export default function StudentTransport() {
  const [bus, setBus] = useState<MyBusDto | null>(null);
  const [available, setAvailable] = useState<AvailableRoutesDto | null>(null);
  const [history, setHistory] = useState<TransportRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [direction, setDirection] = useState<'BOTH' | 'PICKUP' | 'DROP'>('BOTH');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    // Each of the three is allowed to fail on its own: a student with no bus
    // yet gets a 404 from myBus(), and that must not blank the picker.
    const [busResult, routesResult, mineResult] = await Promise.allSettled([
      api.myBus(),
      api.availableRoutes(),
      api.myTransportRequests(),
    ]);
    setBus(busResult.status === 'fulfilled' ? busResult.value : null);
    setAvailable(routesResult.status === 'fulfilled' ? routesResult.value : null);
    setHistory(mineResult.status === 'fulfilled' ? mineResult.value : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chosenRoute = available?.routes.find((r) => r.id === routeId) ?? null;

  async function submit() {
    if (!routeId || !stopId) return;
    setBusy(true);
    try {
      await api.requestTransportRoute(routeId, stopId, direction);
      toast('Your request has been sent to the school office.', 'success');
      setRouteId('');
      setStopId('');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send that request', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await api.cancelTransportRequest(id);
      toast('Request withdrawn.', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not withdraw that request', 'error');
    } finally {
      setBusy(false);
    }
  }

  const pending = available?.myRequest && available.myRequest.status === 'PENDING' ? available.myRequest : null;

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'School Bus', desc: 'Your route, and the routes you can ask for.' }}>
      {loading && <Card><SkeletonRows rows={4} /></Card>}

      {!loading && bus && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Bus Route" value={bus.route.name} />
            <StatCard label="Vehicle Number" value={bus.route.vehicleNo ?? '—'} />
            <StatCard label="My Stop" value={bus.stop.name} delta={`Stop #${bus.stop.sequenceNo}`} deltaDir="flat" />
            <StatCard
              label="Live ETA (A.M.)"
              value={bus.nextEta ? new Date(bus.nextEta).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'}
            />
          </div>

          <Card className="mb-4">
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Driver &amp; Route Contact Info</strong>
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

      {/* Waiting on a decision. Shown instead of the picker, because one live
          request per year is all the school allows. */}
      {!loading && pending && (
        <Card className="mb-4">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Request awaiting a decision</strong>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6 }}>
                {pending.routeName} — {pending.stopName}
                {pending.fareAmountPaise > 0 && <> · {rupees(pending.fareAmountPaise)} a year</>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
                Nothing is charged until the school office grants the place.
              </div>
            </div>
            <Button onClick={() => void cancel(pending.id)} disabled={busy}>Withdraw</Button>
          </div>
        </Card>
      )}

      {/* The picker. Hidden while a request is live or a place is already held. */}
      {!loading && available && available.canRequest && (
        <Card className="mb-4">
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>
            {bus ? 'Ask for a different route' : 'Ask for a place on a bus'}
          </strong>
          {available.routes.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 10 }}>
              No bus routes are running at the moment.
            </div>
          )}

          {available.routes.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 14 }}>
                <Select
                  label="Route"
                  value={routeId}
                  onChange={(v) => { setRouteId(v); setStopId(''); }}
                  options={[
                    { value: '', label: 'Choose a route' },
                    ...available.routes.map((r) => ({
                      value: r.id,
                      label: r.fareAmountPaise > 0 ? `${r.name} — ${rupees(r.fareAmountPaise)} a year` : r.name,
                    })),
                  ]}
                />
                <Select
                  label="Stop"
                  value={stopId}
                  onChange={setStopId}
                  disabled={!chosenRoute}
                  options={[
                    { value: '', label: chosenRoute ? 'Choose a stop' : 'Choose a route first' },
                    ...(chosenRoute?.stops ?? []).map((s) => ({ value: s.id, label: `${s.sequenceNo}. ${s.name}` })),
                  ]}
                />
                <Select
                  label="Direction"
                  value={direction}
                  onChange={(v) => setDirection(v as 'BOTH' | 'PICKUP' | 'DROP')}
                  options={[
                    { value: 'BOTH', label: 'Both ways' },
                    { value: 'PICKUP', label: 'Pick-up only' },
                    { value: 'DROP', label: 'Drop only' },
                  ]}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  {chosenRoute && chosenRoute.fareAmountPaise > 0
                    ? `${rupees(chosenRoute.fareAmountPaise)} for the year, added to your fees only once the place is granted.`
                    : 'The school office decides. Nothing is charged until a place is granted.'}
                </div>
                <Button onClick={() => void submit()} disabled={busy || !routeId || !stopId}>
                  Send request
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {!loading && !bus && !available && (
        <EmptyState
          title="Transport is not set up for you yet"
          sub="You are not enrolled in a class with transport available. Contact the school office."
        />
      )}

      {/* What was asked and what came back. */}
      {!loading && history.length > 0 && (
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Your requests</strong>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {history.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--line)',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600 }}>
                    {r.routeName} — {r.stopName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
                    Asked {new Date(r.requestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {r.decisionNote && <> · {r.decisionNote}</>}
                  </div>
                  {r.status === 'APPROVED' && r.invoiceId && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
                      {rupees(r.fareAmountPaise)} added to your fees — pay it from Payments.
                    </div>
                  )}
                </div>
                <Pill tone={TONE[r.status]}>{r.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>
      )}
    </PortalShell>
  );
}
