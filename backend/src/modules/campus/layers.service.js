import mongoose from 'mongoose';
import { Facility } from '../../models/facility.model.js';
import { Lab, PracticalSession } from '../../models/lab.model.js';
import { Vehicle, Trip } from '../../models/fleet.model.js';
import { Visitor, OutPass } from '../../models/safety.model.js';
import { featuresFor } from '../../utils/features.js';
import { logger } from '../../utils/logger.js';
import { listLabs } from '../labs/labs.service.js';
import { ownLabIds } from '../labs/labs.access.js';
import { presentVehicle, positionStatus } from '../fleet/vehicles.service.js';
import { getSettings, schoolDay } from '../safety/shared.js';
import { coverFor } from '../staff/cover.service.js';
import { summary as tasksSummary } from '../tasks/tasks.service.js';

/**
 * Operational layers for the campus map, each read from the module that owns
 * the record (labs, fleet, staff cover, tasks, visitors, out-pass, clubs,
 * sustainability) — nothing is copied into the map.
 *
 * Who gets which layer (the permission behind the module's own read):
 *   labs       labs.read (ALL: every lab; OWN: labs you run or practicals you teach)
 *   transport  transport.fleet.manage, or transport.tracking.read / trips.operate / transport.read at ALL
 *   cover      cover.manage or staffleave.apply (the same as GET /staff/cover/for)
 *   tasks      tasks.read (ALL: the school; OWN: items you own or were delegated)
 *   gate       visitors.manage (visitors on site), hostel.outpass.manage (students out) — counts only
 *   activities clubs.read, when the clubs module is installed
 *   greenery   sustainability.read, when the sustainability module is installed
 *
 * Students, parents and alumni get none of these. Camera observations,
 * safeguarding, health records, visitor names and children's names are never
 * put on the map: the gate is two counts, a lab incident is a count, a trip is
 * seats used of seats available.
 */

const FAMILY = new Set(['STUDENT', 'PARENT', 'ALUMNUS']);
const held = (actor, key, scope = null) => {
  const v = actor.permissions?.[key];
  return Boolean(v) && (!scope || v === scope);
};
const IST_MS = 330 * 60_000;
const hhmmOf = (now) => new Date(now.getTime() + IST_MS).toISOString().slice(11, 16);

/** Which layers this reader may receive (before feature switches). */
export function layerAccess(actor) {
  if (!actor || FAMILY.has(actor.roleKey)) return { labs: false, transport: false, cover: false, tasks: false, gate: false, visitors: false, outpass: false, activities: false, greenery: false };
  const visitors = held(actor, 'visitors.manage');
  const outpass = held(actor, 'hostel.outpass.manage');
  return {
    labs: held(actor, 'labs.read'),
    transport: held(actor, 'transport.fleet.manage') || held(actor, 'transport.tracking.read', 'ALL') || held(actor, 'transport.trips.operate', 'ALL') || held(actor, 'transport.read', 'ALL'),
    cover: held(actor, 'cover.manage') || held(actor, 'staffleave.apply'),
    tasks: held(actor, 'tasks.read'),
    gate: visitors || outpass,
    visitors,
    outpass,
    activities: held(actor, 'clubs.read'),
    greenery: held(actor, 'sustainability.read'),
  };
}

// ── Optional modules (built separately; the layer appears once they exist) ──

const optional = new Map();
const RETRY_MS = 60_000;
/**
 * Loads `exportName` from the first of `paths` that exists, or null. A module
 * that is missing (or still being written) is tried again a minute later, so
 * the layer appears without a restart once it is installed.
 */
export async function loadOptional(name, paths, exportName) {
  const hit = optional.get(name);
  if (hit && (hit.fn || hit.until > Date.now())) return hit.fn;
  let fn = null;
  for (const p of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop -- first match wins
      const mod = await import(p);
      if (typeof mod[exportName] === 'function') { fn = mod[exportName]; break; }
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') logger.debug?.(`Optional campus layer ${name} from ${p}: ${err.message}`);
    }
  }
  optional.set(name, { fn, until: Date.now() + RETRY_MS });
  return fn;
}
/** For tests: forget what was found. */
export function resetOptional() { optional.clear(); }

const CLUBS_PATHS = ['../clubs/sessions.service.js', '../clubs/clubs.service.js', '../clubs/activity.service.js', '../clubs/index.js'];
const GREEN_PATHS = ['../sustainability/sustainability.map.js', '../sustainability/sustainability.service.js', '../sustainability/index.js'];

