import { AccreditationCycle } from '../../models/accreditation.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto,
} from '../ops/common.js';

/**
 * Accreditation preparation.
 *
 * What the system does: holds the checklist of evidence by criterion, names an
 * owner for each item, keeps the proof, and reports how complete the
 * preparation is. What it does not do: score the institution, predict a grade,
 * or submit to an agency. An item cannot be marked READY without evidence
 * attached, and a cycle is SUBMITTED only when a person records the reference.
 *
 * The starting criteria are HEADINGS ONLY, taken from each agency's published
 * structure as understood when this was written. Agencies revise their
 * manuals, so a cycle starts with `templateVerified: false` and says so on the
 * screen until someone has checked it against the current manual. The
 * individual metrics are deliberately not prefilled: the institution adds the
 * ones in its own manual, rather than trusting a list that may be out of date.
 */
export const FRAMEWORKS = {
  NAAC: {
    label: 'NAAC (institutional accreditation)',
    note: 'Seven criteria headings from the NAAC assessment framework. NAAC has been revising its methodology; check the current manual for your institution type and add its metrics under each criterion.',
    criteria: [
      ['C1', 'Curricular Aspects'],
      ['C2', 'Teaching-Learning and Evaluation'],
      ['C3', 'Research, Innovations and Extension'],
      ['C4', 'Infrastructure and Learning Resources'],
      ['C5', 'Student Support and Progression'],
      ['C6', 'Governance, Leadership and Management'],
      ['C7', 'Institutional Values and Best Practices'],
    ],
  },
  NBA: {
    label: 'NBA (programme accreditation)',
    note: 'Criteria headings in the style of an NBA self-assessment report. The exact criteria and their order differ by programme level and tier; check the current SAR format for your programme.',
    criteria: [
      ['C1', 'Vision, Mission and Programme Educational Objectives'],
      ['C2', 'Programme Curriculum and Teaching-Learning Processes'],
      ['C3', 'Course Outcomes and Programme Outcomes'],
      ['C4', 'Student Performance'],
      ['C5', 'Faculty Information and Contributions'],
      ['C6', 'Facilities and Technical Support'],
      ['C7', 'Continuous Improvement'],
      ['C8', 'First Year Academics'],
      ['C9', 'Student Support Systems'],
      ['C10', 'Governance, Institutional Support and Financial Resources'],
    ],
  },
  BOARD_INSPECTION: {
    label: 'Board or university inspection',
    note: 'A general starting list for an affiliation or inspection visit. Replace it with the checklist your board or university issues.',
    criteria: [
      ['A', 'Recognition, affiliation and statutory certificates'],
      ['B', 'Land, building and safety'],
      ['C', 'Staff: qualifications, appointments and service records'],
      ['D', 'Students: admissions, attendance and records'],
      ['E', 'Academics, examinations and results'],
      ['F', 'Finance, fees and accounts'],
      ['G', 'Facilities: laboratories, library, sports and health'],
    ],
  },
  CUSTOM: { label: 'Custom framework', note: 'Add your own criteria and evidence items.', criteria: [] },
};

const ITEM_STATUS = ['NOT_STARTED', 'IN_PROGRESS', 'READY', 'NOT_APPLICABLE'];

function progress(cycle) {
  const items = cycle.criteria.flatMap((c) => c.items);
  const counted = items.filter((i) => i.status !== 'NOT_APPLICABLE');
  const ready = counted.filter((i) => i.status === 'READY').length;
  const now = new Date();
  return {
    items: items.length,
    counted: counted.length,
    ready,
    inProgress: counted.filter((i) => i.status === 'IN_PROGRESS').length,
    notStarted: counted.filter((i) => i.status === 'NOT_STARTED').length,
    overdue: counted.filter((i) => i.status !== 'READY' && i.dueOn && new Date(i.dueOn) < now).length,
    // No items means nothing has been planned yet: that is "not available", not 0% or 100%.
    readyPct: counted.length ? Math.round((ready / counted.length) * 100) : null,
  };
}

