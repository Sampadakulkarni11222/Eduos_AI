import { PortfolioEvidence, PortfolioRating, PortfolioReflection, RUBRIC_LEVELS } from '../../models/competencyPortfolio.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { TermReportCard, ReportCardTemplate } from '../../models/reportCard.model.js';
import { Club, ClubMembership, Fixture } from '../../models/club.model.js';
import { ShowcaseEntry, ShowcaseEdition } from '../../models/showcase.model.js';
import { PracticalSession, Lab } from '../../models/lab.model.js';
import { EcoActivity, EcoTeam } from '../../models/sustainability.model.js';
import { CoCurricularActivity } from '../../models/coCurricular.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { activeEnrollment, classLabel, studentLabel } from '../ptm/relations.js';
import { assertObjectId, requireProfile, requireText, optionalText, oneOf, parseDate, cleanAttachments, dto } from '../ops/common.js';

/**
 * Competency portfolios.
 *
 * The framework follows the CBSE/NEP competency groups. Evidence comes from
 * records the school already keeps (read live, never copied) plus evidence a
 * teacher adds; a teacher rates each competency on a three-level rubric with
 * a comment; the student writes reflections. There are no numeric scores and
 * no behaviour ratings. Families and students see only their own portfolio.
 */
export const FRAMEWORK = [
  { key: 'COMMUNICATION', group: 'Core', label: 'Communication', description: 'Expresses ideas clearly in speech and writing; listens and responds.' },
  { key: 'CRITICAL_THINKING', group: 'Core', label: 'Critical thinking and problem solving', description: 'Analyses, reasons with evidence, solves unfamiliar problems.' },
  { key: 'COLLABORATION', group: 'Core', label: 'Collaboration and teamwork', description: 'Works with others towards a shared goal; takes and shares roles.' },
  { key: 'CREATIVITY', group: 'Core', label: 'Creativity and innovation', description: 'Generates original ideas and expresses them through art, design or making.' },
  { key: 'DIGITAL', group: 'Core', label: 'Digital literacy', description: 'Uses digital tools safely and purposefully to learn and create.' },
  { key: 'LIFE_SKILLS', group: 'Core', label: 'Life skills and citizenship', description: 'Health, responsibility, care for the environment and the community.' },
  { key: 'LANGUAGE', group: 'Subject', label: 'Language proficiency', description: 'Reads, writes and speaks with growing accuracy and range.' },
  { key: 'MATHEMATICAL', group: 'Subject', label: 'Mathematical reasoning', description: 'Applies number, pattern and logic to solve problems.' },
  { key: 'SCIENTIFIC', group: 'Subject', label: 'Scientific inquiry', description: 'Asks questions, experiments safely, records and explains observations.' },
  { key: 'SOCIAL_SCIENCE', group: 'Subject', label: 'Social understanding', description: 'Understands people, places, history and society.' },
];
const KEYS = FRAMEWORK.map((c) => c.key);
export const LEVEL_LABEL = { DEVELOPING: 'Developing', PROFICIENT: 'Proficient', ADVANCED: 'Advanced' };

const FAMILY_ROLES = ['PARENT', 'STUDENT'];
const isFamily = (actor) => FAMILY_ROLES.includes(actor?.roleKey);

// ── access ───────────────────────────────────────────────────────────────

async function familyStudentIds(actor) {
  if (actor.roleKey === 'PARENT') return (await getGuardianStudentIds(actor.profileId)).map(String);
  if (actor.roleKey === 'STUDENT') { const own = await getOwnStudentId(actor.profileId); return own ? [String(own)] : []; }
  return [];
}

async function taughtStudentIds(profileId) {
  const sections = await getTeacherSectionIds(profileId);
  if (!sections.length) return [];
  return (await Enrollment.find({ sectionId: { $in: sections }, status: 'ACTIVE' }).select('studentId').lean()).map((e) => String(e.studentId));
}

/** Refuses a student the caller may not see (404, so existence is not revealed). */
export async function assertVisible(actor, scope, studentId) {
  requireProfile(actor);
  const id = assertObjectId(studentId, 'studentId');
  if (isFamily(actor)) {
    if (!(await familyStudentIds(actor)).includes(id)) throw new AppError('Portfolio not found', 404);
    return id;
  }
  if (scope === 'ALL') return id;
  if (!(await taughtStudentIds(actor.profileId)).includes(id)) throw new AppError('Portfolio not found', 404);
  return id;
}

