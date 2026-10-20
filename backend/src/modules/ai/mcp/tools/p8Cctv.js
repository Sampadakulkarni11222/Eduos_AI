import { env } from '../../../../config/env.js';
import { currentTenantId } from '../../../../tenancy/tenantContext.js';
import { featureEnabled } from '../../../../utils/features.js';
import { ok } from '../protocol.js';
import { RISK, theNamed, dateStr } from './_shared.js';
import * as cctv from '../../../cctv/cctv.service.js';

/**
 * Part 8: live CCTV through Ask AI (and WhatsApp), read-only.
 *
 *   list_cctv_cameras    GET  the cameras the caller may watch, by zone, with online/offline status
 *   get_cctv_view_log    GET  who watched which camera today (principal / safety officer: everyone; others: their own)
 *   open_cctv_camera     GET  a link to the Live CCTV page for one camera ("open the main gate camera")
 *
 * No video, still or stream address ever goes through chat or WhatsApp: the
 * assistant returns a link to the Live CCTV page, where the viewing starts,
 * is watermarked and logged. Every tool needs camera.live.view and the
 * service refuses parents, students and alumni even if they were granted it.
 */

const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE', 'TRUSTEE'];
const webOrigin = () => String(process.env.PUBLIC_WEB_URL || env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
const HEALTH_WORD = { ONLINE: 'online', OFFLINE: 'offline', UNKNOWN: 'not checked yet', NOT_CONNECTED: 'not connected' };
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : null);
const NO_GATEWAY = 'No camera connected: set up your NVR/gateway on the Live CCTV page (Setup) first.';

async function offSpeak() {
  return (await featureEnabled('cctvLive')) ? null : 'Live CCTV is switched off for this school.';
}

/** Portal-relative link (opened inside the caller's portal) and an absolute one for WhatsApp. */
function linksFor(actor, cameraId) {
  const rel = `/cctv${cameraId ? `?camera=${cameraId}` : ''}`;
  const portal = String(actor?.roleKey ?? '').toLowerCase();
  return { link: rel, url: `${webOrigin()}/${currentTenantId()}/${portal}${rel}` };
}