function present(doc) {
  const c = dto(doc);
  c.criteria = (doc.criteria ?? []).map((cr) => {
    const items = (cr.items ?? []).map((i) => ({
      id: String(i._id), metric: i.metric, ownerProfileId: i.ownerProfileId ? String(i.ownerProfileId) : null, ownerName: i.ownerName ?? null,
      dueOn: i.dueOn ?? null, status: i.status, note: i.note ?? null, evidence: (i.evidence ?? []).map((e) => ({ name: e.name, url: e.url, kind: e.kind })),
    }));
    const counted = items.filter((i) => i.status !== 'NOT_APPLICABLE');
    return { id: String(cr._id), code: cr.code, title: cr.title, items, ready: counted.filter((i) => i.status === 'READY').length, counted: counted.length };
  });
  c.progress = progress(doc);
  c.frameworkLabel = FRAMEWORKS[doc.framework]?.label ?? doc.framework;
  return c;
}

async function load(id) {
  const cycle = await AccreditationCycle.findById(assertObjectId(id));
  if (!cycle) throw new AppError('Accreditation cycle not found', 404);
  return cycle;
}

const editable = (cycle) => {
  if (cycle.status !== 'PREPARING') throw new AppError('This cycle has been submitted; its evidence can no longer be changed.', 409, [], 'CYCLE_LOCKED');
};

export function frameworks() {
  return Object.entries(FRAMEWORKS).map(([key, f]) => ({ key, label: f.label, note: f.note, criteria: f.criteria.map(([code, title]) => ({ code, title })) }));
}

export async function listCycles() {
  const rows = await AccreditationCycle.find({}).sort({ createdAt: -1 }).lean();
  return rows.map(present);
}

export async function getCycle(id) {
  return present((await load(id)).toObject());
}

export async function createCycle(actor, body = {}) {
  requireProfile(actor);
  const framework = oneOf(body.framework, Object.keys(FRAMEWORKS), 'framework');
  const template = FRAMEWORKS[framework];
  const cycle = new AccreditationCycle({
    refNo: await nextRef('ACR'),
    framework,
    title: requireText(body.title, 'title', { max: 200 }),
    programme: optionalText(body.programme, { max: 200 }) || null,
    targetDate: parseDate(body.targetDate, 'targetDate'),
    templateVerified: framework === 'CUSTOM',
    templateNote: template.note,
    criteria: template.criteria.map(([code, title]) => ({ code, title, items: [] })),
    history: [],
  });
  pushHistory(cycle, actor, 'CREATED', { to: 'PREPARING' });
  await cycle.save();
  return present(cycle.toObject());
}

/** Records that someone checked the criteria against the agency's current manual. */
export async function verifyTemplate(actor, id, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  cycle.templateVerified = true;
  pushHistory(cycle, actor, 'TEMPLATE_VERIFIED', { note: optionalText(body.note, { max: 500 }) || null });
  await cycle.save();
  return present(cycle.toObject());
}

export async function addCriterion(actor, id, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  editable(cycle);
  const code = requireText(body.code, 'code', { max: 20 });
  if (cycle.criteria.some((c) => c.code.toLowerCase() === code.toLowerCase())) throw new AppError(`Criterion ${code} already exists.`, 409, [], 'DUPLICATE_CRITERION');
  cycle.criteria.push({ code, title: requireText(body.title, 'title', { max: 200 }), items: [] });
  await cycle.save();
  return present(cycle.toObject());
}

async function ownerOf(profileId) {
  if (!profileId) return { ownerProfileId: null, ownerName: null };
  const p = await Profile.findById(assertObjectId(profileId, 'ownerProfileId')).select('displayName').lean();
  if (!p) throw new AppError('Owner not found', 404);
  return { ownerProfileId: p._id, ownerName: p.displayName };
}

export async function addItem(actor, id, criterionId, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  editable(cycle);
  const criterion = cycle.criteria.id(assertObjectId(criterionId, 'criterionId'));
  if (!criterion) throw new AppError('Criterion not found', 404);
  const metric = requireText(body.metric, 'metric', { max: 500 });
  const owner = await ownerOf(body.ownerProfileId);
  criterion.items.push({ metric, ...owner, dueOn: parseDate(body.dueOn, 'dueOn'), note: optionalText(body.note, { max: 2000 }) || null });
  await cycle.save();
  if (owner.ownerProfileId && String(owner.ownerProfileId) !== String(actor.profileId)) {
    await notify({ recipientProfileIds: [String(owner.ownerProfileId)], type: 'SYSTEM', title: `Accreditation evidence assigned to you: ${criterion.code}`, body: metric.slice(0, 200), link: `/compliance?tab=accreditation&id=${cycle._id}` });
  }
  return present(cycle.toObject());
}

