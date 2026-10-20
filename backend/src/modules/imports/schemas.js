import { Student, Enrollment } from '../../models/student.model.js';
import { Grade, Section, Subject, AcademicYear } from '../../models/academics.model.js';
import { Invoice } from '../../models/fee.model.js';
import { Lead } from '../../models/lead.model.js';
import { HostelRoom, ROOM_TYPES, ROOM_CAPACITY_MIN, ROOM_CAPACITY_MAX } from '../../models/hostel.model.js';
import { Book } from '../../models/library.model.js';
import { TransportRoute, TransportStop } from '../../models/transport.model.js';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { Mark } from '../../models/exam.model.js';
import { bulkCreateUsers } from '../users/user.service.js';
import { bulkCreateGrades, bulkCreateSections, bulkCreateSubjects } from '../academics/academics.service.js';
import { bulkEnroll } from '../students/student.service.js';
import { bulkCreateInvoices } from '../fees/fee.service.js';
import { bulkCreateLeads } from '../admissions/admission.service.js';
import { bulkCreateRooms, bulkAllocate } from '../hostel/hostel.service.js';
import { bulkCreateBooks, bulkIssueBooks } from '../library/library.service.js';
import { bulkCreateRoutes, bulkCreateStops, bulkEnrollStudents } from '../transport/transport.service.js';
import { markAttendanceBulk } from '../attendance/attendance.service.js';
import { enterMarks, listExamSubjects } from '../exams/exam.service.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { classKey } from '../../utils/classNames.js';
import { tenantFilter } from '../../tenancy/tenantContext.js';
import {
  parsePhone, parseDate, parseAmount, parseInteger, parseEnum, splitClassCell, normaliseHeader, editDistance,
} from './mapping.js';

/**
 * The bulk-import registry: every spreadsheet import the app has, described
 * once, so Ask AI can recognise a sheet, map its columns, check every row and
 * import it -- through the SAME service the screen's CSV upload calls.
 *
 * Each schema declares:
 *   key / label / noun     what it is ("students", "New students", "student")
 *   module, link           where the records live (portal-relative page)
 *   permission, minScope   the route's own requirePermission; the import is
 *                          refused to anyone the route would refuse, and the
 *                          service applies its own OWN-scope checks on top
 *                          (a teacher's attendance and marks: their classes only)
 *   route                  the screen's bulk route this mirrors (for the coverage map)
 *   said                   what a person says about this kind of sheet
 *   columns                key, label, required, type, aliases (synonyms, Hindi,
 *                          the spellings schools use), accepted values, example
 *   context                values that may come from the request instead of a
 *                          column ("Class 6 A", "today", "Unit Test 1")
 *   lookups(ctx, rows, context)   reference data, fetched once per file
 *   check(row, refs, context, ctx) → { values, problems[], skip? }
 *   dupKey(values)         two rows that are the same record (flagged)
 *   write(ctx, rows, context, refs) the module's own bulk service, chunked
 *
 * The preview checks mirror the module's own rules so problems are found
 * before anything is written; the service still validates every row when it
 * writes, so the two can never disagree about what is saved.
 */

const CHUNK = 200;

const text = (v) => String(v ?? '').trim();
const problem = (field, issue, suggestion = null, value = undefined) => ({ field, problem: issue, suggestion, ...(value !== undefined && value !== '' && { value }) });

/**
 * Runs a module's `bulkCreateX(rows)` over the valid rows in chunks, mapping
 * each row error the service reports (header = row 1, so row = index + 2)
 * back to the spreadsheet row it came from.
 */
async function viaBulk(fn, valid, toServiceRow) {
  const out = { imported: 0, failed: 0, errors: [], failedRows: new Set() };
  for (let i = 0; i < valid.length; i += CHUNK) {
    const part = valid.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop -- chunks run in order (roll numbers, sequences)
    const res = await fn(part.map((r) => toServiceRow(r.values)));
    out.imported += res?.imported ?? 0;
    out.failed += res?.failed ?? 0;
    for (const e of res?.errors ?? []) {
      const idx = (Number(e.row) || 2) - 2;
      const rowNo = part[idx]?.rowNo ?? null;
      if (rowNo) out.failedRows.add(rowNo);
      out.errors.push({ row: rowNo, field: e.field ?? null, problem: e.problem ?? e.error ?? 'could not be saved', suggestion: e.suggestion ?? null });
    }
  }
  return out;
}

/* ── Shared reference data ───────────────────────────────────────────── */

/** Every section with its label and key ("Class 6 A" / "6 a"). */
async function sectionIndex() {
  const sections = await Section.find().populate('gradeId', 'name').lean();
  return sections.map((s) => {
    const label = `${s.gradeId?.name ?? ''} ${s.name ?? ''}`.trim();
    return { id: String(s._id), label, key: classKey(label), gradeName: s.gradeId?.name ?? '', name: s.name };
  });
}

/** The section a class reference names, or a problem. */
function findSection(sections, ref, allowed = null) {
  const key = classKey(ref);
  if (!key) return { error: problem('class', 'is required', 'the class and section, e.g. "Class 6 A"') };
  const hits = sections.filter((s) => s.key === key);
  if (!hits.length) {
    const near = sections.filter((s) => s.key.split(' ')[0] === key.split(' ')[0]).map((s) => s.label).slice(0, 6);
    return { error: problem('class', 'does not match any class in this school', near.length ? `did you mean ${near.join(' or ')}?` : 'check the class name, or create the class first', text(ref)) };
  }
  const hit = hits[0];
  if (allowed && !allowed.has(hit.id)) return { error: problem('class', `${hit.label} is not one of your classes`, 'you can import only for the classes you teach', text(ref)) };
  return { section: hit };
}

/** Students by admission number (case-insensitive), and — for rows that only give a name — by name. */
async function studentIndex(rows, { needNames = false } = {}) {
  const nos = [...new Set(rows.map((r) => text(r.admissionNo)).filter(Boolean))];
  const byNo = new Map();
  if (nos.length) {
    const found = await Student.find({ admissionNo: { $in: nos.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }, deletedAt: null })
      .select('_id admissionNo firstName lastName').lean();
    for (const s of found) byNo.set(s.admissionNo.toLowerCase(), s);
  }
  let byName = null;
  if (needNames && rows.some((r) => !text(r.admissionNo) && text(r.studentName))) {
    const all = await Student.find({ deletedAt: null }).select('_id admissionNo firstName lastName').limit(20000).lean();
    byName = new Map();
    for (const s of all) {
      const key = normaliseHeader(`${s.firstName ?? ''}${s.lastName ?? ''}`);
      byName.set(key, [...(byName.get(key) ?? []), s]);
    }
  }
  return { byNo, byName };
}

/** The student a row names: by admission number, else by a unique full name. */
function findStudent(index, row, field = 'admissionNo') {
  const no = text(row.admissionNo);
  if (no) {
    const s = index.byNo.get(no.toLowerCase());
    return s ? { student: s } : { error: problem(field, 'does not match any student in this school', 'check the admission number, or import the student first', no) };
  }
  const name = text(row.studentName);
  if (name && index.byName) {
    const hits = index.byName.get(normaliseHeader(name)) ?? [];
    if (hits.length === 1) return { student: hits[0] };
    if (hits.length > 1) return { error: problem('studentName', `matches ${hits.length} students`, 'add the admission number for this row', name) };
    return { error: problem('studentName', 'does not match any student in this school', 'add the admission number, or check the spelling', name) };
  }
  return { error: problem(field, 'is required', 'the student\'s admission number') };
}

const STUDENT_REF_ALIASES = ['admission no', 'admission number', 'adm no', 'admn no', 'adm', 'admission id', 'sr no', 's r no', 'scholar no', 'scholar number', 'registration no', 'reg no', 'student id', 'enrolment no', 'enrollment no', 'gr no', 'प्रवेश संख्या', 'प्रवेश क्रमांक', 'दाखिला संख्या', 'pravesh sankhya'];
const STUDENT_NAME_ALIASES = ['student name', 'name of student', 'name', 'student', 'full name', 'pupil', 'naam', 'छात्र का नाम', 'विद्यार्थी का नाम', 'नाम', 'chhatra ka naam'];
const CLASS_ALIASES = ['class', 'class section', 'class & section', 'grade section', 'class name', 'std', 'standard', 'कक्षा', 'kaksha'];
const PHONE_ALIASES = ['phone', 'mobile', 'mob', 'mob no', 'mobile no', 'mobile number', 'ph no', 'phone no', 'contact mob', 'phone number', 'contact', 'contact no', 'contact number', 'whatsapp', 'whatsapp no', 'cell', 'मोबाइल', 'मोबाइल नंबर', 'फ़ोन', 'फोन', 'संपर्क'];
const DATE_ALIASES = ['date', 'तारीख', 'दिनांक', 'tarikh'];

/* ── The schemas ─────────────────────────────────────────────────────── */

const ROLE_WORDS = {
  TEACHER: ['teacher', 'teachers', 'faculty', 'teaching staff', 'subject teacher', 'class teacher', 'pgt', 'tgt', 'prt', 'शिक्षक', 'अध्यापक', 'shikshak'],
  ADMIN: ['admin', 'administrator', 'office admin', 'school admin'],
  PRINCIPAL: ['principal', 'headmaster', 'head master', 'headmistress', 'vice principal', 'प्रधानाचार्य'],
  FINANCE: ['finance', 'accountant', 'accounts', 'cashier', 'fee clerk', 'लेखाकार'],
  LIBRARIAN: ['librarian', 'library', 'पुस्तकालयाध्यक्ष'],
  WARDEN: ['warden', 'hostel warden'],
  HR: ['hr', 'human resources'],
  MARKETING: ['marketing', 'admissions counsellor', 'counsellor', 'counselor'],
  COMPLIANCE: ['compliance'],
  NURSE: ['nurse', 'school nurse', 'health'],
  TRUSTEE: ['trustee'],
};