async function assertCanManage(actor, scope, studentId) {
  if (isFamily(actor)) throw new AppError('Missing permission', 403);
  return assertVisible(actor, scope, studentId);
}

/** Students in the caller's reach, for the picker. */
export async function students(actor, scope, query = {}) {
  requireProfile(actor);
  let ids;
  if (isFamily(actor)) ids = await familyStudentIds(actor);
  else if (scope === 'ALL') {
    const filter = { status: 'ACTIVE', ...(query.sectionId ? { sectionId: assertObjectId(query.sectionId, 'sectionId') } : {}) };
    ids = (await Enrollment.find(filter).select('studentId').limit(query.sectionId ? 500 : 200).lean()).map((e) => String(e.studentId));
  } else ids = await taughtStudentIds(actor.profileId);
  // Independent reads: run together rather than one after the other.
  const [rows, enr] = await Promise.all([
    Student.find({ _id: { $in: ids }, deletedAt: null }).select('firstName lastName admissionNo').lean(),
    Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).select('studentId sectionId').lean(),
  ]);
  const cls = new Map(enr.map((e) => [String(e.studentId), classLabel(e.sectionId)]));
  const q = String(query.search ?? '').toLowerCase();
  return rows.map((s) => ({ studentId: String(s._id), name: studentLabel(s), admissionNo: s.admissionNo, className: cls.get(String(s._id)) ?? null }))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.admissionNo ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? '') || a.name.localeCompare(b.name));
}

// ── evidence pulled from existing records ────────────────────────────────

const SUBJECT_MAP = [
  [/english|hindi|marathi|sanskrit|language|french|tamil|telugu|kannada|bengali|urdu/i, 'LANGUAGE'],
  [/math/i, 'MATHEMATICAL'],
  [/science|physics|chemistry|biology|evs/i, 'SCIENTIFIC'],
  [/social|history|geography|civics|economics|political/i, 'SOCIAL_SCIENCE'],
  [/computer|informatics|ict|coding|ai\b/i, 'DIGITAL'],
  [/art|music|dance|drama/i, 'CREATIVITY'],
];
const subjectCompetency = (name) => SUBJECT_MAP.find(([re]) => re.test(name ?? ''))?.[1] ?? 'CRITICAL_THINKING';
const CATEGORY_MAP = { SPORTS: 'COLLABORATION', ARTS: 'CREATIVITY', ACADEMIC: 'CRITICAL_THINKING', OLYMPIAD: 'CRITICAL_THINKING', SERVICE: 'LIFE_SKILLS', OTHER: 'LIFE_SKILLS' };
const COCURRICULAR_MAP = { SPORTS: 'COLLABORATION', ARTS: 'CREATIVITY', MUSIC: 'CREATIVITY', DANCE: 'CREATIVITY', DRAMA: 'COMMUNICATION', LITERARY: 'COMMUNICATION', SCIENCE: 'SCIENTIFIC', SOCIAL_SERVICE: 'LIFE_SKILLS', LEADERSHIP: 'COLLABORATION', CLUB: 'COLLABORATION', OTHER: 'LIFE_SKILLS' };
const COSCHOLASTIC_MAP = { WORK_EDUCATION: 'LIFE_SKILLS', ART_EDUCATION: 'CREATIVITY', HEALTH_PE: 'LIFE_SKILLS' };

/**
 * Every settled record about the student that counts as evidence, tagged
 * with the competency it speaks to and a link to where it lives.
 */
