import { AlumniOpportunity, OPPORTUNITY_KINDS, OPPORTUNITY_AUDIENCES } from '../../models/alumniOpportunity.model.js';
import { AlumniProfile } from '../../models/alumni.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Section, Grade } from '../../models/academics.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { notify } from '../notifications/notification.service.js';
import { batchLabel } from '../alumni/alumni.service.js';
import { requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, parseDate } from '../ops/common.js';

/**
 * Alumni "give back" board: career talks, mentoring, internships, jobs,
 * scholarships and volunteering offered by alumni (or posted by the school's
 * alumni coordinator).
 *
 * Rules, all enforced here:
 *   - an alumnus's offer is PENDING_REVIEW until someone with alumni.manage
 *     publishes it (with a reason when rejecting); a coordinator's own post is
 *     published at once;
 *   - students see published offers for their audience only (SENIOR_STUDENTS
 *     means Classes 9 to 12), never the external link and never the poster's
 *     contact: a student's interest goes to the coordinator, who introduces;
 *   - the poster sees how many are interested, never who;
 *   - the assistant may draft an offer or an interest for the person to
 *     confirm, but never publishes or rejects one (that stays on the screen).
 */

const isManager = (actor) => Boolean(actor?.permissions?.['alumni.manage']);
const KIND_LABEL = {
  CAREER_TALK: 'Career talk', MENTORING: 'Mentoring', INTERNSHIP: 'Internship', JOB: 'Job', SCHOLARSHIP: 'Scholarship', VOLUNTEER: 'Volunteering',
};

function httpsLink(value) {
  const v = optionalText(value, { max: 500 });
  if (!v) return null;
  let u;
  try { u = new URL(v); } catch { throw new AppError('The link must be a full https:// address', 400, [], 'BAD_LINK'); }
  if (u.protocol !== 'https:') throw new AppError('The link must be a full https:// address', 400, [], 'BAD_LINK');
  return u.toString();
}

/** The grade number of a student's current class (Class 10 → 10), or null. */
async function studentClass(actor) {
  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
  if (!student) return { gradeNo: null, className: null };
  const e = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' }).sort({ createdAt: -1 }).select('sectionId').lean();
  const section = e ? await Section.findById(e.sectionId).select('name gradeId').lean() : null;
  const grade = section ? await Grade.findById(section.gradeId).select('name').lean() : null;
  const m = /(\d{1,2})/.exec(grade?.name ?? '');
  return { gradeNo: m ? Number(m[1]) : null, className: grade ? `${grade.name} ${section.name}`.trim() : null };
}

export const SENIOR_FROM = 9;

/** Which audiences this person may see. */
async function audiencesFor(actor) {
  if (isManager(actor)) return OPPORTUNITY_AUDIENCES;
  if (actor.roleKey === 'ALUMNUS') return ['ALUMNI', 'EVERYONE', 'SENIOR_STUDENTS', 'ALL_STUDENTS'];
  if (actor.roleKey === 'STUDENT') {
    const { gradeNo } = await studentClass(actor);
    return gradeNo !== null && gradeNo >= SENIOR_FROM ? ['SENIOR_STUDENTS', 'ALL_STUDENTS', 'EVERYONE'] : ['ALL_STUDENTS', 'EVERYONE'];
  }
  // Staff and parents: what the school shows its students.
  return ['SENIOR_STUDENTS', 'ALL_STUDENTS', 'EVERYONE'];
}

function present(o, actor) {
  const mine = String(o.postedByProfileId) === String(actor.profileId);
  const manager = isManager(actor);
  const adult = actor.roleKey !== 'STUDENT';
  const interested = (o.interests ?? []).some((i) => String(i.profileId) === String(actor.profileId));
  return {
    id: String(o._id), kind: o.kind, kindLabel: KIND_LABEL[o.kind] ?? o.kind, title: o.title, description: o.description,
    organisation: o.organisation, location: o.location, mode: o.mode, applyBy: o.applyBy, audience: o.audience,
    // The external link is for adults; a student asks through the coordinator.
    link: adult ? o.link : null,
    postedBy: o.postedByName, batchLabel: o.batchLabel, status: o.status, createdAt: o.createdAt,
    reviewNote: mine || manager ? o.review?.note ?? null : null,
    interestCount: mine || manager ? (o.interests ?? []).length : undefined,
    interested,
    mine,
    ...(manager ? { interests: (o.interests ?? []).map((i) => ({ name: i.name, roleKey: i.roleKey, className: i.className, note: i.note, at: i.at })) } : {}),
  };
}

