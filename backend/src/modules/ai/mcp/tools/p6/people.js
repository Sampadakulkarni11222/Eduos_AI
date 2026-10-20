// Part-6 coverage tools: people. See ./_kit.js and ../p6Coverage.js.
//
// Staff professional profiles, the organisation chart (units, positions,
// appointments), background verification, acknowledging a task, staff-leave
// policies and balances, cover rules and absences, recruitment and exit steps
// that had no assistant path, and one user account read. Each tool is the
// route's own service call behind the route's own guard; the service still
// decides who may act on whose record.
import * as creds from '../../../../staff/credentials.service.js';
import * as org from '../../../../institution/org.service.js';
import * as verification from '../../../../administration/verification.service.js';
import * as tasks from '../../../../tasks/tasks.service.js';
import * as staffLeave from '../../../../staff/staffLeave.service.js';
import * as cover from '../../../../staff/cover.service.js';
import * as hr from '../../../../p4ops/people.service.js';
import * as users from '../../../../users/user.service.js';
import { profilesWithRoles } from '../../../../ops/common.js';
import { CHECK_TYPES } from '../../../../../models/verification.model.js';
import { LEAVE_CODES } from '../../../../../models/staffLeave.model.js';
import { VACANCY_STATUSES } from '../../../../../models/p4People.model.js';
import { collectPages } from '../_shared.js';
import {
  tool, text, int, num, bool, oneOf, list, closed, ask, notFound, pick, listed, shown, did,
  need, needAny, lower, words, day, todayIst, stripTitle, excerpt, RISK, dateStr, AppError, decisionArg,
} from './_kit.js';

const STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const FAMILY = ['PARENT', 'STUDENT'];

/** A member of staff of this school by name (the staff-leave roster). */
async function staffNamed(name, label = 'member of staff') {
  const rows = (await profilesWithRoles([...staffLeave.STAFF_ROLES, 'NURSE'])).map((p) => ({ id: String(p._id), name: p.displayName }));
  return pick(rows, stripTitle(name), { label, nameOf: (r) => r.name, refOf: () => null, describe: (r) => r.name });
}

/* ── Staff professional profiles ──────────────────────────── */

const qualification = closed({ degree: text(120, 'e.g. "B.Ed"'), institution: text(160), year: int(1950, 2100) }, ['degree']);
const certification = closed({ name: text(120, 'e.g. "CTET"'), issuer: text(120), year: int(1950, 2100) }, ['name']);
const PROFILE_FIELDS = {
  qualifications: list(qualification, 10, 'Replaces the list of qualifications'),
  subjects: list(text(60), 12, 'Replaces the subjects taught'),
  specialisations: list(text(60), 12),
  experienceYears: int(0, 60, 'Years of teaching or working experience'),
  certifications: list(certification, 12, 'Replaces the list of certifications'),
  bio: text(600, 'A short professional bio'),
};
const PARTS = ['qualifications', 'subjects', 'experience', 'certifications', 'bio'];

const profileBody = (args) => Object.fromEntries(Object.keys(PROFILE_FIELDS).filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
const profileChanges = (args) => Object.keys(PROFILE_FIELDS).filter((k) => args[k] !== undefined).map((k) => {
  const v = args[k];
  if (Array.isArray(v)) return `${k}: ${v.map((x) => (typeof x === 'string' ? x : x.degree ?? x.name)).join(', ') || 'none'}`;
  return `${k}: ${excerpt(v, 60)}`;
});
const speakProfile = (p) => {
  const bits = [
    p.qualifications?.length ? `qualifications ${p.qualifications.map((q) => [q.degree, q.institution, q.year].filter(Boolean).join(', ')).join('; ')}` : null,
    p.subjects?.length ? `subjects ${p.subjects.join(', ')}` : null,
    p.experienceYears !== null && p.experienceYears !== undefined ? `${p.experienceYears} years' experience` : null,
    p.certifications?.length ? `certifications ${p.certifications.map((c) => c.name).join(', ')}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join('; ') : 'nothing filled in yet';
};

const staffProfileTools = {
  get_my_staff_profile: tool({
    module: 'Staff profiles', operation: 'GET',
    description: "For a member of staff: their own professional profile (qualifications, subjects, experience, certifications, bio) and which parts they have agreed to show families, with what families see. Read-only.",
    permission: 'ai.copilot.use', forRoles: STAFF,
    service: 'staff/credentials.service.mine()',
    async run(ctx) {
      const p = await creds.mine(ctx.actor);
      const showing = PARTS.filter((k) => p.showToFamilies?.[k]);
      return shown(p, `Your profile: ${speakProfile(p)}. Shown to families: ${showing.length ? showing.join(', ') : 'nothing'}.`);
    },
  }),

  update_my_staff_profile: tool({
    module: 'Staff profiles', operation: 'UPDATE', risk: RISK.LOW,
    description: "For a member of staff: change their own professional profile (qualifications, subjects, specialisations, years of experience, certifications, bio) and choose which parts families may see. A list given replaces the one on file. Needs confirmation.",
    inputSchema: closed({
      ...PROFILE_FIELDS,
      showToFamilies: list(oneOf(PARTS), 5, 'The parts families may see; the others are hidden. Leave out to keep the current choice.'),
    }),
    permission: 'ai.copilot.use', forRoles: STAFF,
    service: 'staff/credentials.service.updateMine()',
    summarise: (a) => {
      const bits = profileChanges(a);
      if (a.showToFamilies) bits.push(`families see: ${a.showToFamilies.length ? a.showToFamilies.join(', ') : 'nothing'}`);
      return `Update your staff profile — ${bits.join('; ') || 'no change'}`;
    },
    async prepare(_ctx, args) {
      if (!Object.keys(args).length) throw ask('What should change on your profile?');
      return undefined;
    },
    async run(ctx, args) {
      const body = profileBody(args);
      if (args.showToFamilies) body.showToFamilies = Object.fromEntries(PARTS.map((k) => [k, args.showToFamilies.includes(k)]));
      const p = await creds.updateMine(ctx.actor, body);
      return did('staff_profile_saved', { id: p.profileId, ...p }, 'Your profile is saved.');
    },
  }),

  list_my_child_teacher_profiles: tool({
    module: 'Staff profiles', operation: 'GET',
    description: "For a parent or student: the teachers of their (child's) class, what each teaches, and only what each teacher agreed to show families (qualifications, experience, bio). Read-only.",
    inputSchema: closed({ studentName: text(80, "The child, for a parent with more than one") }),
    permission: 'ai.copilot.use', forRoles: FAMILY,
    service: 'staff/credentials.service.teachersOf()',
    async run(ctx, args) {
      let studentId = null;
      if (args.studentName) {
        const { ownStudentIds } = await import('../../../../safety/shared.js');
        const { Student } = await import('../../../../../models/student.model.js');
        const ids = await ownStudentIds(ctx.actor);
        const rows = (await Student.find({ _id: { $in: ids } }).select('firstName lastName').lean()).map((s) => ({ id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() }));
        studentId = pick(rows, args.studentName, { label: 'child of yours', refOf: () => null }).id;
      }
      const out = await creds.teachersOf(ctx.actor, { studentId });
      return listed(out.teachers, (t) => `${t.name}${t.classTeacher ? ' (class teacher)' : ''}${t.teaches?.length ? ` — ${t.teaches.join(', ')}` : ''}`, { noun: 'teacher', extra: { child: out.child, note: out.note } });
    },
  }),

  list_staff_profiles: tool({
    module: 'Staff profiles', operation: 'GET',
    description: "For HR: every member of staff with how complete their professional profile is (out of 5 parts) and which parts they show families; optionally search by name. Read-only.",
    inputSchema: closed({ search: text(60) }),
    permission: 'org.manage', minScope: 'ALL',
    anyOf: [['verification.manage', 'ALL'], ['org.manage', 'ALL'], ['users.manage', 'ALL']],
    guard: (ctx) => needAny(ctx, [['verification.manage', 'ALL'], ['org.manage', 'ALL'], ['users.manage', 'ALL']]),
    service: 'staff/credentials.service.listStaff()',
    async run(ctx, args) {
      const rows = await creds.listStaff(ctx.actor, { search: args.search ?? '' });
      return listed(rows, (r) => `${r.name} (${r.role ?? 'staff'}) ${r.filled}/${r.of}`, { noun: 'staff profile' });
    },
  }),

  update_staff_profile: tool({
    module: 'Staff profiles', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For HR: correct a colleague's professional profile (qualifications, subjects, specialisations, years of experience, certifications, bio). What families may see stays the colleague's own choice. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120, 'The colleague, e.g. "Sunita Rao"'), ...PROFILE_FIELDS }, ['staffName']),
    permission: 'org.manage', minScope: 'ALL',
    anyOf: [['verification.manage', 'ALL'], ['org.manage', 'ALL'], ['users.manage', 'ALL']],
    guard: (ctx) => needAny(ctx, [['verification.manage', 'ALL'], ['org.manage', 'ALL'], ['users.manage', 'ALL']]),
    service: 'staff/credentials.service.updateFor()',
    summarise: (a, _x, p) => `Update ${p?.name ?? a.staffName}'s staff profile — ${profileChanges(a).join('; ') || 'no change'}`,
    async prepare(_ctx, args) {
      if (!Object.keys(profileBody(args)).length) throw ask(`What should change on ${args.staffName}'s profile?`);
      const who = await staffNamed(args.staffName, 'colleague');
      return { profileId: who.id, name: who.name };
    },
    async run(ctx, args, p) {
      const out = await creds.updateFor(ctx.actor, p.profileId, profileBody(args));
      return did('staff_profile_saved', { id: out.profileId, ...out }, `${p.name}'s profile is saved.`);
    },
  }),
};