/** Keeps only plain, non-personal fields from another module's answer. */
const SAFE_KEYS = new Set(['id', 'facilityId', 'facilityCode', 'venue', 'venueName', 'title', 'club', 'clubName', 'team', 'kind', 'type', 'category', 'activity', 'startsAt', 'endsAt', 'startTime', 'endTime', 'status', 'count', 'participants', 'participantCount', 'value', 'unit', 'label', 'zone', 'area', 'metric', 'points', 'target']);
function safeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'object' && v._bsontype === 'ObjectId') out[k] = String(v);
  }
  // A participant list becomes a count.
  if (Array.isArray(row.participants)) out.participants = row.participants.length;
  return out;
}
function safeList(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.sessions) ? value.sessions : Array.isArray(value?.zones) ? value.zones : [];
  return list.slice(0, 50).map(safeRow).filter(Boolean);
}
function safeTotals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const src = value.totals && typeof value.totals === 'object' ? value.totals : value;
  return Object.fromEntries(Object.entries(src).filter(([k, v]) => typeof v === 'number' && !/name|student|child|person|people/i.test(k)).slice(0, 12));
}

// ── Layers ──────────────────────────────────────────────────────────────

const OPEN_SESSION = ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS'];

async function labsLayer(actor, now) {
  const scope = actor.permissions['labs.read'];
  const labs = await listLabs(actor, scope);
  const docs = await Lab.find({ _id: { $in: labs.map((l) => l.id) } }).select('facilityId').lean();
  const facilityOf = new Map(docs.map((d) => [String(d._id), d.facilityId ? String(d.facilityId) : null]));
  // A practical in session: started and not yet over (an open-ended one counts for 90 minutes).
  const filter = { status: { $in: OPEN_SESSION }, startsAt: { $lte: now, $gt: new Date(now.getTime() - 6 * 3_600_000) } };
  if (scope !== 'ALL') {
    const ids = await ownLabIds(actor, scope);
    filter.$or = [{ labId: { $in: ids } }, { teacherProfileId: actor.profileId }];
  }
  const sessions = (await PracticalSession.find(filter).select('labId title subject className startsAt endsAt status').lean())
    .filter((s) => (s.endsAt ? new Date(s.endsAt) > now : now - new Date(s.startsAt) < 90 * 60_000) || s.status === 'IN_PROGRESS');
  const sessionOf = new Map(sessions.map((s) => [String(s.labId), s]));
  // A practical in a lab the reader does not run still shows on that lab.
  const extra = sessions.filter((s) => !labs.some((l) => l.id === String(s.labId)));
  const extraLabs = extra.length ? await Lab.find({ _id: { $in: extra.map((s) => s.labId) } }).select('name facilityId').lean() : [];
  const rows = labs.map((l) => ({ labId: l.id, name: l.name, facilityId: facilityOf.get(l.id) ?? null, counts: true, c: l.counts }))
    .concat(extraLabs.map((l) => ({ labId: String(l._id), name: l.name, facilityId: l.facilityId ? String(l.facilityId) : null, counts: false, c: null })));
  return rows.map((r) => {
    const s = sessionOf.get(r.labId);
    return {
      labId: r.labId, name: r.name, facilityId: r.facilityId,
      practicalNow: s ? { title: s.title, subject: s.subject ?? null, className: s.className ?? null, until: s.endsAt ?? null, status: s.status } : null,
      // Counts only, and only for labs the reader runs.
      openIncidents: r.counts ? r.c.openIncidents ?? 0 : null,
      lowStock: r.counts ? r.c.lowStock ?? 0 : null,
      expiringSoon: r.counts ? (r.c.expiringSoon ?? 0) + (r.c.expired ?? 0) : null,
      calibrationOverdue: r.counts ? r.c.calibrationOverdue ?? 0 : null,
    };
  });
}

