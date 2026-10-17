import * as alumni from '../../../alumni/alumni.service.js';
import * as docs from '../../../documentRequests/documentRequest.service.js';
import * as docTypes from '../../../documentRequests/documentType.service.js';
import * as opps from '../../../p4StudentAlumnus/opportunities.service.js';
import * as planner from '../../../p4StudentAlumnus/planner.service.js';
import { CURRENT_ONLY } from '../../../p4StudentAlumnus/p4StudentAlumnus.routes.js';
import { OPPORTUNITY_KINDS, OPPORTUNITY_AUDIENCES } from '../../../../models/alumniOpportunity.model.js';
import { FEATURES } from '../../../../constants/features.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, noArgs, dateStr, shortDate, summarise, theNamed } from './_shared.js';

/**
 * Part 4: the student and the alumnus, through the assistant.
 *
 * Everything an alumnus can do on their screens (their profile and what the
 * directory shows, their archived school record, batches, circle posts,
 * certificate requests, the give-back board) and the student's planner and
 * board-details check, asked for in words. Each tool calls the same service
 * the screen calls with the caller's own actor, so scope, consent and review
 * rules are the screen's.
 *
 * Every write is shown as a draft and runs only when the same person
 * confirms. Nothing here decides: publishing or rejecting an alumnus's offer
 * and issuing a certificate stay with a person on the screen.
 */

async function requireOn(key) {
  if (!(await featureEnabled(key))) throw new AppError(`${FEATURES[key]?.label ?? key} is switched off for this school.`, 403, [], 'FEATURE_OFF');
}
function behind(feature, tool) {
  const { run, prepare } = tool;
  return {
    ...tool,
    feature,
    async run(ctx, args, prepared) { await requireOn(feature); return run.call(this, ctx, args, prepared); },
    ...(prepare && { async prepare(ctx, args) { await requireOn(feature); return prepare.call(this, ctx, args); } }),
  };
}

const excerpt = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const DIR = 'alumni.directory.read';

const offerView = (o) => ({
  kind: o.kindLabel, title: o.title, organisation: o.organisation, location: o.location, mode: o.mode, applyBy: o.applyBy, audience: o.audience,
  postedBy: o.postedBy, batch: o.batchLabel, status: o.status, interested: o.interested, interestCount: o.interestCount, details: excerpt(o.description, 240),
});