export async function recordEvidence(studentId) {
  const out = [];
  const add = (competencyKey, e) => out.push({ competencyKey, auto: true, ...e });
  const enrollments = await Enrollment.find({ studentId }).select('_id sectionId').lean();
  const enrIds = enrollments.map((e) => e._id);

  // Assignments: graded or submitted work.
  const subs = await Submission.find({ enrollmentId: { $in: enrIds }, status: { $in: ['GRADED', 'SUBMITTED', 'LATE'] } }).sort({ submittedAt: -1 }).limit(60).lean();
  const assignments = new Map((await Assignment.find({ _id: { $in: subs.map((x) => x.assignmentId) }, deletedAt: null }).select('title type maxMarks subjectOfferingId').lean()).map((a) => [String(a._id), a]));
  const offerings = new Map((await SubjectOffering.find({ _id: { $in: [...assignments.values()].map((a) => a.subjectOfferingId) } }).populate('subjectId', 'name').select('subjectId').lean()).map((o) => [String(o._id), o.subjectId?.name ?? null]));
  for (const sub of subs) {
    const a = assignments.get(String(sub.assignmentId));
    if (!a) continue;
    const subject = offerings.get(String(a.subjectOfferingId));
    const key = a.type === 'LAB' ? 'SCIENTIFIC' : a.type === 'PROJECT' ? (subject ? subjectCompetency(subject) : 'CREATIVITY') : subjectCompetency(subject);
    add(key, { kind: 'ASSIGNMENT', sourceId: String(a._id), title: `${a.title}${subject ? ` (${subject})` : ''}`, detail: sub.status === 'GRADED' && sub.marks != null ? `Marked ${sub.marks}${a.maxMarks ? `/${a.maxMarks}` : ''}${sub.feedback ? ` · "${String(sub.feedback).slice(0, 120)}"` : ''}` : 'Submitted', on: sub.submittedAt ?? sub.updatedAt, link: '/assignments' });
  }

  // Report-card co-scholastic grades (published cards only).
  const cards = await TermReportCard.find({ studentId, status: 'PUBLISHED' }).select('templateId termKey coScholastic publishedAt').lean();
  const templates = new Map((await ReportCardTemplate.find({ _id: { $in: cards.map((c) => c.templateId) } }).select('coScholasticAreas terms').lean()).map((t) => [String(t._id), t]));
  for (const c of cards) {
    const t = templates.get(String(c.templateId));
    const term = t?.terms?.find((x) => x.key === c.termKey)?.name ?? c.termKey;
    for (const [area, grade] of Object.entries(c.coScholastic ?? {})) {
      if (!grade) continue;
      const label = t?.coScholasticAreas?.find((a) => a.key === area)?.label ?? area;
      add(COSCHOLASTIC_MAP[area] ?? 'LIFE_SKILLS', { kind: 'REPORT_CARD', sourceId: String(c._id), title: `${label} (report card, ${term})`, detail: `Grade ${grade}`, on: c.publishedAt, link: '/report-cards' });
    }
  }

  // Clubs and teams, fixtures with approved results and awards.
  const memberships = await ClubMembership.find({ studentId, status: { $in: ['ACTIVE', 'LEFT'] }, joinedAt: { $ne: null } }).lean();
  const clubs = new Map((await Club.find({ _id: { $in: memberships.map((m) => m.clubId) } }).select('name category').lean()).map((c) => [String(c._id), c]));
  for (const m of memberships) {
    const c = clubs.get(String(m.clubId));
    if (!c) continue;
    add(CATEGORY_MAP[c.category] ?? 'COLLABORATION', { kind: 'CLUB', sourceId: String(c._id), title: `${c.name}${m.role && m.role !== 'MEMBER' ? ` (${String(m.role).toLowerCase()})` : ''}`, detail: m.status === 'ACTIVE' ? 'Current member' : 'Former member', on: m.joinedAt, link: '/clubs' });
  }
  const fixtures = await Fixture.find({ 'participants.studentId': studentId, status: 'COMPLETED', 'result.status': 'APPROVED' }).sort({ startsAt: -1 }).limit(40).lean();
  for (const f of fixtures) {
    const awards = (f.result?.awards ?? []).filter((a) => String(a.studentId) === String(studentId)).map((a) => a.title);
    add(CATEGORY_MAP[f.category] ?? 'COLLABORATION', { kind: 'FIXTURE', sourceId: String(f._id), title: f.title, detail: [f.result?.outcome ? `Result: ${String(f.result.outcome).toLowerCase()}` : null, awards.length ? `Award: ${awards.join(', ')}` : null].filter(Boolean).join(' · ') || 'Took part', on: f.startsAt, link: '/clubs' });
  }

  // Published showcase entries.
  const published = new Set((await ShowcaseEdition.find({ status: 'PUBLISHED' }).select('_id').lean()).map((e) => String(e._id)));
  const entries = (await ShowcaseEntry.find({ studentId, status: 'PUBLISHED' }).lean()).filter((e) => published.has(String(e.editionId)));
  for (const e of entries) add(CATEGORY_MAP[e.category] ?? 'LIFE_SKILLS', { kind: 'SHOWCASE', sourceId: String(e._id), title: e.title, detail: 'Published on the school showcase', on: e.publishedAt, link: '/showcase' });

  // Lab practicals the student attended.
  const sessions = await PracticalSession.find({ status: 'COMPLETED', attendance: { $elemMatch: { studentId, present: true } } }).sort({ startsAt: -1 }).limit(40).select('title subject labId startsAt').lean();
  const labs = new Map((await Lab.find({ _id: { $in: sessions.map((x) => x.labId) } }).select('type name').lean()).map((l) => [String(l._id), l]));
  for (const ps of sessions) {
    const lab = labs.get(String(ps.labId));
    add(lab?.type === 'COMPUTER' ? 'DIGITAL' : 'SCIENTIFIC', { kind: 'LAB_PRACTICAL', sourceId: String(ps._id), title: `${ps.title}${ps.subject ? ` (${ps.subject})` : ''}`, detail: `Practical in ${lab?.name ?? 'the lab'}`, on: ps.startsAt, link: '/labs' });
  }

  // Verified eco activities of the student's class team (class-level evidence).
  const sectionIds = enrollments.map((e) => e.sectionId).filter(Boolean);
  const teams = await EcoTeam.find({ kind: 'CLASS', sectionId: { $in: sectionIds } }).select('_id name').lean();
  const eco = await EcoActivity.find({ teamId: { $in: teams.map((t) => t._id) }, status: 'VERIFIED' }).sort({ date: -1 }).limit(20).lean();
  for (const a of eco) add('LIFE_SKILLS', { kind: 'ECO_ACTIVITY', sourceId: String(a._id), title: a.title, detail: `Verified class eco activity (${a.points} points to the class)`, on: a.date, link: '/eco-points' });

  // Approved co-curricular records.
  const co = await CoCurricularActivity.find({ studentId, status: 'APPROVED' }).sort({ activityDate: -1 }).limit(40).lean();
  for (const r of co) add(COCURRICULAR_MAP[r.category] ?? 'LIFE_SKILLS', { kind: 'CO_CURRICULAR', sourceId: String(r._id), title: r.name, detail: [r.achievement, r.level && r.level !== 'SCHOOL' ? String(r.level).toLowerCase().replace(/_/g, ' ') : null].filter(Boolean).join(' · ') || 'Approved record', on: r.activityDate, link: null });

  return out;
}

