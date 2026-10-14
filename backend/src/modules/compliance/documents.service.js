import { InstitutionProfile } from '../../models/institution.model.js';
import { RegulatoryReturn, Licence } from '../../models/compliance.model.js';
import { Correspondence } from '../../models/administration.model.js';
import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { Section, Grade } from '../../models/academics.model.js';
import { Profile } from '../../models/profile.model.js';
import { Facility } from '../../models/facility.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, pushHistory, requireProfile } from '../ops/common.js';

/**
 * Official documents, ready to print, sign, stamp and submit by hand.
 *
 * Why print: no board or department we could find offers schools an API to
 * file with. UDISE+ takes data through its own portal (with an Excel bulk
 * upload), CBSE's OASIS and the list of candidates go through CBSE's portal,
 * AISHE through its portal; APAAR and DigiLocker have APIs, but for issuing and
 * verifying a student's records, not for filing returns. See
 * docs/research/board-submission-channels.md. So EduOS prepares the document,
 * and a person files it and records the acknowledgement.
 *
 * Every document carries the institution's letterhead, a reference number, the
 * date, who it is for, the figures with where they came from, a declaration,
 * and blocks for the preparer, the verifier and the principal with the seal.
 * Until the return is approved for submission it prints with a DRAFT mark, and
 * every export is recorded on the return.
 */

const SUBMITTABLE = ['APPROVED_FOR_SUBMISSION', 'SUBMITTED', 'ACCEPTED', 'RESUBMISSION_REQUIRED', 'REJECTED'];
const fmtDate = (d) => (d ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(d)) : null);

export async function letterhead() {
  const p = await InstitutionProfile.findOne({}).lean();
  const campus = (p?.campuses ?? []).find((c) => c.active) ?? null;
  const address = campus ? [campus.addressLine, campus.city, campus.district ? `District ${campus.district}` : null, campus.state, campus.pincode].filter(Boolean).join(', ') : null;
  const codes = [
    ...(p?.affiliations ?? []).filter((a) => a.number && ['ACTIVE', 'PROVISIONAL'].includes(a.status)).map((a) => `${a.body} Affiliation No. ${a.number}`),
    ...(campus?.udiseCode ? [`UDISE+ Code ${campus.udiseCode}`] : []),
    ...(campus?.aisheCode ? [`AISHE Code ${campus.aisheCode}`] : []),
  ];
  const missing = [];
  if (!p?.legalName && !p?.displayName) missing.push('institution name');
  if (!address) missing.push('address');
  if (!codes.length) missing.push('affiliation number or UDISE+/AISHE code');
  return {
    name: p?.legalName || p?.displayName || 'Institution name not recorded',
    displayName: p?.displayName ?? null,
    managedBy: p?.legalEntity?.name ? `Managed by ${p.legalEntity.name}${p.legalEntity.registrationNo ? ` (Reg. No. ${p.legalEntity.registrationNo})` : ''}` : null,
    address, codes,
    contact: [p?.contact?.phone ? `Phone ${p.contact.phone}` : null, p?.contact?.email ? `Email ${p.contact.email}` : null, p?.website ?? null].filter(Boolean),
    // The document says what its letterhead is missing rather than printing a gap.
    missing,
  };
}

const table = (title, columns, rows, note = null) => ({ type: 'table', title, columns, rows, note });
const facts = (title, items) => ({ type: 'facts', title, items });

function returnSections(r) {
  const d = r.data ?? {};
  const out = [];
  if (Array.isArray(d.enrolment)) {
    out.push(table('Enrolment by class and gender', [
      { key: 'grade', label: 'Class' }, { key: 'boys', label: 'Boys', num: true }, { key: 'girls', label: 'Girls', num: true },
      { key: 'other', label: 'Other', num: true }, { key: 'unknown', label: 'Not recorded', num: true }, { key: 'total', label: 'Total', num: true },
    ], [...d.enrolment.map(({ level: _l, ...row }) => row), { grade: 'Total', ...['boys', 'girls', 'other', 'unknown', 'total'].reduce((acc, k) => ({ ...acc, [k]: d.enrolment.reduce((n, row) => n + (row[k] ?? 0), 0) }), {}), isTotal: true }]));
    out.push(facts('Staff and infrastructure', [
      ['Teaching staff (including the principal)', d.teachingStaff], ['Non-teaching staff', d.nonTeachingStaff],
      ['Classrooms', d.classrooms], ['Laboratories', d.laboratories],
    ]));
  }
  if (Array.isArray(d.sections)) {
    out.push(table(`Whole-day attendance, ${d.period}`, [
      { key: 'section', label: 'Class' }, { key: 'workingDaysMarked', label: 'Days marked', num: true }, { key: 'present', label: 'Present', num: true },
      { key: 'absent', label: 'Absent', num: true }, { key: 'attendancePct', label: 'Attendance %', num: true },
    ], d.sections));
  }
  if (d.byRole) {
    out.push(table('Staff strength by role', [{ key: 'role', label: 'Role' }, { key: 'count', label: 'Number', num: true }],
      [...Object.entries(d.byRole).map(([role, count]) => ({ role: role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' '), count })), { role: 'Total', count: d.total, isTotal: true }]));
  }
  if (Array.isArray(d.candidates)) {
    out.push(table(`List of candidates, ${d.className}`, [
      { key: 'sno', label: 'S. No.', num: true }, { key: 'admissionNo', label: 'Admission No.' }, { key: 'name', label: 'Candidate name' },
      { key: 'gender', label: 'Gender' }, { key: 'dob', label: 'Date of birth' }, { key: 'father', label: "Father's name" },
      { key: 'mother', label: "Mother's name" }, { key: 'section', label: 'Section' },
    ], d.candidates, 'Check every entry against the admission register before signing. Board portals usually allow no correction after submission.'));
  }
  if (d.disclosure) {
    for (const block of d.disclosure) out.push(facts(block.title, block.items));
  }
  if (d.figures && !out.length) {
    out.push(facts('Figures', Object.entries(d.figures).map(([k, v]) => [k, v])));
  }
  return out;
}