async function findOffer(ctx, term, { mine = false } = {}) {
  const rows = mine ? (await opps.mine(ctx.actor)).filter((o) => ['PENDING_REVIEW', 'PUBLISHED'].includes(o.status)) : await opps.list(ctx.actor, {});
  if (!term) {
    if (rows.length === 1) return rows[0];
    if (!rows.length) throw new AppError(mine ? 'You have no open offers.' : 'There are no published opportunities for you right now.', 404, [], 'NOT_FOUND');
    throw new AppError(`Which one — ${rows.slice(0, 8).map((o) => o.title).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return theNamed(rows, term, { label: 'opportunity', nameOf: (o) => o.title, describe: (o) => `${o.title} (${o.kindLabel})` });
}

async function alumniTypes() {
  return (await docTypes.listRequestable()).filter((t) => !CURRENT_ONLY.test(t.name));
}

const ALL = {
  get_my_alumni_profile: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "For an alumnus: their own alumni profile — batch (or served years), whether they are listed in the directory, profession, city, links and which of those they chose to show. Read-only.",
    inputSchema: noArgs, permission: DIR, forRoles: ['ALUMNUS'], service: 'alumni.service.me()',
    async run(ctx) {
      const me = await alumni.me(ctx.actor);
      const shown = Object.entries(me.consent).filter(([, v]) => v).map(([k]) => k);
      return ok({ profile: me }, { speak: `You are ${me.name}, ${me.batchLabel}. ${me.listed ? 'You are listed in the directory' : 'You are not listed in the directory'}${shown.length ? `, showing your ${shown.join(', ')}` : ', showing only your name and batch'}.` });
    },
  },

  update_my_alumni_profile: {
    module: 'Alumni', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "For an alumnus: change their own profession, city, links (https only), whether they are listed in the directory, and which details the directory shows. Only what is named changes. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        profession: { type: 'string', maxLength: 120 }, city: { type: 'string', maxLength: 80 }, listed: { type: 'boolean' },
        showProfession: { type: 'boolean' }, showCity: { type: 'boolean' }, showLinks: { type: 'boolean' },
        linkedin: { type: 'string', maxLength: 300 }, github: { type: 'string', maxLength: 300 }, instagram: { type: 'string', maxLength: 300 }, website: { type: 'string', maxLength: 300 },
      },
      additionalProperties: false,
    },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'alumni.service.updateMe()',
    summarise: (a) => {
      const parts = [];
      for (const k of ['profession', 'city']) if (k in a) parts.push(`${k} → "${a[k]}"`);
      if ('listed' in a) parts.push(a.listed ? 'list me in the directory' : 'remove me from the directory');
      for (const [k, label] of [['showProfession', 'profession'], ['showCity', 'city'], ['showLinks', 'links']]) if (k in a) parts.push(`${a[k] ? 'show' : 'hide'} my ${label}`);
      for (const k of ['linkedin', 'github', 'instagram', 'website']) if (k in a) parts.push(`${k} link → ${a[k] || 'removed'}`);
      return `Update your alumni profile: ${parts.join('; ') || 'no change'}`;
    },
    async run(ctx, a) {
      const body = {};
      for (const k of ['profession', 'city', 'listed']) if (k in a) body[k] = a[k];
      const links = Object.fromEntries(['linkedin', 'github', 'instagram', 'website'].filter((k) => k in a).map((k) => [k, a[k] || null]));
      if (Object.keys(links).length) body.links = links;
      const consent = {};
      if ('showProfession' in a) consent.profession = a.showProfession;
      if ('showCity' in a) consent.city = a.showCity;
      if ('showLinks' in a) consent.links = a.showLinks;
      if (Object.keys(consent).length) body.consent = consent;
      if (!Object.keys(body).length) throw new AppError('Say what to change: profession, city, links, or what the directory shows.', 400, [], 'AGENT_NEEDS_INPUT');
      const me = await alumni.updateMe(ctx.actor, body);
      return action({ type: 'alumni_profile_updated', id: me.id, data: { profile: me }, speak: 'Your alumni profile is saved.' });
    },
  },

  get_my_school_record: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "For an alumnus: their own archived school record — admission number, batch, the classes and years they were enrolled, and how they left. Never marks, fees, attendance or health. Read-only.",
    inputSchema: noArgs, permission: DIR, forRoles: ['ALUMNUS'], service: 'alumni.service.myRecord()',
    async run(ctx) {
      const r = await alumni.myRecord(ctx.actor);
      const years = (r.enrolments ?? []).map((e) => `${e.year ?? '—'} ${e.class ?? ''}`.trim());
      return ok({ record: r }, { speak: r.kind === 'FORMER_STAFF' ? `Former staff (${r.servedFrom}–${r.servedTo}). ${r.note}` : `${r.name}, admission no. ${r.admissionNo ?? '—'}, ${r.batchLabel}. ${years.length ? `Enrolled: ${years.join('; ')}.` : ''} ${r.note}` });
    },
  },

  list_alumni_batches: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: 'Alumni batches by passing-out year, with how many listed former students (and former staff who served that year) each has. Read-only.',
    inputSchema: noArgs, permission: DIR, service: 'alumni.service.batches()',
    async run() {
      const rows = await alumni.batches();
      const view = summarise(rows, (b) => `${b.year}: ${b.students}${b.staff ? ` + ${b.staff} staff` : ''}`, { limit: 12 });
      return ok({ batches: rows }, { speak: rows.length ? `Batches: ${view.list}.` : 'No alumni batches yet.' });
    },
  },

  list_alumni_posts: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "Posts in the caller's alumni circles (the school-wide circle and their batch or the former-staff circle): published posts, plus the caller's own posts waiting for review or returned. Read-only.",
    inputSchema: { type: 'object', properties: { circle: { type: 'string', maxLength: 80 } }, additionalProperties: false },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'alumni.service.listPosts()',
    async run(ctx, a) {
      let circleId;
      if (a.circle) circleId = theNamed(await alumni.myCircles(ctx.actor), a.circle, { label: 'alumni circle', nameOf: (c) => c.name }).id;
      const rows = await alumni.listPosts(ctx.actor, { circleId });
      const posts = rows.map((p) => ({ circle: p.circle, title: p.title, body: excerpt(p.body, 240), author: p.authorName, status: p.status, at: p.publishedAt ?? p.createdAt, note: p.note }));
      const view = summarise(posts, (p) => `${p.title ?? excerpt(p.body, 50)} (${p.circle}${p.status !== 'PUBLISHED' ? `, ${p.status.toLowerCase().replace(/_/g, ' ')}` : ''})`, { limit: 6 });
      return ok({ posts }, { speak: posts.length ? `${posts.length} posts: ${view.list}.` : 'No posts in your circles yet.' });
    },
  },

  create_alumni_post: {
    module: 'Alumni', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "For an alumnus: write a post in one of their alumni circles (named, e.g. 'Class of 2019' or 'Alumni community'). It waits for the school's review before others see it. Needs confirmation.",
    inputSchema: { type: 'object', properties: { circle: { type: 'string', maxLength: 80 }, title: { type: 'string', maxLength: 150 }, body: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['body'], additionalProperties: false },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'alumni.service.createPost()',
    summarise: (a, _actor, p) => `Post in ${p?.circle ?? a.circle ?? 'your alumni circle'}${a.title ? ` — "${a.title}"` : ''}: "${excerpt(a.body, 120)}" (sent for the school's review)`,
    async prepare(ctx, a) {
      const circles = await alumni.myCircles(ctx.actor);
      let c;
      if (a.circle) c = theNamed(circles, a.circle, { label: 'alumni circle', nameOf: (x) => x.name });
      else if (circles.length === 1) [c] = circles;
      else c = circles.find((x) => /^class of/i.test(x.name)) ?? circles[0];
      if (!c) throw new AppError('You are not in any alumni circle yet.', 404, [], 'NOT_FOUND');
      return { circleId: c.id, circle: c.name };
    },
    async run(ctx, a, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, a));
      const p = await alumni.createPost(ctx.actor, { circleId: plan.circleId, title: a.title, body: a.body });
      return action({ type: 'alumni_post_created', id: p.id, data: { status: p.status, circle: plan.circle }, speak: `Posted in ${plan.circle}. It is ${p.status === 'PUBLISHED' ? 'published' : 'waiting for the school\'s review'}.` });
    },
  },

  list_alumni_certificate_types: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: 'For a former student: the certificates they can request from their school record (character, study, leaving and others the school set up), with any extra details each asks for. Read-only.',
    inputSchema: noArgs, permission: DIR, forRoles: ['ALUMNUS'], service: 'documentType.service.listRequestable()',
    async run() {
      const rows = await alumniTypes();
      return ok({ types: rows.map((t) => ({ name: t.name, description: t.description, fields: t.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, options: f.options })) })) }, {
        speak: rows.length ? `You can request: ${rows.map((t) => t.name).join(', ')}. A duplicate board marksheet or migration certificate comes from the board itself, not the school.` : 'The school has not set up any certificates to request yet.',
      });
    },
  },

  get_my_alumni_certificate_requests: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "For a former student: their own certificate requests and where each stands (pending, under review, approved, ready to download, rejected with the reason). Read-only.",
    inputSchema: noArgs, permission: DIR, forRoles: ['ALUMNUS'], service: 'documentRequest.service.listMine()',
    async run(ctx) {
      const rows = await docs.listMine(ctx.actor);
      const view = summarise(rows, (r) => `${r.documentTypeName}: ${r.status.toLowerCase().replace(/_/g, ' ')}${r.rejectionReason ? ` (${r.rejectionReason})` : ''}`, { limit: 8 });
      return ok({ requests: rows.map((r) => ({ certificate: r.documentTypeName, status: r.status, purpose: r.purpose, requestedAt: r.requestedAt, requiredBy: r.requiredBy, rejectionReason: r.rejectionReason, ready: Boolean(r.document) })) }, {
        speak: rows.length ? `${view.list}.${rows.some((r) => r.document) ? ' Download ready ones from Certificates.' : ''}` : 'You have not requested any certificates.',
      });
    },
  },

  request_alumni_certificate: {
    module: 'Alumni', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "For a former student: request a certificate (named, e.g. 'character certificate') from their own school record, saying what it is for and optionally when it is needed. It goes to the school office. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        certificate: { type: 'string', minLength: 2, maxLength: 120 }, purpose: { type: 'string', minLength: 2, maxLength: 500 },
        requiredBy: dateStr('YYYY-MM-DD'), additionalInformation: { type: 'string', maxLength: 2000 },
        fields: {
          type: 'array', maxItems: 20, description: "Answers to the certificate's extra details (see list_alumni_certificate_types)",
          items: { type: 'object', properties: { key: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 500 } }, required: ['key', 'value'], additionalProperties: false },
        },
      },
      required: ['certificate', 'purpose'],
      additionalProperties: false,
    },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'documentRequest.service.createRequest()',
    summarise: (a, _actor, p) => `Request a ${p?.name ?? a.certificate} for "${a.purpose}"${a.requiredBy ? `, needed by ${a.requiredBy}` : ''}`,
    async prepare(ctx, a) {
      const t = theNamed(await alumniTypes(), a.certificate, { label: 'certificate', nameOf: (x) => x.name });
      return { typeId: t.id, name: t.name };
    },
    async run(ctx, a, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, a));
      const r = await docs.createRequest(ctx.actor, { documentTypeId: plan.typeId, purpose: a.purpose, requiredBy: a.requiredBy, additionalInformation: a.additionalInformation, fields: Object.fromEntries((a.fields ?? []).map((f) => [f.key, f.value])) });
      return action({ type: 'alumni_certificate_requested', id: r.id, data: { certificate: plan.name, status: r.status }, speak: `Your ${plan.name} request is with the school office. You will be told when it is ready to download.` });
    },
  },

  cancel_alumni_certificate_request: {
    module: 'Alumni', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'For a former student: cancel one of their own certificate requests that is still pending (named by the certificate). Needs confirmation.',
    inputSchema: { type: 'object', properties: { certificate: { type: 'string', minLength: 2, maxLength: 120 } }, required: ['certificate'], additionalProperties: false },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'documentRequest.service.cancelMine()',
    summarise: (_a, _actor, p) => `Cancel your pending ${p?.name ?? 'certificate'} request`,
    async prepare(ctx, a) {
      const pending = (await docs.listMine(ctx.actor)).filter((r) => r.status === 'PENDING');
      if (!pending.length) throw new AppError('You have no pending certificate request to cancel.', 404, [], 'NOT_FOUND');
      const r = theNamed(pending, a.certificate, { label: 'pending request', nameOf: (x) => x.documentTypeName });
      return { id: r.id, name: r.documentTypeName };
    },
    async run(ctx, a, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, a));
      await docs.cancelMine(ctx.actor, plan.id);
      return action({ type: 'alumni_certificate_cancelled', id: plan.id, data: { certificate: plan.name }, speak: `Cancelled your ${plan.name} request.` });
    },
  },

  list_alumni_opportunities: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "The alumni give-back board: published career talks, mentoring, internships, jobs, scholarships and volunteering the caller may see (students see offers for their class; external links are for adults only). Read-only.",
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: OPPORTUNITY_KINDS } }, additionalProperties: false },
    permission: DIR, service: 'opportunities.service.list()',
    async run(ctx, a) {
      const rows = await opps.list(ctx.actor, { kind: a.kind });
      const view = summarise(rows, (o) => `${o.title} (${o.kindLabel}${o.applyBy ? `, apply by ${shortDate(o.applyBy)}` : ''})`, { limit: 8 });
      return ok({ opportunities: rows.map(offerView) }, { speak: rows.length ? `${rows.length} open: ${view.list}. Say "I'm interested in …" and the alumni coordinator will introduce you.` : 'No open opportunities right now.' });
    },
  },

  get_my_opportunity_offers: {
    module: 'Alumni', operation: 'GET', risk: RISK.LOW,
    description: "For an alumnus: the offers they posted, each with its review status, the reviewer's note and how many people are interested (never who). Read-only.",
    inputSchema: noArgs, permission: DIR, forRoles: ['ALUMNUS'], service: 'opportunities.service.mine()',
    async run(ctx) {
      const rows = await opps.mine(ctx.actor);
      const view = summarise(rows, (o) => `${o.title}: ${o.status.toLowerCase().replace(/_/g, ' ')}, ${o.interestCount ?? 0} interested`, { limit: 8 });
      return ok({ offers: rows.map((o) => ({ ...offerView(o), reviewNote: o.reviewNote })) }, { speak: rows.length ? `${view.list}.` : 'You have not offered anything yet.' });
    },
  },

  offer_opportunity: {
    module: 'Alumni', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "For an alumnus: offer a career talk, mentoring, an internship, a job, a scholarship or volunteering to the school. It goes to the alumni coordinator for review before anyone sees it; students never see the alumnus's contact. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: OPPORTUNITY_KINDS }, title: { type: 'string', minLength: 3, maxLength: 150 }, description: { type: 'string', minLength: 10, maxLength: 3000 },
        organisation: { type: 'string', maxLength: 120 }, location: { type: 'string', maxLength: 120 }, mode: { type: 'string', enum: ['IN_PERSON', 'ONLINE', 'HYBRID'] },
        applyBy: dateStr('YYYY-MM-DD'), audience: { type: 'string', enum: OPPORTUNITY_AUDIENCES }, link: { type: 'string', maxLength: 500, description: 'https link, shown to adults only' },
      },
      required: ['kind', 'title', 'description'],
      additionalProperties: false,
    },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'opportunities.service.create()',
    summarise: (a) => `Offer "${a.title}" (${a.kind.toLowerCase().replace(/_/g, ' ')}) to ${(a.audience ?? 'SENIOR_STUDENTS').toLowerCase().replace(/_/g, ' ')}${a.applyBy ? `, apply by ${a.applyBy}` : ''} — sent to the alumni coordinator for review`,
    async run(ctx, a) {
      const o = await opps.create(ctx.actor, a);
      return action({ type: 'opportunity_offered', id: o.id, data: { status: o.status }, speak: o.status === 'PUBLISHED' ? 'Your offer is published.' : 'Thank you. Your offer is with the alumni coordinator for review; you will be told when it is live.' });
    },
  },

  withdraw_opportunity_offer: {
    module: 'Alumni', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'For an alumnus: withdraw one of their own offers that is waiting for review or published (named by its title). Needs confirmation.',
    inputSchema: { type: 'object', properties: { offer: { type: 'string', maxLength: 150 } }, additionalProperties: false },
    permission: DIR, forRoles: ['ALUMNUS'], service: 'opportunities.service.withdraw()',
    summarise: (_a, _actor, p) => `Withdraw your offer "${p?.title ?? ''}"`,
    async prepare(ctx, a) { const o = await findOffer(ctx, a.offer, { mine: true }); return { id: o.id, title: o.title }; },
    async run(ctx, a, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, a));
      await opps.withdraw(ctx.actor, plan.id);
      return action({ type: 'opportunity_withdrawn', id: plan.id, data: { title: plan.title }, speak: `Withdrawn: ${plan.title}.` });
    },
  },

  express_interest_in_opportunity: {
    module: 'Alumni', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "For a student or alumnus: say they are interested in a published opportunity (named by its title), with an optional line about why. The school's alumni coordinator is told and makes the introduction; nothing goes to the alumnus directly. Needs confirmation.",
    inputSchema: { type: 'object', properties: { opportunity: { type: 'string', maxLength: 150 }, note: { type: 'string', maxLength: 500 } }, additionalProperties: false },
    permission: DIR, forRoles: ['STUDENT', 'ALUMNUS'], service: 'opportunities.service.interest()',
    summarise: (a, _actor, p) => `Tell the alumni coordinator you are interested in "${p?.title ?? a.opportunity}"${a.note ? `: "${excerpt(a.note, 100)}"` : ''}`,
    async prepare(ctx, a) { const o = await findOffer(ctx, a.opportunity); return { id: o.id, title: o.title }; },
    async run(ctx, a, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, a));
      await opps.interest(ctx.actor, plan.id, { note: a.note });
      return action({ type: 'opportunity_interest', id: plan.id, data: { title: plan.title }, speak: `Sent. The alumni coordinator will be in touch about ${plan.title}.` });
    },
  },
};