/* ── Organisation chart ───────────────────────────────────── */

const UNIT_KINDS = ['GOVERNING_BODY', 'LEADERSHIP', 'DEPARTMENT', 'TEAM', 'COMMITTEE'];
const POSITION_ROLES = ['PRINCIPAL', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'TRUSTEE'];

function flatUnits(tree, out = [], parent = null) {
  for (const u of tree ?? []) {
    out.push({ id: u.id, name: u.name, kind: u.kind, code: u.code, parent, positions: u.positions?.length ?? 0, children: u.children?.length ?? 0 });
    flatUnits(u.children, out, u.name);
  }
  return out;
}
async function unitNamed(name, label = 'unit') {
  const c = await org.chart();
  return pick(flatUnits(c.tree), name, { label, describe: (u) => `${u.name} (${words(u.kind)})` });
}
async function positionNamed(name, label = 'position') {
  const c = await org.chart();
  const units = new Map(flatUnits(c.tree).map((u) => [u.id, u.name]));
  const rows = c.positions.map((p) => ({ ...p, unit: units.get(p.orgUnitId) ?? null }));
  return pick(rows, name, { label, nameOf: (p) => p.title, refOf: () => null, describe: (p) => `${p.title}${p.unit ? ` (${p.unit})` : ''}` });
}