export const p8CctvTools = {
  list_cctv_cameras: {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Live CCTV cameras the caller is allowed to watch, by zone, each with whether it is online, offline or not connected (from the school\'s video gateway). Use for "which cameras are online", "list the CCTV cameras", "is the main gate camera working", "are any cameras offline". Status only, never video. Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'ALL'], description: 'Only online or offline cameras (default all)' } }),
    permission: 'camera.live.view', forRoles: STAFF,
    service: 'cctv.service.listStreams()',
    async run(ctx, args = {}) {
      const off = await offSpeak();
      if (off) return ok({ enabled: false, cameras: [] }, { speak: off });
      const st = await cctv.status(ctx.actor);
      const all = await cctv.listStreams(ctx.actor);
      const rows = all.filter((c) => !args.status || args.status === 'ALL' || c.health === args.status);
      const cameras = rows.map((c) => ({ name: c.name, zone: c.zone, status: HEALTH_WORD[c.health] ?? c.health, checkedAt: time(c.lastCheckedAt) }));
      const online = all.filter((c) => c.health === 'ONLINE').length;
      if (!st.gateway.configured) return ok({ enabled: true, connected: false, cameras, ...linksFor(ctx.actor) }, { speak: `${all.length} camera(s) are registered. ${NO_GATEWAY}` });
      if (!all.length) return ok({ enabled: true, connected: true, cameras: [] }, { speak: 'There are no cameras you are allowed to watch.' });
      return ok({ enabled: true, connected: true, online, total: all.length, cameras, ...linksFor(ctx.actor) }, {
        speak: `${online} of ${all.length} camera(s) are online.${rows.length ? ` ${rows.slice(0, 12).map((c) => `${c.name}: ${HEALTH_WORD[c.health] ?? c.health}`).join('; ')}.` : ''}`,
        view: { type: 'list.numbered', intro: `**Cameras** (${online} of ${all.length} online)`, items: cameras.map((c) => ({ label: c.name, detail: `${c.zone ?? 'No zone'} · ${c.status}` })) },
      });
    },
  },

  get_cctv_view_log: {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The live CCTV view log for a day: who opened which camera, when, for how long and the reason given. The principal and the safety officer see everyone\'s viewings; anyone else only their own. Use for "show me the CCTV view log for today", "who watched the cameras today", "who opened the hostel camera yesterday". Read-only.',
    inputSchema: closed({ date: dateStr('YYYY-MM-DD (default today)') }),
    permission: 'camera.live.view', forRoles: STAFF,
    service: 'cctv.service.viewLog()',
    async run(ctx, args = {}) {
      const off = await offSpeak();
      if (off) return ok({ enabled: false, items: [] }, { speak: off });
      const log = await cctv.viewLog(ctx.actor, { date: args.date });
      const items = log.items.map((i) => ({ camera: i.camera, viewer: i.viewer, from: time(i.startedAt), to: i.open ? 'still watching' : time(i.endedAt), minutes: i.minutes, reason: i.reason, ended: i.endReason }));
      const whose = log.scope === 'ALL' ? '' : ' (your own viewings)';
      if (!items.length) return ok({ ...log, items }, { speak: `No live CCTV viewings on ${log.date}${whose}.` });
      return ok({ ...log, items }, {
        speak: `${items.length} viewing(s) on ${log.date}${whose}: ${items.slice(0, 10).map((i) => `${i.viewer} watched ${i.camera} from ${i.from}${i.reason ? ` (${i.reason})` : ''}`).join('; ')}.`,
        view: { type: 'list.numbered', intro: `**CCTV view log** ${log.date}${whose}`, items: items.map((i) => ({ label: `${i.viewer} · ${i.camera}`, detail: `${i.from}–${i.to}${i.reason ? ` · ${i.reason}` : ''}` })) },
      });
    },
  },

  open_cctv_camera: {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'A link that opens one camera on the Live CCTV page ("open the main gate camera", "show me the bus bay camera", "live view of the hostel corridor"). Returns the link only: the video plays on the page, watermarked and logged, never in chat or WhatsApp. Read-only.',
    inputSchema: closed({ camera: { type: 'string', maxLength: 120, description: 'Camera or zone name, e.g. "main gate"' } }, ['camera']),
    permission: 'camera.live.view', forRoles: STAFF,
    service: 'cctv.service.listStreams() → link',
    async run(ctx, args) {
      const off = await offSpeak();
      if (off) return ok({ enabled: false }, { speak: off });
      const all = await cctv.listStreams(ctx.actor);
      let cam;
      try {
        cam = theNamed(all, args.camera, { label: 'camera', nameOf: (c) => c.name, describe: (c) => `${c.name}${c.zone ? ` (${c.zone})` : ''}` });
      } catch (err) {
        // A zone name ("hostel") picks its only camera.
        const inZone = all.filter((c) => String(c.zone ?? '').toLowerCase() === String(args.camera).trim().toLowerCase());
        if (inZone.length !== 1) throw err;
        [cam] = inZone;
      }
      const st = await cctv.status(ctx.actor);
      const links = linksFor(ctx.actor, cam.id);
      const note = st.gateway.configured ? '' : ` ${NO_GATEWAY}`;
      return ok({ camera: cam.name, zone: cam.zone, status: HEALTH_WORD[cam.health] ?? cam.health, reasonRequired: cam.reasonRequired, ...links }, {
        speak: `Open ${cam.name} on the Live CCTV page: ${ctx.channel === 'WHATSAPP' ? links.url : links.link}${cam.reasonRequired ? ' (you will be asked for a reason)' : ''}. The viewing is logged.${note}`,
      });
    },
  },
};
