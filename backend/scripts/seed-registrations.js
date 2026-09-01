/**
 * Fills in subject-registration data for every enrolled student in an EXISTING
 * school database, and makes sure every teacher who owns an elective ends up
 * with something in their review queue.
 *
 * This is the companion to add-electives.js. That script creates the *offerings*
 * (what a class is allowed to register for); this one creates the
 * *registrations* (who actually took what, and how staff decided).
 *
 * Like add-electives.js it is strictly additive and narrow:
 *   - it only ever writes SubjectRegistration rows, plus (optionally) a
 *     teacherId onto an elective offering that has none, so the offering lands
 *     in somebody's queue instead of only an admin's;
 *   - it never creates, edits or deletes an account, profile, student,
 *     enrolment, grade, section, term or subject;
 *   - it never touches a registration that already exists.
 *
 * Dry run by default. Nothing is written until you pass --apply.
 *
 *   node scripts/seed-registrations.js                     # plan only
 *   node scripts/seed-registrations.js --apply             # commit the plan
 *   node scripts/seed-registrations.js --term "Term 2"     # pick the term
 *   node scripts/seed-registrations.js --grades 8,9,10     # limit to some grades
 *   node scripts/seed-registrations.js --per-student 3     # electives each (default 2)
 *
 * Idempotent: a student who already has a registration on an offering — in any
 * status, decided or not — is skipped, so re-running converges rather than
 * duplicating. Which student gets which elective, and in which state, is
 * derived from the student's own id, so a second run makes the same choices as
 * the first.
 */
import 'dotenv/config';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import readline from 'node:readline/promises';
import { AcademicYear, Term, Grade, Section, SubjectOffering } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
// Imported for its side effect: populating a section's class teacher or an
// offering's teacher resolves the 'Profile' ref, which mongoose can only do
// once that model has been registered on the connection.
import '../src/models/profile.model.js';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const TERM_NAME = argValue('--term');
const ONLY_GRADES = argValue('--grades')?.split(',').map((n) => Number(n.trim())).filter(Number.isFinite) ?? null;
const PER_STUDENT = Math.max(1, Number(argValue('--per-student') ?? 2) || 2);

// A registration is only worth creating against a seat-holding status; the two
// below are what the API counts against capacity (see registration.service.js).
const SEAT_HOLDING = ['PENDING', 'APPROVED'];

// Roughly 60% approved / 30% pending / 10% rejected, so all three states are
// visible on the student page and the staff queue is not empty.
const STATUS_WHEEL = [
  'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED',
  'PENDING', 'PENDING', 'PENDING',
  'REJECTED',
];

const REJECTION_NOTES = [
  'Clashes with another activity in this slot.',
  'Class is oversubscribed this term — reapply next term.',
  'Prerequisite not met yet.',
];

