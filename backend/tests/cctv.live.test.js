import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import { seedTransportSchool, inOak } from './support/transportSafety.js';
import { Facility } from '../src/models/facility.model.js';
import { CctvSettings, CctvStream, CctvViewSession } from '../src/models/cctv.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SYSTEM_ROLES, RESTRICTED_BY_DEFAULT, PLATFORM_WITHHELD } from '../src/constants/permissions.js';
import { FEATURES } from '../src/constants/features.js';
import { requireFeature, setFeatures } from '../src/utils/features.js';
import * as cctv from '../src/modules/cctv/cctv.service.js';
import { cctvPlayRouter } from '../src/modules/cctv/cctv.routes.js';
import { setGatewayNetwork, assertGatewayBase, gatewayUrl, gatewayRequest } from '../src/modules/cctv/gateway.js';
import { signToken, verifyToken } from '../src/modules/cctv/playback.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { OAK } from './support/mcpSchool.js';

/**
 * Live CCTV: who may watch (permission, camera groups, never families), where
 * a camera may be (forbidden places), what the browser gets (a short-lived
 * token bound to viewer, camera, address and browser; never the gateway
 * address, a path or a credential), how the proxy reaches the gateway
 * (allowlisted origin, SSRF refusals, no redirects, size caps), and that
 * every view is in the audit log and the view log.
 */
const UA = 'Mozilla/5.0 (cctv-test)';
const GW = 'https://cctv-gw.oakridge.example/';
const PUBLIC_IP = [{ address: '93.184.216.34', family: 4 }];
const SECRET_PASS = 'gw-pass-SECRET-91';
const CAM_PASS = 'cam-pass-SECRET-42';

let s; let principal; let compliance; let warden; let parentMisgranted; let gate; let hostel; let classroom;
let calls;

const withReq = (actor) => ({ ...actor, ip: '127.0.0.1', userAgent: UA });
const fakeNetwork = (handler) => setGatewayNetwork({
  resolve: async () => PUBLIC_IP,
  request: async (url, opts) => { calls.push({ url: url.toString(), method: opts.method, headers: opts.headers, body: opts.body }); return handler(url, opts); },
});
const text = (status, body, headers = {}) => ({ status, headers, body: Buffer.from(body) });

beforeEach(async () => {
  calls = [];
  s = await seedTransportSchool({ features: { cctvLive: true } });
  principal = withReq(s.people.PRINCIPAL.actor);
  compliance = withReq(s.people.COMPLIANCE.actor);
  // A school that granted the warden live view for its own camera groups (OWN scope).
  warden = withReq({ ...s.people.WARDEN.actor, permissions: { ...s.people.WARDEN.actor.permissions, 'camera.live.view': 'OWN' } });
  // A parent mistakenly granted the key: still refused.
  parentMisgranted = withReq({ ...s.people.PARENT.actor, permissions: { ...s.people.PARENT.actor.permissions, 'camera.live.view': 'ALL' } });
  gate = await inOak(() => cctv.createStream(compliance, { name: 'Main gate (sample)', zone: 'Entrance', locationKind: 'GATE', purpose: 'ENTRY_EXIT', group: 'main-gate', streamType: 'HLS', streamPath: 'gate-1/index.m3u8', approvalNote: 'Approved by SMC (sample)' }));
  hostel = await inOak(() => cctv.createStream(compliance, { name: 'Hostel corridor (sample)', zone: 'Hostel', locationKind: 'HOSTEL_CORRIDOR', purpose: 'HOSTEL_SAFETY', group: 'hostel', streamType: 'WHEP', streamPath: 'hostel-1/whep', credentials: { username: 'viewer', password: CAM_PASS }, approvalNote: 'Approved (sample)' }));
  classroom = await inOak(() => cctv.createStream(compliance, { name: 'Exam hall overview (sample)', zone: 'Block A', locationKind: 'LECTURE_HALL', purpose: 'EVENT_SAFETY', group: 'exams', streamType: 'HLS', streamPath: 'hall-1/index.m3u8', approvalNote: 'Approved (sample)' }));
  await inOak(() => cctv.updateSettings(compliance, { groupGrants: [{ roleKey: 'WARDEN', groups: ['hostel'] }] }));
});