const PLANNER = {
  get_my_planner: {
    module: 'Academics', operation: 'GET', risk: RISK.LOW,
    description: "For a student (or a parent, for their child): homework due and overdue, quizzes not yet taken, exam papers ahead, and a suggested study week built from the student's own homework, exam dates and published marks, sized for their age. Read-only; a suggestion, nothing is booked.",
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 7, maximum: 60 }, studentId: { type: 'string', pattern: '^[a-f0-9]{24}$' } }, additionalProperties: false },
    permission: 'assignments.read', forRoles: ['STUDENT', 'PARENT'], service: 'planner.service.getPlanner()',
    async run(ctx, a) {
      const p = await planner.getPlanner(ctx.actor, { studentId: a.studentId, days: a.days });
      const next = p.plan.days.find((d) => d.blocks.length);
      const due = summarise(p.due, (d) => `${d.title} (${d.subject}, ${d.daysLeft === 0 ? 'today' : d.daysLeft === 1 ? 'tomorrow' : `in ${d.daysLeft} days`})`, { limit: 4 });
      const exams = summarise(p.exams, (e) => `${e.subject} on ${shortDate(e.date)}`, { limit: 4 });
      return ok(p, {
        speak: [
          p.due.length ? `Due: ${due.list}.` : 'No homework due.',
          p.overdue.length ? `${p.overdue.length} overdue.` : null,
          p.exams.length ? `Exams: ${exams.list}.` : null,
          next ? `Suggested next: ${next.blocks.map((b) => `${b.subject} ${b.minutes} min (${b.reason})`).join('; ')}.` : null,
        ].filter(Boolean).join(' '),
      });
    },
  },

  get_board_registration_details: {
    module: 'Academics', operation: 'GET', risk: RISK.LOW,
    description: "For a student in Class 10 or 12 (or their parent): the details the school sends to the board in its List of Candidates — name, date of birth, gender, parents' names, subjects — flagging anything missing, with any board deadlines on the school calendar. Read-only; corrections are requested from My Profile.",
    inputSchema: { type: 'object', properties: { studentId: { type: 'string', pattern: '^[a-f0-9]{24}$' } }, additionalProperties: false },
    permission: 'assignments.read', forRoles: ['STUDENT', 'PARENT'], service: 'planner.service.getPlanner().board',
    async run(ctx, a) {
      const p = await planner.getPlanner(ctx.actor, { studentId: a.studentId, days: 60 });
      if (!p.board) return ok({ board: null, className: p.student.className }, { speak: `Board registration applies in Classes 10 and 12; ${p.student.className ?? 'this class'} is not a board year.` });
      const missing = p.board.checks.filter((c) => c.missing).map((c) => c.label);
      return ok({ board: p.board }, { speak: `${p.board.checks.filter((c) => !c.missing).map((c) => `${c.label}: ${c.value}`).join('; ')}.${missing.length ? ` Missing: ${missing.join(', ')} — ask for a correction from My Profile.` : ' Check each one; if anything is wrong, ask for a correction from My Profile.'}` });
    },
  },
};

export const p4StudentAlumnusTools = {
  ...Object.fromEntries(Object.entries(ALL).map(([name, tool]) => [name, behind('alumni', tool)])),
  ...PLANNER,
};