export async function updateItem(actor, id, itemId, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  editable(cycle);
  const wanted = String(assertObjectId(itemId, 'itemId'));
  const item = cycle.criteria.flatMap((c) => c.items).find((i) => String(i._id) === wanted);
  if (!item) throw new AppError('Evidence item not found', 404);
  // The owner may update their own item; anyone else needs to manage compliance.
  const mine = item.ownerProfileId && String(item.ownerProfileId) === String(actor.profileId);
  const manager = Boolean(actor.permissions?.['compliance.manage']);
  if (!mine && !manager) throw new AppError('Only the owner of this item or a compliance manager can change it.', 403, [], 'NOT_ITEM_OWNER');

  // What is asked for, and who owns it, is the manager's to set.
  if (manager) {
    if (body.metric !== undefined) item.metric = requireText(body.metric, 'metric', { max: 500 });
    if (body.dueOn !== undefined) item.dueOn = parseDate(body.dueOn, 'dueOn');
    if (body.ownerProfileId !== undefined) Object.assign(item, await ownerOf(body.ownerProfileId));
  }
  if (body.note !== undefined) item.note = optionalText(body.note, { max: 2000 }) || null;
  if (Array.isArray(body.evidence)) item.evidence = cleanAttachments(body.evidence, actor);
  if (body.status !== undefined) {
    const status = oneOf(body.status, ITEM_STATUS, 'status');
    if (status === 'READY' && !item.evidence.length) throw new AppError('Attach the evidence before marking this item ready.', 409, [], 'EVIDENCE_REQUIRED');
    if (status === 'NOT_APPLICABLE' && !(item.note ?? '').trim()) throw new AppError('Say why this item does not apply.', 400, [], 'REASON_REQUIRED');
    item.status = status;
  }
  // Removing the proof from a READY item un-readies it.
  if (item.status === 'READY' && !item.evidence.length) item.status = 'IN_PROGRESS';
  item.updatedAt = new Date();
  await cycle.save();
  return present(cycle.toObject());
}

/** Records that the institution itself submitted to the agency. The system submits nothing. */
export async function recordSubmission(actor, id, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  editable(cycle);
  const reference = requireText(body.reference, 'reference', { max: 200 });
  const p = progress(cycle);
  if (!p.counted) throw new AppError('This cycle has no evidence items yet.', 409, [], 'NOTHING_TO_SUBMIT');
  if (p.ready < p.counted && !body.acknowledgeIncomplete) {
    throw new AppError(`${p.counted - p.ready} evidence item(s) are not ready. Confirm that you are recording the submission anyway.`, 409, [], 'INCOMPLETE');
  }
  cycle.submission = { at: parseDate(body.at, 'at') ?? new Date(), reference, evidence: cleanAttachments(body.evidence, actor) };
  cycle.status = 'SUBMITTED';
  pushHistory(cycle, actor, 'SUBMISSION_RECORDED', { from: 'PREPARING', to: 'SUBMITTED', note: reference });
  await cycle.save();
  return present(cycle.toObject());
}

export async function recordOutcome(actor, id, body = {}) {
  requireProfile(actor);
  const cycle = await load(id);
  if (cycle.status !== 'SUBMITTED') throw new AppError('An outcome is recorded after the submission.', 409, [], 'NOT_SUBMITTED');
  cycle.outcome = requireText(body.outcome, 'outcome', { max: 1000 });
  cycle.status = 'CLOSED';
  pushHistory(cycle, actor, 'OUTCOME_RECORDED', { from: 'SUBMITTED', to: 'CLOSED', note: cycle.outcome.slice(0, 200) });
  await cycle.save();
  return present(cycle.toObject());
}

/** Evidence items the caller owns, across every open cycle. */
export async function myItems(actor) {
  requireProfile(actor);
  const cycles = await AccreditationCycle.find({ status: 'PREPARING', 'criteria.items.ownerProfileId': actor.profileId }).lean();
  return cycles.flatMap((c) => c.criteria.flatMap((cr) => cr.items.filter((i) => String(i.ownerProfileId) === String(actor.profileId)).map((i) => ({
    cycleId: String(c._id), cycle: c.title, criterion: `${cr.code} ${cr.title}`, itemId: String(i._id), metric: i.metric, status: i.status, dueOn: i.dueOn ?? null, note: i.note ?? null,
    evidence: (i.evidence ?? []).map((e) => ({ name: e.name, url: e.url, kind: e.kind })),
  }))));
}
