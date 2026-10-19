import { CctvStream } from '../models/cctv.model.js';
import { Facility } from '../models/facility.model.js';
import * as cctv from '../modules/cctv/cctv.service.js';

/**
 * Sample data for live CCTV (part 8): the feature switched on for the demo
 * school, five fictional cameras at allowed places (main gate, bus bay, a
 * corridor, the playground and a hostel corridor) and the warden granted the
 * hostel camera group. No gateway is configured, so every camera shows
 * "Not connected" and the page shows the setup steps: nothing pretends to be
 * footage and no view-log entries are invented.
 */
export async function seedP8Cctv({ section, attempt, who }) {
  const SO = who.COMPLIANCE;
  if (!SO) return;
  await section('Live CCTV cameras (sample, no gateway connected)', CctvStream, async () => {
    const { setFeatures } = await import('../utils/features.js');
    const { currentTenantId } = await import('../tenancy/tenantContext.js');
    await attempt('cctvLive on', () => setFeatures({ cctvLive: true }, currentTenantId()));
    const byKind = async (kind) => Facility.findOne({ kind }).select('_id').lean();
    const [gateF, busF, groundF, hostelF] = await Promise.all([byKind('GATE'), byKind('TRANSPORT_BAY'), byKind('GROUND'), byKind('HOSTEL')]);
    const cams = [
      { name: 'Main gate (sample)', zone: 'Entrance', locationKind: 'GATE', purpose: 'ENTRY_EXIT', group: 'main-gate', facilityId: gateF?._id, streamPath: 'main-gate/whep' },
      { name: 'Bus bay (sample)', zone: 'Transport', locationKind: 'BUS_BAY', purpose: 'TRANSPORT_SAFETY', group: 'bus-bay', facilityId: busF?._id, streamPath: 'bus-bay/whep' },
      { name: 'Block A ground-floor corridor (sample)', zone: 'Block A', locationKind: 'CORRIDOR', purpose: 'CORRIDOR_SAFETY', group: 'corridors', streamPath: 'block-a-corridor/whep' },
      { name: 'Playground (sample)', zone: 'Grounds', locationKind: 'PLAYGROUND', purpose: 'COMMON_AREA_SAFETY', group: 'grounds', facilityId: groundF?._id, streamPath: 'playground/index.m3u8', streamType: 'HLS' },
      { name: 'Hostel corridor (sample)', zone: 'Hostel', locationKind: 'HOSTEL_CORRIDOR', purpose: 'HOSTEL_SAFETY', group: 'hostel', facilityId: hostelF?._id, streamPath: 'hostel-corridor/whep' },
    ];
    let n = 0;
    for (const c of cams) {
      // eslint-disable-next-line no-await-in-loop
      if (await attempt(c.name, () => cctv.createStream(SO.actor, { streamType: 'WHEP', ...c, facilityId: c.facilityId ? String(c.facilityId) : undefined, approvalNote: 'Approved by the School Management Committee for live viewing, signage up (sample)' }))) n += 1;
    }
    await attempt('group grants', () => cctv.updateSettings(SO.actor, { groupGrants: [{ roleKey: 'WARDEN', groups: ['hostel'] }] }));
    return `${n} cameras registered; no gateway connected (the page shows the setup steps)`;
  });
}