async function transportLayer(now) {
  const [vehicles, settings, bay] = await Promise.all([
    Vehicle.find({ status: { $ne: 'RETIRED' } }).sort({ registrationNo: 1 }).lean(),
    getSettings(),
    Facility.findOne({ kind: 'TRANSPORT_BAY' }).select('_id').lean(),
  ]);
  const trips = await Trip.find({ date: schoolDay(now), status: { $ne: 'CANCELLED' }, vehicleId: { $in: vehicles.map((v) => v._id) } })
    .select('vehicleId refNo kind status routeName usableSeats seatsAllocated').lean();
  const tripsOf = new Map();
  for (const t of trips) {
    const k = String(t.vehicleId);
    if (!tripsOf.has(k)) tripsOf.set(k, []);
    tripsOf.get(k).push(t);
  }
  const due = (s) => s === 'EXPIRING' || s === 'EXPIRED';
  const out = vehicles.map((v) => {
    const p = presentVehicle(v, now);
    const latest = new Map();
    for (const d of p.documents) if (!latest.has(d.kind) || new Date(d.validTo ?? 0) > new Date(latest.get(d.kind).validTo ?? 0)) latest.set(d.kind, d);
    const docsDue = [...latest.values()].filter((d) => due(d.state)).map((d) => ({ kind: d.kind, state: d.state, daysLeft: d.daysLeft }));
    const checksDue = Object.entries(p.safetyState).filter(([, s]) => due(s)).map(([k, s]) => ({ kind: k, state: s }));
    return {
      id: String(v._id), registrationNo: v.registrationNo, type: v.type, vehicleStatus: v.status,
      positionStatus: positionStatus(v.lastPosition, settings, now),
      trips: (tripsOf.get(String(v._id)) ?? []).map((t) => ({ refNo: t.refNo, kind: t.kind, status: t.status, routeName: t.routeName ?? null, seatsUsed: t.seatsAllocated ?? 0, capacity: t.usableSeats ?? 0 })),
      documentsDue: docsDue, checksDue, blocked: p.blockingDocuments.length > 0,
    };
  });
  return {
    facilityId: bay ? String(bay._id) : null,
    vehicles: out,
    live: out.filter((v) => v.positionStatus === 'LIVE').length,
    stale: out.filter((v) => v.positionStatus === 'STALE').length,
    offline: out.filter((v) => ['OFFLINE', 'NO_DATA'].includes(v.positionStatus)).length,
    dueSoon: out.filter((v) => v.documentsDue.length || v.checksDue.length).length,
  };
}

async function coverLayer(now) {
  const all = await coverFor(now);
  const hhmm = hhmmOf(now);
  const current = all.filter((c) => c.startTime && c.endTime && c.startTime <= hhmm && c.endTime > hhmm);
  const rooms = current.length
    ? await Facility.find({ $or: [{ sectionId: { $in: current.map((c) => c.sectionId) } }, { code: { $in: current.map((c) => c.room).filter(Boolean) } }, { name: { $in: current.map((c) => c.room).filter(Boolean) } }], restricted: { $ne: true } }).select('code name sectionId').lean()
    : [];
  const roomFor = (c) => (c.room && rooms.find((r) => r.code === c.room || r.name === c.room)) || rooms.find((r) => String(r.sectionId ?? '') === String(c.sectionId)) || null;
  return {
    today: all.length,
    now: current.map((c) => {
      const r = roomFor(c);
      return {
        facilityId: r ? String(r._id) : null, room: r?.name ?? c.room ?? null, className: c.className, periodNo: c.periodNo, startTime: c.startTime, endTime: c.endTime,
        substituteName: c.substituteName, absentName: c.absentName,
        label: `${c.substituteName ?? 'A substitute'} covering for ${c.absentName ?? 'an absent colleague'}`,
      };
    }),
  };
}

/** Task departments → the map's departments. Health items stay off the map. */
const TASK_DEPT = {
  ADMINISTRATION: 'ADMINISTRATION', FINANCE: 'FINANCE', ACADEMICS: 'ACADEMICS', LABS: 'ACADEMICS', TRANSPORT: 'TRANSPORT',
  FACILITIES: 'ADMINISTRATION', COMPLIANCE: 'COMPLIANCE', HR: 'HR', HOSTEL: 'HOSTEL', LIBRARY: 'LIBRARY', ENGAGEMENT: 'LEADERSHIP', IT: 'ADMINISTRATION',
};
async function tasksLayer(actor) {
  const scope = actor.permissions['tasks.read'];
  // tasks.summary matches the owner inside an aggregation, where a string id is not
  // cast; hand it an ObjectId so OWN scope counts the reader's own items.
  const me = mongoose.isValidObjectId(actor.profileId) ? new mongoose.Types.ObjectId(String(actor.profileId)) : actor.profileId;
  const s = await tasksSummary({ ...actor, profileId: me }, scope);
  const rows = s.byDepartment.filter((r) => r.department !== 'HEALTH').map((r) => ({ department: r.department, mapDepartment: TASK_DEPT[r.department] ?? null, overdue: r.overdue, dueThisWeek: r.week, open: r.open }));
  return { scope, byDepartment: rows, overdue: rows.reduce((n, r) => n + r.overdue, 0), dueThisWeek: rows.reduce((n, r) => n + r.dueThisWeek, 0) };
}

async function gateLayer(access, features) {
  const gate = await Facility.findOne({ kind: 'GATE' }).select('_id').lean();
  const [visitorsOnSite, studentsOut] = await Promise.all([
    access.visitors && features.visitors ? Visitor.countDocuments({ status: 'CHECKED_IN' }) : null,
    access.outpass && features.hostelOutpass ? OutPass.countDocuments({ status: 'OUT' }) : null,
  ]);
  return { facilityId: gate ? String(gate._id) : null, visitorsOnSite, studentsOutOnPass: studentsOut };
}