// Deterministic, so a re-run reproduces the same allocation instead of
// reshuffling everybody's electives.
const hashOf = (value) => {
  const s = String(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

const uri = process.env.MONGO_URI || process.env.MONGO_URI_ATLAS;
if (!uri) {
  console.error('MONGO_URI is not set.');
  process.exit(1);
}

const redacted = uri.replace(/\/\/[^@]*@/, '//***@');
const looksRemote = !/localhost|127\.0\.0\.1/.test(uri);

console.log('\n  Target : ' + redacted);
console.log('  Mode   : ' + (APPLY ? 'APPLY — changes will be written' : 'DRY RUN — nothing will be written'));
if (looksRemote && APPLY) console.log('  \x1b[33mThis is a REMOTE database.\x1b[0m');
console.log();

await mongoose.connect(uri);

const bail = async (message) => {
  console.error('  ' + message);
  await mongoose.disconnect();
  process.exit(1);
};

// ── locate the existing structure (read-only) ───────────────────────────────
const year = await AcademicYear.findOne({ isCurrent: true }) ?? await AcademicYear.findOne().sort({ startsOn: -1 });
if (!year) await bail('No academic year exists. Set the school up first — this script only adds registrations.');

const terms = await Term.find({ academicYearId: year._id }).sort({ startsOn: 1 });
if (terms.length === 0) await bail(`No terms exist for ${year.name}.`);

// Same rule add-electives.js uses: prefer the term running now, else the next
// one that has not ended, else the last.
const now = new Date();
const chosenTerm = TERM_NAME
  ? terms.find((t) => t.name.toLowerCase() === TERM_NAME.toLowerCase())
  : terms.find((t) => t.startsOn <= now && t.endsOn >= now)
    ?? terms.find((t) => t.endsOn >= now)
    ?? terms.at(-1);

if (!chosenTerm) await bail(`No term named "${TERM_NAME}". Available: ${terms.map((t) => t.name).join(', ')}`);

const grades = await Grade.find(ONLY_GRADES ? { level: { $in: ONLY_GRADES } } : {}).sort({ level: 1 });
const sections = await Section.find({ gradeId: { $in: grades.map((g) => g._id) } })
  .populate('gradeId')
  .populate('classTeacherId', 'displayName');

console.log(`  Year     : ${year.name}`);
console.log(`  Term     : ${chosenTerm.name}  (${chosenTerm.startsOn.toISOString().slice(0, 10)} → ${chosenTerm.endsOn.toISOString().slice(0, 10)})${chosenTerm.endsOn < now ? '  \x1b[33m← already ended\x1b[0m' : ''}`);
console.log(`  Grades   : ${grades.map((g) => g.name).join(', ') || 'none'}`);
console.log(`  Divisions: ${sections.length}\n`);

if (sections.length === 0) await bail('No sections found. Nothing to do.');

const offerings = await SubjectOffering.find({
  isElective: true,
  termId: chosenTerm._id,
  sectionId: { $in: sections.map((s) => s._id) },
})
  .populate('subjectId', 'name code')
  .populate('teacherId', 'displayName');

if (offerings.length === 0) {
  await bail(
    `No elective offerings exist for ${chosenTerm.name}.\n` +
    '  Create them first:  npm run electives:apply\n' +
    '  Registrations can only point at an elective offering, so there is nothing to register for yet.'
  );
}

// Offerings grouped by the section they belong to — a student may only register
// for electives offered to their own division.
const offeringsBySection = new Map();
for (const off of offerings) {
  const key = off.sectionId.toString();
  if (!offeringsBySection.has(key)) offeringsBySection.set(key, []);
  offeringsBySection.get(key).push(off);
}
// Stable order per section, so the deterministic rotation below means the same
// thing on every run regardless of how Mongo returned the documents.
for (const list of offeringsBySection.values()) {
  list.sort((a, b) => a._id.toString().localeCompare(b._id.toString()));
}

// ── who is enrolled ─────────────────────────────────────────────────────────
const enrollments = await Enrollment.find({
  academicYearId: year._id,
  status: 'ACTIVE',
  sectionId: { $in: sections.map((s) => s._id) },
}).select('studentId sectionId');

if (enrollments.length === 0) await bail(`No active enrolments for ${year.name}. Nothing to do.`);

// Students that were soft-deleted still have enrolment rows; the API filters
// them out, so registering them would create data no page will ever show.
const liveStudentIds = new Set(
  (await Student.find({ _id: { $in: enrollments.map((e) => e.studentId) }, deletedAt: null }).select('_id'))
    .map((s) => s._id.toString())
);

// ── current state, so the plan only covers what is missing ──────────────────
const existing = await SubjectRegistration.find({
  subjectOfferingId: { $in: offerings.map((o) => o._id) },
}).select('studentId subjectOfferingId status');

// Two different questions, and conflating them is what makes a re-run
// duplicate: "has this student already been dealt with on this offering?"
// counts every status, while "is there a seat left?" counts only the two that
// hold one. A rejected row holds no seat but is still a decision that exists —
// seeding a second one on top of it would invent history.
const decidedKeys = new Set(); // `${studentId}:${offeringId}` — any status
const seatsTaken = new Map(); // offeringId → seats already held
for (const reg of existing) {
  decidedKeys.add(`${reg.studentId}:${reg.subjectOfferingId}`);
  if (!SEAT_HOLDING.includes(reg.status)) continue;
  const key = reg.subjectOfferingId.toString();
  seatsTaken.set(key, (seatsTaken.get(key) ?? 0) + 1);
}

// ── build the plan ──────────────────────────────────────────────────────────
// One pass, pure: decide everything first so the dry run and the apply are
// guaranteed to describe the same writes.
const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
const offeringById = new Map(offerings.map((o) => [o._id.toString(), o]));

const planned = [];
const skipped = { alreadyRegistered: 0, full: 0, deletedStudent: 0, noOfferings: 0 };
// Guarantees each division contributes at least one PENDING row, so every
// teacher owning electives there opens a queue with something in it rather
// than an empty state.
const sectionHasPending = new Set();

// Sorted so the allocation does not depend on document return order.
const orderedEnrollments = [...enrollments].sort((a, b) =>
  a.studentId.toString().localeCompare(b.studentId.toString())
);

for (const enr of orderedEnrollments) {
  const studentKey = enr.studentId.toString();
  if (!liveStudentIds.has(studentKey)) { skipped.deletedStudent++; continue; }

  const sectionKey = enr.sectionId.toString();
  const available = offeringsBySection.get(sectionKey) ?? [];
  if (available.length === 0) { skipped.noOfferings++; continue; }

  const seed = hashOf(studentKey);
  const start = seed % available.length;
  let given = 0;

  for (let step = 0; step < available.length && given < PER_STUDENT; step++) {
    const offering = available[(start + step) % available.length];
    const offeringKey = offering._id.toString();

    if (decidedKeys.has(`${studentKey}:${offeringKey}`)) { skipped.alreadyRegistered++; given++; continue; }

    // First row for a division is forced PENDING; after that, follow the wheel.
    let status = sectionHasPending.has(sectionKey)
      ? STATUS_WHEEL[(seed + step) % STATUS_WHEEL.length]
      : 'PENDING';

    // A REJECTED row holds no seat, so the cap only constrains the other two.
    if (SEAT_HOLDING.includes(status) && offering.capacity != null) {
      const taken = seatsTaken.get(offeringKey) ?? 0;
      if (taken >= offering.capacity) {
        // Full: record it as a rejection rather than dropping the student
        // silently — a full elective with a queue of rejections is the honest
        // shape of the data, and it keeps the student's page non-empty.
        status = 'REJECTED';
        skipped.full++;
      }
    }

    decidedKeys.add(`${studentKey}:${offeringKey}`);
    if (SEAT_HOLDING.includes(status)) {
      seatsTaken.set(offeringKey, (seatsTaken.get(offeringKey) ?? 0) + 1);
    }
    if (status === 'PENDING') sectionHasPending.add(sectionKey);

    planned.push({
      studentId: enr.studentId,
      sectionKey,
      offeringId: offering._id,
      status,
      note: status === 'REJECTED' ? REJECTION_NOTES[(seed + step) % REJECTION_NOTES.length] : null,
    });
    given++;
  }
}

// Offerings with no teacher sit in nobody's queue but an admin's. Filling in
// the division's class teacher is the one non-registration write this script
// makes, and only where the field is currently empty.
const teacherFixes = [];
for (const off of offerings) {
  if (off.teacherId) continue;
  const section = sectionById.get(off.sectionId.toString());
  if (!section?.classTeacherId) continue;
  teacherFixes.push({
    offeringId: off._id,
    teacherProfileId: section.classTeacherId._id ?? section.classTeacherId,
    label: `${section.gradeId?.name ?? '?'} ${section.name} · ${off.subjectId?.name ?? '?'}`,
    teacherName: section.classTeacherId.displayName ?? 'class teacher',
  });
}

// ── show the plan ───────────────────────────────────────────────────────────
const counts = planned.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
const studentsCovered = new Set(planned.map((p) => p.studentId.toString())).size;

const line = (n, s) => `  ${String(n).padStart(5)}  ${s}`;
console.log('  PLAN');
console.log('  ' + '─'.repeat(66));
console.log(line(planned.length, 'registrations to create'));
console.log(line(counts.APPROVED ?? 0, '  approved'));
console.log(line(counts.PENDING ?? 0, '  pending  (these are the staff review queue)'));
console.log(line(counts.REJECTED ?? 0, '  rejected'));
console.log(line(studentsCovered, `students covered (up to ${PER_STUDENT} elective(s) each)`));
console.log(line(teacherFixes.length, 'offerings to give a teacher (currently unassigned)'));
console.log(line(skipped.alreadyRegistered, 'already have a registration — left alone'));
if (skipped.deletedStudent) console.log(line(skipped.deletedStudent, 'withdrawn students — skipped'));
if (skipped.noOfferings) console.log(line(skipped.noOfferings, 'students whose division offers no electives — skipped'));
console.log();

// Per-division breakdown: the quickest way to see a class that will still look
// empty after this runs.
const byDivision = new Map();
for (const p of planned) {
  const section = sectionById.get(p.sectionKey);
  const label = `${section?.gradeId?.name ?? '?'} ${section?.name ?? '?'}`;
  const row = byDivision.get(label) ?? { total: 0, pending: 0, teacher: section?.classTeacherId?.displayName ?? '—' };
  row.total++;
  if (p.status === 'PENDING') row.pending++;
  byDivision.set(label, row);
}

if (byDivision.size) {
  console.log('  Division      Registrations   Pending   Class teacher');
  console.log('  ' + '─'.repeat(66));
  for (const [label, row] of [...byDivision].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${label.padEnd(13)} ${String(row.total).padStart(13)} ${String(row.pending).padStart(9)}   ${row.teacher}`);
  }
  console.log();
}

if (teacherFixes.length) {
  console.log('  Offerings that will be assigned to their class teacher:');
  for (const f of teacherFixes.slice(0, 8)) console.log(`    ${f.label.padEnd(34)} → ${f.teacherName}`);
  if (teacherFixes.length > 8) console.log(`    … and ${teacherFixes.length - 8} more`);
  console.log();
}

const totalWrites = planned.length + teacherFixes.length;

if (!APPLY) {
  console.log(`  Dry run — nothing written. ${totalWrites} change(s) would be made.`);
  console.log('  Re-run with --apply to commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

if (totalWrites === 0) {
  console.log('  Nothing to do — every enrolled student already has registrations.\n');
  await mongoose.disconnect();
  process.exit(0);
}

// ── confirm before writing to a remote database ─────────────────────────────
if (looksRemote && !YES) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`  Write ${totalWrites} change(s) to ${redacted}? Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('  Aborted. Nothing was written.\n');
    await mongoose.disconnect();
    process.exit(1);
  }
}

// ── apply ───────────────────────────────────────────────────────────────────
for (const fix of teacherFixes) {
  await SubjectOffering.updateOne(
    { _id: fix.offeringId, teacherId: null },
    { $set: { teacherId: fix.teacherProfileId } }
  );
}

// A decided registration needs a decider for the audit story the UI shows
// ("approved by …"). The offering's teacher is the person who would have made
// that call, so use them; an offering with no teacher leaves it null, which the
// DTO already renders as blank.
const deciderFor = (offeringId) => {
  const off = offeringById.get(offeringId.toString());
  const assigned = off?.teacherId?._id ?? off?.teacherId ?? null;
  if (assigned) return assigned;
  const fix = teacherFixes.find((f) => f.offeringId.toString() === offeringId.toString());
  return fix?.teacherProfileId ?? null;
};

let created = 0;
let raced = 0;

for (const p of planned) {
  const decided = p.status !== 'PENDING';
  try {
    await SubjectRegistration.create({
      studentId: p.studentId,
      subjectOfferingId: p.offeringId,
      academicYearId: year._id,
      status: p.status,
      decidedByProfileId: decided ? deciderFor(p.offeringId) : null,
      decidedAt: decided ? new Date() : null,
      decisionNote: p.note,
    });
    created++;
  } catch (err) {
    // The partial unique index is the real arbiter of "one live request per
    // student per offering". If something registered between the read above and
    // this write, that row wins — this script never overwrites a real request.
    if (err?.code === 11000) { raced++; continue; }
    throw err;
  }
}

const totals = {
  all: await SubjectRegistration.countDocuments({ academicYearId: year._id }),
  pending: await SubjectRegistration.countDocuments({ academicYearId: year._id, status: 'PENDING' }),
};

await mongoose.disconnect();

console.log(`\n  Created ${created} registration(s)${raced ? `, skipped ${raced} that were created concurrently` : ''}.`);
if (teacherFixes.length) console.log(`  Assigned a teacher to ${teacherFixes.length} offering(s).`);
console.log(`  ${totals.all} registrations now exist for ${year.name} — ${totals.pending} awaiting a decision.\n`);
console.log('  Visible immediately at:');
console.log('    /student/subjects        each student sees their own electives and status');
console.log('    /teacher/registrations   the queue for divisions that teacher owns');
console.log('    /admin/registrations     every request, school-wide\n');
