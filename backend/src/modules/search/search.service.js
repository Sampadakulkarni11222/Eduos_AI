import { Student, Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { Profile } from '../../models/profile.model.js';
import { Announcement } from '../../models/announcement.model.js';
import { Document } from '../../models/document.model.js';
import { Book } from '../../models/library.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { Club } from '../../models/club.model.js';
import { Lab, LabItem, LabEquipment } from '../../models/lab.model.js';
import { Vehicle } from '../../models/fleet.model.js';
import { Asset } from '../../models/finance.model.js';
import { Lead } from '../../models/lead.model.js';
import { Campaign } from '../../models/marketing.model.js';
import { OfflineCampaign } from '../../models/marketingGrowth.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { escapeRegex } from '../ops/common.js';
import { audienceFilterFor } from '../announcements/announcement.service.js';
import { buildVisibilityFilter } from '../documents/document.service.js';
import * as community from '../community/community.service.js';
import { teachersOfSection } from '../ptm/relations.js';
import { ownLabIds } from '../labs/labs.access.js';

/**
 * Universal search.
 *
 * One query fans out to a provider per kind of record. Every provider decides
 * for itself, on the server, whether the caller may search that kind at all
 * (the same permission its own page needs) and narrows the query to what the
 * caller may see at their scope: a parent finds their own children, those
 * children's teachers and the notices addressed to them; a student finds
 * themself; a teacher finds the students of the sections they teach unless
 * they hold students.read school-wide. The tenant plugin keeps every query
 * inside the caller's school.
 *
 * The text is matched with an escaped, case-insensitive regular expression
 * anchored at the start of a word, so a typed "(" or ".*" is literal text and
 * never a pattern. Results carry only what a list row on the record's own page
 * would show to the same person, and a hint of which page opens it; the
 * client picks the first of those pages that the caller's own menu has.
 */

export const MIN_CHARS = 2;
export const MAX_CHARS = 80;
export const PER_TYPE = 6;

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const isFamily = (actor) => FAMILY.has(actor?.roleKey);
const scopeOf = (actor, key) => actor?.permissions?.[key] ?? null;
const fullName = (s) => [s?.firstName, s?.lastName].filter(Boolean).join(' ').trim();

/** Prefix match on the whole value. */
export function prefixRegex(q) { return new RegExp(`^${escapeRegex(q)}`, 'i'); }
/** Match at the start of any word in the value. */
export function wordRegex(q) { return new RegExp(`(?:^|[\\s\\-_/(,.:#])${escapeRegex(q)}`, 'i'); }

/** Cleans the query: trimmed, collapsed spaces, at most MAX_CHARS, refused under MIN_CHARS. */
export function cleanQuery(raw) {
  if (Array.isArray(raw) || (raw !== undefined && raw !== null && typeof raw === 'object')) throw new AppError('q must be text', 400, [], 'BAD_QUERY');
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (q.length < MIN_CHARS) throw new AppError(`Type at least ${MIN_CHARS} characters to search.`, 400, [], 'QUERY_TOO_SHORT');
  return q;
}

/** What the caller belongs to, computed at most once per search. */
function reachOf(actor) {
  const memo = new Map();
  const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  const reach = {
    /** Students this person speaks for: their own record, or their children. */
    ownStudentIds: () => once('own', async () => {
      if (actor.roleKey === 'STUDENT') return [await getOwnStudentId(actor.profileId)].filter(Boolean).map(String);
      if (actor.roleKey === 'PARENT') return (await getGuardianStudentIds(actor.profileId)).map(String);
      return [];
    }),
    /** Sections of those students' current enrolments. */
    familySections: () => once('famSections', async () => {
      const ids = await reach.ownStudentIds();
      if (!ids.length) return [];
      const ens = await Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' }).select('sectionId').lean();
      return [...new Set(ens.map((e) => String(e.sectionId)))];
    }),
    teacherSections: () => once('teach', async () => (await getTeacherSectionIds(actor.profileId)).map(String)),
  };
  return reach;
}

async function classLabels(sectionIds) {
  const sections = await Section.find({ _id: { $in: sectionIds } }).select('name gradeId').populate('gradeId', 'name').lean();
  return new Map(sections.map((s) => [String(s._id), `${s.gradeId?.name ?? ''} ${s.name ?? ''}`.trim()]));
}

/** Student ids whose names (or admission number) match, inside `restrictTo` when given. */
async function matchingStudents(q, { restrictTo = null, limit = PER_TYPE, withAdmissionNo = true } = {}) {
  const rx = prefixRegex(q);
  const or = [{ firstName: rx }, { lastName: rx }];
  if (withAdmissionNo) or.push({ admissionNo: rx });
  const parts = q.split(' ');
  if (parts.length > 1) or.push({ firstName: prefixRegex(parts[0]), lastName: prefixRegex(parts.slice(1).join(' ')) });
  const filter = { deletedAt: null, $or: or };
  if (restrictTo) filter._id = { $in: restrictTo };
  return Student.find(filter).select('firstName lastName admissionNo').sort({ firstName: 1, lastName: 1 }).limit(limit).lean();
}

// ── providers ─────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    type: 'students', label: 'Students', pages: ['student-classes', 'classes', 'students', 'risk', 'student-view', 'performance', 'profile'],
    async run({ actor, q, reach }) {
      const scope = scopeOf(actor, 'students.read');
      if (!scope) return [];
      let restrictTo = null;
      if (scope !== 'ALL') {
        if (actor.roleKey === 'TEACHER') {
          const sections = await reach.teacherSections();
          if (!sections.length) return [];
          const ens = await Enrollment.find({ sectionId: { $in: sections }, status: 'ACTIVE' }).select('studentId').lean();
          restrictTo = ens.map((e) => e.studentId);
        } else if (actor.roleKey === 'PARENT' || actor.roleKey === 'STUDENT') {
          restrictTo = await reach.ownStudentIds();
        } else {
          return [];
        }
        if (!restrictTo.length) return [];
      }
      const family = isFamily(actor);
      const rows = await matchingStudents(q, { restrictTo, withAdmissionNo: !family });
      const ens = await Enrollment.find({ studentId: { $in: rows.map((r) => r._id) }, status: 'ACTIVE' }).select('studentId sectionId').lean();
      const labels = await classLabels(ens.map((e) => e.sectionId));
      const classOf = new Map(ens.map((e) => [String(e.studentId), labels.get(String(e.sectionId)) ?? null]));
      return rows.map((s) => ({
        id: String(s._id), title: fullName(s),
        // A family sees the name and class it already knows; staff also see the admission number.
        subtitle: [classOf.get(String(s._id)), family ? null : s.admissionNo].filter(Boolean).join(' · ') || null,
        params: { q: fullName(s) },
      }));
    },
  },
  {
    type: 'staff', label: 'Staff', pages: ['users', 'staff', 'organization', 'conversations', 'ptm'],
    async run({ actor, q, reach }) {
      const rx = wordRegex(q);
      // A family finds only the teachers of their own child's class (and the principal).
      if (actor.roleKey === 'PARENT' || actor.roleKey === 'STUDENT') {
        const sections = await reach.familySections();
        const seen = new Map();
        for (const sec of sections) {
          // eslint-disable-next-line no-await-in-loop
          for (const t of await teachersOfSection(sec)) if (!seen.has(t.profileId)) seen.set(t.profileId, t);
        }
        return [...seen.values()].filter((t) => rx.test(t.name)).slice(0, PER_TYPE).map((t) => ({
          id: t.profileId, title: t.name,
          subtitle: [t.roles.includes('CLASS_TEACHER') ? 'Class teacher' : null, t.roles.includes('PRINCIPAL') ? 'Principal' : null, t.subjects.join(', ') || null].filter(Boolean).join(' · ') || null,
          params: { q: t.name },
        }));
      }
      if (isFamily(actor)) return [];
      // Staff see colleagues' names and roles, as the organisation map shows them.
      if (!scopeOf(actor, 'users.read') && !scopeOf(actor, 'org.read')) return [];
      const rows = await Profile.find({ displayName: rx, status: 'ACTIVE', deletedAt: null }).select('displayName roleId').populate('roleId', 'key name').limit(PER_TYPE * 4).lean();
      return rows.filter((p) => p.roleId?.key && !FAMILY.has(p.roleId.key) && p.roleId.key !== 'SUPER_ADMIN').slice(0, PER_TYPE).map((p) => ({
        id: String(p._id), title: p.displayName, subtitle: p.roleId?.name ?? null, params: { q: p.displayName },
      }));
    },
  },
  {
    type: 'classes', label: 'Classes', pages: ['student-classes', 'classes', 'timetable', 'attendance'],
    async run({ actor, q, reach }) {
      const lower = q.toLowerCase();
      let allowed = null;
      if (isFamily(actor)) {
        if (actor.roleKey === 'ALUMNUS') return [];
        allowed = new Set(await reach.familySections());
      } else if (!scopeOf(actor, 'academics.read')) {
        if (actor.roleKey !== 'TEACHER') return [];
        allowed = new Set(await reach.teacherSections());
      }
      const filter = allowed ? { _id: { $in: [...allowed] } } : {};
      const sections = await Section.find(filter).select('name gradeId').populate('gradeId', 'name level').limit(500).lean();
      const mine = actor.roleKey === 'TEACHER' ? new Set(await reach.teacherSections()) : new Set();
      return sections
        .map((s) => ({ s, label: `${s.gradeId?.name ?? ''} ${s.name}`.trim() }))
        .filter(({ label }) => label.toLowerCase().includes(lower) || label.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lower.replace(/[^a-z0-9]/g, '')))
        .sort((a, b) => (a.s.gradeId?.level ?? 0) - (b.s.gradeId?.level ?? 0) || a.label.localeCompare(b.label))
        .slice(0, PER_TYPE)
        .map(({ s, label }) => ({ id: String(s._id), title: label, subtitle: mine.has(String(s._id)) ? 'You teach this class' : null, params: { sectionId: String(s._id) } }));
    },
  },
  {
    type: 'notices', label: 'Notices', pages: ['announcements'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'announcements.read')) return [];
      const rx = wordRegex(q);
      const rows = await Announcement.find({ deletedAt: null, $and: [await audienceFilterFor(actor), { $or: [{ title: rx }, { content: rx }] }] })
        .select('title publishedAt').sort({ publishedAt: -1 }).limit(PER_TYPE).lean();
      return rows.map((a) => ({ id: String(a._id), title: a.title, subtitle: a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : null, params: { q: a.title } }));
    },
  },
  {
    type: 'news', label: 'Newsroom', pages: ['newsroom'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'community.read')) return [];
      // The newsroom's own feed, so its audience rules decide (class, role, circle, consent).
      const page = await community.feed(actor, { q, pageSize: PER_TYPE });
      return page.items.map((p) => ({ id: p.id, title: p.title || String(p.body ?? '').slice(0, 80), subtitle: p.kind ? p.kind.replace(/_/g, ' ').toLowerCase() : null, params: { post: p.id } }));
    },
  },
  {
    type: 'documents', label: 'Documents & material', pages: ['documents', 'material'],
    async run({ actor, q }) {
      const scope = scopeOf(actor, 'materials.read');
      if (!scope) return [];
      const visible = await buildVisibilityFilter(actor, scope, null, {});
      const rows = await Document.find({ $and: [visible, { title: wordRegex(q) }] }).select('title type').sort({ createdAt: -1 }).limit(PER_TYPE).lean();
      return rows.map((d) => ({ id: String(d._id), title: d.title, subtitle: d.type && d.type !== 'CUSTOM' ? d.type.replace(/_/g, ' ').toLowerCase() : 'Course material', params: { q: d.title } }));
    },
  },
  {
    type: 'books', label: 'Library', pages: ['library', 'books', 'notes', 'question-papers'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'library.read')) return [];
      const rx = wordRegex(q);
      const rows = await Book.find({ deletedAt: null, $or: [{ title: rx }, { author: rx }, { isbn: prefixRegex(q) }] }).select('title author').sort({ title: 1 }).limit(PER_TYPE).lean();
      return rows.map((b) => ({ id: String(b._id), title: b.title, subtitle: b.author || null, params: { q: b.title } }));
    },
  },
  {
    type: 'labs', label: 'Labs', pages: ['labs'],
    async run({ actor, q }) {
      const scope = scopeOf(actor, 'labs.read');
      if (!scope || isFamily(actor)) return [];
      const ids = await ownLabIds(actor, scope);
      const rx = wordRegex(q);
      const labFilter = ids === null ? {} : { labId: { $in: ids } };
      const [labs, items, equipment] = await Promise.all([
        Lab.find({ ...(ids === null ? {} : { _id: { $in: ids } }), name: rx }).select('name').limit(PER_TYPE).lean(),
        LabItem.find({ ...labFilter, name: rx }).select('name labId').limit(PER_TYPE).lean(),
        LabEquipment.find({ ...labFilter, name: rx }).select('name labId').limit(PER_TYPE).lean(),
      ]);
      return [
        ...labs.map((l) => ({ id: String(l._id), title: l.name, subtitle: 'Laboratory', params: { q: l.name } })),
        ...items.map((i) => ({ id: String(i._id), title: i.name, subtitle: 'Lab stock', params: { q: i.name } })),
        ...equipment.map((i) => ({ id: String(i._id), title: i.name, subtitle: 'Lab equipment', params: { q: i.name } })),
      ].slice(0, PER_TYPE);
    },
  },
  {
    type: 'assets', label: 'Assets', pages: ['procurement'],
    async run({ actor, q }) {
      if (isFamily(actor) || (scopeOf(actor, 'procurement.read') !== 'ALL' && !scopeOf(actor, 'procurement.manage'))) return [];
      const rows = await Asset.find({ $or: [{ tag: prefixRegex(q) }, { description: wordRegex(q) }] }).select('tag description status').limit(PER_TYPE).lean();
      return rows.map((a) => ({ id: String(a._id), title: `${a.tag} · ${a.description}`, subtitle: a.status ? a.status.replace(/_/g, ' ').toLowerCase() : null, params: { q: a.tag } }));
    },
  },
  {
    type: 'vehicles', label: 'Vehicles', pages: ['fleet', 'transport'],
    async run({ actor, q }) {
      const p = actor?.permissions ?? {};
      const may = p['transport.fleet.manage'] || p['transport.tracking.read'] === 'ALL' || p['transport.trips.operate'] === 'ALL' || p['transport.read'] === 'ALL';
      if (!may || isFamily(actor)) return [];
      const compact = q.replace(/[\s-]/g, '');
      const rows = await Vehicle.find({ registrationNo: prefixRegex(compact.toUpperCase()) }).select('registrationNo kind status').limit(PER_TYPE).lean();
      return rows.map((v) => ({ id: String(v._id), title: v.registrationNo, subtitle: [v.kind, v.status].filter(Boolean).join(' · ').toLowerCase() || null, params: { q: v.registrationNo } }));
    },
  },
  {
    type: 'tickets', label: 'Tickets & requests', pages: ['tickets'],
    async run({ actor, q }) {
      const scope = scopeOf(actor, 'tickets.read');
      if (!scope) return [];
      const filter = { subject: wordRegex(q) };
      if (scope !== 'ALL') filter.$or = [{ raisedByProfileId: actor.profileId }, { assigneeProfileId: actor.profileId }];
      const rows = await Ticket.find(filter).select('subject status').sort({ createdAt: -1 }).limit(PER_TYPE).lean();
      return rows.map((t) => ({ id: String(t._id), title: t.subject, subtitle: t.status?.toLowerCase() ?? null, params: { q: t.subject } }));
    },
  },
  {
    type: 'tasks', label: 'Tasks', pages: ['tasks'],
    async run({ actor, q }) {
      const scope = scopeOf(actor, 'tasks.read');
      if (!scope || isFamily(actor)) return [];
      const filter = { title: wordRegex(q) };
      if (scope !== 'ALL') filter.$or = [{ ownerProfileId: actor.profileId }, { delegateProfileId: actor.profileId }];
      const rows = await DueItem.find(filter).select('title dueAt status').sort({ dueAt: 1 }).limit(PER_TYPE).lean();
      return rows.map((t) => ({ id: String(t._id), title: t.title, subtitle: [t.status?.toLowerCase(), t.dueAt ? `due ${new Date(t.dueAt).toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · '), params: { q: t.title } }));
    },
  },
  {
    type: 'clubs', label: 'Clubs & teams', pages: ['clubs'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'clubs.read')) return [];
      const rows = await Club.find({ status: 'ACTIVE', name: wordRegex(q) }).select('name kind').limit(PER_TYPE).lean();
      return rows.map((c) => ({ id: String(c._id), title: c.name, subtitle: c.kind === 'TEAM' ? 'Team' : 'Club', params: { q: c.name } }));
    },
  },
  {
    type: 'enquiries', label: 'Admission enquiries', pages: ['admissions', 'online-applications'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'admissions.read') || isFamily(actor)) return [];
      const digits = q.replace(/\D/g, '');
      const or = [{ childName: wordRegex(q) }, { guardianName: wordRegex(q) }];
      if (digits.length >= 4) or.push({ phone: new RegExp(escapeRegex(digits)) });
      const rows = await Lead.find({ $or: or }).select('childName guardianName stage gradeApplying').sort({ createdAt: -1 }).limit(PER_TYPE).lean();
      return rows.map((l) => ({ id: String(l._id), title: l.childName, subtitle: [l.guardianName, l.gradeApplying, l.stage?.toLowerCase()].filter(Boolean).join(' · '), params: { q: l.childName } }));
    },
  },
  {
    type: 'campaigns', label: 'Campaigns', pages: ['campaigns', 'marketing'],
    async run({ actor, q }) {
      if (!scopeOf(actor, 'marketing.read') || isFamily(actor)) return [];
      const or = [{ name: wordRegex(q) }, { code: prefixRegex(q) }];
      const [online, offline] = await Promise.all([
        Campaign.find({ $or: or }).select('name code status').limit(PER_TYPE).lean(),
        OfflineCampaign.find({ $or: [...or, { channelType: prefixRegex(q.replace(/ +/g, '_')) }, { 'placements.location': wordRegex(q) }] }).select('name code status channelType').limit(PER_TYPE).lean(),
      ]);
      return [
        ...online.map((c) => ({ id: String(c._id), title: c.name, subtitle: [c.code, c.status?.toLowerCase()].filter(Boolean).join(' · '), params: { q: c.code } })),
        ...offline.map((c) => ({ id: String(c._id), title: c.name, subtitle: ['Offline', c.code, c.status?.toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(' · '), params: { q: c.code } })),
      ];
    },
  },
];

/** Registers another provider (another module's records). */
export function registerSearchProvider(provider) {
  if (!provider?.type || typeof provider.run !== 'function') throw new Error('A search provider needs a type and run()');
  if (PROVIDERS.some((p) => p.type === provider.type)) throw new Error(`Search provider ${provider.type} exists`);
  PROVIDERS.push({ pages: [], label: provider.type, ...provider });
}

export const providerTypes = () => PROVIDERS.map((p) => p.type);

/**
 * Runs every provider the caller may use and returns non-empty groups.
 * A provider that fails is left out (and logged); it never takes the others down.
 */
export async function search(actor, rawQuery, { types = null } = {}) {
  if (!actor?.profileId) throw new AppError('Sign in to search', 401);
  const q = cleanQuery(rawQuery);
  const reach = reachOf(actor);
  const wanted = types ? PROVIDERS.filter((p) => types.includes(p.type)) : PROVIDERS;
  const settled = await Promise.all(wanted.map(async (p) => {
    try {
      const items = (await p.run({ actor, q, reach })) ?? [];
      return { type: p.type, label: p.label, pages: p.pages, items: items.slice(0, PER_TYPE) };
    } catch (err) {
      logger.warn(`[search] ${p.type} failed: ${err.message}`);
      return { type: p.type, label: p.label, pages: p.pages, items: [] };
    }
  }));
  const groups = settled.filter((g) => g.items.length);
  return { q, groups, total: groups.reduce((n, g) => n + g.items.length, 0) };
}