const LEAD_SOURCE = { WALK_IN: ['walk in', 'walkin', 'walk-in', 'visit', 'campus visit', 'direct'], WEB: ['web', 'website', 'online', 'internet', 'google', 'form'], WHATSAPP: ['whatsapp', 'wa', 'whats app'], REFERRAL: ['referral', 'referred', 'reference', 'word of mouth', 'parent referral'] };
const LEAD_STAGE = { NEW: ['new', 'fresh', 'open'], CONTACTED: ['contacted', 'called', 'follow up', 'followup'], TOUR_SCHEDULED: ['tour', 'tour scheduled', 'visit scheduled', 'campus tour'], APPLICATION: ['application', 'applied', 'form filled'], ENROLLED: ['enrolled', 'admitted', 'joined', 'converted'], LOST: ['lost', 'dropped', 'not interested', 'closed'] };
const ROOM_TYPE = { BOYS: ['boys', 'boy', 'male', 'm'], GIRLS: ['girls', 'girl', 'female', 'f'], STAFF: ['staff', 'teachers'], GENERAL: ['general', 'common', 'mixed', ''] };
const DIRECTION = { BOTH: ['both', 'two way', 'pickup and drop', 'pick up and drop', 'both ways', 'up down'], PICKUP: ['pickup', 'pick up', 'morning', 'to school'], DROP: ['drop', 'evening', 'from school', 'return'] };
const ATTENDANCE = {
  PRESENT: ['p', 'present', 'pr', 'yes', 'y', '1', 'उपस्थित', 'हाजिर', 'हाज़िर', 'hazir', 'upasthit'],
  ABSENT: ['a', 'absent', 'ab', 'no', 'n', '0', 'अनुपस्थित', 'गैरहाजिर', 'gairhazir', 'anupasthit'],
  LATE: ['l', 'late', 'lt', 'देर', 'der'],
  EXCUSED: ['e', 'ex', 'excused', 'leave', 'on leave', 'lv', 'od', 'on duty', 'छुट्टी', 'chutti'],
  HALF_DAY: ['h', 'hd', 'half', 'half day', 'halfday', 'आधा दिन'],
};

function dupKeyOf(...parts) {
  return parts.map((p) => normaliseHeader(p)).join('|');
}