async function managers() {
  const roles = await Role.find({ permissions: { $elemMatch: { key: 'alumni.manage' } } }).select('_id').lean();
  if (!roles.length) return [];
  const tenantId = currentTenantId();
  const rows = await Profile.find({ roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

async function activeAlumnus(actor) {
  const a = await AlumniProfile.findOne({ profileId: actor.profileId }).lean();
  if (!a) throw new AppError('Offers are posted by alumni of the school (or the alumni coordinator).', 403, [], 'NOT_ALUMNUS');
  if (a.status !== 'ACTIVE') throw new AppError('Your alumni membership is suspended. Contact the school.', 403, [], 'ALUMNUS_SUSPENDED');
  return a;
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  const audiences = await audiencesFor(actor);
  const filter = { audience: { $in: audiences } };
  if (isManager(actor) && query.status) filter.status = oneOf(query.status, ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'CLOSED'], 'status');
  else if (isManager(actor) && query.queue === 'review') filter.status = 'PENDING_REVIEW';
  else filter.status = 'PUBLISHED';
  if (query.kind) filter.kind = oneOf(query.kind, OPPORTUNITY_KINDS, 'kind');
  const rows = await AlumniOpportunity.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  // An offer past its apply-by date drops off the public board.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const visible = filter.status === 'PUBLISHED' ? rows.filter((o) => !o.applyBy || new Date(o.applyBy) >= today) : rows;
  return visible.map((o) => present(o, actor));
}

export async function mine(actor) {
  requireProfile(actor);
  const rows = await AlumniOpportunity.find({ postedByProfileId: actor.profileId }).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map((o) => present(o, actor));
}

export async function create(actor, body = {}) {
  requireProfile(actor);
  const manager = isManager(actor);
  const a = manager && actor.roleKey !== 'ALUMNUS' ? null : await activeAlumnus(actor);
  const o = new AlumniOpportunity({
    kind: oneOf(body.kind, OPPORTUNITY_KINDS, 'kind'),
    title: requireText(body.title, 'title', { max: 150 }),
    description: requireText(body.description, 'description', { max: 3000 }),
    organisation: optionalText(body.organisation, { max: 120 }) || null,
    location: optionalText(body.location, { max: 120 }) || null,
    mode: oneOf(body.mode, ['IN_PERSON', 'ONLINE', 'HYBRID'], 'mode', 'ONLINE'),
    applyBy: parseDate(body.applyBy, 'applyBy'),
    audience: oneOf(body.audience, OPPORTUNITY_AUDIENCES, 'audience', 'SENIOR_STUDENTS'),
    link: httpsLink(body.link),
    postedByProfileId: actor.profileId,
    postedByName: a?.displayName ?? actor.displayName ?? null,
    postedByRole: actor.roleKey ?? null,
    batchLabel: a ? batchLabel(a) : null,
    status: a ? 'PENDING_REVIEW' : 'PUBLISHED',
  });
  if (o.applyBy && o.applyBy < new Date(Date.now() - 86_400_000)) throw new AppError('The apply-by date has already passed', 400, [], 'BAD_DATE');
  pushHistory(o, actor, 'CREATED', { to: o.status });
  await o.save();
  if (o.status === 'PENDING_REVIEW') {
    const ids = (await managers()).filter((id) => id !== String(actor.profileId));
    if (ids.length) await notify({ recipientProfileIds: ids, type: 'SYSTEM', title: `Alumni offer to review: ${o.title}`, body: `${o.postedByName ?? 'An alumnus'} (${o.batchLabel ?? 'alumni'}) offered ${KIND_LABEL[o.kind].toLowerCase()}. Review it before students see it.`, link: '/alumni' });
  }
  return present(o.toObject(), actor);
}

async function load(id) {
  const o = await AlumniOpportunity.findById(assertObjectId(id));
  if (!o) throw new AppError('Offer not found', 404);
  return o;
}

export async function withdraw(actor, id) {
  requireProfile(actor);
  const o = await load(id);
  if (String(o.postedByProfileId) !== String(actor.profileId) && !isManager(actor)) throw new AppError('Offer not found', 404);
  if (!['PENDING_REVIEW', 'PUBLISHED'].includes(o.status)) throw new AppError(`This offer is already ${o.status.toLowerCase().replace(/_/g, ' ')}`, 409, [], 'INVALID_TRANSITION');
  const from = o.status;
  o.status = String(o.postedByProfileId) === String(actor.profileId) ? 'WITHDRAWN' : 'CLOSED';
  pushHistory(o, actor, o.status, { from, to: o.status });
  await o.save();
  return present(o.toObject(), actor);
}

/** PUBLISH or REJECT an alumnus's offer. A person decides this, on the screen. */
export async function review(actor, id, body = {}) {
  requireProfile(actor);
  if (!isManager(actor)) throw new AppError('Missing permission: alumni.manage', 403);
  const decision = oneOf(body.decision, ['PUBLISH', 'REJECT'], 'decision');
  const o = await load(id);
  if (o.status !== 'PENDING_REVIEW') throw new AppError(`This offer is ${o.status.toLowerCase().replace(/_/g, ' ')}, not waiting for review`, 409, [], 'INVALID_TRANSITION');
  if (String(o.postedByProfileId) === String(actor.profileId)) throw new AppError('Someone else reviews your own offer.', 403, [], 'SELF_REVIEW');
  const note = optionalText(body.note, { max: 500 }) || null;
  if (decision === 'REJECT' && !note) throw new AppError('Say why, for the alumnus', 400, [], 'REASON_REQUIRED');
  o.status = decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';
  o.review = { byProfileId: actor.profileId, at: new Date(), note };
  pushHistory(o, actor, 'REVIEWED', { from: 'PENDING_REVIEW', to: o.status, note });
  await o.save();
  await notify({ recipientProfileIds: [String(o.postedByProfileId)], type: 'SYSTEM', title: o.status === 'PUBLISHED' ? `Your offer is live: ${o.title}` : `Your offer was not published: ${o.title}`, body: note ?? 'Students and alumni can now see it. The school will introduce anyone interested.', link: '/alumni' });
  return present(o.toObject(), actor);
}

/** A student or alumnus says "I'm interested"; the coordinator is told and makes the introduction. */
export async function interest(actor, id, body = {}) {
  requireProfile(actor);
  if (!['STUDENT', 'ALUMNUS'].includes(actor.roleKey)) throw new AppError('Students and alumni can show interest in an offer.', 403, [], 'ROLE_NOT_PERMITTED');
  const o = await load(id);
  const audiences = await audiencesFor(actor);
  if (o.status !== 'PUBLISHED' || !audiences.includes(o.audience)) throw new AppError('Offer not found', 404);
  if (String(o.postedByProfileId) === String(actor.profileId)) throw new AppError('This is your own offer.', 409, [], 'OWN_OFFER');
  const withdrawn = body.withdraw === true;
  const already = (o.interests ?? []).some((i) => String(i.profileId) === String(actor.profileId));
  if (withdrawn) {
    o.interests = (o.interests ?? []).filter((i) => String(i.profileId) !== String(actor.profileId));
    await o.save();
    return present(o.toObject(), actor);
  }
  if (already) throw new AppError('You have already shown interest. The school will be in touch.', 409, [], 'ALREADY_INTERESTED');
  const { className } = actor.roleKey === 'STUDENT' ? await studentClass(actor) : { className: null };
  o.interests.push({ profileId: actor.profileId, name: actor.displayName ?? null, roleKey: actor.roleKey, className, note: optionalText(body.note, { max: 500 }) || null });
  await o.save();
  const ids = (await managers()).filter((x) => x !== String(actor.profileId));
  if (ids.length) await notify({ recipientProfileIds: ids, type: 'SYSTEM', title: `Interest in: ${o.title}`, body: `${actor.roleKey === 'STUDENT' ? `A student${className ? ` in ${className}` : ''}` : 'An alumnus'} would like an introduction (${KIND_LABEL[o.kind].toLowerCase()}).`, link: '/alumni' });
  return present(o.toObject(), actor);
}

export { KIND_LABEL };
