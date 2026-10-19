/**
 * Part 8: live CCTV requests in Ask AI and WhatsApp, read into ONE step on a
 * read-only tool in tools/p8Cctv.js. Only for a caller holding
 * camera.live.view (the tools and the service re-check, and refuse families
 * whatever they hold). The words are CCTV's own (camera, CCTV, view log), so
 * nothing here takes a bus, gate or exam question.
 *
 *   "which cameras are online", "are any cameras offline", "list the CCTV cameras"  → list_cctv_cameras
 *   "show me the view log for today", "who watched the cameras today"              → get_cctv_view_log
 *   "open the main gate camera", "show me the bus bay camera", "live view of X"     → open_cctv_camera
 */
const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const CAM = String.raw`(?:cctv\s+)?(?:cameras?|cams?|cctv)`;

const LOG = new RegExp(String.raw`\b(?:cctv|camera)\s+view(?:ing)?\s+log\b|\bview(?:ing)?\s+log\b|\bwho\s+(?:has\s+)?(?:watched|viewed|opened|looked\s+at)\s+(?:the\s+)?(?:[\w\s-]{0,30}?\s)?${CAM}\b|\b${CAM}\s+(?:access|viewing)\s+log\b`, 'i');
const STATUS = new RegExp(String.raw`\b(?:which|what|how\s+many|are\s+(?:any|all|the))\s+(?:of\s+the\s+)?${CAM}\s+(?:are\s+|is\s+)?(?:online|offline|working|down|connected|live|up)\b|\b(?:list|show)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:live\s+)?${CAM}\b(?!\s+(?:view|log))|\b${CAM}\s+(?:status|health)\b|\bis\s+(?:the\s+)?[\w\s-]{1,40}?\s${CAM}\s+(?:working|online|offline|down|up)\b`, 'i');
const OPEN = new RegExp(String.raw`\b(?:open|show(?:\s+me)?|view|watch|see|play|pull\s+up|bring\s+up|go\s+to)\s+(?:the\s+)?(?:live\s+(?:view\s+of\s+)?(?:the\s+)?)?([\w\s-]{2,60}?)\s+${CAM}(?:\s+(?:live|feed|now))?\s*[?.!]*$|\blive\s+(?:view|feed|cctv)\s+(?:of|for|from)\s+(?:the\s+)?([\w\s-]{2,60}?)\s*[?.!]*$`, 'i');

export function cctvStep(message, actor) {
  if (!actor?.permissions?.['ai.copilot.use'] || !actor?.permissions?.['camera.live.view'] || FAMILY.has(actor.roleKey)) return null;
  const t = String(message ?? '').trim();
  if (!t || t.length > 200) return null;
  // The camera pilot's review queue and observations are its own tool (a count only).
  if (/\b(?:review|observations?|presence)\b/i.test(t)) {
    return /\bcameras?\b/i.test(t) && actor.permissions['camera.events.review'] ? { tool: 'get_camera_review_count', args: {} } : null;
  }
  if (LOG.test(t)) {
    const when = /\byesterday\b/i.test(t) ? new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10) : /\b(\d{4}-\d{2}-\d{2})\b/.exec(t)?.[1];
    return { tool: 'get_cctv_view_log', args: when ? { date: when } : {} };
  }
  if (STATUS.test(t)) {
    const args = /\boffline|down\b/i.test(t) ? { status: 'OFFLINE' } : /\b(?:which|what|how\s+many)\b[^?]*\bonline\b/i.test(t) ? { status: 'ONLINE' } : {};
    // "Is the main gate camera working" asks about every camera; the list answers it.
    return { tool: 'list_cctv_cameras', args: /\bis\s+the\b/i.test(t) ? {} : args };
  }
  const m = OPEN.exec(t);
  if (m) {
    const camera = String(m[1] ?? m[2] ?? '').replace(/\b(?:cctv|live|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (camera && !/^(?:all|every|my|any)$/i.test(camera)) return { tool: 'open_cctv_camera', args: { camera } };
  }
  return null;
}
