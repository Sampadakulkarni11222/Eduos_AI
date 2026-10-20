#!/usr/bin/env node
/**
 * SIMULATION — sends made-up camera OBSERVATIONS through the provider adapter
 * contract (POST /camera/events). There is no camera, no video model and no
 * provider behind this; it exists to exercise the human review workflow.
 *
 * The contract a real adapter must follow (and this script follows):
 *   { type: POSSIBLE_UNATTENDED_ROOM | POSSIBLE_AGGRESSION | DEVICE_OFFLINE,
 *     confidence: 0..1, timestamp: ISO, room?: string,
 *     evidenceRef?: "<restricted-storage reference>", eventId?: "<provider id>" }
 * Never images, faces, names, student ids, emotions or scores — the API refuses them.
 *
 * Usage (register a camera in Camera → Devices; the school must switch the camera pilot on):
 *   node scripts/simulate-camera.mjs --device camera_xxx --secret yyy \
 *     [--api http://localhost:5000/api/v1] [--type POSSIBLE_UNATTENDED_ROOM] [--confidence 0.7] [--room R-6A]
 */
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []));
const api = String(args.api ?? process.env.EDUOS_API ?? 'http://localhost:5000/api/v1').replace(/\/$/, '');
const device = args.device;
const secret = args.secret;
if (!device || !secret) {
  console.error('SIMULATION: pass --device <deviceKey> --secret <secret> (from the camera registration).');
  process.exit(1);
}
const observation = {
  type: String(args.type ?? 'POSSIBLE_UNATTENDED_ROOM').toUpperCase(),
  confidence: Number(args.confidence ?? 0.7),
  timestamp: new Date().toISOString(),
  ...(args.room ? { room: String(args.room) } : {}),
  evidenceRef: `sim://restricted/${crypto.randomBytes(6).toString('hex')}`,
  eventId: `sim-${Date.now()}`,
};
const body = JSON.stringify(observation);
const timestamp = Date.now();
const nonce = crypto.randomBytes(12).toString('hex');
const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
console.log('[SIMULATION] Sending a simulated, unverified camera observation:', observation);
const res = await fetch(`${api}/camera/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-device-id': device, 'x-device-timestamp': String(timestamp), 'x-device-nonce': nonce, 'x-device-signature': signature },
  body,
});
console.log(`[SIMULATION] ${res.status}`, await res.json().catch(() => ({})));