/** A regulatory return as a printable document. Records that it was exported. */
export async function returnDocument(actor, id) {
  requireProfile(actor);
  const r = await RegulatoryReturn.findById(assertObjectId(id));
  if (!r) throw new AppError('Return not found', 404);
  const head = await letterhead();
  const errors = (r.validation ?? []).filter((v) => v.level === 'ERROR');
  const warnings = (r.validation ?? []).filter((v) => v.level === 'WARNING');
  const final = SUBMITTABLE.includes(r.status);
  pushHistory(r, actor, 'EXPORTED', { note: final ? 'Printable document' : 'Printable draft' });
  await r.save();
  return {
    kind: 'RETURN',
    letterhead: head,
    refNo: r.refNo,
    date: fmtDate(new Date()),
    to: r.authority,
    subject: r.title,
    period: r.period,
    opening: `Please find below the ${r.title.toLowerCase()} of ${head.name} for the period ${r.period}, prepared from the institution's records.`,
    sections: returnSections(r),
    sources: Object.values(r.data?.sources ?? {}),
    generatedAt: fmtDate(r.generatedAt),
    findings: { errors: errors.map((e) => e.message), warnings: warnings.map((w) => w.message) },
    declaration: `I certify that the information given above is true and correct to the best of my knowledge and is based on the records maintained by ${head.name}.`,
    signatories: [
      { role: 'Prepared by', name: null },
      { role: 'Verified by', name: null },
      { role: 'Principal', name: null, seal: true },
    ],
    // A document that has not been approved, or that still has errors, says so on every page.
    watermark: !final ? 'DRAFT — NOT APPROVED FOR SUBMISSION' : errors.length ? 'CONTAINS UNRESOLVED ERRORS' : null,
    status: r.status,
    filingNote: 'EduOS does not submit this document. File it through the authority\'s portal or office, then record the acknowledgement number in the Compliance Centre.',
  };
}

/** An outgoing letter or reply, on letterhead, for signature. */
export async function correspondenceDocument(actor, scope, id) {
  requireProfile(actor);
  const doc = await Correspondence.findById(assertObjectId(id));
  if (!doc) throw new AppError('Correspondence not found', 404);
  if (scope !== 'ALL' && ![String(doc.ownerProfileId), ...doc.assigneeProfileIds.map(String)].includes(String(actor.profileId))) throw new AppError('Correspondence not found', 404);
  const latest = [...(doc.drafts ?? [])].sort((a, b) => b.version - a.version)[0];
  if (!latest?.body?.trim()) throw new AppError('Write the letter first: there is no draft to print.', 409, [], 'NO_DRAFT');
  const head = await letterhead();
  const approved = ['APPROVED', 'DISPATCHED', 'CLOSED'].includes(doc.status);
  pushHistory(doc, actor, 'EXPORTED', { note: `Printable letter, draft v${latest.version}` });
  await doc.save();
  return {
    kind: 'LETTER',
    letterhead: head,
    refNo: doc.refNo,
    date: fmtDate(new Date()),
    to: doc.counterpartyName,
    subject: doc.direction === 'INWARD' ? `Reply: ${doc.subject}` : doc.subject,
    theirReference: doc.theirReference ?? null,
    body: latest.body,
    signatories: [{ role: 'Principal', name: null, seal: true }],
    watermark: approved ? null : 'DRAFT — NOT APPROVED FOR DISPATCH',
    confidential: doc.confidentiality !== 'NORMAL',
    filingNote: 'Sign and stamp, then send. Record how it was sent and attach the acknowledgement in Correspondence.',
  };
}

// ── Templates that read student records ─────────────────────────────────

/**
 * The list of candidates for a board class: every active student of that
 * class with the details boards ask for. Personal data, so it is built only
 * by people who manage compliance, and printed from the return like any other.
 */