const orgTools = {
  list_appointable_staff: tool({
    module: 'Organisation', operation: 'GET',
    description: 'The staff who can be appointed to a position in the organisation chart: name and role only. Read-only.',
    inputSchema: closed({ search: text(60) }),
    permission: 'org.read',
    service: 'org.service.appointableStaff()',
    async run(_ctx, args) {
      const rows = (await org.appointableStaff()).filter((p) => !args.search || lower(p.name).includes(lower(args.search)));
      return listed(rows, (p) => `${p.name} (${words(p.roleKey ?? 'staff')})`, { noun: 'member of staff' });
    },
  }),

  set_up_org_structure: tool({
    module: 'Organisation', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: "For administration or HR, once, on an empty chart: build the organisation structure from the staff records (governing body, leadership, a department per staff role, a position for each, every current role holder appointed). Afterwards the chart is edited, not rebuilt. Confirmed on the website.",
    inputSchema: closed({ institutionType: oneOf(['SCHOOL', 'COLLEGE'], 'Default: the school\'s own type') }),
    permission: 'org.manage',
    service: 'institution.service.terminology() + org.service.bootstrap()',
    summarise: (a) => `Build the organisation chart from the staff records${a.institutionType ? ` as a ${a.institutionType.toLowerCase()}` : ''} (only on an empty chart)`,
    async run(_ctx, args) {
      const { terminology } = await import('../../../../institution/institution.service.js');
      const type = args.institutionType ?? (await terminology()).institutionType;
      const c = await org.bootstrap(type);
      return did('org_structure_created', null, `Built the chart: ${c.stats.units} units, ${c.stats.positions} positions, ${c.stats.filled} people placed.`);
    },
  }),

  create_org_unit: tool({
    module: 'Organisation', operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'Add a unit to the organisation chart (a department, team, committee, leadership group or governing body), optionally under a parent unit. Needs confirmation.',
    inputSchema: closed({ name: text(120), kind: oneOf(UNIT_KINDS), parentUnit: text(120, 'The unit it sits under'), code: text(20), description: text(1000) }, ['name', 'kind']),
    permission: 'org.manage',
    service: 'org.service.createUnit()',
    summarise: (a, _x, p) => `Add the ${words(a.kind)} "${a.name}" to the organisation chart${p?.parent ? ` under ${p.parent}` : ''}`,
    async prepare(_ctx, args) {
      if (!args.parentUnit) return { parentId: null, parent: null };
      const u = await unitNamed(args.parentUnit, 'parent unit');
      return { parentId: u.id, parent: u.name };
    },
    async run(_ctx, args, p) {
      const u = await org.createUnit({ name: args.name, kind: args.kind, code: args.code, description: args.description, parentId: p.parentId });
      return did('org_unit_created', u, `Added "${u.name}".`);
    },
  }),

  update_org_unit: tool({
    module: 'Organisation', operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'Rename a unit of the organisation chart, change its kind or description, or move it under another unit. Needs confirmation.',
    inputSchema: closed({ unit: text(120, 'The unit to change'), name: text(120, 'New name'), kind: oneOf(UNIT_KINDS), description: text(1000), parentUnit: text(120, 'Move it under this unit') }, ['unit']),
    permission: 'org.manage',
    service: 'org.service.updateUnit()',
    summarise: (a, _x, p) => `Change the unit "${p?.name ?? a.unit}": ${[a.name && `name → ${a.name}`, a.kind && `kind → ${words(a.kind)}`, a.description && 'new description', p?.parent && `under ${p.parent}`].filter(Boolean).join(', ')}`,
    async prepare(_ctx, args) {
      if (![args.name, args.kind, args.description, args.parentUnit].some((v) => v !== undefined)) throw ask('What should change on that unit?');
      const u = await unitNamed(args.unit);
      const parent = args.parentUnit ? await unitNamed(args.parentUnit, 'parent unit') : null;
      return { id: u.id, name: u.name, parentId: parent?.id ?? undefined, parent: parent?.name ?? null };
    },
    async run(_ctx, args, p) {
      const body = {};
      for (const k of ['name', 'kind', 'description']) if (args[k] !== undefined) body[k] = args[k];
      if (p.parentId) body.parentId = p.parentId;
      const u = await org.updateUnit(p.id, body);
      return did('org_unit_updated', u, `Updated "${u.name}".`);
    },
  }),

  delete_org_unit: tool({
    module: 'Organisation', operation: 'DELETE', risk: RISK.MEDIUM,
    description: 'Remove an empty unit from the organisation chart (its sub-units and positions must be moved or removed first). Needs confirmation.',
    inputSchema: closed({ unit: text(120) }, ['unit']),
    permission: 'org.manage',
    service: 'org.service.deleteUnit()',
    summarise: (a, _x, p) => `Remove the unit "${p?.name ?? a.unit}" from the organisation chart`,
    async prepare(_ctx, args) {
      const u = await unitNamed(args.unit);
      if (u.positions || u.children) throw new AppError(`"${u.name}" still has ${u.positions} position(s) and ${u.children} sub-unit(s); move or remove them first.`, 409, [], 'ORG_NOT_EMPTY');
      return { id: u.id, name: u.name };
    },
    async run(_ctx, _args, p) {
      await org.deleteUnit(p.id);
      return did('org_unit_removed', { id: p.id }, `Removed "${p.name}".`);
    },
  }),

  create_org_position: tool({
    module: 'Organisation', operation: 'CREATE', risk: RISK.MEDIUM,
    description: 'Add a position to a unit of the organisation chart: title, how many posts are sanctioned, the staff role it is for, whether it heads the unit and whom it reports to. Needs confirmation.',
    inputSchema: closed({
      title: text(120), unit: text(120, 'The unit it belongs to'), sanctioned: int(0, 500, 'Number of posts (default 1)'),
      staffRole: oneOf(POSITION_ROLES, 'The staff role it is for'), isHead: bool('Heads the unit'), reportsTo: text(120, 'The position it reports to'),
    }, ['title', 'unit']),
    permission: 'org.manage',
    service: 'org.service.createPosition()',
    summarise: (a, _x, p) => `Add the position "${a.title}" to ${p?.unit ?? a.unit}${a.sanctioned !== undefined ? ` (${a.sanctioned} post(s))` : ''}${p?.reportsTo ? `, reporting to ${p.reportsTo}` : ''}`,
    async prepare(_ctx, args) {
      const u = await unitNamed(args.unit);
      const to = args.reportsTo ? await positionNamed(args.reportsTo, 'position it reports to') : null;
      return { unitId: u.id, unit: u.name, reportsToId: to?.id ?? null, reportsTo: to?.title ?? null };
    },
    async run(_ctx, args, p) {
      const pos = await org.createPosition({ title: args.title, orgUnitId: p.unitId, sanctioned: args.sanctioned, roleKey: args.staffRole, isHead: args.isHead === true, reportsToPositionId: p.reportsToId });
      return did('org_position_created', pos, `Added the position "${pos.title}".`);
    },
  }),

  update_org_position: tool({
    module: 'Organisation', operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'Change a position on the organisation chart: its title, sanctioned posts, staff role, whether it heads its unit, its unit or whom it reports to. Needs confirmation.',
    inputSchema: closed({
      position: text(120, 'The position to change'), title: text(120, 'New title'), sanctioned: int(0, 500), staffRole: oneOf(POSITION_ROLES), isHead: bool(),
      unit: text(120, 'Move it to this unit'), reportsTo: text(120, 'The position it now reports to'),
    }, ['position']),
    permission: 'org.manage',
    service: 'org.service.updatePosition()',
    summarise: (a, _x, p) => `Change the position "${p?.title ?? a.position}": ${[a.title && `title → ${a.title}`, a.sanctioned !== undefined && `${a.sanctioned} post(s)`, a.staffRole && `role → ${words(a.staffRole)}`, a.isHead !== undefined && (a.isHead ? 'heads the unit' : 'not the head'), p?.unit && `unit → ${p.unit}`, p?.reportsTo && `reports to ${p.reportsTo}`].filter(Boolean).join(', ')}`,
    async prepare(_ctx, args) {
      if (!['title', 'sanctioned', 'staffRole', 'isHead', 'unit', 'reportsTo'].some((k) => args[k] !== undefined)) throw ask('What should change on that position?');
      const pos = await positionNamed(args.position);
      const u = args.unit ? await unitNamed(args.unit) : null;
      const to = args.reportsTo ? await positionNamed(args.reportsTo, 'position it reports to') : null;
      return { id: pos.id, title: pos.title, unitId: u?.id ?? null, unit: u?.name ?? null, reportsToId: to?.id ?? null, reportsTo: to?.title ?? null };
    },
    async run(_ctx, args, p) {
      const body = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.sanctioned !== undefined) body.sanctioned = args.sanctioned;
      if (args.staffRole !== undefined) body.roleKey = args.staffRole;
      if (args.isHead !== undefined) body.isHead = args.isHead;
      if (p.unitId) body.orgUnitId = p.unitId;
      if (p.reportsToId) body.reportsToPositionId = p.reportsToId;
      const pos = await org.updatePosition(p.id, body);
      return did('org_position_updated', pos, `Updated "${pos.title}".`);
    },
  }),

  delete_org_position: tool({
    module: 'Organisation', operation: 'DELETE', risk: RISK.MEDIUM,
    description: 'Remove a position from the organisation chart (nobody may hold it and no position may report to it). Needs confirmation.',
    inputSchema: closed({ position: text(120) }, ['position']),
    permission: 'org.manage',
    service: 'org.service.deletePosition()',
    summarise: (a, _x, p) => `Remove the position "${p?.title ?? a.position}" from the organisation chart`,
    async prepare(_ctx, args) {
      const pos = await positionNamed(args.position);
      if (pos.holders?.length) throw new AppError(`"${pos.title}" is held by ${pos.holders.map((h) => h.name).join(', ')}; end the appointment(s) first.`, 409, [], 'ORG_NOT_EMPTY');
      return { id: pos.id, title: pos.title };
    },
    async run(_ctx, _args, p) {
      await org.deletePosition(p.id);
      return did('org_position_removed', { id: p.id }, `Removed "${p.title}".`);
    },
  }),

  appoint_to_position: tool({
    module: 'Organisation', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true,
    description: 'Appoint a member of staff to a position on the organisation chart (primary, additional or acting), from a date and optionally until a date. Confirmed on the website.',
    inputSchema: closed({
      staffName: text(120), position: text(120), kind: oneOf(['PRIMARY', 'ADDITIONAL', 'ACTING'], 'Default PRIMARY'),
      from: dateStr('From (default today)'), until: dateStr('Until (optional)'), note: text(500),
    }, ['staffName', 'position']),
    permission: 'org.manage',
    service: 'org.service.appointableStaff() + appoint()',
    summarise: (a, _x, p) => `Appoint ${p?.name ?? a.staffName} as ${p?.title ?? a.position}${a.kind && a.kind !== 'PRIMARY' ? ` (${words(a.kind)})` : ''} from ${a.from ?? 'today'}${a.until ? ` until ${a.until}` : ''}`,
    async prepare(_ctx, args) {
      const person = pick(await org.appointableStaff(), stripTitle(args.staffName), { label: 'member of staff', refOf: () => null, describe: (x) => `${x.name} (${words(x.roleKey ?? '')})` });
      const pos = await positionNamed(args.position);
      return { profileId: person.profileId, name: person.name, positionId: pos.id, title: pos.title };
    },
    async run(_ctx, args, p) {
      const a = await org.appoint({ positionId: p.positionId, profileId: p.profileId, kind: args.kind, effectiveFrom: args.from, effectiveTo: args.until, note: args.note });
      return did('appointment_made', a, `${p.name} is appointed ${p.title}.`);
    },
  }),

  close_appointment: tool({
    module: 'Organisation', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "End a person's appointment to a position on the organisation chart, on a date (default today); the position shows as vacant after it. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120), position: text(120, 'Needed when they hold more than one'), on: dateStr('Last day (default today)') }, ['staffName']),
    permission: 'org.manage',
    service: 'org.service.chart() + endAppointment()',
    summarise: (a, _x, p) => `End ${p?.name ?? a.staffName}'s appointment as ${p?.title ?? a.position ?? 'their position'} on ${a.on ?? 'today'}`,
    async prepare(_ctx, args) {
      const c = await org.chart();
      const held = c.positions.flatMap((pos) => pos.holders.map((h) => ({ ...h, title: pos.title })));
      let pool = held.filter((h) => lower(h.name).includes(lower(stripTitle(args.staffName))));
      if (args.position) pool = pool.filter((h) => lower(h.title).includes(lower(args.position)));
      if (!pool.length) throw notFound(`${args.staffName} holds no current appointment${args.position ? ` as ${args.position}` : ''}.`);
      if (pool.length > 1) throw ask(`Which appointment? ${pool.map((h) => `${h.name} as ${h.title}`).join('; ')}`);
      return { id: pool[0].appointmentId, name: pool[0].name, title: pool[0].title };
    },
    async run(_ctx, args, p) {
      const a = await org.endAppointment(p.id, { effectiveTo: args.on });
      return did('appointment_ended', a, `${p.name}'s appointment as ${p.title} ends ${day(a.effectiveTo) ?? args.on ?? 'today'}.`);
    },
  }),
};