// ── the portfolio ────────────────────────────────────────────────────────

async function currentTerm() {
  const y = await AcademicYear.findOne({ isCurrent: true }).select('name').lean();
  return y?.name ?? String(new Date().getFullYear());
}

export async function portfolio(actor, scope, studentId) {
  const id = await assertVisible(actor, scope, studentId);
  const student = await Student.findById(id).select('firstName lastName admissionNo').lean();
  if (!student) throw new AppError('Portfolio not found', 404);
  const e = await activeEnrollment(id);
  const [auto, manual, ratings, reflections, term] = await Promise.all([
    recordEvidence(id),
    PortfolioEvidence.find({ studentId: id }).sort({ on: -1 }).lean(),
    PortfolioRating.find({ studentId: id }).sort({ ratedAt: -1 }).lean(),
    PortfolioReflection.find({ studentId: id }).sort({ createdAt: -1 }).limit(100).lean(),
    currentTerm(),
  ]);
  const competencies = FRAMEWORK.map((c) => {
    const evidence = [
      ...auto.filter((x) => x.competencyKey === c.key),
      ...manual.filter((x) => x.competencyKey === c.key).map((m) => ({ ...dto(m), kind: 'TEACHER', auto: false })),
    ].sort((a, b) => new Date(b.on ?? 0) - new Date(a.on ?? 0));
    const rs = ratings.filter((r) => r.competencyKey === c.key);
    return {
      ...c,
      rating: rs[0] ? { term: rs[0].term, level: rs[0].level, levelLabel: LEVEL_LABEL[rs[0].level], comment: rs[0].comment, ratedByName: rs[0].ratedByName, ratedAt: rs[0].ratedAt } : null,
      history: rs.map((r) => ({ term: r.term, level: r.level, levelLabel: LEVEL_LABEL[r.level], ratedAt: r.ratedAt })),
      evidence,
      reflections: reflections.filter((r) => r.competencyKey === c.key).map((r) => ({ id: String(r._id), text: r.text, at: r.createdAt })),
    };
  });
  return {
    student: { id, name: studentLabel(student), admissionNo: student.admissionNo, className: classLabel(e?.sectionId) },
    term,
    levels: RUBRIC_LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l] })),
    competencies,
    generalReflections: reflections.filter((r) => !r.competencyKey).map((r) => ({ id: String(r._id), text: r.text, at: r.createdAt })),
    counts: { evidence: auto.length + manual.length, fromRecords: auto.length, teacherAdded: manual.length, rated: competencies.filter((c) => c.rating).length, reflections: reflections.length },
    canManage: !isFamily(actor) && Boolean(actor.permissions?.['portfolios.manage']),
    canReflect: actor.roleKey === 'STUDENT' && Boolean(actor.permissions?.['portfolios.reflect']),
    note: 'Evidence is read from the school\'s own records (assignments, report cards, clubs and fixtures, showcase, lab practicals, eco activities, co-curricular records) plus evidence teachers add. Ratings use a three-level rubric; there are no scores and nothing about behaviour.',
  };
}