export async function candidateListData(className) {
  const grade = await Grade.findOne({ name: className }).lean();
  if (!grade) throw new AppError(`No class called "${className}". Use the class name exactly as in Academics, e.g. "Class 10".`, 404, [], 'NO_SUCH_CLASS');
  const sections = await Section.find({ gradeId: grade._id }).lean();
  const sectionName = new Map(sections.map((s) => [String(s._id), s.name]));
  const enrolments = await Enrollment.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' }).lean();
  const students = await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) }, deletedAt: null }).lean();
  const links = await StudentGuardian.find({ studentId: { $in: students.map((s) => s._id) } }).lean();
  const guardians = await Profile.find({ _id: { $in: links.map((l) => l.guardianProfileId) } }).select('displayName').lean();
  const nameOf = new Map(guardians.map((g) => [String(g._id), g.displayName]));
  const parent = (studentId, relation) => {
    const link = links.find((l) => String(l.studentId) === String(studentId) && l.relation === relation);
    return link ? nameOf.get(String(link.guardianProfileId)) ?? null : null;
  };
  const sectionOf = new Map(enrolments.map((e) => [String(e.studentId), sectionName.get(String(e.sectionId)) ?? '']));
  const validation = [];
  const rows = students
    .map((s) => ({
      admissionNo: s.admissionNo, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), gender: s.gender ?? null,
      dob: s.dob ? new Date(s.dob).toISOString().slice(0, 10) : null, father: parent(s._id, 'FATHER'), mother: parent(s._id, 'MOTHER'), section: sectionOf.get(String(s._id)) ?? '',
    }))
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
    .map((row, i) => ({ sno: i + 1, ...row }));
  const missing = (field, label) => {
    const n = rows.filter((row) => !row[field]).length;
    if (n) validation.push({ level: 'ERROR', field, message: `${n} candidate(s) have no ${label}.` });
  };
  missing('dob', 'date of birth'); missing('gender', 'gender'); missing('father', "father's name recorded"); missing('mother', "mother's name recorded");
  if (!rows.length) validation.push({ level: 'ERROR', field: 'candidates', message: `No active students in ${className}.` });
  return { data: { className, candidates: rows, total: rows.length, sources: { candidates: 'Active enrolments, student records and guardian links' } }, validation };
}

/**
 * The figures a school publishes as its mandatory public disclosure (CBSE
 * asks for one on the school's website), from the institution profile, staff,
 * facilities and licences. The board's own format lists more than EduOS
 * holds; what is missing is listed, not invented.
 */
export async function disclosureData() {
  const p = await InstitutionProfile.findOne({}).lean();
  const campus = (p?.campuses ?? []).find((c) => c.active);
  const validation = [];
  const affiliation = (p?.affiliations ?? []).find((a) => a.kind === 'BOARD');
  const licences = await Licence.find({ publicDisclosure: true }).select('title number issuer expiresOn').lean();
  const [classrooms, labs, library, grounds] = await Promise.all([
    Facility.countDocuments({ kind: { $in: ['CLASSROOM', 'LECTURE_HALL'] }, sampleLayout: { $ne: true } }),
    Facility.countDocuments({ kind: 'LAB', sampleLayout: { $ne: true } }),
    Facility.countDocuments({ kind: 'LIBRARY', sampleLayout: { $ne: true } }),
    Facility.countDocuments({ kind: { $in: ['GROUND', 'COURT'] }, sampleLayout: { $ne: true } }),
  ]);
  if (!affiliation?.number) validation.push({ level: 'ERROR', field: 'affiliation', message: 'No board affiliation number in the Institution profile.' });
  if (!campus?.udiseCode) validation.push({ level: 'WARNING', field: 'udiseCode', message: 'No UDISE+ code in the Institution profile.' });
  if (!classrooms) validation.push({ level: 'WARNING', field: 'infrastructure', message: 'No real classrooms recorded (sample-campus rooms are not counted).' });
  if (!licences.length) validation.push({ level: 'WARNING', field: 'documents', message: 'No licences or certificates are marked for public disclosure in the Compliance Centre.' });
  validation.push({ level: 'WARNING', field: 'scope', message: 'Results, fee structure and staff qualification details are not filled from EduOS. Add them before publishing.' });
  return {
    data: {
      disclosure: [
        { title: 'A. General information', items: [
          ['Name of the school', p?.legalName ?? p?.displayName ?? null], ['Affiliation number', affiliation?.number ?? null], ['Affiliating body', affiliation?.body ?? null],
          ['UDISE+ code', campus?.udiseCode ?? null], ['Address', campus ? [campus.addressLine, campus.city, campus.state, campus.pincode].filter(Boolean).join(', ') : null],
          ['Phone', p?.contact?.phone ?? null], ['Email', p?.contact?.email ?? null], ['Managed by', p?.legalEntity?.name ?? null],
        ] },
        { title: 'B. Documents and certificates', items: licences.map((l) => [l.title, [l.number, l.issuer, l.expiresOn ? `valid till ${new Date(l.expiresOn).toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · ')]) },
        { title: 'C. Infrastructure', items: [['Classrooms', classrooms], ['Laboratories', labs], ['Library', library ? 'Yes' : 'Not recorded'], ['Playground / courts', grounds]] },
      ],
      sources: { disclosure: 'Institution profile, Compliance Centre licences marked for disclosure, Facilities register (sample layout excluded)' },
    },
    validation,
  };
}