/* ── Background verification ──────────────────────────────── */

const SUBJECT_TYPES = Object.keys(verification.DEFAULT_CHECKS);

async function caseNamed(ctx, term) {
  const rows = await verification.list(ctx.actor, {});
  return pick(rows, term, { label: 'verification case', nameOf: (c) => c.subjectName, refOf: (c) => c.refNo, describe: (c) => `${c.refNo} ${c.subjectName} (${words(c.status)})` });
}
const caseView = (c) => ({
  refNo: c.refNo, name: c.subjectName, type: c.subjectType, position: c.positionTitle, status: c.status,
  consent: c.consent?.obtained ?? undefined, recheckDueOn: day(c.recheckDueOn),
  checks: (c.checks ?? []).map((k) => ({ type: k.type, required: k.required, status: k.status, reference: k.reference ?? null, expiresOn: day(k.expiresOn) })),
  hrReview: c.hrReview?.recommendation ? { recommendation: c.hrReview.recommendation, note: c.hrReview.note } : undefined,
  decision: c.decision?.status ? { status: c.decision.status, by: c.decision.byName, conditions: c.decision.conditions } : undefined,
  dispute: c.dispute?.raisedAt ? { note: c.dispute.note, resolution: c.dispute.resolution, resolvedAt: c.dispute.resolvedAt } : undefined,
});
const caseIdentity = { case: text(160, 'The reference (e.g. BGV-0003) or the person\'s name') };