afterEach(() => { setGatewayNetwork(); delete process.env.CCTV_ALLOW_PRIVATE_GATEWAY; delete process.env.CCTV_GATEWAY_HOSTS; });

const connect = () => inOak(() => cctv.updateSettings(compliance, { gateway: { baseUrl: GW, vendor: 'MEDIAMTX', authMode: 'BASIC', username: 'eduos', password: SECRET_PASS } }));

describe('permissions and the feature switch', () => {
  it('camera.live.view is restricted, held by the principal and safety officer only, never by families or the platform', () => {
    const grant = (key) => SYSTEM_ROLES.find((r) => r.key === key).grants.find((g) => g.key === 'camera.live.view');
    expect(RESTRICTED_BY_DEFAULT).toContain('camera.live.view');
    expect(PLATFORM_WITHHELD).toContain('camera.live.view');
    expect(grant('PRINCIPAL')?.scope).toBe('ALL');
    expect(grant('COMPLIANCE')?.scope).toBe('ALL');
    for (const k of ['ADMIN', 'SUPER_ADMIN', 'TEACHER', 'WARDEN', 'PARENT', 'STUDENT', 'ALUMNUS', 'FINANCE', 'HR']) expect(grant(k)).toBeUndefined();
    expect(FEATURES.cctvLive.default).toBe(false);
  });

  it('the API is off until the school switches it on; status still answers', async () => {
    await inOak(() => setFeatures({ cctvLive: false }));
    const err = await inOak(() => new Promise((resolve) => requireFeature('cctvLive')({}, {}, resolve)));
    expect(err).toMatchObject({ code: 'FEATURE_OFF' });
    const st = await inOak(() => cctv.status(principal));
    expect(st).toMatchObject({ enabled: false, canView: true });
    expect(st.setupSteps.length).toBeGreaterThan(3);
  });

  it('an administrator can register cameras but cannot watch them', async () => {
    const admin = withReq(s.people.ADMIN.actor);
    await expect(inOak(() => cctv.listStreams(admin))).rejects.toMatchObject({ code: 'NO_LIVE_PERMISSION' });
    const st = await inOak(() => cctv.status(admin));
    expect(st).toMatchObject({ canView: false, canManage: true });
    await expect(inOak(() => cctv.status(withReq(s.people.TEACHER.actor)))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('families are refused even if mis-granted', () => {
  it('a parent holding the key cannot list, watch or be granted camera groups', async () => {
    await connect();
    await expect(inOak(() => cctv.listStreams(parentMisgranted))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    await expect(inOak(() => cctv.startSession(parentMisgranted, gate.id, {}))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    await expect(inOak(() => cctv.status(parentMisgranted))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    const student = withReq({ ...s.people.STUDENT.actor, permissions: { ...s.people.STUDENT.actor.permissions, 'camera.live.view': 'ALL', 'camera.devices.manage': 'ALL' } });
    await expect(inOak(() => cctv.viewLog(student, {}))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    await expect(inOak(() => cctv.createStream(student, { name: 'x' }))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    await expect(inOak(() => cctv.updateSettings(compliance, { groupGrants: [{ roleKey: 'PARENT', groups: ['main-gate'] }] }))).rejects.toMatchObject({ code: 'FAMILY_REFUSED' });
    const refused = await inOak(() => AuditLog.find({ action: 'cctv.view.refused' }).lean());
    expect(refused.some((r) => r.after?.code === 'FAMILY_REFUSED')).toBe(true);
    expect(await inOak(() => CctvViewSession.countDocuments({}))).toBe(0);
  });
});

describe('camera groups', () => {
  it('a warden granted OWN sees only hostel cameras; the principal sees all', async () => {
    await connect();
    const mine = await inOak(() => cctv.listStreams(warden));
    expect(mine.map((c) => c.name)).toEqual(['Hostel corridor (sample)']);
    const all = await inOak(() => cctv.listStreams(principal));
    expect(all).toHaveLength(3);
    await expect(inOak(() => cctv.startSession(warden, gate.id, {}))).rejects.toMatchObject({ code: 'GROUP_NOT_GRANTED' });
    // A role with the key but no group granted sees nothing.
    const teacher = withReq({ ...s.people.TEACHER.actor, permissions: { ...s.people.TEACHER.actor.permissions, 'camera.live.view': 'OWN' } });
    expect(await inOak(() => cctv.listStreams(teacher))).toEqual([]);
  });

  it('disabled cameras disappear for viewers and end open viewings', async () => {
    await connect();
    const v = await inOak(() => cctv.startSession(principal, gate.id, {}));
    await inOak(() => cctv.updateStream(compliance, gate.id, { enabled: false }));
    expect((await inOak(() => cctv.listStreams(principal))).map((c) => c.id)).not.toContain(gate.id);
    const row = await inOak(() => CctvViewSession.findById(v.sessionId).lean());
    expect(row.endReason).toBe('STREAM_DISABLED');
  });
});

describe('forbidden places', () => {
  it('refuses toilets, changing rooms, the health room, staff private areas, dormitory rooms and RTSP', async () => {
    const base = { name: 'Cam', locationKind: 'CORRIDOR', purpose: 'CORRIDOR_SAFETY', streamPath: 'c/whep', approvalNote: 'n' };
    const refuse = (body) => expect(inOak(() => cctv.createStream(compliance, { ...base, ...body }))).rejects.toMatchObject({ code: 'FORBIDDEN_CAMERA_LOCATION' });
    await refuse({ locationKind: 'TOILET' });
    await refuse({ locationKind: 'CHANGING_ROOM' });
    await refuse({ locationKind: 'MEDICAL_ROOM' });
    await refuse({ locationKind: 'HEALTH_ROOM' });
    await refuse({ locationKind: 'STAFF_ROOM' });
    await refuse({ roomLabel: 'Corridor outside girls changing room' });
    await refuse({ name: 'Health room door' });
    await refuse({ zone: 'Staff lounge' });
    const wc = await inOak(() => Facility.create({ code: 'WC1', name: 'Block A', kind: 'TOILET' }));
    const clinic = await inOak(() => Facility.create({ code: 'CL1', name: 'Room 4', kind: 'CLINIC' }));
    const staff = await inOak(() => Facility.create({ code: 'SR1', name: 'Room 9', kind: 'STAFF_ROOM' }));
    const hostelBlock = await inOak(() => Facility.create({ code: 'H1', name: 'Boys hostel', kind: 'HOSTEL' }));
    await refuse({ facilityId: String(wc._id) });
    await refuse({ facilityId: String(clinic._id) });
    await refuse({ facilityId: String(staff._id) });
    await refuse({ facilityId: String(hostelBlock._id) });
    await expect(inOak(() => cctv.createStream(compliance, { ...base, locationKind: 'HOSTEL_CORRIDOR', purpose: 'HOSTEL_SAFETY', facilityId: String(hostelBlock._id) }))).resolves.toMatchObject({ privacyClass: 'RESTRICTED_AREA' });
    await expect(inOak(() => cctv.createStream(compliance, { ...base, streamPath: 'rtsp://10.0.0.5:554/stream1' }))).rejects.toMatchObject({ code: 'RTSP_NOT_PLAYABLE' });
    await expect(inOak(() => cctv.createStream(compliance, { ...base, streamPath: 'https://evil.example/x' }))).rejects.toMatchObject({ code: 'PATH_NOT_RELATIVE' });
    // A principal (no camera.devices.manage) cannot register one.
    await expect(inOak(() => cctv.createStream(principal, base))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('no credentials, gateway address or path reach a viewer', () => {
  it('stores credentials encrypted and never returns them', async () => {
    await connect();
    const raw = await inOak(() => CctvSettings.findOne({}).lean());
    expect(raw.gateway.credentialsEnc).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain(SECRET_PASS);
    const camRaw = await inOak(() => CctvStream.findById(hostel.id).lean());
    expect(JSON.stringify(camRaw)).not.toContain(CAM_PASS);
    const settings = await inOak(() => cctv.readSettings(compliance));
    const managed = await inOak(() => cctv.manageStreams(compliance));
    const viewer = await inOak(() => cctv.listStreams(principal));
    const status = await inOak(() => cctv.status(principal));
    const started = await inOak(() => cctv.startSession(principal, gate.id, {}));
    const all = JSON.stringify({ settings, managed, viewer, status, started, hostel });
    expect(all).not.toContain(SECRET_PASS);
    expect(all).not.toContain(CAM_PASS);
    expect(all).not.toContain('credentialsEnc');
    expect(settings.gateway.hasCredentials).toBe(true);
    // A viewer (not a manager) never learns the gateway or a camera path.
    const viewerText = JSON.stringify({ viewer, status, started });
    expect(viewerText).not.toContain('cctv-gw.oakridge.example');
    expect(viewerText).not.toContain('gate-1/index');
    const audit = await inOak(() => AuditLog.find({ action: 'cctv.settings.update' }).lean());
    expect(JSON.stringify(audit)).not.toContain(SECRET_PASS);
  });

  it('without a gateway: health says not connected and viewing explains the setup', async () => {
    const list = await inOak(() => cctv.listStreams(principal));
    expect(list.every((c) => c.health === 'NOT_CONNECTED')).toBe(true);
    await expect(inOak(() => cctv.startSession(principal, gate.id, {}))).rejects.toMatchObject({ code: 'GATEWAY_NOT_CONFIGURED' });
  });
});

describe('gateway allowlist and SSRF', () => {
  it('refuses non-https, credentials in the URL, private and metadata addresses, and hosts off the platform list', async () => {
    const bad = async (url, code) => {
      expect(() => assertGatewayBase(url)).toThrow();
      try { assertGatewayBase(url); } catch (e) { expect(e.code).toBe(code); }
    };
    await bad('http://cctv.example.com/', 'NOT_HTTPS');
    await bad('https://admin:pw@cctv.example.com/', 'CREDENTIALS_IN_URL');
    await bad('https://localhost:8889/', 'SSRF_BLOCKED');
    await bad('https://10.0.0.5:8889/', 'SSRF_BLOCKED');
    await bad('https://169.254.169.254/', 'SSRF_BLOCKED');
    await bad('https://nvr.lan/', 'SSRF_BLOCKED');
    process.env.CCTV_GATEWAY_HOSTS = 'gw.allowed.example,.tunnel.example';
    await bad('https://cctv.example.com/', 'NOT_ALLOWLISTED');
    expect(assertGatewayBase('https://school1.tunnel.example/').hostname).toBe('school1.tunnel.example');
    delete process.env.CCTV_GATEWAY_HOSTS;
    // On-premise opt-in allows a LAN gateway, never link-local metadata.
    process.env.CCTV_ALLOW_PRIVATE_GATEWAY = 'true';
    expect(assertGatewayBase('https://192.168.1.20:8889/').hostname).toBe('192.168.1.20');
    await bad('https://169.254.169.254/', 'SSRF_BLOCKED');
    await expect(inOak(() => cctv.updateSettings(compliance, { gateway: { baseUrl: 'http://x.example/' } }))).rejects.toMatchObject({ code: 'NOT_HTTPS' });
  });

  it('stays inside the gateway origin, refuses DNS to private ranges, redirects and oversize answers', async () => {
    expect(() => gatewayUrl(GW, 'https://evil.example/x.m3u8')).toThrow(/outside/);
    expect(() => gatewayUrl('https://gw.example/base/', '../other/x.m3u8')).toThrow(/outside/);
    expect(() => gatewayUrl(GW, 'rtsp://cam/1')).toThrow(/RTSP/);
    setGatewayNetwork({ resolve: async () => [{ address: '10.1.2.3', family: 4 }], request: async () => text(200, 'x') });
    await expect(gatewayRequest(GW, `${GW}a.m3u8`)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    setGatewayNetwork({ resolve: async () => [{ address: '169.254.169.254', family: 4 }], request: async () => text(200, 'x') });
    process.env.CCTV_ALLOW_PRIVATE_GATEWAY = 'true';
    await expect(gatewayRequest(GW, `${GW}a.m3u8`)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    setGatewayNetwork({ resolve: async () => PUBLIC_IP, request: async () => text(302, '', { location: 'http://169.254.169.254/latest/meta-data' }) });
    await expect(gatewayRequest(GW, `${GW}a.m3u8`)).rejects.toMatchObject({ code: 'REDIRECT_REFUSED' });
    setGatewayNetwork({ resolve: async () => PUBLIC_IP, request: async () => text(200, 'x'.repeat(2000)) });
    await expect(gatewayRequest(GW, `${GW}a.m3u8`, { maxBytes: 1000 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});

describe('playback through the proxy', () => {
  let server; let api;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/cctv/play', cctvPlayRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    api = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => { await new Promise((resolve) => server?.close(resolve)); });
  const get = (path, headers = {}) => fetch(`${api}${path}`, { headers: { 'user-agent': UA, ...headers } });

  const playlist = [
    '#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:2', '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:2.0,', 'seg-101.mp4', '#EXTINF:2.0,', 'https://evil.example/steal.ts', '#EXTINF:2.0,', 'seg-102.mp4',
  ].join('\n');

  it('rewrites the playlist to opaque proxy paths, sends credentials only to the gateway, and serves segments', async () => {
    await connect();
    fakeNetwork((url) => (url.pathname.endsWith('.m3u8')
      ? text(200, playlist, { 'content-type': 'application/vnd.apple.mpegurl' })
      : text(200, 'SEGMENT-BYTES', { 'content-type': 'video/mp4' })));
    const v = await inOak(() => cctv.startSession(principal, gate.id, {}));
    expect(v.playbackPath).toMatch(/^\/cctv\/play\/[a-f0-9]{24}\/index\.m3u8\?t=/);
    const res = await get(v.playbackPath);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.text();
    expect(body).toMatch(/^#EXTM3U/);
    expect(body).not.toContain('cctv-gw.oakridge.example');
    expect(body).not.toContain('seg-101');
    expect(body).not.toContain('evil.example');
    expect(body).not.toContain(SECRET_PASS);
    const uris = body.split('\n').filter((l) => l.startsWith('/api/v1/cctv/play/'));
    expect(uris).toHaveLength(2);
    expect(body).toMatch(/#EXT-X-MAP:URI="\/api\/v1\/cctv\/play\//);
    // Credentials went to the gateway, as a header, and nowhere else.
    expect(calls[0].url).toBe(`${GW}gate-1/index.m3u8`);
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from(`eduos:${SECRET_PASS}`).toString('base64')}`);
    const seg = await get(uris[0].replace('/api/v1', ''));
    expect(seg.status).toBe(200);
    expect(seg.headers.get('content-type')).toBe('video/mp4');
    expect(await seg.text()).toBe('SEGMENT-BYTES');
    expect(calls[1].url).toBe(`${GW}gate-1/seg-101.mp4`);
    // A reference forged for another camera is refused.
    const bogus = await get(`/cctv/play/${v.sessionId}/r/AAAA${v.token.slice(0, 4)}?t=${encodeURIComponent(v.token)}`);
    expect(bogus.status).toBe(400);
  });

  it('refuses expired, tampered, swapped and rebound tokens, and idle viewings', async () => {
    await connect();
    fakeNetwork(() => text(200, playlist, { 'content-type': 'application/vnd.apple.mpegurl' }));
    const v = await inOak(() => cctv.startSession(principal, gate.id, {}));
    const other = await inOak(() => cctv.startSession(compliance, gate.id, {}));
    const path = `/cctv/play/${v.sessionId}/index.m3u8`;
    const old = signToken({ sid: v.sessionId, tid: OAK }, Date.now() - 6 * 60_000).token;
    expect(verifyToken(old).error).toBe('EXPIRED');
    expect((await (await get(`${path}?t=${old}`)).json()).error?.code).toBe('TOKEN_EXPIRED');
    const tampered = `${v.token.split('.')[0]}.${'A'.repeat(43)}`;
    expect((await get(`${path}?t=${tampered}`)).status).toBe(401);
    expect((await (await get(`${path}?t=${encodeURIComponent(other.token)}`)).json()).error?.code).toBe('TOKEN_MISMATCH');
    // Same token from another browser: refused (bound to the user agent).
    const rebound = await get(`${path}?t=${encodeURIComponent(v.token)}`, { 'user-agent': 'curl/8.0' });
    expect(rebound.status).toBe(403);
    expect((await rebound.json()).error?.code).toBe('BINDING_MISMATCH');
    // The header form works too.
    expect((await get(path, { 'x-playback-token': v.token })).status).toBe(200);
    // Nobody answered "still watching?": the viewing times out and the token stops working.
    await inOak(() => CctvViewSession.updateOne({ _id: v.sessionId }, { $set: { confirmedAt: new Date(Date.now() - 12 * 60_000) } }));
    const idle = await get(`${path}?t=${encodeURIComponent(v.token)}`);
    expect(idle.status).toBe(410);
    expect((await inOak(() => CctvViewSession.findById(v.sessionId).lean())).endReason).toBe('TIMEOUT');
  });

  it('renews with "still watching", ends on request, and logs start and end in the audit log and view log', async () => {
    await connect();
    fakeNetwork(() => text(200, playlist, { 'content-type': 'application/vnd.apple.mpegurl' }));
    await inOak(() => cctv.updateSettings(compliance, { reasonRequired: true }));
    await expect(inOak(() => cctv.startSession(warden, hostel.id, {}))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const w = await inOak(() => cctv.startSession(warden, hostel.id, { reason: 'Night round check' }));
    const v = await inOak(() => cctv.startSession(principal, gate.id, { reason: 'Gate crowding at dispersal' }));
    const renewed = await inOak(() => cctv.renewSession(principal, v.sessionId, { stillWatching: true }));
    expect(renewed.token).toBeTruthy();
    expect(new Date(renewed.confirmBy).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    await expect(inOak(() => cctv.renewSession(warden, v.sessionId, {}))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => cctv.endSession(principal, v.sessionId));
    expect((await get(`/cctv/play/${v.sessionId}/index.m3u8?t=${encodeURIComponent(renewed.token)}`)).status).toBe(410);
    const audit = await inOak(() => AuditLog.find({ action: { $in: ['cctv.view.start', 'cctv.view.end'] } }).lean());
    expect(audit.filter((a) => a.action === 'cctv.view.start')).toHaveLength(2);
    expect(audit.find((a) => a.action === 'cctv.view.end' && a.after.sessionId === v.sessionId).after.endReason).toBe('CLOSED');
    expect(await inOak(() => AuditLog.countDocuments({ action: 'cctv.stream.create' }))).toBe(3);
    // The principal sees everyone's viewings with reasons; the warden only their own.
    const full = await inOak(() => cctv.viewLog(principal, {}));
    expect(full.scope).toBe('ALL');
    expect(full.items.map((i) => i.reason).sort()).toEqual(['Gate crowding at dispersal', 'Night round check']);
    const own = await inOak(() => cctv.viewLog(warden, {}));
    expect(own.scope).toBe('OWN');
    expect(own.items.map((i) => i.id)).toEqual([w.sessionId]);
    // A restricted-area camera always needs a reason, whatever the setting.
    await inOak(() => cctv.updateSettings(compliance, { reasonRequired: false }));
    await expect(inOak(() => cctv.startSession(principal, classroom.id, {}))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('WHEP: forwards the offer with the server credentials, returns only the answer, and deletes the gateway session at the end', async () => {
    await connect();
    fakeNetwork((url, opts) => {
      if (opts.method === 'POST') return text(201, 'v=0\r\no=- answer\r\n', { 'content-type': 'application/sdp', location: '/hostel-1/whep/session/abc123' });
      return text(200, '');
    });
    const v = await inOak(() => cctv.startSession(principal, hostel.id, { reason: 'Check corridor' }));
    expect(v.whepPath).toBe(`/cctv/play/${v.sessionId}/whep`);
    const res = await fetch(`${api}${v.whepPath}`, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json', 'x-playback-token': v.token }, body: JSON.stringify({ sdp: 'v=0\r\no=- offer\r\n' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sdp).toMatch(/^v=0/);
    expect(JSON.stringify(json)).not.toMatch(/abc123|cctv-gw|hostel-1/);
    expect(calls[0]).toMatchObject({ url: `${GW}hostel-1/whep`, method: 'POST' });
    // The camera's own credentials win over the gateway's.
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from(`viewer:${CAM_PASS}`).toString('base64')}`);
    await inOak(() => cctv.endSession(principal, v.sessionId));
    expect(calls.at(-1)).toMatchObject({ url: `${GW}hostel-1/whep/session/abc123`, method: 'DELETE' });
  });

  it('health check marks cameras online or offline from the gateway', async () => {
    await connect();
    fakeNetwork((url, opts) => {
      if (url.pathname.includes('gate-1')) return text(200, '#EXTM3U\n', {});
      if (opts.method === 'OPTIONS') return text(204, '');
      return text(404, '');
    });
    const r = await inOak(() => cctv.checkStreams());
    expect(r).toMatchObject({ connected: true, online: 2, offline: 1 });
    const list = await inOak(() => cctv.listStreams(principal));
    expect(list.find((c) => c.id === classroom.id).health).toBe('OFFLINE');
    expect(list.find((c) => c.id === gate.id).health).toBe('ONLINE');
  });
});

describe('assistant tools (read-only; a link, never a stream)', () => {
  it('lists cameras, says when no gateway is connected, opens a camera as a link and shows the view log', async () => {
    const { mcp } = await import('./support/mcpSchool.js');
    const { MCP_TOOLS, mcpToolsFor } = await import('../src/modules/ai/mcp/registry.js');
    for (const n of ['list_cctv_cameras', 'get_cctv_view_log', 'open_cctv_camera']) {
      expect(MCP_TOOLS[n].operation).toBe('GET');
      expect(MCP_TOOLS[n].permission).toBe('camera.live.view');
      expect(MCP_TOOLS[n].inputSchema.additionalProperties).toBe(false);
    }
    const names = (a) => mcpToolsFor(a).map((t) => t.name);
    expect(names(principal)).toContain('open_cctv_camera');
    expect(names(s.people.TEACHER.actor)).not.toContain('list_cctv_cameras');
    expect(names(s.people.ADMIN.actor)).not.toContain('list_cctv_cameras');
    expect(names(parentMisgranted)).not.toContain('list_cctv_cameras');
    const refused = await mcp(OAK, parentMisgranted, 'list_cctv_cameras', {});
    expect(refused.success).toBe(false);

    let r = await mcp(OAK, principal, 'list_cctv_cameras', {});
    expect(r.success).toBe(true);
    expect(JSON.stringify(r)).toMatch(/No camera connected/);
    await connect();
    r = await mcp(OAK, principal, 'open_cctv_camera', { camera: 'main gate' });
    expect(r.success).toBe(true);
    expect(r.data.link).toBe(`/cctv?camera=${gate.id}`);
    expect(JSON.stringify(r)).not.toMatch(/cctv-gw|gate-1\/index|m3u8|token/i);
    const wa = await mcp(OAK, principal, 'open_cctv_camera', { camera: 'main gate' }, { channel: 'WHATSAPP' });
    expect(wa.data.url.endsWith(`/${OAK}/principal/cctv?camera=${gate.id}`)).toBe(true);
    // The warden cannot open a camera outside their groups.
    const w = await mcp(OAK, warden, 'open_cctv_camera', { camera: 'main gate' });
    expect(w.success).toBe(false);
    await inOak(() => cctv.startSession(warden, hostel.id, { reason: 'Night round' }));
    const log = await mcp(OAK, principal, 'get_cctv_view_log', {});
    expect(log.success).toBe(true);
    expect(JSON.stringify(log.data.items)).toMatch(/Night round/);
    expect(await inOak(() => CctvViewSession.countDocuments({ profileId: principal.profileId }))).toBe(0);
  });
});

describe('sample data', () => {
  it('seeds allowed cameras with no gateway, so nothing pretends to be footage', async () => {
    await inOak(() => CctvStream.deleteMany({}));
    const { seedP8Cctv } = await import('../src/seed/seed_p8_cctv.js');
    const notes = [];
    const section = async (name, Model, fn) => { notes.push(await fn()); };
    const attempt = async (_l, fn) => { try { return await fn(); } catch (e) { notes.push(`ERR ${e.message}`); return null; } };
    await inOak(() => seedP8Cctv({ section, attempt, who: { COMPLIANCE: { actor: compliance } } }));
    expect(notes.filter((n) => String(n).startsWith('ERR'))).toEqual([]);
    const list = await inOak(() => cctv.listStreams(principal));
    expect(list).toHaveLength(5);
    expect(list.every((c) => c.health === 'NOT_CONNECTED')).toBe(true);
    expect((await inOak(() => cctv.listStreams(warden))).map((c) => c.name)).toEqual(['Hostel corridor (sample)']);
    expect(await inOak(() => CctvViewSession.countDocuments({}))).toBe(0);
  });
});

describe('Ask AI routing (agent/p8Cctv.js)', () => {
  it('reads the CCTV questions into the CCTV tools, and nothing for roles without live view', async () => {
    const { parseIntent } = await import('../src/modules/ai/agent/intent.js');
    const { actorForRole } = await import('./support/mcpSchool.js');
    const p = actorForRole('PRINCIPAL');
    const step = (m, a = p) => parseIntent(m, a);
    expect(step('which cameras are online')).toMatchObject({ tool: 'list_cctv_cameras', args: { status: 'ONLINE' } });
    expect(step('are any cameras offline')).toMatchObject({ tool: 'list_cctv_cameras', args: { status: 'OFFLINE' } });
    expect(step('show me the view log for today')).toMatchObject({ tool: 'get_cctv_view_log' });
    expect(step('who watched the cameras today')).toMatchObject({ tool: 'get_cctv_view_log' });
    expect(step('open the main gate camera')).toMatchObject({ tool: 'open_cctv_camera', args: { camera: 'main gate' } });
    expect(step('live view of the hostel corridor')).toMatchObject({ tool: 'open_cctv_camera', args: { camera: 'hostel corridor' } });
    // The camera pilot's review count keeps its own words.
    expect(step('show camera review queue')).toMatchObject({ tool: 'get_camera_review_count' });
    expect(step('show the gate visitors')?.tool).not.toMatch(/cctv/);
    for (const role of ['PARENT', 'STUDENT', 'ADMIN', 'TEACHER']) {
      for (const m of ['which cameras are online', 'open the main gate camera', 'show me the CCTV view log for today']) expect(step(m, actorForRole(role))?.tool ?? '').not.toMatch(/cctv/);
    }
  });
});
