'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api, ApiError } from '@/lib/api';
import type { TransportRouteDto, TransportStopDto, StudentListItem } from '@/lib/types';

export default function AdminTransport() {
  const [routes, setRoutes] = useState<TransportRouteDto[] | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<TransportRouteDto | null>(null);
  const [stops, setStops] = useState<TransportStopDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const toast = useToast();

  // Modals / forms state
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: '', operatorName: '', vehicleNo: '', driverName: '', driverPhone: '' });

  const [showStopModal, setShowStopModal] = useState(false);
  const [newStop, setNewStop] = useState({ name: '', sequenceNo: 1, etaMinutesFromStart: 10 });

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ studentId: '', routeId: '', stopId: '', direction: 'BOTH' });
  const [enrollStops, setEnrollStops] = useState<TransportStopDto[]>([]);

  const [showBulkRoutes, setShowBulkRoutes] = useState(false);
  const [showBulkStops, setShowBulkStops] = useState(false);
  const [showBulkEnroll, setShowBulkEnroll] = useState(false);

  const loadData = () => {
    api.listRoutes().then(setRoutes).catch(() => setRoutes([]));
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedRoute) {
      setStops(null);
      api.listStops(selectedRoute.id).then(setStops).catch(() => setStops([]));
    } else {
      setStops(null);
    }
  }, [selectedRoute]);

  useEffect(() => {
    if (enrollForm.routeId) {
      api.listStops(enrollForm.routeId).then(setEnrollStops).catch(() => setEnrollStops([]));
    } else {
      setEnrollStops([]);
    }
  }, [enrollForm.routeId]);

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoute.name) return;
    try {
      await api.createRoute(newRoute);
      setShowRouteModal(false);
      setNewRoute({ name: '', operatorName: '', vehicleNo: '', driverName: '', driverPhone: '' });
      toast('Route created.');
      loadData();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the route.', 'error');
    }
  };

  const handleCreateStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoute || !newStop.name) return;
    try {
      await api.createStop({
        routeId: selectedRoute.id,
        name: newStop.name,
        sequenceNo: Number(newStop.sequenceNo),
        etaMinutesFromStart: Number(newStop.etaMinutesFromStart),
      });
      setShowStopModal(false);
      setNewStop({ name: '', sequenceNo: stops ? stops.length + 1 : 1, etaMinutesFromStart: 10 });
      // Reload stops
      api.listStops(selectedRoute.id).then(setStops).catch(() => setStops([]));
      toast('Stop added to the route.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the stop.', 'error');
    }
  };

  const handleEnrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollForm.studentId || !enrollForm.routeId || !enrollForm.stopId) return;
    try {
      await api.enrollStudent({
        studentId: enrollForm.studentId,
        routeId: enrollForm.routeId,
        stopId: enrollForm.stopId,
        direction: enrollForm.direction,
      });
      setShowEnrollModal(false);
      setEnrollForm({ studentId: '', routeId: '', stopId: '', direction: 'BOTH' });
      toast('Student enrolled on the route.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not enroll the student.', 'error');
    }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Transport Operations', desc: 'Manage school bus routes, stops, and student routing.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button onClick={() => setShowRouteModal(true)}>Add Route</Button>
        <Button variant="soft" onClick={() => setShowEnrollModal(true)}>Enroll Student</Button>
        <Button variant="soft" onClick={() => setShowBulkRoutes(true)}>Bulk Upload Routes</Button>
        <Button variant="soft" onClick={() => setShowBulkStops(true)}>Bulk Upload Stops</Button>
        <Button variant="soft" onClick={() => setShowBulkEnroll(true)}>Bulk Enroll</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedRoute ? '1.2fr 1fr' : '1fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Bus Routes</strong>
          </div>
          {routes === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
          {routes !== null && routes.length === 0 && (
            <EmptyState title="No routes configured" sub="Create your first transport route to begin." />
          )}
          {routes && routes.length > 0 && (
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Route Name</th>
                  <th>Vehicle No.</th>
                  <th>Driver Details</th>
                  <th>Stops</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} style={{ background: selectedRoute?.id === r.id ? 'var(--hairline)' : 'none' }}>
                    <td className="cell-primary" data-label="Route Name">{r.name}</td>
                    <td data-label="Vehicle No.">{r.vehicleNo ?? '—'}</td>
                    <td data-label="Driver Details">
                      <div>{r.driverName ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.driverPhone ?? ''}</div>
                    </td>
                    <td data-label="Stops">{r.stopCount} stops</td>
                    <td data-label="Action">
                      <Button variant="ghost" small onClick={() => setSelectedRoute(r)}>View Stops</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {selectedRoute && (
          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Stops: {selectedRoute.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Driver: {selectedRoute.driverName ?? 'Unknown'} ({selectedRoute.vehicleNo ?? 'No Bus'})
                </div>
              </div>
              <Button small onClick={() => {
                setNewStop({ name: '', sequenceNo: stops ? stops.length + 1 : 1, etaMinutesFromStart: 10 });
                setShowStopModal(true);
              }}>Add Stop</Button>
            </div>
            {stops === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {stops !== null && stops.length === 0 && (
              <EmptyState title="No stops defined" sub="Add stops to map out the route." />
            )}
            {stops && stops.length > 0 && (
              <table className="data-table data-table-cards">
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Stop Name</th>
                    <th>ETA Offset</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }} data-label="Seq">#{s.sequenceNo}</td>
                      <td className="cell-primary" data-label="Stop Name">{s.name}</td>
                      <td data-label="ETA Offset">{s.etaMinutesFromStart} mins</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>

      {/* Create Route Modal */}
      {showRouteModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Create Route</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowRouteModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateRoute}>
              <div className="field-label">Route Name *</div>
              <input className="field-input" required value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} placeholder="e.g. Route 10 - South Extension" />
              
              <div className="field-label">Vehicle Number</div>
              <input className="field-input" value={newRoute.vehicleNo} onChange={(e) => setNewRoute({ ...newRoute, vehicleNo: e.target.value })} placeholder="e.g. MH-12-PQ-9876" />

              <div className="field-label">Driver Name</div>
              <input className="field-input" value={newRoute.driverName} onChange={(e) => setNewRoute({ ...newRoute, driverName: e.target.value })} placeholder="Driver name" />

              <div className="field-label">Driver Phone</div>
              <input className="field-input" value={newRoute.driverPhone} onChange={(e) => setNewRoute({ ...newRoute, driverPhone: e.target.value })} placeholder="Driver phone number" />

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Create Route</Button>
                <Button variant="ghost" type="button" onClick={() => setShowRouteModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Stop Modal */}
      {showStopModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Stop</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowStopModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateStop}>
              <div className="field-label">Stop Name *</div>
              <input className="field-input" required value={newStop.name} onChange={(e) => setNewStop({ ...newStop, name: e.target.value })} placeholder="e.g. Central Library Roundabout" />
              
              <div className="field-label">Sequence Number</div>
              <input className="field-input" type="number" required value={newStop.sequenceNo} onChange={(e) => setNewStop({ ...newStop, sequenceNo: Number(e.target.value) })} />

              <div className="field-label">ETA Offset (minutes from start)</div>
              <input className="field-input" type="number" required value={newStop.etaMinutesFromStart} onChange={(e) => setNewStop({ ...newStop, etaMinutesFromStart: Number(e.target.value) })} />

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Stop</Button>
                <Button variant="ghost" type="button" onClick={() => setShowStopModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Student Modal */}
      {showEnrollModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Enroll Student on Route</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowEnrollModal(false)}>×</button>
            </div>
            <form onSubmit={handleEnrollStudent}>
              <div className="field-label">Select Student *</div>
              <select className="field-input" required value={enrollForm.studentId} onChange={(e) => setEnrollForm({ ...enrollForm, studentId: e.target.value })}>
                <option value="">-- Choose Student --</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.enrollment?.class ?? 'No Class'})</option>
                ))}
              </select>
              
              <div className="field-label">Select Route *</div>
              <select className="field-input" required value={enrollForm.routeId} onChange={(e) => setEnrollForm({ ...enrollForm, routeId: e.target.value, stopId: '' })}>
                <option value="">-- Choose Route --</option>
                {routes?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>

              {enrollForm.routeId && (
                <>
                  <div className="field-label">Select Stop *</div>
                  <select className="field-input" required value={enrollForm.stopId} onChange={(e) => setEnrollForm({ ...enrollForm, stopId: e.target.value })}>
                    <option value="">-- Choose Stop --</option>
                    {enrollStops.map((s) => (
                      <option key={s.id} value={s.id}>#{s.sequenceNo} - {s.name} (+{s.etaMinutesFromStart} mins)</option>
                    ))}
                  </select>
                </>
              )}

              <div className="field-label">Route Direction</div>
              <select className="field-input" value={enrollForm.direction} onChange={(e) => setEnrollForm({ ...enrollForm, direction: e.target.value })}>
                <option value="BOTH">Both (Pickup & Drop)</option>
                <option value="PICKUP">Pickup Only</option>
                <option value="DROP">Drop Only</option>
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Enroll Student</Button>
                <Button variant="ghost" type="button" onClick={() => setShowEnrollModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkRoutes && (
        <BulkUploadModal
          title="Bulk upload routes"
          description="Upload a CSV to create many bus routes at once."
          templateHeaders={['name', 'operatorName', 'vehicleNo', 'driverName', 'driverPhone']}
          templateSampleRow={['Route 10 - South Extension', '', 'MH-12-PQ-9876', 'Ramesh Kumar', '+919999900001']}
          onSubmit={(file) => api.bulkCreateRoutes(file)}
          onClose={() => setShowBulkRoutes(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} routes.`, r.failed > 0 ? 'error' : 'success'); loadData(); }}
        />
      )}

      {showBulkStops && (
        <BulkUploadModal
          title="Bulk upload stops"
          description="Upload a CSV to add many stops at once, across one or more routes (matched by route name)."
          templateHeaders={['routeName', 'name', 'sequenceNo', 'etaMinutesFromStart']}
          templateSampleRow={['Route 10 - South Extension', 'Central Library Roundabout', '1', '10']}
          onSubmit={(file) => api.bulkCreateStops(file)}
          onClose={() => setShowBulkStops(false)}
          onImported={(r) => {
            toast(`Created ${r.imported} of ${r.imported + r.failed} stops.`, r.failed > 0 ? 'error' : 'success');
            if (selectedRoute) api.listStops(selectedRoute.id).then(setStops).catch(() => {});
            loadData();
          }}
        />
      )}

      {showBulkEnroll && (
        <BulkUploadModal
          title="Bulk enroll students"
          description="Upload a CSV to enroll many students on bus routes at once."
          templateHeaders={['admissionNo', 'routeName', 'stopName', 'direction']}
          templateSampleRow={['ADM-2026-0010', 'Route 10 - South Extension', 'Central Library Roundabout', 'BOTH']}
          onSubmit={(file) => api.bulkEnrollStudents(file)}
          onClose={() => setShowBulkEnroll(false)}
          onImported={(r) => { toast(`Enrolled ${r.imported} of ${r.imported + r.failed} students.`, r.failed > 0 ? 'error' : 'success'); }}
        />
      )}
    </PortalShell>
  );
}