export const IMPORT_SCHEMAS = [
  /* ── People ── */
  {
    key: 'students',
    label: 'New students',
    noun: 'student',
    module: 'Users',
    link: '/users',
    permission: 'users.manage',
    route: 'POST /users/bulk',
    said: [/\b(?:new\s+)?(?:students?|pupils?|admissions?\s+list|admitted|kids|children)\b(?!.*\b(?:marks?|attendance|fees?|invoices?|hostel|bus|transport|library|books?)\b)/i, /छात्र|विद्यार्थी/],
    columns: [
      { key: 'displayName', label: 'Student name', required: true, type: 'text', aliases: [...STUDENT_NAME_ALIASES, 'student full name'], example: 'Aarav Sharma', note: 'First and last name, as on the admission form.' },
      { key: 'phone', label: 'Phone', required: true, type: 'phone', aliases: [...PHONE_ALIASES, 'parent phone', 'parent mobile', 'father mobile', 'mother mobile', 'guardian phone', 'student phone'], example: '+919876543210', note: 'The number the student (or family) signs in with. 10-digit Indian numbers are accepted; +91 is added. Each student needs a different number.' },
      { key: 'admissionNo', label: 'Admission No', type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', note: 'Left blank, one is generated.' },
      { key: 'gradeName', label: 'Class', type: 'text', aliases: [...CLASS_ALIASES, 'grade', 'class name', 'admitted to class'], example: 'Class 6', note: 'The class, e.g. "Class 6" (or "Class 6 A" with no Section column).' },
      { key: 'sectionName', label: 'Section', type: 'text', aliases: ['section', 'sec', 'div', 'division', 'वर्ग', 'सेक्शन', 'खंड'], example: 'A' },
      { key: 'email', label: 'Email', type: 'email', aliases: ['email', 'email id', 'e-mail', 'mail', 'ईमेल'], example: '' },
    ],
    async lookups(ctx, rows) {
      const sections = await sectionIndex();
      const phones = [...new Set(rows.map((r) => parsePhone(r.phone)).filter(Boolean))];
      const nos = [...new Set(rows.map((r) => text(r.admissionNo)).filter(Boolean))];
      const studentRole = await Role.findOne({ key: 'STUDENT' }).select('_id').lean();
      const accounts = phones.length ? await Account.find({ phoneE164: { $in: phones } }).select('_id phoneE164').lean() : [];
      const withStudent = accounts.length && studentRole
        ? await Profile.find({ accountId: { $in: accounts.map((a) => a._id) }, roleId: studentRole._id, deletedAt: null }).select('accountId').lean()
        : [];
      const takenAccounts = new Set(withStudent.map((p) => String(p.accountId)));
      const takenPhones = new Set(accounts.filter((a) => takenAccounts.has(String(a._id))).map((a) => a.phoneE164));
      const takenNos = new Set(nos.length ? (await Student.find({ admissionNo: { $in: nos } }).select('admissionNo').lean()).map((s) => s.admissionNo.toLowerCase()) : []);
      return { sections, takenPhones, takenNos };
    },
    check(row, refs) {
      const problems = [];
      const name = text(row.displayName);
      if (!name) problems.push(problem('displayName', 'is required', 'the student\'s full name'));
      else if (name.length < 2 || name.length > 120) problems.push(problem('displayName', 'must be 2 to 120 characters', null, name));
      const phone = parsePhone(row.phone);
      if (!text(row.phone)) problems.push(problem('phone', 'is required', 'a 10-digit mobile number, e.g. 9876543210'));
      else if (!phone) problems.push(problem('phone', 'is not a valid phone number', 'use a 10-digit mobile number or +91XXXXXXXXXX', text(row.phone)));
      else if (refs.takenPhones.has(phone)) problems.push(problem('phone', 'already belongs to a student account', 'each student needs their own sign-in number; use a different one', phone));
      const admissionNo = text(row.admissionNo) || undefined;
      if (admissionNo && refs.takenNos.has(admissionNo.toLowerCase())) problems.push(problem('admissionNo', 'already exists', 'this student is already in the school; remove the row', admissionNo));
      let gradeName = text(row.gradeName);
      let sectionName = text(row.sectionName);
      if (gradeName && !sectionName) {
        const split = splitClassCell(gradeName);
        if (split) ({ grade: gradeName, section: sectionName } = split);
      }
      if (gradeName && sectionName) {
        const found = findSection(refs.sections, `${gradeName} ${sectionName}`);
        if (found.error) problems.push({ ...found.error, field: 'gradeName' });
        else { gradeName = found.section.gradeName; sectionName = found.section.name; }
      } else if (gradeName && !sectionName) {
        problems.push(problem('sectionName', 'is required when a class is given', 'add the section, e.g. "A"'));
      }
      const email = text(row.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(problem('email', 'is not a valid email address', 'leave it blank if unknown', email));
      return { values: { displayName: name, phone, admissionNo, gradeName, sectionName, email: email || undefined }, problems };
    },
    dupKey: (v) => (v.phone ? `phone:${v.phone}` : null),
    dupKeys: (v) => [v.phone && `phone:${v.phone}`, v.admissionNo && `adm:${v.admissionNo.toLowerCase()}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateUsers, rows, (v) => ({ rolekey: 'STUDENT', displayname: v.displayName, phone: v.phone, admissionno: v.admissionNo ?? '', gradename: v.gradeName ?? '', sectionname: v.sectionName ?? '', email: v.email ?? '' })),
  },
  {
    key: 'staff',
    label: 'Staff',
    noun: 'staff member',
    module: 'Users',
    link: '/users',
    permission: 'users.manage',
    route: 'POST /users/bulk',
    context: ['roleKey'],
    said: [/\b(?:staff|teachers?|employees?|faculty|teaching\s+staff|non[-\s]?teaching)\b/i, /शिक्षक|कर्मचारी|स्टाफ/],
    columns: [
      { key: 'displayName', label: 'Name', required: true, type: 'text', aliases: ['name', 'full name', 'staff name', 'teacher name', 'employee name', 'naam', 'नाम', 'कर्मचारी का नाम'], example: 'Meena Iyer' },
      { key: 'phone', label: 'Phone', required: true, type: 'phone', aliases: PHONE_ALIASES, example: '+919812345678', note: 'The number they sign in with.' },
      { key: 'roleKey', label: 'Role', required: true, fromContext: 'roleKey', type: 'enum', values: Object.keys(ROLE_WORDS), aliases: ['role', 'designation', 'post', 'position', 'job title', 'department', 'पद', 'भूमिका'], example: 'TEACHER', note: `One of ${Object.keys(ROLE_WORDS).join(', ')}. "Teacher", "Accountant", "PGT" and the like are understood.` },
      { key: 'email', label: 'Email', type: 'email', aliases: ['email', 'email id', 'e-mail', 'mail', 'ईमेल'], example: 'meena.iyer@school.edu' },
      { key: 'employeeId', label: 'Employee ID', type: 'text', aliases: ['employee id', 'emp id', 'emp code', 'staff id', 'employee code'], example: 'EMP-104', note: 'Kept for your reference; not stored.' },
    ],
    headerBonus: (headers, mapping) => (mapping.roleKey !== undefined ? 0.1 : 0),
    async lookups(ctx, rows) {
      const phones = [...new Set(rows.map((r) => parsePhone(r.phone)).filter(Boolean))];
      const accounts = phones.length ? await Account.find({ phoneE164: { $in: phones } }).select('_id phoneE164').lean() : [];
      const inSchool = accounts.length ? await Profile.find({ ...tenantFilter(), accountId: { $in: accounts.map((a) => a._id) }, deletedAt: null }).populate('roleId', 'key').lean() : [];
      const held = new Map();
      for (const p of inSchool) {
        const phone = accounts.find((a) => String(a._id) === String(p.accountId))?.phoneE164;
        if (phone) held.set(`${phone}|${p.roleId?.key}`, true);
      }
      return { held };
    },
    check(row, refs, context) {
      const problems = [];
      const name = text(row.displayName);
      if (!name) problems.push(problem('displayName', 'is required', 'the person\'s full name'));
      const phone = parsePhone(row.phone);
      if (!text(row.phone)) problems.push(problem('phone', 'is required', 'a 10-digit mobile number'));
      else if (!phone) problems.push(problem('phone', 'is not a valid phone number', 'use a 10-digit mobile number or +91XXXXXXXXXX', text(row.phone)));
      const rawRole = text(row.roleKey) || context.roleKey || '';
      const roleKey = parseEnum(rawRole, ROLE_WORDS);
      if (!rawRole) problems.push(problem('roleKey', 'is required', `one of ${Object.keys(ROLE_WORDS).join(', ')}`));
      else if (!roleKey) problems.push(problem('roleKey', 'is not a role this school uses', `use one of ${Object.keys(ROLE_WORDS).join(', ')}`, rawRole));
      if (phone && roleKey && refs.held.has(`${phone}|${roleKey}`)) problems.push(problem('phone', `already has a ${roleKey.toLowerCase()} account here`, 'remove the row; they are already set up', phone));
      const email = text(row.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(problem('email', 'is not a valid email address', 'leave it blank if unknown', email));
      return { values: { displayName: name, phone, roleKey, email: email || undefined }, problems };
    },
    dupKeys: (v) => [v.phone && v.roleKey && `phone:${v.phone}|${v.roleKey}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateUsers, rows, (v) => ({ rolekey: v.roleKey, displayname: v.displayName, phone: v.phone, email: v.email ?? '' })),
  },
  {
    key: 'admission_enquiries',
    label: 'Admission enquiries',
    noun: 'enquiry',
    module: 'Admissions',
    link: '/admissions',
    permission: 'admissions.manage',
    route: 'POST /admissions/leads/bulk',
    said: [/\b(?:enquir(?:y|ies)|inquir(?:y|ies)|leads?|prospects?|admission\s+(?:enquir|lead|form)|walk[-\s]?ins?)\w*/i, /पूछताछ/],
    columns: [
      { key: 'childName', label: 'Child name', required: true, type: 'text', aliases: ['child name', 'student name', 'child', 'name of child', 'ward name', 'candidate name', 'applicant name', 'बच्चे का नाम'], example: 'Kabir Rao' },
      { key: 'guardianName', label: 'Parent / guardian name', required: true, type: 'text', aliases: ['parent name', 'guardian name', 'father name', 'mother name', 'parent', 'guardian', "father's name", 'अभिभावक का नाम', 'पिता का नाम'], example: 'Suresh Rao' },
      { key: 'phone', label: 'Phone', required: true, type: 'phone', aliases: [...PHONE_ALIASES, 'parent phone', 'parent mobile'], example: '+919900112233' },
      { key: 'email', label: 'Email', type: 'email', aliases: ['email', 'email id', 'parent email', 'e-mail'], example: 'suresh.rao@example.com' },
      { key: 'gradeApplying', label: 'Class applying for', type: 'text', aliases: ['class applying', 'grade applying', 'class applied', 'applying for', 'admission class', 'class', 'grade', 'कक्षा'], example: 'Class 1' },
      { key: 'source', label: 'Source', type: 'enum', values: Object.keys(LEAD_SOURCE), aliases: ['source', 'lead source', 'how did you hear', 'channel', 'medium', 'स्रोत'], example: 'WALK_IN', note: 'WALK_IN, WEB, WHATSAPP or REFERRAL ("walk-in", "website", "referred" understood). Blank = WALK_IN.' },
      { key: 'stage', label: 'Stage', type: 'enum', values: Object.keys(LEAD_STAGE), aliases: ['stage', 'status', 'lead status', 'pipeline stage'], example: 'NEW', note: 'NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION, ENROLLED or LOST. Blank = NEW.' },
      { key: 'notes', label: 'Notes', type: 'text', aliases: ['notes', 'remarks', 'comments', 'टिप्पणी'], example: 'Sibling in Class 4' },
    ],
    async lookups(ctx, rows) {
      const phones = [...new Set(rows.map((r) => parsePhone(r.phone)).filter(Boolean))];
      const existing = phones.length ? await Lead.find({ phone: { $in: phones } }).select('phone childName').lean() : [];
      return { existing: new Set(existing.map((l) => dupKeyOf(l.phone, l.childName))) };
    },
    check(row, refs) {
      const problems = [];
      const childName = text(row.childName);
      const guardianName = text(row.guardianName);
      if (!childName) problems.push(problem('childName', 'is required', 'the child\'s name'));
      if (!guardianName) problems.push(problem('guardianName', 'is required', 'the parent or guardian\'s name'));
      const phone = parsePhone(row.phone);
      if (!text(row.phone)) problems.push(problem('phone', 'is required', 'a contact number'));
      else if (!phone) problems.push(problem('phone', 'is not a valid phone number', 'use a 10-digit mobile number or +91XXXXXXXXXX', text(row.phone)));
      const source = text(row.source) ? parseEnum(row.source, LEAD_SOURCE) : 'WALK_IN';
      if (!source) problems.push(problem('source', 'is not a source this CRM knows', 'use WALK_IN, WEB, WHATSAPP or REFERRAL', text(row.source)));
      const stage = text(row.stage) ? parseEnum(row.stage, LEAD_STAGE) : 'NEW';
      if (!stage) problems.push(problem('stage', 'is not a pipeline stage', 'use NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION, ENROLLED or LOST', text(row.stage)));
      if (phone && childName && refs.existing.has(dupKeyOf(phone, childName))) problems.push(problem('childName', 'is already an enquiry with this phone number', 'remove the row; it is already in the pipeline', childName));
      return { values: { childName, guardianName, phone, email: text(row.email), gradeApplying: text(row.gradeApplying), source, stage, notes: text(row.notes) }, problems };
    },
    dupKeys: (v) => [v.phone && v.childName && dupKeyOf(v.phone, v.childName)].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateLeads, rows, (v) => ({ childname: v.childName, guardianname: v.guardianName, phone: v.phone, email: v.email, gradeapplying: v.gradeApplying, source: v.source, stage: v.stage, notes: v.notes })),
  },

  /* ── School structure ── */
  {
    key: 'classes',
    label: 'Classes (grades)',
    noun: 'class',
    module: 'Academics',
    link: '/classrooms',
    permission: 'academics.structure.manage',
    route: 'POST /academics/grades/bulk',
    said: [/\b(?:classes|grades|standards)\b(?!.*\bsections?\b)/i],
    columns: [
      { key: 'name', label: 'Class name', required: true, type: 'text', aliases: ['class', 'class name', 'grade', 'grade name', 'standard', 'std', 'कक्षा'], example: 'Class 6' },
      { key: 'level', label: 'Level', type: 'integer', aliases: ['level', 'grade level', 'order', 'number', 'class number', 'स्तर'], example: '6', note: 'A number for ordering. Left blank, it is read from the name ("Class 6" = 6).' },
    ],
    headerBonus: (headers, mapping) => (headers.length <= 2 && mapping.name !== undefined ? 0.05 : 0),
    async lookups() {
      const grades = await Grade.find().select('name').lean();
      return { existing: new Set(grades.map((g) => normaliseHeader(g.name))) };
    },
    check(row, refs) {
      const problems = [];
      const name = text(row.name);
      if (!name) problems.push(problem('name', 'is required', 'e.g. "Class 5"'));
      let level = parseInteger(row.level);
      if (level === null && text(row.level)) problems.push(problem('level', 'must be a number', 'e.g. 5 for Class 5', text(row.level)));
      if (level === null && !text(row.level)) {
        const n = /(\d{1,2})/.exec(name);
        if (/\b(?:nursery|pre[-\s]?nursery|play\s*group)\b/i.test(name)) level = 1;
        else if (/\b(?:lkg|jr\.?\s*kg)\b/i.test(name)) level = 2;
        else if (/\b(?:ukg|sr\.?\s*kg)\b/i.test(name)) level = 3;
        else if (n) level = Number(n[1]);
        else problems.push(problem('level', 'is required (it could not be read from the name)', 'a number for ordering, e.g. 5'));
      }
      if (level !== null && (level < 1 || level > 20)) problems.push(problem('level', 'must be between 1 and 20', null, String(level)));
      if (name && refs.existing.has(normaliseHeader(name))) problems.push(problem('name', 'already exists', 'remove the row', name));
      return { values: { name, level }, problems };
    },
    dupKeys: (v) => [v.name && `name:${normaliseHeader(v.name)}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateGrades, rows, (v) => ({ name: v.name, level: String(v.level) })),
  },
  {
    key: 'sections',
    label: 'Sections',
    noun: 'section',
    module: 'Academics',
    link: '/classrooms',
    permission: 'academics.structure.manage',
    route: 'POST /academics/sections/bulk',
    said: [/\bsections?\b|\bdivisions?\b/i],
    columns: [
      { key: 'gradeName', label: 'Class', required: true, type: 'text', aliases: ['class', 'grade', 'grade name', 'class name', 'standard', 'std', 'कक्षा'], example: 'Class 6' },
      { key: 'name', label: 'Section', required: true, type: 'text', aliases: ['section', 'section name', 'sec', 'division', 'div', 'वर्ग', 'सेक्शन'], example: 'C', derivable: (m) => m.gradeName !== undefined },
      { key: 'classTeacherPhone', label: 'Class teacher phone', type: 'phone', aliases: ['class teacher phone', 'class teacher mobile', 'teacher phone', 'class teacher', 'teacher mobile'], example: '+919812345678', note: 'Optional. The phone the class teacher signs in with.' },
    ],
    async lookups(ctx, rows) {
      const grades = await Grade.find().select('name').lean();
      const sections = await sectionIndex();
      const phones = [...new Set(rows.map((r) => parsePhone(r.classTeacherPhone)).filter(Boolean))];
      const accounts = phones.length ? await Account.find({ phoneE164: { $in: phones } }).select('_id phoneE164').lean() : [];
      const staff = accounts.length ? await Profile.find({ ...tenantFilter(), accountId: { $in: accounts.map((a) => a._id) }, deletedAt: null }).select('accountId').lean() : [];
      const staffPhones = new Set(accounts.filter((a) => staff.some((p) => String(p.accountId) === String(a._id))).map((a) => a.phoneE164));
      return { grades: new Map(grades.map((g) => [normaliseHeader(g.name), g.name])), sections, staffPhones };
    },
    check(row, refs) {
      const problems = [];
      let gradeName = text(row.gradeName);
      let name = text(row.name);
      if (gradeName && !name) {
        const split = splitClassCell(gradeName);
        if (split) ({ grade: gradeName, section: name } = split);
      }
      if (!gradeName) problems.push(problem('gradeName', 'is required', 'the class this section belongs to, e.g. "Class 5"'));
      if (!name) problems.push(problem('name', 'is required', 'the section letter, e.g. "A"'));
      const grade = gradeName ? refs.grades.get(normaliseHeader(gradeName)) ?? [...refs.grades.entries()].find(([k]) => classKey(k) === classKey(gradeName))?.[1] : null;
      if (gradeName && !grade) problems.push(problem('gradeName', 'does not match any class in this school', `known classes: ${[...refs.grades.values()].slice(0, 8).join(', ') || 'none yet — import the classes first'}`, gradeName));
      if (grade && name && refs.sections.some((s) => s.key === classKey(`${grade} ${name}`))) problems.push(problem('name', `${grade} ${name} already exists`, 'remove the row', name));
      const phone = text(row.classTeacherPhone) ? parsePhone(row.classTeacherPhone) : null;
      if (text(row.classTeacherPhone) && (!phone || !refs.staffPhones.has(phone))) problems.push(problem('classTeacherPhone', 'does not match a staff member in this school', 'use the phone the teacher signs in with, or leave it blank', text(row.classTeacherPhone)));
      return { values: { gradeName: grade ?? gradeName, name, classTeacherPhone: phone ?? '' }, problems };
    },
    dupKeys: (v) => [v.gradeName && v.name && `sec:${classKey(`${v.gradeName} ${v.name}`)}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateSections, rows, (v) => ({ gradename: v.gradeName, name: v.name, classteacherphone: v.classTeacherPhone })),
  },
  {
    key: 'subjects',
    label: 'Subjects',
    noun: 'subject',
    module: 'Academics',
    link: '/classrooms',
    permission: 'academics.structure.manage',
    route: 'POST /academics/subjects/bulk',
    said: [/\bsubjects?\b|\bcourses?\b/i, /विषय/],
    columns: [
      { key: 'name', label: 'Subject', required: true, type: 'text', aliases: ['subject', 'subject name', 'course', 'paper', 'विषय'], example: 'Computer Science' },
      { key: 'code', label: 'Code', type: 'text', aliases: ['code', 'subject code', 'course code', 'short name'], example: 'CS' },
    ],
    async lookups() {
      const subjects = await Subject.find().select('name').lean();
      return { existing: new Set(subjects.map((s) => normaliseHeader(s.name))) };
    },
    check(row, refs) {
      const problems = [];
      const name = text(row.name);
      if (!name) problems.push(problem('name', 'is required', 'the subject name, e.g. "Mathematics"'));
      else if (refs.existing.has(normaliseHeader(name))) problems.push(problem('name', 'already exists', 'remove the row', name));
      return { values: { name, code: text(row.code) }, problems };
    },
    dupKeys: (v) => [v.name && `name:${normaliseHeader(v.name)}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateSubjects, rows, (v) => ({ name: v.name, code: v.code })),
  },
  {
    key: 'enrollments',
    label: 'Class placements (enrolments)',
    noun: 'placement',
    module: 'Students',
    link: '/student-classes',
    permission: 'enrollments.manage',
    route: 'POST /enrollments/bulk',
    context: ['className'],
    said: [/\b(?:enrol(?:l)?(?:ment|ments)?|placements?|assign(?:ing)?\s+(?:students\s+)?to\s+(?:a\s+)?(?:class|section)|class\s+allocation|promot(?:e|ion))\b/i],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['studentName'] },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma', note: 'Used to find the student when there is no admission number.' },
      { key: 'className', label: 'Class', required: true, fromContext: 'className', type: 'text', aliases: [...CLASS_ALIASES, 'new class', 'section'], example: 'Class 6 A', note: 'The class and section to place the student in. Can instead be said in the chat ("put these in Class 6 A").' },
      { key: 'rollNo', label: 'Roll No', type: 'integer', aliases: ['roll no', 'roll number', 'roll', 'rollno', 'रोल नंबर', 'क्रमांक'], example: '12', note: 'Left blank, the next free number is given.' },
    ],
    async lookups(ctx, rows) {
      const [sections, students, year] = await Promise.all([sectionIndex(), studentIndex(rows, { needNames: true }), AcademicYear.findOne({ isCurrent: true }).select('_id name').lean()]);
      const existing = year ? await Enrollment.find({ academicYearId: year._id, status: 'ACTIVE' }).select('studentId sectionId').lean() : [];
      return { sections, students, year, enrolled: new Map(existing.map((e) => [String(e.studentId), String(e.sectionId)])) };
    },
    check(row, refs, context) {
      const problems = [];
      if (!refs.year) problems.push(problem('className', 'no current academic year is set up', 'set the current academic year first'));
      const who = findStudent(refs.students, row);
      if (who.error) problems.push(who.error);
      const cls = findSection(refs.sections, text(row.className) || context.className);
      if (cls.error) problems.push(cls.error);
      const rollNo = text(row.rollNo) ? parseInteger(row.rollNo) : null;
      if (text(row.rollNo) && rollNo === null) problems.push(problem('rollNo', 'must be a whole number', 'e.g. 12 — leave it blank to have one assigned', text(row.rollNo)));
      let skip = null;
      if (who.student && cls.section && refs.enrolled.get(String(who.student._id)) === cls.section.id) skip = `already in ${cls.section.label}`;
      else if (who.student && refs.enrolled.has(String(who.student._id))) problems.push(problem('admissionNo', 'is already placed in another class this year', 'move the student on the Student classes screen instead', who.student.admissionNo));
      return { values: { admissionNo: who.student?.admissionNo, studentId: who.student ? String(who.student._id) : null, sectionId: cls.section?.id, classLabel: cls.section?.label, rollNo }, problems, skip };
    },
    dupKeys: (v) => [v.studentId && `stu:${v.studentId}`].filter(Boolean),
    async write(ctx, rows, context, refs) {
      const out = { imported: 0, failed: 0, errors: [], failedRows: new Set() };
      const bySection = new Map();
      for (const r of rows) bySection.set(r.values.sectionId, [...(bySection.get(r.values.sectionId) ?? []), r]);
      for (const [sectionId, group] of bySection) {
        // eslint-disable-next-line no-await-in-loop
        const res = await viaBulk((serviceRows) => bulkEnroll({ sectionId, academicYearId: String(refs.year._id), rows: serviceRows }), group, (v) => ({ admissionno: v.admissionNo, rollno: v.rollNo === null ? '' : String(v.rollNo) }));
        out.imported += res.imported; out.failed += res.failed; out.errors.push(...res.errors);
        res.failedRows.forEach((n) => out.failedRows.add(n));
      }
      return out;
    },
  },

  /* ── Fees ── */
  {
    key: 'fee_invoices',
    label: 'Fee invoices',
    noun: 'invoice',
    module: 'Fees',
    link: '/payments',
    permission: 'fees.manage',
    route: 'POST /fees/invoices/bulk',
    said: [/\b(?:fees?|invoices?|bills?\s+for\s+students|dues|challans?)\b/i, /फीस|शुल्क/],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['studentName'] },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma', note: 'Used to find the student when there is no admission number.' },
      { key: 'description', label: 'Description', required: true, type: 'text', aliases: ['description', 'fee head', 'fee type', 'particulars', 'item', 'fee name', 'head', 'विवरण', 'मद'], example: 'Tuition — Term 2' },
      { key: 'amount', label: 'Amount (₹)', required: true, type: 'amount', aliases: ['amount', 'amount rs', 'amount inr', 'fee amount', 'total', 'fee', 'rs', 'राशि', 'रकम', 'शुल्क'], example: '8000', note: 'In rupees. "₹8,000" and "8000/-" are understood.' },
      { key: 'dueOn', label: 'Due date', required: true, type: 'date', aliases: ['due date', 'due on', 'due', 'last date', 'payment due', 'deadline', 'अंतिम तिथि', 'देय तिथि'], example: '2026-11-10', note: 'YYYY-MM-DD or DD/MM/YYYY (day first).' },
      { key: 'invoiceNo', label: 'Invoice No', type: 'text', aliases: ['invoice no', 'invoice number', 'bill no', 'challan no', 'receipt no', 'ref no'], example: '', note: 'Left blank, the school\'s invoice series supplies one.' },
    ],
    async lookups(ctx, rows) {
      const students = await studentIndex(rows, { needNames: true });
      const ids = [...students.byNo.values(), ...[...(students.byName?.values() ?? [])].flat()].map((s) => s._id);
      const active = ids.length ? await Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' }).select('studentId').lean() : [];
      const nos = [...new Set(rows.map((r) => text(r.invoiceNo)).filter(Boolean))];
      const taken = nos.length ? new Set((await Invoice.find({ invoiceNo: { $in: nos } }).select('invoiceNo').lean()).map((i) => i.invoiceNo)) : new Set();
      return { students, active: new Set(active.map((e) => String(e.studentId))), taken };
    },
    check(row, refs) {
      const problems = [];
      const who = findStudent(refs.students, row);
      if (who.error) problems.push(who.error);
      else if (!refs.active.has(String(who.student._id))) problems.push(problem('admissionNo', 'names a student with no active enrolment, so there is no class to bill', 'enrol the student for the current year first', who.student.admissionNo));
      const description = text(row.description);
      if (!description) problems.push(problem('description', 'is required', 'what the fee is for, e.g. "Tuition — Term 2"'));
      const amount = parseAmount(row.amount);
      if (!text(row.amount)) problems.push(problem('amount', 'is required', 'the amount in rupees'));
      else if (amount === null || amount <= 0) problems.push(problem('amount', 'must be a positive amount', 'e.g. 8000', text(row.amount)));
      const dueOn = parseDate(row.dueOn);
      if (!text(row.dueOn)) problems.push(problem('dueOn', 'is required', 'the due date, e.g. 2026-11-10'));
      else if (!dueOn) problems.push(problem('dueOn', 'is not a date this can read', 'use YYYY-MM-DD or DD/MM/YYYY', text(row.dueOn)));
      const invoiceNo = text(row.invoiceNo);
      if (invoiceNo && refs.taken.has(invoiceNo)) problems.push(problem('invoiceNo', 'already exists', 'leave it blank to have a number assigned, or remove the row', invoiceNo));
      return { values: { admissionNo: who.student?.admissionNo, studentId: who.student ? String(who.student._id) : null, description, amount, dueOn, invoiceNo }, problems };
    },
    dupKeys: (v) => [v.invoiceNo && `inv:${v.invoiceNo}`, v.studentId && v.description && v.dueOn && `line:${v.studentId}|${normaliseHeader(v.description)}|${v.dueOn}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateInvoices, rows, (v) => ({ admissionno: v.admissionNo, description: v.description, amount: String(v.amount), dueon: v.dueOn, invoiceno: v.invoiceNo })),
  },

  /* ── Hostel ── */
  {
    key: 'hostel_rooms',
    label: 'Hostel rooms',
    noun: 'room',
    module: 'Hostel',
    link: '/rooms',
    permission: 'hostel.manage',
    route: 'POST /hostel/rooms/bulk',
    said: [/\b(?:hostel\s+)?rooms?\b(?!.*\b(?:allot|allocat|assign))/i, /कमरा/],
    columns: [
      { key: 'roomNo', label: 'Room No', required: true, type: 'text', aliases: ['room no', 'room number', 'room', 'room id', 'कमरा नंबर', 'कमरा'], example: 'B-204' },
      { key: 'capacity', label: 'Beds', required: true, type: 'integer', aliases: ['capacity', 'beds', 'no of beds', 'bed count', 'occupancy', 'seats', 'बिस्तर'], example: '4', note: `${ROOM_CAPACITY_MIN} to ${ROOM_CAPACITY_MAX}.` },
      { key: 'block', label: 'Block', type: 'text', aliases: ['block', 'building', 'wing', 'hostel', 'ब्लॉक'], example: 'Boys Block B' },
      { key: 'floor', label: 'Floor', type: 'text', aliases: ['floor', 'level', 'मंजिल'], example: '2' },
      { key: 'type', label: 'Type', type: 'enum', values: ROOM_TYPES, aliases: ['type', 'room type', 'for', 'gender', 'category'], example: 'BOYS', note: 'BOYS, GIRLS, STAFF or GENERAL. Blank = GENERAL.' },
    ],
    async lookups() {
      const rooms = await HostelRoom.find().select('roomNo').lean();
      return { existing: new Set(rooms.map((r) => r.roomNo.toLowerCase())) };
    },
    check(row, refs) {
      const problems = [];
      const roomNo = text(row.roomNo);
      if (!roomNo) problems.push(problem('roomNo', 'is required', 'the room number, e.g. B-204'));
      else if (refs.existing.has(roomNo.toLowerCase())) problems.push(problem('roomNo', 'already exists', 'remove the row, or change the room number', roomNo));
      const capacity = parseInteger(row.capacity);
      if (!text(row.capacity)) problems.push(problem('capacity', 'is required', 'the number of beds, e.g. 4'));
      else if (capacity === null || capacity < ROOM_CAPACITY_MIN || capacity > ROOM_CAPACITY_MAX) problems.push(problem('capacity', `must be a whole number from ${ROOM_CAPACITY_MIN} to ${ROOM_CAPACITY_MAX}`, 'e.g. 4', text(row.capacity)));
      const type = text(row.type) ? parseEnum(row.type, ROOM_TYPE) : 'GENERAL';
      if (!type) problems.push(problem('type', 'is not a room type', 'use BOYS, GIRLS, STAFF or GENERAL', text(row.type)));
      return { values: { roomNo, capacity, block: text(row.block), floor: text(row.floor), type }, problems };
    },
    dupKeys: (v) => [v.roomNo && `room:${v.roomNo.toLowerCase()}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateRooms, rows, (v) => ({ roomno: v.roomNo, capacity: String(v.capacity), block: v.block, floor: v.floor, type: v.type })),
  },
  {
    key: 'hostel_allocations',
    label: 'Hostel bed allocations',
    noun: 'allocation',
    module: 'Hostel',
    link: '/rooms',
    permission: 'hostel.manage',
    route: 'POST /hostel/allocations/bulk',
    said: [/\b(?:allot|allocat|assign)\w*\b.*\b(?:rooms?|beds?|hostel)\b|\b(?:hostel|room|bed)\s+(?:allotment|allocation)s?\b|\bhostel(?:lers|ers)?\b/i],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['studentName'] },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma', note: 'Used to find the student when there is no admission number.' },
      { key: 'roomNo', label: 'Room No', required: true, type: 'text', aliases: ['room no', 'room number', 'room', 'allotted room', 'कमरा नंबर', 'कमरा'], example: 'B-204' },
    ],
    async lookups(ctx, rows) {
      const students = await studentIndex(rows, { needNames: true });
      const rooms = await HostelRoom.find().select('roomNo').lean();
      return { students, rooms: new Set(rooms.map((r) => r.roomNo.toLowerCase())) };
    },
    check(row, refs) {
      const problems = [];
      const who = findStudent(refs.students, row);
      if (who.error) problems.push(who.error);
      const roomNo = text(row.roomNo);
      if (!roomNo) problems.push(problem('roomNo', 'is required', 'the room to put the student in'));
      else if (!refs.rooms.has(roomNo.toLowerCase())) problems.push(problem('roomNo', 'does not match any hostel room', 'import the rooms first, or correct the room number', roomNo));
      return { values: { admissionNo: who.student?.admissionNo, studentId: who.student ? String(who.student._id) : null, roomNo }, problems };
    },
    dupKeys: (v) => [v.studentId && `stu:${v.studentId}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkAllocate, rows, (v) => ({ admissionno: v.admissionNo, roomno: v.roomNo })),
  },

  /* ── Library ── */
  {
    key: 'library_books',
    label: 'Library books',
    noun: 'book',
    module: 'Library',
    link: '/library',
    permission: 'library.manage',
    route: 'POST /library/books/bulk',
    said: [/\b(?:library\s+)?(?:books?|titles|catalogue|catalog|accession)\b(?!.*\b(?:issue|lend|borrow))/i, /पुस्तक|किताब/],
    columns: [
      { key: 'title', label: 'Title', required: true, type: 'text', aliases: ['title', 'book title', 'book name', 'name of book', 'book', 'शीर्षक', 'पुस्तक का नाम'], example: 'Wings of Fire' },
      { key: 'author', label: 'Author', required: true, type: 'text', aliases: ['author', 'authors', 'writer', 'author name', 'लेखक'], example: 'A. P. J. Abdul Kalam' },
      { key: 'isbn', label: 'ISBN', type: 'text', aliases: ['isbn', 'isbn no', 'isbn number', 'isbn 13', 'isbn10'], example: '9788173711466' },
      { key: 'category', label: 'Category', type: 'text', aliases: ['category', 'genre', 'subject', 'section', 'type', 'श्रेणी'], example: 'Biography', note: 'Blank = General.' },
      { key: 'totalCopies', label: 'Copies', type: 'integer', aliases: ['copies', 'total copies', 'no of copies', 'quantity', 'qty', 'count', 'प्रतियां'], example: '3', note: 'Blank = 1.' },
    ],
    async lookups(ctx, rows) {
      const isbns = [...new Set(rows.map((r) => text(r.isbn)).filter(Boolean))];
      const existing = isbns.length ? await Book.find({ isbn: { $in: isbns }, deletedAt: null }).select('isbn').lean() : [];
      return { existing: new Set(existing.map((b) => b.isbn)) };
    },
    check(row, refs) {
      const problems = [];
      const title = text(row.title);
      const author = text(row.author);
      if (!title) problems.push(problem('title', 'is required', 'the book\'s title'));
      if (!author) problems.push(problem('author', 'is required', 'the author\'s name'));
      const totalCopies = text(row.totalCopies) ? parseInteger(row.totalCopies) : 1;
      if (totalCopies === null || totalCopies < 0) problems.push(problem('totalCopies', 'must be a whole number of copies', 'e.g. 3 — leave it blank for one copy', text(row.totalCopies)));
      const isbn = text(row.isbn).replace(/[\s-]/g, '');
      if (isbn && refs.existing.has(isbn)) problems.push(problem('isbn', 'is already in the catalogue', 'add copies to the existing title on the Library screen instead', isbn));
      return { values: { title, author, isbn, category: text(row.category), totalCopies }, problems };
    },
    dupKeys: (v) => [v.isbn && `isbn:${v.isbn}`, v.title && v.author && `ta:${normaliseHeader(v.title)}|${normaliseHeader(v.author)}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateBooks, rows, (v) => ({ title: v.title, author: v.author, isbn: v.isbn, category: v.category, totalcopies: String(v.totalCopies) })),
  },
  {
    key: 'library_issues',
    label: 'Library issues (books lent)',
    noun: 'issue',
    module: 'Library',
    link: '/library',
    permission: 'library.manage',
    route: 'POST /library/issues/bulk',
    said: [/\b(?:issue[ds]?|lend|lent|borrow(?:ed|ers)?|loans?)\b.*\b(?:books?)?\b|\bbook\s+issues?\b/i],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['studentName'] },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: [...STUDENT_NAME_ALIASES, 'borrower', 'borrower name'], example: 'Aarav Sharma', note: 'Used to find the student when there is no admission number.' },
      { key: 'isbn', label: 'ISBN', required: true, type: 'text', aliases: ['isbn', 'isbn no', 'book isbn', 'isbn number'], example: '9788173711466' },
      { key: 'dueAt', label: 'Due date', required: true, type: 'date', aliases: ['due date', 'due', 'return date', 'return by', 'due on', 'वापसी तिथि'], example: '2026-11-01' },
    ],
    async lookups(ctx, rows) {
      const students = await studentIndex(rows, { needNames: true });
      const isbns = [...new Set(rows.map((r) => text(r.isbn).replace(/[\s-]/g, '')).filter(Boolean))];
      const books = isbns.length ? await Book.find({ isbn: { $in: isbns }, deletedAt: null }).select('isbn availableCopies title').lean() : [];
      return { students, books: new Map(books.map((b) => [b.isbn, b])) };
    },
    check(row, refs) {
      const problems = [];
      const who = findStudent(refs.students, row);
      if (who.error) problems.push(who.error);
      const isbn = text(row.isbn).replace(/[\s-]/g, '');
      const book = isbn ? refs.books.get(isbn) : null;
      if (!isbn) problems.push(problem('isbn', 'is required', 'the ISBN of the book lent'));
      else if (!book) problems.push(problem('isbn', 'does not match any book in the catalogue', 'import the book first, or correct the ISBN', isbn));
      else if ((book.availableCopies ?? 0) <= 0) problems.push(problem('isbn', `"${book.title}" has no copy available`, 'return a copy first, or add copies', isbn));
      const dueAt = parseDate(row.dueAt);
      if (!text(row.dueAt)) problems.push(problem('dueAt', 'is required', 'the return date'));
      else if (!dueAt) problems.push(problem('dueAt', 'is not a date this can read', 'use YYYY-MM-DD or DD/MM/YYYY', text(row.dueAt)));
      return { values: { admissionNo: who.student?.admissionNo, studentId: who.student ? String(who.student._id) : null, isbn, dueAt }, problems };
    },
    dupKeys: (v) => [v.studentId && v.isbn && `iss:${v.studentId}|${v.isbn}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkIssueBooks, rows, (v) => ({ admissionno: v.admissionNo, isbn: v.isbn, dueat: v.dueAt })),
  },

  /* ── Transport ── */
  {
    key: 'transport_routes',
    label: 'Bus routes',
    noun: 'route',
    module: 'Transport',
    link: '/transport',
    permission: 'transport.manage',
    route: 'POST /transport/routes/bulk',
    said: [/\b(?:bus\s+)?routes?\b(?!.*\b(?:stops?|riders?|students?))/i],
    columns: [
      { key: 'name', label: 'Route name', required: true, type: 'text', aliases: ['route', 'route name', 'route no', 'route number', 'रूट'], example: 'Route 4 - Kothrud' },
      { key: 'vehicleNo', label: 'Vehicle No', type: 'text', aliases: ['vehicle no', 'vehicle number', 'bus no', 'bus number', 'registration no', 'reg no', 'vehicle'], example: 'MH12AB1234' },
      { key: 'driverName', label: 'Driver name', type: 'text', aliases: ['driver', 'driver name', 'चालक'], example: 'Ramesh Patil' },
      { key: 'driverPhone', label: 'Driver phone', type: 'phone', aliases: ['driver phone', 'driver mobile', 'driver contact', 'driver no'], example: '+919811122233' },
      { key: 'operatorName', label: 'Operator', type: 'text', aliases: ['operator', 'operator name', 'vendor', 'contractor', 'transporter'], example: 'City Travels' },
    ],
    async lookups() {
      const routes = await TransportRoute.find().select('name').lean();
      return { existing: new Set(routes.map((r) => r.name.toLowerCase())) };
    },
    check(row, refs) {
      const problems = [];
      const name = text(row.name);
      if (!name) problems.push(problem('name', 'is required', 'the route name, e.g. "Route 4 - Kothrud"'));
      else if (refs.existing.has(name.toLowerCase())) problems.push(problem('name', 'already exists', 'remove the row', name));
      const driverPhone = text(row.driverPhone) ? parsePhone(row.driverPhone) : '';
      if (text(row.driverPhone) && !driverPhone) problems.push(problem('driverPhone', 'is not a valid phone number', 'use a 10-digit mobile number, or leave it blank', text(row.driverPhone)));
      return { values: { name, vehicleNo: text(row.vehicleNo), driverName: text(row.driverName), driverPhone: driverPhone || '', operatorName: text(row.operatorName) }, problems };
    },
    dupKeys: (v) => [v.name && `route:${v.name.toLowerCase()}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateRoutes, rows, (v) => ({ name: v.name, vehicleno: v.vehicleNo, drivername: v.driverName, driverphone: v.driverPhone, operatorname: v.operatorName })),
  },
  {
    key: 'transport_stops',
    label: 'Bus stops',
    noun: 'stop',
    module: 'Transport',
    link: '/transport',
    permission: 'transport.manage',
    route: 'POST /transport/stops/bulk',
    said: [/\b(?:bus\s+)?stops?\b|\bpick[-\s]?up\s+points?\b/i],
    columns: [
      { key: 'routeName', label: 'Route', required: true, type: 'text', aliases: ['route', 'route name', 'route no', 'bus route', 'रूट'], example: 'Route 4 - Kothrud' },
      { key: 'name', label: 'Stop name', required: true, type: 'text', aliases: ['stop', 'stop name', 'pickup point', 'pick up point', 'stoppage', 'location', 'स्टॉप'], example: 'Karve Nagar' },
      { key: 'sequenceNo', label: 'Order', required: true, type: 'integer', aliases: ['sequence', 'sequence no', 'order', 'stop no', 'stop number', 's no', 'sr no', 'position'], example: '1', note: 'The stop\'s place along the route, starting at 1.' },
      { key: 'etaMinutesFromStart', label: 'Minutes from start', type: 'integer', aliases: ['eta', 'eta minutes', 'minutes from start', 'time from start', 'minutes'], example: '10' },
    ],
    async lookups() {
      const routes = await TransportRoute.find().select('_id name').lean();
      const stops = await TransportStop.find().select('routeId sequenceNo').lean();
      return { routes: new Map(routes.map((r) => [r.name.toLowerCase(), r])), taken: new Set(stops.map((s) => `${s.routeId}|${s.sequenceNo}`)) };
    },
    check(row, refs) {
      const problems = [];
      const routeName = text(row.routeName);
      const route = routeName ? refs.routes.get(routeName.toLowerCase()) : null;
      if (!routeName) problems.push(problem('routeName', 'is required', 'the route this stop is on'));
      else if (!route) problems.push(problem('routeName', 'does not match any route in this school', 'import the routes first, or correct the spelling', routeName));
      const name = text(row.name);
      if (!name) problems.push(problem('name', 'is required', 'the stop\'s name'));
      const sequenceNo = parseInteger(row.sequenceNo);
      if (sequenceNo === null || sequenceNo < 1) problems.push(problem('sequenceNo', text(row.sequenceNo) ? 'must be a whole number from 1' : 'is required', 'the stop order along the route, starting at 1', text(row.sequenceNo)));
      else if (route && refs.taken.has(`${route._id}|${sequenceNo}`)) problems.push(problem('sequenceNo', `${route.name} already has a stop number ${sequenceNo}`, 'use the next free number', String(sequenceNo)));
      const eta = text(row.etaMinutesFromStart) ? parseInteger(row.etaMinutesFromStart) : 0;
      if (eta === null || eta < 0) problems.push(problem('etaMinutesFromStart', 'must be a whole number of minutes', 'e.g. 10, or leave it blank', text(row.etaMinutesFromStart)));
      return { values: { routeName: route?.name ?? routeName, name, sequenceNo, etaMinutesFromStart: eta ?? 0 }, problems };
    },
    dupKeys: (v) => [v.routeName && v.sequenceNo && `seq:${v.routeName.toLowerCase()}|${v.sequenceNo}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkCreateStops, rows, (v) => ({ routename: v.routeName, name: v.name, sequenceno: String(v.sequenceNo), etaminutesfromstart: String(v.etaMinutesFromStart) })),
  },
  {
    key: 'transport_riders',
    label: 'Bus riders (transport enrolment)',
    noun: 'rider',
    module: 'Transport',
    link: '/transport',
    permission: 'transport.manage',
    route: 'POST /transport/enroll/bulk',
    said: [/\b(?:bus|transport|van)\s+(?:riders?|students?|users?|enrol\w*|list|allocation)\b|\briders?\b|\bwho\s+takes\s+the\s+bus\b/i],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['studentName'] },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma', note: 'Used to find the student when there is no admission number.' },
      { key: 'routeName', label: 'Route', required: true, type: 'text', aliases: ['route', 'route name', 'route no', 'bus route', 'bus no', 'bus', 'रूट'], example: 'Route 4 - Kothrud' },
      { key: 'stopName', label: 'Stop', required: true, type: 'text', aliases: ['stop', 'stop name', 'pickup point', 'pick up point', 'boarding point', 'stoppage', 'स्टॉप'], example: 'Karve Nagar' },
      { key: 'direction', label: 'Direction', type: 'enum', values: Object.keys(DIRECTION), aliases: ['direction', 'trip', 'pickup drop', 'way', 'service'], example: 'BOTH', note: 'BOTH, PICKUP or DROP. Blank = BOTH.' },
    ],
    async lookups(ctx, rows) {
      const students = await studentIndex(rows, { needNames: true });
      const routes = await TransportRoute.find().select('_id name').lean();
      const stops = await TransportStop.find().select('routeId name').lean();
      return {
        students,
        routes: new Map(routes.map((r) => [r.name.toLowerCase(), r])),
        stops: new Set(stops.map((s) => `${s.routeId}|${s.name.toLowerCase()}`)),
        year: await AcademicYear.findOne({ isCurrent: true }).select('_id').lean(),
      };
    },
    check(row, refs) {
      const problems = [];
      if (!refs.year) problems.push(problem('routeName', 'no current academic year is set up', 'set the current academic year first'));
      const who = findStudent(refs.students, row);
      if (who.error) problems.push(who.error);
      const routeName = text(row.routeName);
      const route = routeName ? refs.routes.get(routeName.toLowerCase()) : null;
      if (!routeName) problems.push(problem('routeName', 'is required', 'the student\'s bus route'));
      else if (!route) problems.push(problem('routeName', 'does not match any route in this school', 'import the routes first, or correct the spelling', routeName));
      const stopName = text(row.stopName);
      if (!stopName) problems.push(problem('stopName', 'is required', 'the stop the student boards at'));
      else if (route && !refs.stops.has(`${route._id}|${stopName.toLowerCase()}`)) problems.push(problem('stopName', `is not a stop on ${route.name}`, 'import the stops first, or correct the spelling', stopName));
      const direction = text(row.direction) ? parseEnum(row.direction, DIRECTION) : 'BOTH';
      if (!direction) problems.push(problem('direction', 'is not a travel direction', 'use BOTH, PICKUP or DROP', text(row.direction)));
      return { values: { admissionNo: who.student?.admissionNo, studentId: who.student ? String(who.student._id) : null, routeName: route?.name ?? routeName, stopName, direction }, problems };
    },
    dupKeys: (v) => [v.studentId && `stu:${v.studentId}`].filter(Boolean),
    write: (ctx, rows) => viaBulk(bulkEnrollStudents, rows, (v) => ({ admissionno: v.admissionNo, routename: v.routeName, stopname: v.stopName, direction: v.direction })),
  },

  /* ── Registers ── */
  {
    key: 'attendance',
    label: 'Attendance',
    noun: 'attendance mark',
    module: 'Attendance',
    link: '/attendance',
    permission: 'attendance.mark',
    route: 'POST /attendance/mark/bulk',
    context: ['className', 'date', 'periodNo'],
    said: [/\battendance\b|\bregister\b|\bpresent\b.*\babsent\b|\babsentees?\b/i, /हाजिरी|उपस्थिति/],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['rollNo', 'studentName'] },
      { key: 'rollNo', label: 'Roll No', type: 'integer', aliases: ['roll no', 'roll number', 'roll', 'rollno', 'रोल नंबर', 'क्रमांक'], example: '1' },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma', note: 'Used to find the student when there is no admission or roll number.' },
      { key: 'status', label: 'Status', required: true, type: 'enum', values: Object.keys(ATTENDANCE), aliases: ['status', 'attendance', 'present absent', 'p a', 'mark', 'remark', 'स्थिति', 'हाजिरी', 'उपस्थिति'], example: 'PRESENT', note: 'PRESENT, ABSENT, LATE, EXCUSED or HALF_DAY. P / A / L / E / H and Hindi words are understood.' },
      { key: 'className', label: 'Class', required: true, fromContext: 'className', type: 'text', aliases: [...CLASS_ALIASES, 'section'], example: 'Class 6 A', note: 'Can instead be said in the chat ("attendance of Class 6 A").' },
      { key: 'date', label: 'Date', required: true, fromContext: 'date', type: 'date', aliases: DATE_ALIASES, example: '2026-10-16', note: 'Can instead be said in the chat ("for today", "for 16 October").' },
      { key: 'note', label: 'Note', type: 'text', aliases: ['note', 'notes', 'remarks', 'reason', 'comment', 'टिप्पणी', 'कारण'], example: '' },
    ],
    headerBonus: (headers, mapping) => (mapping.status !== undefined ? 0.1 : 0),
    async lookups(ctx, rows, context) {
      const sections = await sectionIndex();
      const scope = ctx.actor?.permissions?.['attendance.mark'];
      const allowed = scope === 'ALL' ? null : new Set((await getTeacherSectionIds(ctx.actor.profileId)).map(String));
      const sectionIds = new Set();
      for (const r of rows) {
        const found = findSection(sections, text(r.className) || context.className, allowed);
        if (found.section) sectionIds.add(found.section.id);
      }
      const roster = sectionIds.size
        ? await Enrollment.find({ sectionId: { $in: [...sectionIds] }, status: 'ACTIVE' }).populate('studentId', 'admissionNo firstName lastName').select('sectionId rollNo studentId').lean()
        : [];
      return { sections, allowed, roster };
    },
    check(row, refs, context) {
      const problems = [];
      const cls = findSection(refs.sections, text(row.className) || context.className, refs.allowed);
      if (cls.error) problems.push(cls.error);
      const date = text(row.date) ? parseDate(row.date) : context.date ?? null;
      if (!date) problems.push(problem('date', text(row.date) ? 'is not a date this can read' : 'is required', 'use YYYY-MM-DD or DD/MM/YYYY, or say the date in the chat', text(row.date)));
      const status = parseEnum(row.status, ATTENDANCE);
      if (!text(row.status)) problems.push(problem('status', 'is required', 'P (present) or A (absent)'));
      else if (!status) problems.push(problem('status', 'is not a status the register accepts', 'use PRESENT, ABSENT, LATE, EXCUSED or HALF_DAY (P / A / L / E / H)', text(row.status)));
      let enrollment = null;
      if (cls.section) {
        const roster = refs.roster.filter((e) => String(e.sectionId) === cls.section.id);
        const no = text(row.admissionNo).toLowerCase();
        const roll = text(row.rollNo);
        const name = normaliseHeader(row.studentName);
        if (no) enrollment = roster.find((e) => e.studentId?.admissionNo?.toLowerCase() === no);
        else if (roll) enrollment = roster.find((e) => String(e.rollNo) === String(parseInteger(roll) ?? roll));
        else if (name) {
          const hits = roster.filter((e) => normaliseHeader(`${e.studentId?.firstName ?? ''}${e.studentId?.lastName ?? ''}`) === name);
          if (hits.length > 1) problems.push(problem('studentName', `matches ${hits.length} students in ${cls.section.label}`, 'add the roll number for this row', text(row.studentName)));
          enrollment = hits.length === 1 ? hits[0] : null;
          if (!hits.length) {
            const near = roster.filter((e) => editDistance(normaliseHeader(`${e.studentId?.firstName ?? ''}${e.studentId?.lastName ?? ''}`), name) <= 2);
            if (near.length === 1) enrollment = near[0];
          }
        }
        if (!enrollment && (no || roll || name) && !problems.some((p) => p.field === 'studentName')) {
          problems.push(problem(no ? 'admissionNo' : roll ? 'rollNo' : 'studentName', `does not match a student in ${cls.section.label}`, 'check the student is in that class and the number is spelt as on the roll', text(row.admissionNo) || roll || text(row.studentName)));
        }
        if (!no && !roll && !name) problems.push(problem('admissionNo', 'is required', 'the admission number, roll number or name'));
      }
      return {
        values: {
          sectionId: cls.section?.id, classLabel: cls.section?.label, date, periodNo: context.periodNo ?? null,
          admissionNo: enrollment?.studentId?.admissionNo ?? '', rollNo: enrollment?.rollNo ?? null, status, note: text(row.note),
        },
        problems,
      };
    },
    dupKeys: (v) => [v.sectionId && v.date && v.admissionNo && `att:${v.sectionId}|${v.date}|${v.admissionNo.toLowerCase()}`].filter(Boolean),
    async write(ctx, rows) {
      const out = { imported: 0, failed: 0, errors: [], failedRows: new Set() };
      const scope = ctx.actor?.permissions?.['attendance.mark'];
      const groups = new Map();
      for (const r of rows) {
        const k = `${r.values.sectionId}|${r.values.date}|${r.values.periodNo ?? ''}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      for (const group of groups.values()) {
        const { sectionId, date, periodNo } = group[0].values;
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await markAttendanceBulk(ctx.actor, scope, { sectionId, date, periodNo, rows: group.map((r) => ({ admissionno: r.values.admissionNo, rollno: '', status: r.values.status, note: r.values.note })) });
          out.imported += res.imported ?? 0;
          for (const e of res.errors ?? []) {
            const rowNo = group[(Number(e.row) || 2) - 2]?.rowNo ?? null;
            if (rowNo) out.failedRows.add(rowNo);
            out.failed += 1;
            out.errors.push({ row: rowNo, field: e.field ?? null, problem: e.problem ?? e.error, suggestion: e.suggestion ?? null });
          }
        } catch (err) {
          // The register refused the whole day for this class (not your class, a holiday, too far back).
          for (const r of group) { out.failed += 1; out.failedRows.add(r.rowNo); out.errors.push({ row: r.rowNo, field: 'date', problem: err.message, suggestion: null }); }
        }
      }
      return out;
    },
  },
  {
    key: 'marks',
    label: 'Exam marks',
    noun: 'mark',
    module: 'Exams',
    link: '/exams',
    permission: 'marks.enter',
    route: 'POST /exams/marks (per paper)',
    context: ['className', 'exam', 'subject'],
    said: [/\bmarks?\b|\bscores?\b|\bresults?\b|\bexam\b|\btest\b|\bunit\s+test\b/i, /अंक|परिणाम|नंबर/],
    columns: [
      { key: 'admissionNo', label: 'Admission No', required: true, type: 'text', aliases: STUDENT_REF_ALIASES, example: 'OAK-2026-001', orColumns: ['rollNo', 'studentName'] },
      { key: 'rollNo', label: 'Roll No', type: 'integer', aliases: ['roll no', 'roll number', 'roll', 'rollno', 'रोल नंबर', 'क्रमांक'], example: '1' },
      { key: 'studentName', label: 'Student name', type: 'text', aliases: STUDENT_NAME_ALIASES, example: 'Aarav Sharma' },
      { key: 'marks', label: 'Marks', required: true, type: 'marks', aliases: ['marks', 'marks obtained', 'score', 'obtained', 'total marks obtained', 'mark', 'अंक', 'प्राप्तांक', 'ank', 'number'], example: '42', note: 'A number, or AB (absent) / ML (medical leave). Several subject columns (Maths, Science…) are read as one paper each.' },
      { key: 'exam', label: 'Exam', required: true, fromContext: 'exam', type: 'text', aliases: ['exam', 'exam name', 'test', 'assessment', 'परीक्षा'], example: 'Unit Test 1', note: 'Can instead be said in the chat ("Unit Test 1 marks").' },
      { key: 'subject', label: 'Subject', required: true, fromContext: 'subject', type: 'text', aliases: ['subject', 'paper', 'subject name', 'विषय'], example: 'Mathematics', note: 'Can instead be said in the chat, or given as one column per subject.' },
      { key: 'className', label: 'Class', required: true, fromContext: 'className', type: 'text', aliases: [...CLASS_ALIASES, 'section'], example: 'Class 6 A', note: 'Can instead be said in the chat.' },
      { key: 'remarks', label: 'Remarks', type: 'text', aliases: ['remarks', 'remark', 'comments', 'टिप्पणी'], example: '' },
    ],
    headerBonus: (headers, mapping) => (mapping.marks !== undefined ? 0.1 : 0),
    async lookups(ctx, rows, context) {
      const scope = ctx.actor?.permissions?.['marks.enter'];
      const papers = await listExamSubjects(ctx.actor, scope, null);
      const sections = await sectionIndex();
      const sectionIds = new Set();
      for (const r of rows) {
        const found = findSection(sections, text(r.className) || context.className);
        if (found.section) sectionIds.add(found.section.id);
      }
      const roster = sectionIds.size
        ? await Enrollment.find({ sectionId: { $in: [...sectionIds] }, status: 'ACTIVE' }).populate('studentId', 'admissionNo firstName lastName').select('sectionId rollNo studentId').lean()
        : [];
      const published = papers.length
        ? new Set((await Mark.find({ examSubjectId: { $in: papers.map((p) => p.id) }, status: 'PUBLISHED' }).select('examSubjectId enrollmentId').lean()).map((m) => `${m.examSubjectId}|${m.enrollmentId}`))
        : new Set();
      return { papers, sections, roster, published, scope };
    },
    check(row, refs, context) {
      const problems = [];
      const cls = findSection(refs.sections, text(row.className) || context.className);
      if (cls.error) problems.push(cls.error);
      const examName = text(row.exam) || context.exam || '';
      const subjectName = text(row.subject) || context.subject || '';
      let paper = null;
      if (cls.section) {
        const inClass = refs.papers.filter((p) => classKey(p.class) === cls.section.key);
        const bySubject = subjectName ? inClass.filter((p) => normaliseHeader(p.subject) === normaliseHeader(subjectName) || normaliseHeader(p.subject).startsWith(normaliseHeader(subjectName))) : inClass;
        const byExam = examName ? bySubject.filter((p) => normaliseHeader(p.examName) === normaliseHeader(examName) || normaliseHeader(p.examName).includes(normaliseHeader(examName))) : bySubject;
        if (!subjectName) problems.push(problem('subject', 'is required', 'the subject, as a column or said in the chat'));
        else if (!examName && byExam.length > 1) problems.push(problem('exam', 'is required', `which exam — ${[...new Set(byExam.map((p) => p.examName))].slice(0, 5).join(', ')}?`));
        else if (byExam.length === 1) paper = byExam[0];
        else if (byExam.length > 1) problems.push(problem('exam', `matches ${byExam.length} papers`, 'use the exam\'s full name', examName));
        else {
          const own = refs.scope !== 'ALL';
          problems.push(problem(subjectName && !bySubject.length ? 'subject' : 'exam', own
            ? `${[examName, subjectName].filter(Boolean).join(' ')} for ${cls.section.label} is not one of your papers`
            : `no ${[examName, subjectName].filter(Boolean).join(' ')} paper for ${cls.section.label}`,
          own ? `you enter marks for: ${refs.papers.slice(0, 6).map((p) => `${p.examName} ${p.subject} (${p.class})`).join('; ') || 'no papers yet'}` : 'set the paper up on the Exams screen first', [examName, subjectName].filter(Boolean).join(' ')));
        }
      }
      let enrollment = null;
      if (cls.section) {
        const roster = refs.roster.filter((e) => String(e.sectionId) === cls.section.id);
        const no = text(row.admissionNo).toLowerCase();
        const roll = text(row.rollNo);
        const name = normaliseHeader(row.studentName);
        if (no) enrollment = roster.find((e) => e.studentId?.admissionNo?.toLowerCase() === no);
        else if (roll) enrollment = roster.find((e) => String(e.rollNo) === String(parseInteger(roll) ?? roll));
        else if (name) {
          const hits = roster.filter((e) => normaliseHeader(`${e.studentId?.firstName ?? ''}${e.studentId?.lastName ?? ''}`) === name);
          enrollment = hits.length === 1 ? hits[0] : null;
          if (hits.length > 1) problems.push(problem('studentName', `matches ${hits.length} students`, 'add the roll number for this row', text(row.studentName)));
        }
        if (!enrollment && !problems.some((p) => p.field === 'studentName')) {
          problems.push(problem(no ? 'admissionNo' : roll ? 'rollNo' : 'studentName', (no || roll || name) ? `does not match a student in ${cls.section.label}` : 'is required', 'the admission number, roll number or name of a student in the class', text(row.admissionNo) || roll || text(row.studentName)));
        }
      }
      const raw = text(row.marks);
      let marks = null;
      let absence = null;
      if (!raw) problems.push(problem('marks', 'is required', 'a number, or AB / ML'));
      else if (/^(ab|absent|a|ml|medical|medical leave)$/i.test(raw)) absence = /^m/i.test(raw) ? 'ML' : 'AB';
      else {
        const n = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(n)) problems.push(problem('marks', 'is not a number', 'use a number, or AB (absent) / ML (medical leave)', raw));
        else if (paper && (n < 0 || n > (paper.maxMarks ?? 100))) problems.push(problem('marks', `must be between 0 and ${paper.maxMarks ?? 100} for this paper`, 'check the entry', raw));
        else marks = n;
      }
      let skip = null;
      if (paper && enrollment && refs.published.has(`${paper.id}|${enrollment._id}`)) skip = 'already published (published marks are locked)';
      return {
        values: {
          examSubjectId: paper ? String(paper.id) : null, paper: paper ? `${paper.examName} ${paper.subject} (${paper.class})` : null,
          enrollmentId: enrollment ? String(enrollment._id) : null, admissionNo: enrollment?.studentId?.admissionNo ?? null,
          marks, absence, remarks: text(row.remarks),
        },
        problems,
        skip,
      };
    },
    dupKeys: (v) => [v.examSubjectId && v.enrollmentId && `mk:${v.examSubjectId}|${v.enrollmentId}`].filter(Boolean),
    async write(ctx, rows, context, refs) {
      const out = { imported: 0, failed: 0, errors: [], failedRows: new Set() };
      const byPaper = new Map();
      for (const r of rows) byPaper.set(r.values.examSubjectId, [...(byPaper.get(r.values.examSubjectId) ?? []), r]);
      for (const [examSubjectId, group] of byPaper) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await enterMarks(ctx.actor, refs.scope, {
            examSubjectId,
            entries: group.map((r) => ({ enrollmentId: r.values.enrollmentId, marks: r.values.absence ?? r.values.marks, ...(r.values.remarks && { remarks: r.values.remarks }) })),
          });
          out.imported += group.length;
        } catch (err) {
          for (const r of group) { out.failed += 1; out.failedRows.add(r.rowNo); out.errors.push({ row: r.rowNo, field: 'marks', problem: err.message, suggestion: null }); }
        }
      }
      return out;
    },
  },
];

/**
 * A wide marks sheet -- one column per subject ("Name | Maths | Science") --
 * becomes one row per student per subject. Columns whose header is a subject
 * of the school's papers are melted; everything else is kept on every row.
 */
export function meltSubjectColumns(headers, rows, rowNumbers, subjectNames) {
  const subjects = new Map(subjectNames.map((s) => [normaliseHeader(s), s]));
  const subjectCols = headers
    .map((h, i) => ({ i, subject: subjects.get(normaliseHeader(h)) ?? [...subjects.entries()].find(([k]) => k.length >= 4 && normaliseHeader(h).startsWith(k))?.[1] }))
    .filter((c) => c.subject);
  if (subjectCols.length < 1) return null;
  const keep = headers.map((h, i) => i).filter((i) => !subjectCols.some((c) => c.i === i));
  const outHeaders = [...keep.map((i) => headers[i]), 'Subject', 'Marks'];
  const outRows = [];
  const outNumbers = [];
  rows.forEach((row, r) => {
    for (const c of subjectCols) {
      if (!String(row[c.i] ?? '').trim()) continue;
      outRows.push([...keep.map((i) => row[i]), c.subject, row[c.i]]);
      outNumbers.push(rowNumbers[r]);
    }
  });
  return { headers: outHeaders, rows: outRows, rowNumbers: outNumbers, melted: subjectCols.map((c) => c.subject) };
}

export const SCHEMA_BY_KEY = Object.fromEntries(IMPORT_SCHEMAS.map((s) => [s.key, s]));

/** Whether this actor may import into a schema: the route's own permission, at its scope. */
export function mayImport(actor, schema) {
  const held = actor?.permissions?.[schema.permission];
  if (!held) return false;
  return schema.minScope !== 'ALL' || held === 'ALL';
}

/** The schemas this actor may import into. */
export function schemasFor(actor) {
  return IMPORT_SCHEMAS.filter((s) => mayImport(actor, s));
}

/** Every permission an import needs (for the MCP tools' anyOf). */
export const IMPORT_PERMISSIONS = [...new Set(IMPORT_SCHEMAS.map((s) => s.permission))];