export async function addEvidence(actor, scope, studentId, body = {}) {
  const id = await assertCanManage(actor, scope, studentId);
  const competencyKey = oneOf(body.competencyKey, KEYS, 'competencyKey');
  const link = optionalText(body.link, { max: 500 }) || null;
  if (link && !/^https:\/\//i.test(link) && !link.startsWith('/')) throw new AppError('link must be an https:// address or a page in EduOS', 400);
  const doc = await PortfolioEvidence.create({
    studentId: id, competencyKey, title: requireText(body.title, 'title', { max: 200 }), description: optionalText(body.description, { max: 2000 }) || null,
    on: parseDate(body.on, 'on') ?? new Date(), link, attachments: cleanAttachments(body.attachments, actor), addedByProfileId: actor.profileId, addedByName: actor.displayName,
  });
  return dto(doc.toObject());
}

export async function removeEvidence(actor, scope, studentId, evidenceId) {
  const id = await assertCanManage(actor, scope, studentId);
  const doc = await PortfolioEvidence.findOne({ _id: assertObjectId(evidenceId, 'evidenceId'), studentId: id });
  if (!doc) throw new AppError('Evidence not found', 404);
  if (scope !== 'ALL' && String(doc.addedByProfileId) !== String(actor.profileId)) throw new AppError('Only the teacher who added it (or the principal) can remove it.', 403);
  await doc.deleteOne();
  return { removed: true };
}

export async function rate(actor, scope, studentId, body = {}) {
  const id = await assertCanManage(actor, scope, studentId);
  for (const k of ['score', 'marks', 'points', 'behaviour', 'behavior', 'behaviourScore']) {
    if (body[k] !== undefined) throw new AppError('Portfolios use the rubric only (developing, proficient, advanced): no scores and no behaviour ratings.', 422, [], 'RUBRIC_ONLY');
  }
  const competencyKey = oneOf(body.competencyKey, KEYS, 'competencyKey');
  const term = optionalText(body.term, { max: 40 }) || (await currentTerm());
  const level = oneOf(body.level, RUBRIC_LEVELS, 'level');
  const doc = await PortfolioRating.findOneAndUpdate(
    { studentId: id, competencyKey, term },
    { $set: { level, comment: optionalText(body.comment, { max: 1000 }) || null, ratedByProfileId: actor.profileId, ratedByName: actor.displayName, ratedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return { ...dto(doc), levelLabel: LEVEL_LABEL[doc.level] };
}

export async function reflect(actor, studentId, body = {}) {
  requireProfile(actor);
  if (actor.roleKey !== 'STUDENT') throw new AppError('Reflections are written by the student.', 403, [], 'STUDENT_ONLY');
  const own = await getOwnStudentId(actor.profileId);
  if (!own || String(own) !== String(assertObjectId(studentId, 'studentId'))) throw new AppError('Portfolio not found', 404);
  const competencyKey = body.competencyKey ? oneOf(body.competencyKey, KEYS, 'competencyKey') : null;
  const doc = await PortfolioReflection.create({ studentId: own, competencyKey, text: requireText(body.text, 'text', { max: 2000 }), byProfileId: actor.profileId });
  return { id: String(doc._id), text: doc.text, competencyKey, at: doc.createdAt };
}

export const framework = () => ({ competencies: FRAMEWORK, levels: RUBRIC_LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l] })) });