/**
 * Club and team sessions today, from clubs `clubsActivityFor(date)`: the club,
 * its activity, the time and the venue. Never who attends.
 */
export function adaptClubs(value, now = new Date()) {
  if (!Array.isArray(value)) return { items: safeList(value), totals: safeTotals(value) };
  const items = value.slice(0, 50).map((r) => {
    const startsAt = r.startsAt ? new Date(r.startsAt) : null;
    const endsAt = r.endsAt ? new Date(r.endsAt) : null;
    return safeRow({
      id: r.sessionId ?? r.id, title: r.clubName ?? r.title ?? null, category: r.category ?? null, activity: r.activity ?? null, status: r.status ?? null,
      startsAt, endsAt, startTime: startsAt ? hhmmOf(startsAt) : null, endTime: endsAt ? hhmmOf(endsAt) : null,
      facilityId: r.venue && typeof r.venue === 'object' ? r.venue.facilityId ?? null : r.facilityId ?? null,
      venue: r.venue && typeof r.venue === 'object' ? r.venue.name ?? null : r.venue ?? null,
      label: startsAt && endsAt && startsAt <= now && endsAt > now ? 'Now' : null,
    });
  });
  return { items, totals: { sessionsToday: items.length, now: items.filter((i) => i.label === 'Now').length } };
}

/**
 * Green zones from sustainability `sustainabilityFor()`: plants alive of
 * planted and sanitation tasks open per zone. Waste and activity logs stay on
 * their own page.
 */
export function adaptGreenery(value) {
  if (!value || !Array.isArray(value.zones)) return { items: safeList(value), totals: safeTotals(value) };
  const items = value.zones.slice(0, 50).map((z) => safeRow({
    id: z.id, title: z.name, kind: z.kind, facilityId: z.facilityId ?? null,
    value: z.plants?.alive ?? null, unit: z.plants?.planted ? `of ${z.plants.planted} plants alive` : null,
    count: z.openSanitationTasks ?? 0, target: z.overdueSanitationTasks ?? 0,
  }));
  const open = Array.isArray(value.openSanitationTasks) ? value.openSanitationTasks : [];
  return {
    items,
    totals: {
      zones: items.length,
      plantsAlive: value.zones.reduce((n, z) => n + (z.plants?.alive ?? 0), 0),
      plantsPlanted: value.zones.reduce((n, z) => n + (z.plants?.planted ?? 0), 0),
      sanitationOpen: open.length, sanitationOverdue: open.filter((t) => t.overdue).length,
    },
  };
}

async function optionalLayer(name, paths, exportName, arg, adapt) {
  const fn = await loadOptional(name, paths, exportName);
  if (!fn) return { available: false, note: 'This module is not installed yet.' };
  const value = await fn(arg);
  return { available: true, ...adapt(value) };
}

/**
 * Every operational layer the reader may see, for one moment. A layer that
 * fails is reported as unavailable instead of failing the map.
 */
export async function campusLayers(actor, { now = new Date() } = {}) {
  const access = layerAccess(actor);
  const features = await featuresFor();
  const on = {
    labs: access.labs && features.labs,
    transport: access.transport && features.fleet,
    cover: access.cover && features.staffCover,
    tasks: access.tasks && features.tasks,
    gate: access.gate && (features.visitors || features.hostelOutpass),
    activities: access.activities && features.clubs,
    greenery: access.greenery && features.sustainability,
  };
  const jobs = {
    labs: () => labsLayer(actor, now),
    transport: () => transportLayer(now),
    cover: () => coverLayer(now),
    tasks: () => tasksLayer(actor),
    gate: () => gateLayer(access, features),
    activities: () => optionalLayer('clubs', CLUBS_PATHS, 'clubsActivityFor', now, (v) => adaptClubs(v, now)),
    greenery: () => optionalLayer('sustainability', GREEN_PATHS, 'sustainabilityFor', undefined, adaptGreenery),
  };
  const keys = Object.keys(jobs).filter((k) => on[k]);
  const results = await Promise.allSettled(keys.map((k) => jobs[k]()));
  const out = { asOf: now.toISOString(), layers: Object.fromEntries(Object.keys(jobs).map((k) => [k, on[k]])), unavailable: [] };
  keys.forEach((k, i) => {
    if (results[i].status === 'fulfilled') out[k] = results[i].value;
    else { out[k] = null; out.unavailable.push(k); logger.warn(`Campus layer ${k} unavailable: ${results[i].reason?.message}`); }
  });
  return out;
}
