/**
 * Seeds elective subject-registration data across every division.
 *
 * Matches the shape seed_school_data.js builds: Classes 5–10, sections A and B,
 * i.e. 12 divisions. Every division gets its own elective offerings, its own
 * class teacher, and its own students — offerings are per-section, so a student
 * only ever sees the electives attached to their own division.
 *
 * The chain each student needs, and which this builds end to end:
 *
 *   Account ──> Profile (STUDENT role, grants registrations.apply)
 *                  │
 *                  └─> Student.profileId          ← links the login to the child
 *                          │
 *                          └─> Enrollment (ACTIVE) ──> Section
 *                                                        ▲
 *                        SubjectOffering (isElective) ────┘
 *                          same section, term not yet ended
 *
 *   MONGO_URI=<uri> npm run seed:electives
 *
 * Safe to re-run: everything is upserted, and registrations are rebuilt.
 */
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import {
  AcademicYear, Term, Grade, Section, Subject, SubjectOffering,
} from '../src/models/academics.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';

const PASSWORD = 'localdev123';
const GRADES = [5, 6, 7, 8, 9, 10];
const SECTIONS = ['A', 'B'];
const STUDENTS_PER_DIVISION = 5;

/**
 * Junior and senior years offer different electives — the same subject
 * catalogue school-wide, but each division only offers its own band's three.
 * Capacities are deliberately small so "seats left" and "Full" are both
 * reachable without registering by hand first.
 */
const ELECTIVE_BANDS = {
  junior: [ // Classes 5–7
    { name: 'Art & Craft', code: 'ART', capacity: 6 },
    { name: 'Music', code: 'MUS', capacity: 4 },
    { name: 'Dance', code: 'DAN', capacity: null }, // unlimited
  ],
  senior: [ // Classes 8–10
    { name: 'French', code: 'FRE', capacity: 4 },
    { name: 'Robotics', code: 'ROB', capacity: 6 },
    { name: 'Debate', code: 'DEB', capacity: null },
  ],
};
const bandFor = (level) => (level <= 7 ? 'junior' : 'senior');

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Start the backend with `npm run dev:local` and pass the URI it prints.');
  process.exit(1);
}

await mongoose.connect(uri);
console.log(`connected: ${uri.replace(/\/\/[^@]*@/, '//***@')}\n`);

// ── roles ───────────────────────────────────────────────────────────────────
// Taken from the permission catalogue so the grants are exactly what the app
// enforces, rather than a hand-written guess that drifts.
const roles = {};
for (const key of ['ADMIN', 'TEACHER', 'STUDENT']) {
  const def = SYSTEM_ROLES.find((r) => r.key === key);
  roles[key] = await Role.findOneAndUpdate(
    { key },
    { key, name: def.name, isSystem: true, permissions: def.grants },
    { upsert: true, new: true }
  );
}

