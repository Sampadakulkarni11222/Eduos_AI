#!/usr/bin/env node
/**
 * SIMULATION — sends made-up GPS fixes for a demo trip. This is not a real
 * tracker and does not claim any GPS provider integration.
 *
 * It behaves like a device would: every request is signed with the device's
 * secret (HMAC-SHA256 over `timestamp.nonce.body`), carries a fresh nonce,
 * numbers its fixes with a sequence, and can send a buffered batch to mimic a
 * tracker that was offline.
 *
 * Usage (register a GPS device first in Fleet → Devices and copy its key and secret):
 *   node scripts/simulate-gps.mjs --device gps_xxx --secret yyy \
 *     [--api http://localhost:5000/api/v1] [--from 18.5200,73.8560] [--to 18.5400,73.8650] \
 *     [--steps 30] [--interval 3] [--speed 24] [--buffer 5]
 *
 * --buffer N sends the first N fixes together in one late batch (offline buffering).
 * The school must have "Live bus location from GPS devices" switched on.
 */
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []));
const api = String(args.api ?? process.env.EDUOS_API ?? 'http://localhost:5000/api/v1').replace(/\/$/, '');
const device = args.device ?? process.env.SIM_DEVICE_KEY;
const secret = args.secret ?? process.env.SIM_DEVICE_SECRET;
if (!device || !secret) {
  console.error('SIMULATION: pass --device <deviceKey> --secret <secret> (from the device registration).');
  process.exit(1);
}
const [fromLat, fromLng] = String(args.from ?? '18.5200,73.8560').split(',').map(Number);
const [toLat, toLng] = String(args.to ?? '18.5400,73.8650').split(',').map(Number);
const steps = Number(args.steps ?? 30);
const intervalSec = Number(args.interval ?? 3);
const speed = Number(args.speed ?? 24);
const buffer = Number(args.buffer ?? 0);
let seq = Number(args.seq ?? Math.floor(Date.now() / 1000));

async function send(points) {
  const body = JSON.stringify({ points });
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(12).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  const res = await fetch(`${api}/fleet/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': device, 'x-device-timestamp': String(timestamp), 'x-device-nonce': nonce, 'x-device-signature': signature },
    body,
  });
  const out = await res.json().catch(() => ({}));
  console.log(`[SIMULATION] ${res.status} sent ${points.length} fix(es) →`, out?.data ?? out?.message ?? out);
}

const point = (i, at) => ({
  seq: seq + i,
  eventAt: new Date(at).toISOString(),
  lat: fromLat + ((toLat - fromLat) * i) / steps,
  lng: fromLng + ((toLng - fromLng) * i) / steps,
  speedKmh: speed,
  heading: (Math.atan2(toLng - fromLng, toLat - fromLat) * 180) / Math.PI,
});

console.log(`[SIMULATION] Simulated GPS for device ${device}: ${steps} fixes from ${fromLat},${fromLng} to ${toLat},${toLng}. Not a real tracker.`);
if (buffer > 0) {
  const start = Date.now() - buffer * intervalSec * 1000;
  await send(Array.from({ length: buffer }, (_, i) => point(i, start + i * intervalSec * 1000)));
}
for (let i = buffer; i <= steps; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await send([point(i, Date.now())]);
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
seq += steps + 1;
console.log('[SIMULATION] done.');