const verificationTools = {
  get_verification_clearance: tool({
    module: 'Verification', operation: 'GET',
    description: 'Whether a person (a member of staff, a driver, an attendant) is cleared by background verification for a role with children, and if not, why (none on record, still in progress, a check lapsed, licence expired). Read-only.',
    inputSchema: closed({ name: text(160, 'The person, e.g. "Ramesh Kumar"'), subjectType: oneOf(SUBJECT_TYPES) }, ['name']),
    permission: 'verification.read',
    service: 'verification.service.clearanceFor()',
    async run(_ctx, args) {
      const who = await profilesWithRoles([...staffLeave.STAFF_ROLES, 'NURSE']);
      const exact = who.filter((p) => lower(p.displayName) === lower(stripTitle(args.name)));
      const out = await verification.clearanceFor(exact.length === 1 ? { subjectProfileId: exact[0]._id } : { subjectName: stripTitle(args.name), subjectType: args.subjectType });
      const fallback = exact.length === 1 && out.reason === 'No background verification on record.' ? await verification.clearanceFor({ subjectName: exact[0].displayName, subjectType: args.subjectType }) : out;
      return shown({ name: args.name, ...fallback }, fallback.cleared ? `${args.name} is cleared${fallback.conditions ? `, with conditions: ${fallback.conditions}` : ''}.` : `${args.name} is not cleared: ${fallback.reason}`);
    },
  }),

  get_verification_case: tool({
    module: 'Verification', operation: 'GET',
    description: "One background-verification case by reference or the person's name: status, consent, each check and its result, HR's recommendation, the decision and any dispute. Those who only read verification see the status alone. Read-only.",
    inputSchema: closed(caseIdentity, ['case']),
    permission: 'verification.read',
    service: 'verification.service.list() + get()',
    async run(ctx, args) {
      const c = await verification.get(ctx.actor, (await caseNamed(ctx, args.case)).id);
      const open = (c.checks ?? []).filter((k) => k.required && !['CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'].includes(k.status)).map((k) => words(k.type));
      return shown(caseView(c), `${c.refNo} ${c.subjectName}: ${words(c.status)}${open.length ? `; open checks: ${open.join(', ')}` : ''}.`);
    },
  }),

  start_background_verification: tool({
    module: 'Verification', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: "For HR or administration: start a background verification for a person (teacher, staff, driver, attendant, security, vendor, volunteer, contractor) with the default checks for that kind of person or a chosen list. Police and licence checks can never be left out for a driver. Consent is recorded afterwards. Confirmed on the website.",
    inputSchema: closed({
      name: text(160, 'The person, e.g. "Ramesh Kumar"'), subjectType: oneOf(SUBJECT_TYPES), positionTitle: text(120, 'e.g. "School bus driver"'),
      checks: list(oneOf(CHECK_TYPES), 10, 'Default: the standard checks for that kind of person'),
    }, ['name', 'subjectType']),
    permission: 'verification.manage',
    service: 'verification.service.initiate()',
    summarise: (a, _x, p) => `Start background verification ${p?.linked ? `for ${p.name} (on staff)` : `for ${a.name}`} as ${words(a.subjectType)}${a.positionTitle ? `, ${a.positionTitle}` : ''}; checks: ${(a.checks?.length ? a.checks : verification.DEFAULT_CHECKS[a.subjectType] ?? []).map(words).join(', ')}`,
    async prepare(_ctx, args) {
      const who = (await profilesWithRoles([...staffLeave.STAFF_ROLES, 'NURSE'])).filter((p) => lower(p.displayName) === lower(stripTitle(args.name)));
      return who.length === 1 ? { profileId: String(who[0]._id), name: who[0].displayName, linked: true } : { profileId: null, name: stripTitle(args.name), linked: false };
    },
    async run(ctx, args, p) {
      const c = await verification.initiate(ctx.actor, { subjectType: args.subjectType, subjectName: p.name, subjectProfileId: p.profileId, positionTitle: args.positionTitle, checks: args.checks });
      return did('verification_started', c, `Started ${c.refNo} for ${c.subjectName}. Record the signed consent next.`);
    },
  }),

  update_verification_case: tool({
    module: 'Verification', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "For HR or administration: move a background-verification case along. step=consent records the subject's signed consent (give where the signed form is filed or its link); step=check records one check's result (status, the verifier's reference number, provider, note, expiry) or waives a check with the reason; step=dispute records the subject's dispute of a decision. Confirmed on the website.",
    inputSchema: closed({
      ...caseIdentity,
      step: oneOf(['consent', 'check', 'dispute']),
      consentForm: text(1000, 'step=consent: where the signed consent form is (link or file reference)'),
      consentOn: dateStr('step=consent: the day it was signed (default today)'),
      checkType: oneOf(CHECK_TYPES, 'step=check: which check'),
      status: oneOf(['NOT_STARTED', 'IN_PROGRESS', 'CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'], 'step=check: its result'),
      reference: text(120, "step=check: the verifier's reference number (needed to complete a check)"),
      provider: text(160, 'step=check: who verified it'),
      expiresOn: dateStr('step=check: when the result lapses (police verification, licence)'),
      waive: bool('step=check: waive this check (needs the reason in note)'),
      note: text(2000, 'step=check: a note or the reason for waiving; step=dispute: what is disputed'),
    }, ['case', 'step']),
    permission: 'verification.manage',
    service: 'verification.service.recordConsent() / recordCheck() / raiseDispute()',
    summarise: (a, _x, p) => {
      const who = p ? `${p.refNo} (${p.name})` : a.case;
      if (a.step === 'consent') return `Record ${p?.name ?? 'the subject'}'s signed consent on ${who}${a.consentOn ? ` (signed ${a.consentOn})` : ''}`;
      if (a.step === 'check') return a.waive ? `Waive the ${words(a.checkType)} check on ${who}: ${excerpt(a.note, 80)}` : `Record the ${words(a.checkType)} check on ${who} as ${words(a.status)}${a.reference ? `, reference ${a.reference}` : ''}${a.expiresOn ? `, valid until ${a.expiresOn}` : ''}`;
      return `Record a dispute on ${who}: ${excerpt(a.note, 80)}`;
    },
    async prepare(ctx, args) {
      if (args.step === 'consent' && !args.consentForm) throw ask('Where is the signed consent form (a link or where it is filed)? Consent is recorded only against the signed form.');
      if (args.step === 'check' && !args.checkType) throw ask('Which check (identity, address, police, ...)?');
      if (args.step === 'check' && !args.status && !args.waive) throw ask(`What is the result of the ${words(args.checkType)} check?`);
      if (args.step === 'check' && args.waive && !args.note) throw ask('Why is this check waived?');
      if (args.step === 'dispute' && !args.note) throw ask('What does the person dispute?');
      const c = await verification.get(ctx.actor, (await caseNamed(ctx, args.case)).id);
      let checkId = null;
      if (args.step === 'check') {
        const k = (c.checks ?? []).find((x) => x.type === args.checkType);
        if (!k) throw notFound(`${c.refNo} has no ${words(args.checkType)} check.`);
        checkId = String(k._id ?? k.id);
      }
      return { id: c.id, refNo: c.refNo, name: c.subjectName, checkId };
    },
    async run(ctx, args, p) {
      let c;
      if (args.step === 'consent') c = await verification.recordConsent(ctx.actor, p.id, { evidenceUrl: args.consentForm, at: args.consentOn });
      else if (args.step === 'check') {
        const current = (await verification.get(ctx.actor, p.id)).checks.find((x) => String(x._id ?? x.id) === p.checkId);
        c = await verification.recordCheck(ctx.actor, p.id, p.checkId, {
          status: args.status ?? current?.status ?? 'NOT_STARTED', reference: args.reference, provider: args.provider, note: args.note, expiresOn: args.expiresOn, waive: args.waive === true,
        });
      } else c = await verification.raiseDispute(ctx.actor, p.id, { note: args.note });
      return did(`verification_${args.step}_recorded`, c, `${c.refNo}: ${args.step} recorded; the case is ${words(c.status)}.`);
    },
  }),

  record_verification_recommendation: tool({
    module: 'Verification', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For HR, once every required check is complete: record HR's recommendation on a background-verification case (clear, clear with conditions, do not clear) with the reasoning; the principal is then asked to decide. Recorded only when HR states the recommendation in their own words. Confirmed on the website.",
    inputSchema: closed({ ...caseIdentity, decision: decisionArg(['CLEAR', 'CLEAR_WITH_CONDITIONS', 'DO_NOT_CLEAR'], 'HR'), note: text(3000, 'The reasoning') }, ['case', 'decision', 'note']),
    permission: 'verification.manage',
    service: 'verification.service.hrReview()',
    summarise: (a, _x, p) => `Record HR's recommendation on ${p?.refNo ?? a.case} (${p?.name ?? ''}): ${words(a.decision)} — "${excerpt(a.note, 80)}"; the principal is asked to decide`,
    async prepare(ctx, args) { const c = await caseNamed(ctx, args.case); return { id: c.id, refNo: c.refNo, name: c.subjectName }; },
    async run(ctx, args, p) {
      const c = await verification.hrReview(ctx.actor, p.id, { recommendation: args.decision, note: args.note });
      return did('verification_recommended', c, `${c.refNo}: HR recommends ${words(args.decision)}. It is with the principal for decision.`);
    },
  }),

  record_verification_decision: tool({
    module: 'Verification', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For the principal: record the final clearance decision on a background-verification case awaiting decision (cleared, cleared with conditions, not cleared), with conditions or reasoning. The HR reviewer cannot also decide. Recorded only when the principal states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ ...caseIdentity, decision: decisionArg(['CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED'], 'The principal'), conditions: text(2000, 'Needed for cleared with conditions'), note: text(3000, 'Reasoning (needed to clear despite an adverse check)') }, ['case', 'decision']),
    permission: 'verification.decide',
    service: 'verification.service.decide()',
    summarise: (a, _x, p) => `Record your decision on ${p?.refNo ?? a.case} (${p?.name ?? ''}): ${words(a.decision)}${a.conditions ? `, conditions: ${excerpt(a.conditions, 80)}` : ''}${a.note ? ` — "${excerpt(a.note, 60)}"` : ''}`,
    async prepare(ctx, args) {
      if (args.decision === 'CLEARED_WITH_CONDITIONS' && !args.conditions) throw ask('What are the conditions?');
      const c = await caseNamed(ctx, args.case);
      if (c.status !== 'AWAITING_DECISION') throw new AppError(`${c.refNo} is ${words(c.status)}, not awaiting a decision.`, 409);
      return { id: c.id, refNo: c.refNo, name: c.subjectName };
    },
    async run(ctx, args, p) {
      const c = await verification.decide(ctx.actor, p.id, { decision: args.decision, conditions: args.conditions, note: args.note });
      return did('verification_decided', c, `${c.refNo}: ${words(c.status)}.`);
    },
  }),

  record_verification_dispute_resolution: tool({
    module: 'Verification', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For the principal: resolve an open dispute on a background-verification decision, either upholding the decision or reopening the case for HR review, with the resolution. Recorded only when the principal states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ ...caseIdentity, decision: decisionArg(['UPHOLD', 'REOPEN'], 'The principal'), resolution: text(3000) }, ['case', 'decision', 'resolution']),
    permission: 'verification.decide',
    service: 'verification.service.resolveDispute()',
    summarise: (a, _x, p) => `Resolve the dispute on ${p?.refNo ?? a.case} (${p?.name ?? ''}): ${a.decision === 'REOPEN' ? 'reopen the case for HR review' : 'uphold the decision'} — "${excerpt(a.resolution, 80)}"`,
    async prepare(ctx, args) { const c = await caseNamed(ctx, args.case); return { id: c.id, refNo: c.refNo, name: c.subjectName }; },
    async run(ctx, args, p) {
      const c = await verification.resolveDispute(ctx.actor, p.id, { resolution: args.resolution, reopen: args.decision === 'REOPEN' });
      return did('verification_dispute_resolved', c, `${c.refNo}: dispute resolved; the case is ${words(c.status)}.`);
    },
  }),
};