let phoneSeq = 1000;
async function makeUser({ email, displayName, roleKey }) {
  const account = await Account.findOneAndUpdate(
    { email },
    {
      email,
      phoneE164: `+9199000${String(phoneSeq++).padStart(5, '0')}`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
    { upsert: true, new: true }
  );
  const profile = await Profile.findOneAndUpdate(
    { accountId: account._id, roleId: roles[roleKey]._id },
    { accountId: account._id, roleId: roles[roleKey]._id, displayName, status: 'ACTIVE' },
    { upsert: true, new: true }
  );
  return profile;
}

// ── year and term ───────────────────────────────────────────────────────────
const year = await AcademicYear.findOneAndUpdate(
  { name: '2026-27' },
  { name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true },
  { upsert: true, new: true }
);

// endsOn must be in the future: register() refuses a closed term.
const term = await Term.findOneAndUpdate(
  { academicYearId: year._id, name: 'Term 1' },
  {
    academicYearId: year._id,
    name: 'Term 1',
    startsOn: new Date('2026-04-01'),
    endsOn: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
  },
  { upsert: true, new: true }
);

// ── subjects (school-wide catalogue) ────────────────────────────────────────
const subjects = {};
for (const def of [...ELECTIVE_BANDS.junior, ...ELECTIVE_BANDS.senior]) {
  subjects[def.code] = await Subject.findOneAndUpdate(
    { name: def.name }, { name: def.name, code: def.code }, { upsert: true, new: true }
  );
}
// One core subject per division, to prove non-electives stay out of the list.
subjects.MATH = await Subject.findOneAndUpdate(
  { name: 'Mathematics' }, { name: 'Mathematics', code: 'MATH' }, { upsert: true, new: true }
);

await makeUser({ email: 'admin@local.test', displayName: 'Local Admin', roleKey: 'ADMIN' });

// ── divisions ───────────────────────────────────────────────────────────────
const divisions = [];

for (const level of GRADES) {
  const grade = await Grade.findOneAndUpdate(
    { name: `Class ${level}` }, { name: `Class ${level}`, level }, { upsert: true, new: true }
  );

  // One teacher per grade, class teacher of both its sections. That also makes
  // them the owner of those divisions' review queues at OWN scope.
  const teacher = await makeUser({
    email: `teacher${level}@local.test`,
    displayName: `Teacher Class ${level}`,
    roleKey: 'TEACHER',
  });

  for (const secName of SECTIONS) {
    const section = await Section.findOneAndUpdate(
      { gradeId: grade._id, name: secName },
      { gradeId: grade._id, name: secName, classTeacherId: teacher._id },
      { upsert: true, new: true }
    );

    const label = `Class ${level} ${secName}`;
    const slug = `${level}${secName.toLowerCase()}`;

    // Core subject — must NOT appear on the student's elective list.
    await SubjectOffering.findOneAndUpdate(
      { sectionId: section._id, subjectId: subjects.MATH._id, termId: term._id },
      {
        sectionId: section._id, subjectId: subjects.MATH._id, termId: term._id,
        teacherId: teacher._id, isElective: false, capacity: null,
      },
      { upsert: true, new: true }
    );

    const band = ELECTIVE_BANDS[bandFor(level)];
    const offerings = {};
    for (const def of band) {
      offerings[def.code] = await SubjectOffering.findOneAndUpdate(
        { sectionId: section._id, subjectId: subjects[def.code]._id, termId: term._id },
        {
          sectionId: section._id, subjectId: subjects[def.code]._id, termId: term._id,
          teacherId: teacher._id, isElective: true, capacity: def.capacity,
        },
        { upsert: true, new: true }
      );
    }

    // Students. The first in each division is the one whose login is printed;
    // the rest exist to occupy seats so the UI states are visible immediately.
    const students = [];
    for (let i = 0; i < STUDENTS_PER_DIVISION; i++) {
      const admissionNo = `ADM-2026-${slug.toUpperCase()}-${String(i + 1).padStart(2, '0')}`;
      const email = i === 0 ? `s${slug}@local.test` : `s${slug}.${i + 1}@local.test`;
      const profile = await makeUser({
        email,
        displayName: `${label} Student ${i + 1}`,
        roleKey: 'STUDENT',
      });
      const student = await Student.findOneAndUpdate(
        { admissionNo },
        {
          admissionNo,
          firstName: `Student${i + 1}`,
          lastName: label.replace(/\s/g, ''),
          status: 'ACTIVE',
          profileId: profile._id,
        },
        { upsert: true, new: true }
      );
      await Enrollment.findOneAndUpdate(
        { studentId: student._id, academicYearId: year._id },
        {
          studentId: student._id, sectionId: section._id, academicYearId: year._id,
          status: 'ACTIVE', rollNo: i + 1,
        },
        { upsert: true, new: true }
      );
      students.push({ student, email });
    }

    divisions.push({ label, slug, section, band, offerings, students, teacherEmail: `teacher${level}@local.test` });
  }
}

// ── registrations: give every division a different, visible state ───────────
await SubjectRegistration.deleteMany({});

const reg = (studentId, offeringId, status, decidedBy = null) =>
  SubjectRegistration.create({
    studentId,
    subjectOfferingId: offeringId,
    academicYearId: year._id,
    status,
    ...(decidedBy ? { decidedByProfileId: decidedBy, decidedAt: new Date() } : {}),
  });

const summary = [];
for (const [i, d] of divisions.entries()) {
  const [first, ...others] = d.students;
  const capped = d.band.find((b) => b.capacity !== null && b.capacity <= 4); // Music or French
  const cappedOffering = d.offerings[capped.code];
  const uncapped = d.offerings[d.band.find((b) => b.capacity === null).code];

  // Rotate the state per division so every case exists somewhere in the data.
  const state = i % 3;
  let note;

  if (state === 0) {
    // The capped elective is filled to its last seat by other students.
    for (let n = 0; n < capped.capacity - 1; n++) {
      await reg(others[n % others.length].student._id, cappedOffering, n === 0 ? 'APPROVED' : 'PENDING');
    }
    note = `${capped.name} has 1 seat left`;
  } else if (state === 1) {
    // Completely full, so the student sees "Full" with no Register button.
    for (let n = 0; n < capped.capacity; n++) {
      await reg(others[n % others.length].student._id, cappedOffering, 'APPROVED');
    }
    note = `${capped.name} is FULL`;
  } else {
    // The printed student already has one approved and one pending.
    await reg(first.student._id, cappedOffering, 'APPROVED');
    await reg(first.student._id, uncapped, 'PENDING');
    note = 'printed student: 1 approved, 1 pending';
  }

  summary.push({ ...d, note });
}

const totals = {
  divisions: divisions.length,
  offerings: await SubjectOffering.countDocuments({ isElective: true }),
  students: await Student.countDocuments({}),
  registrations: await SubjectRegistration.countDocuments({}),
};

await mongoose.disconnect();

console.log(`Seeded ${totals.divisions} divisions — Classes ${GRADES[0]}–${GRADES.at(-1)}, sections ${SECTIONS.join('/')}`);
console.log(`  ${totals.offerings} elective offerings · ${totals.students} students · ${totals.registrations} registrations\n`);
console.log(`  Password for every account: ${PASSWORD}\n`);
console.log('  admin@local.test                 ADMIN    → /admin/classrooms, /admin/registrations');
console.log('  teacher5@local.test … teacher10  TEACHER  → /teacher/registrations (their own grade only)\n');
console.log('  Division      Student login          Electives offered                 Starting state');
console.log('  ' + '─'.repeat(100));
for (const d of summary) {
  console.log(
    `  ${d.label.padEnd(13)} ${d.students[0].email.padEnd(22)} ` +
    `${d.band.map((b) => b.name).join(', ').padEnd(34)} ${d.note}`
  );
}
console.log('\n  Mathematics is offered to every division but is NOT elective —');
console.log('  it must never appear on a student\'s registration page.\n');