/* ── Tasks ────────────────────────────────────────────────── */

const taskTools = {
  acknowledge_due_item: tool({
    module: 'Tasks', operation: 'ACTION', risk: RISK.LOW, feature: 'tasks',
    description: 'Acknowledge an open task (say "I have seen it and it is in hand"), by its reference or title; reminders treat it as picked up. Needs confirmation.',
    inputSchema: closed({ taskRef: text(40, 'e.g. "TSK-000123"'), title: text(200, 'The task in words') }),
    permission: 'tasks.manage',
    service: 'tasks.service.list() + acknowledge()',
    summarise: (a, _x, p) => `Acknowledge ${p?.refNo ?? a.taskRef ?? ''} "${p?.title ?? a.title ?? ''}"`,
    async prepare(ctx, args) {
      const view = ctx.scope === 'ALL' ? 'all' : 'mine';
      const page = await collectPages((pg, pageSize) => tasks.list(ctx.actor, ctx.scope, { status: 'open', view, page: pg, pageSize }), undefined, { pageSize: 200 });
      const t = pick(page.items.filter((x) => x.status !== 'ACKNOWLEDGED'), args.taskRef ?? args.title, { label: 'open task', nameOf: (x) => x.title, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.title}` });
      return { id: t.id, refNo: t.refNo, title: t.title };
    },
    async run(ctx, _args, p) {
      const t = await tasks.acknowledge(ctx.actor, ctx.scope, p.id);
      return did('task_acknowledged', t, `${t.refNo} is acknowledged.`);
    },
  }),
};

/* ── Staff leave policies and balances; cover rules and absences ── */

const staffTools = {
  list_staff_leave_policies: tool({
    module: 'Staff leave', operation: 'GET', feature: 'staffCover',
    description: 'The staff leave types and their rules: days a year, carry-forward cap, half days, paid or not, when a document is expected. Read-only.',
    permission: 'staffleave.apply',
    anyOf: [['staffleave.manage'], ['staffleave.apply']],
    guard: (ctx) => needAny(ctx, [['staffleave.manage'], ['staffleave.apply']]),
    service: 'staffLeave.service.policies()',
    async run() {
      const rows = await staffLeave.policies();
      return listed(rows, (p) => `${p.name} (${p.code}) ${p.tracksBalance ? `${p.yearlyDays} days` : 'no fixed balance'}${p.paid ? '' : ', unpaid'}${p.active ? '' : ', not offered'}`, { noun: 'leave type' });
    },
  }),

  set_staff_leave_policy: tool({
    module: 'Staff leave', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, feature: 'staffCover',
    description: "For HR or the principal: change a staff leave type's rules for the whole school: its name, days a year, carry-forward cap (halves allowed), half days allowed, paid, offered or not, and its note. Confirmed on the website.",
    inputSchema: closed({
      code: oneOf(LEAVE_CODES, 'CL casual, SL sick, EL earned, ML maternity, PL paternity, DL duty, LWP without pay'),
      name: text(80), yearlyDays: num(0, 366), carryForwardMax: num(0, 366), allowHalfDay: bool(), paid: bool(), active: bool('Offered at all'), note: text(300),
    }, ['code']),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.service.setPolicy()',
    summarise: (a) => `Change the ${a.code} leave rules for all staff: ${Object.entries(a).filter(([k, v]) => k !== 'code' && v !== undefined).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
    async prepare(_ctx, args) {
      if (Object.keys(args).length < 2) throw ask(`What should change about ${args.code} leave?`);
      return undefined;
    },
    async run(ctx, args) {
      const { code, ...body } = args;
      const p = await staffLeave.setPolicy(ctx.actor, ctx.scope, code, body);
      return did('leave_policy_saved', { id: p.code, ...p }, `${p.name} saved: ${p.yearlyDays} days a year.`);
    },
  }),

  set_up_staff_leave_balances: tool({
    module: 'Staff leave', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'staffCover',
    description: "For HR or the principal: create the leave year's balances for every member of staff (or the named ones) from the leave rules, carrying forward what each policy allows. Balances that already exist are left as they are. Confirmed on the website.",
    inputSchema: closed({ leaveYear: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'e.g. 2026-27 (default the current one)' }, staffNames: list(text(120), 50, 'Only these people (default everyone)') }),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.service.initBalances()',
    summarise: (a, _x, p) => `Set up ${a.leaveYear ?? staffLeave.leaveYearOf(new Date())} leave balances for ${p?.names?.length ? p.names.join(', ') : 'every member of staff'} (existing balances unchanged)`,
    async prepare(_ctx, args) {
      const people = [];
      for (const n of args.staffNames ?? []) people.push(await staffNamed(n));
      return { ids: people.map((x) => x.id), names: people.map((x) => x.name) };
    },
    async run(ctx, args, p) {
      const out = await staffLeave.initBalances(ctx.actor, ctx.scope, { leaveYear: args.leaveYear, ...(p.ids.length && { profileIds: p.ids }) });
      return did('leave_balances_set_up', null, `${out.leaveYear}: ${out.created} balance(s) created for ${out.people} people.`);
    },
  }),

  adjust_staff_leave_balance: tool({
    module: 'Staff leave', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'staffCover',
    description: "For HR or the principal: add or take away days on a colleague's leave balance (a joining-date pro-rata, a correction), always with the reason. Halves allowed; a negative number takes days away. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120), code: oneOf(LEAVE_CODES), days: num(-366, 366, 'e.g. 2 or -1.5'), reason: text(300), leaveYear: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } }, ['staffName', 'code', 'days', 'reason']),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.service.adjustBalance()',
    summarise: (a, _x, p) => `${a.days > 0 ? 'Add' : 'Take away'} ${Math.abs(a.days)} day(s) of ${a.code} on ${p?.name ?? a.staffName}'s ${a.leaveYear ?? 'current'} balance — ${a.reason}`,
    async prepare(_ctx, args) {
      if (!args.days) throw ask('How many days (not zero)?');
      const who = await staffNamed(args.staffName, 'colleague');
      return { profileId: who.id, name: who.name };
    },
    async run(ctx, args, p) {
      const b = await staffLeave.adjustBalance(ctx.actor, ctx.scope, { profileId: p.profileId, code: args.code, days: args.days, reason: args.reason, leaveYear: args.leaveYear });
      const row = (b.balances ?? []).find((x) => x.code === args.code);
      return did('leave_balance_adjusted', { id: p.profileId, ...b }, `${p.name}'s ${args.code} balance adjusted${row ? `; ${row.available} day(s) available` : ''}.`);
    },
  }),

  get_cover_assignment_rules: tool({
    module: 'Cover', operation: 'GET', feature: 'staffCover',
    description: 'For the cover coordinator: the cover limits — the most covers a teacher takes in a day and in a week. Read-only.',
    permission: 'cover.manage',
    service: 'cover.service.rules()',
    async run() {
      const r = await cover.rules();
      return shown(r, `At most ${r.maxPerDay} cover(s) a day and ${r.maxPerWeek} a week per teacher.`);
    },
  }),

  set_cover_rules: tool({
    module: 'Cover', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, feature: 'staffCover',
    description: 'For the cover coordinator: change the cover limits for every teacher (the most covers in a day, 0-10, and in a week, 0-40). Confirmed on the website.',
    inputSchema: closed({ maxPerDay: int(0, 10), maxPerWeek: int(0, 40) }),
    permission: 'cover.manage', minScope: 'ALL',
    service: 'cover.service.setRules()',
    summarise: (a) => `Set the cover limits: ${[a.maxPerDay !== undefined && `${a.maxPerDay} a day`, a.maxPerWeek !== undefined && `${a.maxPerWeek} a week`].filter(Boolean).join(', ')} per teacher`,
    async prepare(_ctx, args) {
      if (args.maxPerDay === undefined && args.maxPerWeek === undefined) throw ask('What should the daily or weekly limit be?');
      return undefined;
    },
    async run(ctx, args) {
      const r = await cover.setRules(ctx.actor, ctx.scope, args);
      return did('cover_rules_saved', { id: 'default', ...r }, `Cover limits: ${r.maxPerDay} a day, ${r.maxPerWeek} a week.`);
    },
  }),

  list_staff_absences: tool({
    module: 'Cover', operation: 'GET', feature: 'staffCover',
    description: 'For the cover coordinator: staff marked absent on a day (default today), with the half day if any. Read-only.',
    inputSchema: closed({ date: dateStr('YYYY-MM-DD') }),
    permission: 'cover.manage',
    service: 'cover.service.listAbsences()',
    async run(ctx, args) {
      const rows = await cover.listAbsences(ctx.actor, ctx.scope, { date: args.date ?? todayIst() });
      return listed(rows.map((r) => ({ name: r.name, date: r.date, halfDay: r.halfDay })), (r) => `${r.name}${r.halfDay ? ` (${words(r.halfDay)})` : ''}`, { noun: 'absence' });
    },
  }),

  withdraw_staff_absence: tool({
    module: 'Cover', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'staffCover',
    description: "For the cover coordinator: withdraw a colleague's absence marked in error (default today); the cover arranged for it is cancelled. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120), date: dateStr('YYYY-MM-DD') }, ['staffName']),
    permission: 'cover.manage', minScope: 'ALL',
    service: 'cover.service.listAbsences() + withdrawAbsence()',
    summarise: (a, _x, p) => `Withdraw ${p?.name ?? a.staffName}'s absence on ${p?.date ?? a.date ?? 'today'}; any cover arranged for it is cancelled`,
    async prepare(ctx, args) {
      const rows = await cover.listAbsences(ctx.actor, ctx.scope, { date: args.date ?? todayIst() });
      const a = pick(rows, stripTitle(args.staffName), { label: `absence on ${args.date ?? 'today'}`, nameOf: (r) => r.name, refOf: () => null });
      return { id: a.id, name: a.name, date: a.date };
    },
    async run(ctx, _args, p) {
      const out = await cover.withdrawAbsence(ctx.actor, ctx.scope, p.id);
      return did('staff_absence_withdrawn', out, `${p.name}'s absence on ${p.date} is withdrawn.`);
    },
  }),
};

/* ── Recruitment and exits ────────────────────────────────── */

async function vacancyNamed(ctx, term) {
  const { items } = await hr.listVacancies(ctx.actor, {});
  return pick(items, term, { label: 'vacancy', nameOf: (v) => v.title, refOf: (v) => v.refNo, describe: (v) => `${v.refNo} ${v.title} (${words(v.status)})` });
}
async function candidateNamed(ctx, term) {
  const { items } = await hr.listCandidates(ctx.actor, {});
  return pick(items, stripTitle(term), { label: 'candidate', nameOf: (c) => c.name, refOf: (c) => c.refNo, describe: (c) => `${c.refNo} ${c.name} (${c.vacancy?.title ?? ''}, ${words(c.stage)})` });
}
async function exitNamed(ctx, term, status) {
  const { items } = await hr.listExits(ctx.actor, status ? { status } : {});
  return pick(items, stripTitle(term), { label: 'staff exit', nameOf: (x) => x.name, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.name} (${words(x.status)})` });
}

const hrTools = {
  set_vacancy_status: tool({
    module: 'Recruitment', operation: 'UPDATE', risk: RISK.MEDIUM,
    description: 'For HR: put a vacancy on hold, reopen it, mark it filled or close it, with an optional note. Needs confirmation.',
    inputSchema: closed({ vacancy: text(120, 'Title or reference, e.g. VAC-0002'), status: oneOf(VACANCY_STATUSES), note: text(300) }, ['vacancy', 'status']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listVacancies() + setVacancyStatus()',
    summarise: (a, _x, p) => `Mark ${p?.refNo ?? ''} "${p?.title ?? a.vacancy}" ${words(a.status)}${p?.from ? ` (now ${words(p.from)})` : ''}${a.note ? ` — ${a.note}` : ''}`,
    async prepare(ctx, args) { const v = await vacancyNamed(ctx, args.vacancy); return { id: v.id, refNo: v.refNo, title: v.title, from: v.status }; },
    async run(ctx, args, p) {
      const v = await hr.setVacancyStatus(ctx.actor, p.id, { status: args.status, note: args.note });
      return did('vacancy_status_set', v, `${v.refNo} is ${words(v.status)}.`);
    },
  }),

  get_candidate: tool({
    module: 'Recruitment', operation: 'GET',
    description: "For HR: one candidate's record: the vacancy, stage and the stages it can move to, experience, qualifications, expected CTC, notice, each interviewer's scorecard and the average, the offer drafted and the verification status. Read-only.",
    inputSchema: closed({ candidate: text(120, 'Name or reference') }, ['candidate']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listCandidates() + getCandidate()',
    async run(ctx, args) {
      const c = await hr.getCandidate(ctx.actor, (await candidateNamed(ctx, args.candidate)).id);
      const { history: _h, ...view } = c;
      return shown(view, `${c.name} (${c.refNo}) for ${c.vacancy?.title ?? 'the vacancy'}: ${words(c.stage)}${c.averageScore ? `, average ${c.averageScore}/5 over ${c.scores.length} scorecard(s)` : ''}${c.verificationStatus ? `; verification ${words(c.verificationStatus)}` : ''}.`);
    },
  }),

  start_candidate_verification: tool({
    module: 'Recruitment', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "For HR: start background verification for a candidate at interview stage or later (as a teacher or staff member, a driver, attendant or security), linked to the candidate. Consent is recorded on the case afterwards. Confirmed on the website.",
    inputSchema: closed({ candidate: text(120), subjectType: oneOf(['TEACHER', 'STAFF', 'DRIVER', 'ATTENDANT', 'SECURITY'], 'Default from the vacancy') }, ['candidate']),
    permission: 'org.manage', minScope: 'ALL',
    guard: (ctx) => need(ctx, 'verification.manage', 'ALL'),
    service: 'p4ops/people.startCandidateVerification()',
    summarise: (a, _x, p) => `Start background verification for ${p?.name ?? a.candidate} (${p?.vacancy ?? ''})${a.subjectType ? ` as ${words(a.subjectType)}` : ''}`,
    async prepare(ctx, args) {
      const c = await candidateNamed(ctx, args.candidate);
      if (c.verificationCaseId) throw new AppError(`${c.name} already has a verification case.`, 409);
      return { id: c.id, name: c.name, vacancy: c.vacancy?.title ?? null };
    },
    async run(ctx, args, p) {
      const out = await hr.startCandidateVerification(ctx.actor, p.id, { subjectType: args.subjectType });
      return did('candidate_verification_started', { id: out.verification.id, ...out.verification }, `Started ${out.verification.refNo} for ${p.name}. Record the signed consent next.`);
    },
  }),

  get_staff_exit: tool({
    module: 'Exits', operation: 'GET',
    description: "For HR: one staff exit: kind, notice date and last working day, notice served, each department's clearance and dues, the exit interview and whether the full-and-final has gone to payroll (amounts are on the Payroll screen). Read-only.",
    inputSchema: closed({ staffName: text(120, 'The leaving person or the reference') }, ['staffName']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listExits() + getExit()',
    async run(ctx, args) {
      const x = await hr.getExit(ctx.actor, (await exitNamed(ctx, args.staffName, 'ALL')).id);
      const view = { refNo: x.refNo, name: x.name, kind: x.kind, noticeOn: x.noticeOn, lastWorkingDay: x.lastWorkingDay, noticeDaysRequired: x.noticeDaysRequired, noticeServedDays: x.noticeServedDays, status: x.status, clearances: x.clearances.map((c) => ({ department: c.department, status: c.status, note: c.note })), exitInterview: x.exitInterview, onPayroll: Boolean(x.payrollRunId) };
      return shown(view, `${x.name} (${x.refNo}), ${words(x.kind)}: last day ${x.lastWorkingDay}, ${words(x.status)}; ${x.clearancesPending} clearance(s) pending${x.exitInterview ? '; exit interview held' : ''}.`);
    },
  }),

  record_exit_interview: tool({
    module: 'Exits', operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "For HR: record a leaving staff member's exit interview: when it was held and the notes. Needs confirmation.",
    inputSchema: closed({ staffName: text(120), heldOn: dateStr('Default today'), notes: text(3000) }, ['staffName', 'notes']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.recordExitInterview()',
    summarise: (a, _x, p) => `Record ${p?.name ?? a.staffName}'s exit interview (${a.heldOn ?? 'today'}): "${excerpt(a.notes, 100)}"`,
    async prepare(ctx, args) { const x = await exitNamed(ctx, args.staffName); return { id: x.id, name: x.name }; },
    async run(ctx, args, p) {
      const x = await hr.recordExitInterview(ctx.actor, p.id, { at: args.heldOn, note: args.notes });
      return did('exit_interview_recorded', x, `Saved ${p.name}'s exit interview.`);
    },
  }),

  get_exit_letters: tool({
    module: 'Exits', operation: 'GET',
    description: "For HR: draft relieving and experience letters for a leaving staff member, as text to edit on the letterhead, sign and hand over (the relieving letter only after clearances are complete). Nothing is sent or saved. Read-only.",
    inputSchema: closed({ staffName: text(120), schoolName: text(160, 'As it should appear on the letters') }, ['staffName']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.exitLetters()',
    async run(ctx, args) {
      const x = await exitNamed(ctx, args.staffName, 'ALL');
      const out = await hr.exitLetters(ctx.actor, x.id, { schoolName: args.schoolName });
      return shown(out, `Relieving letter:\n\n${out.relieving}\n\nExperience certificate:\n\n${out.experience}\n\n${out.note}`);
    },
  }),

  close_staff_exit: tool({
    module: 'Exits', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For HR: close a staff exit once every department has cleared (step=close), or record that the person withdrew their resignation (step=withdraw), with a note; the exit's task is resolved. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120), step: oneOf(['close', 'withdraw']), note: text(500) }, ['staffName', 'step']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.closeExit()',
    summarise: (a, _x, p) => `${a.step === 'withdraw' ? 'Mark as withdrawn' : 'Close'} ${p?.name ?? a.staffName}'s exit (${p?.refNo ?? ''})${a.note ? ` — ${a.note}` : ''}`,
    async prepare(ctx, args) {
      const x = await exitNamed(ctx, args.staffName);
      if (args.step === 'close' && x.clearancesPending) throw new AppError(`${x.clearancesPending} department clearance(s) are still pending for ${x.name}.`, 409, [], 'CLEARANCE_PENDING');
      return { id: x.id, name: x.name, refNo: x.refNo };
    },
    async run(ctx, args, p) {
      const x = await hr.closeExit(ctx.actor, p.id, { withdraw: args.step === 'withdraw', note: args.note });
      return did('staff_exit_closed', x, `${p.name}'s exit is ${words(x.status)}.`);
    },
  }),
};

/* ── User accounts (read) ─────────────────────────────────── */

const userTools = {
  get_user_account: tool({
    module: 'Users', operation: 'GET',
    description: "One person's account in this school by name: account status, the profiles and roles they hold here and, for a student, the class, admission and roll number. Phone and email are not given out here. Read-only.",
    inputSchema: closed({ name: text(120, 'The person, e.g. "Sunita Rao"') }, ['name']),
    permission: 'users.read',
    service: 'user.service.listUsers() + getUserById()',
    async run(_ctx, args) {
      const page = await users.listUsers({ search: stripTitle(args.name), page: 1, pageSize: 50 });
      const rows = (Array.isArray(page) ? page : page.items ?? []).map((u) => ({ id: String(u.id), name: u.displayName, roleKey: u.roleKey }));
      const u = pick(rows, stripTitle(args.name), { label: 'person', refOf: () => null, describe: (x) => `${x.name} (${words(x.roleKey ?? x.role ?? '')})` });
      const full = await users.getUserById(u.id);
      // Contact details stay out, as in list_users: naming who is here is a directory read.
      const view = {
        name: full.displayName ?? u.name, status: full.status, since: day(full.createdAt),
        profiles: (full.profiles ?? []).map((p) => ({ name: p.displayName, role: p.roleName ?? p.roleKey, status: p.status, student: p.studentDetails ? { class: p.studentDetails.class, admissionNo: p.studentDetails.admissionNo, rollNo: p.studentDetails.rollNo } : null })),
      };
      const roles = view.profiles.map((p) => p.role).filter(Boolean);
      const cls = view.profiles.find((p) => p.student?.class)?.student.class;
      return shown(view, `${view.name}: account ${lower(view.status)}${roles.length ? `; ${roles.join(', ')}` : ''}${cls ? `; ${cls}` : ''}.`);
    },
  }),
};

export const tools = {
  ...staffProfileTools,
  ...orgTools,
  ...verificationTools,
  ...taskTools,
  ...staffTools,
  ...hrTools,
  ...userTools,
};
