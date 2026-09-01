/**
 * Adds elective subject offerings to an EXISTING school database.
 *
 * This is the production counterpart to seed-electives-demo.js. The difference
 * matters: the demo script invents students, teachers and accounts, which would
 * be catastrophic to run against real data. This one **only ever writes
 * Subject and SubjectOffering rows**. It never creates, edits or deletes an
 * account, profile, student, enrolment, grade, section or term — if the
 * structure it needs is not already there, it reports that and stops.
 *
 * Dry run by default. Nothing is written until you pass --apply.
 *
 *   node scripts/add-electives.js                    # plan only, writes nothing
 *   node scripts/add-electives.js --apply            # commit the plan
 *   node scripts/add-electives.js --term "Midterm"   # pick the term explicitly
 *   node scripts/add-electives.js --grades 8,9,10    # limit to some grades
 *
 * Idempotent: re-running converges on the same state rather than duplicating.
 */
// Loaded the same way src/config/env.js does it, so `npm run electives:plan`
// picks up MONGO_URI from .env without having to pass it on the command line.
import 'dotenv/config';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import readline from 'node:readline/promises';
import { AcademicYear, Term, Grade, Section, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';

// ── what to offer ───────────────────────────────────────────────────────────
// Edit this to match your school. `grades` is matched against Grade.level.
// `capacity: null` means unlimited.
const ALL_GRADES = [5, 6, 7, 8, 9, 10, 11];

const ELECTIVES = [
  { name: 'Art & Craft', code: 'ART', grades: ALL_GRADES, capacity: 30 },
  { name: 'Music',       code: 'MUS', grades: ALL_GRADES, capacity: 25 },
  { name: 'Dance',       code: 'DAN', grades: ALL_GRADES, capacity: null },
  { name: 'French',      code: 'FRE', grades: ALL_GRADES, capacity: 25 },
  { name: 'Robotics',    code: 'ROB', grades: ALL_GRADES, capacity: 20 },
  { name: 'Debate',      code: 'DEB', grades: ALL_GRADES, capacity: null },
];

// NOTE ON CORE SUBJECTS
// Mathematics, Science, English, Social Science and Computer Science are
// deliberately NOT listed above. Marking a subject elective hides it from a
// student's timetable until their registration is approved (see
// unregisteredElectiveIds in modules/timetable/timetable.service.js) — so
// making the core subjects registerable would blank out every student's
// timetable. Core subjects stay automatic; only the optional ones are opt-in.

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

// ── locate the existing structure ───────────────────────────────────────────
// Everything below is read-only. If the school is not already set up, this
// script is not the tool to set it up.
const year = await AcademicYear.findOne({ isCurrent: true }) ?? await AcademicYear.findOne().sort({ startsOn: -1 });
if (!year) {
  console.error('  No academic year exists. Set the school up first — this script only adds electives.');
  await mongoose.disconnect();
  process.exit(1);
}

const terms = await Term.find({ academicYearId: year._id }).sort({ startsOn: 1 });
if (terms.length === 0) {
  console.error(`  No terms exist for ${year.name}.`);
  await mongoose.disconnect();
  process.exit(1);
}

// Prefer the term that is running now; otherwise the next one that has not
// ended; otherwise the last. Registering against a finished term is refused by
// the API, so picking one that has ended would produce offerings nobody can use.
const now = new Date();
const chosenTerm = TERM_NAME
  ? terms.find((t) => t.name.toLowerCase() === TERM_NAME.toLowerCase())
  : terms.find((t) => t.startsOn <= now && t.endsOn >= now)
    ?? terms.find((t) => t.endsOn >= now)
    ?? terms.at(-1);

if (!chosenTerm) {
  console.error(`  No term named "${TERM_NAME}". Available: ${terms.map((t) => t.name).join(', ')}`);
  await mongoose.disconnect();
  process.exit(1);
}

const termEnded = chosenTerm.endsOn < now;
const grades = await Grade.find(ONLY_GRADES ? { level: { $in: ONLY_GRADES } } : {}).sort({ level: 1 });
const sections = await Section.find({ gradeId: { $in: grades.map((g) => g._id) } }).populate('gradeId');

console.log(`  Year     : ${year.name}`);
console.log(`  Term     : ${chosenTerm.name}  (${chosenTerm.startsOn.toISOString().slice(0, 10)} → ${chosenTerm.endsOn.toISOString().slice(0, 10)})${termEnded ? '  \x1b[33m← already ended\x1b[0m' : ''}`);
console.log(`  Grades   : ${grades.map((g) => g.name).join(', ') || 'none'}`);
console.log(`  Divisions: ${sections.length}\n`);

if (sections.length === 0) {
  console.error('  No sections found. Nothing to do.');
  await mongoose.disconnect();
  process.exit(1);
}

// ── build the plan ──────────────────────────────────────────────────────────
const plan = { createSubject: [], createOffering: [], markElective: [], updateCapacity: [], unchanged: 0, blocked: [] };

for (const def of ELECTIVES) {
  const existing = await Subject.findOne({ name: def.name });
  if (!existing) plan.createSubject.push(def.name);
}

for (const section of sections) {
  const level = section.gradeId?.level;
  const label = `${section.gradeId?.name ?? '?'} ${section.name}`;

  for (const def of ELECTIVES) {
    if (!def.grades.includes(level)) continue;

    const subject = await Subject.findOne({ name: def.name });
    const offering = subject
      ? await SubjectOffering.findOne({ sectionId: section._id, subjectId: subject._id, termId: chosenTerm._id })
      : null;

    if (!offering) {
      plan.createOffering.push({ label, subject: def.name, capacity: def.capacity });
      continue;
    }

    const needsFlag = !offering.isElective;
    const needsCap = (offering.capacity ?? null) !== def.capacity;

    if (needsCap && def.capacity !== null) {
      // Never strand students who already hold a seat.
      const taken = await SubjectRegistration.countDocuments({
        subjectOfferingId: offering._id,
        status: { $in: ['PENDING', 'APPROVED'] },
      });
      if (def.capacity < taken) {
        plan.blocked.push({ label, subject: def.name, wanted: def.capacity, taken });
        if (needsFlag) plan.markElective.push({ label, subject: def.name, capacityUnchanged: true });
        continue;
      }
    }

    if (needsFlag) plan.markElective.push({ label, subject: def.name });
    if (needsCap) plan.updateCapacity.push({ label, subject: def.name, from: offering.capacity ?? '∞', to: def.capacity ?? '∞' });
    if (!needsFlag && !needsCap) plan.unchanged++;
  }
}

// Electives that already exist but are not in ELECTIVES above. This script is
// deliberately additive — it never un-marks or deletes an offering, because
// doing so to one students are registered for would strand them. They are
// reported so the result is not a surprise.
const managedNames = new Set(ELECTIVES.map((e) => e.name));
const unmanaged = new Map();
for (const off of await SubjectOffering.find({
  isElective: true,
  termId: chosenTerm._id,
  sectionId: { $in: sections.map((s) => s._id) },
}).populate('subjectId sectionId')) {
  const name = off.subjectId?.name;
  if (!name || managedNames.has(name)) continue;
  unmanaged.set(name, (unmanaged.get(name) ?? 0) + 1);
}

// A managed elective offered to a grade band it is NOT configured for — same
// situation, but easier to miss because the name looks familiar.
const outOfBand = new Map();
for (const section of sections) {
  const level = section.gradeId?.level;
  for (const def of ELECTIVES) {
    if (def.grades.includes(level)) continue;
    const subject = await Subject.findOne({ name: def.name });
    if (!subject) continue;
    const off = await SubjectOffering.findOne({
      sectionId: section._id, subjectId: subject._id, termId: chosenTerm._id, isElective: true,
    });
    if (off) outOfBand.set(def.name, (outOfBand.get(def.name) ?? 0) + 1);
  }
}

// ── show the plan ───────────────────────────────────────────────────────────
const line = (n, s) => `  ${String(n).padStart(4)}  ${s}`;
console.log('  PLAN');
console.log('  ' + '─'.repeat(64));
console.log(line(plan.createSubject.length, 'subjects to create' + (plan.createSubject.length ? `  (${plan.createSubject.join(', ')})` : '')));
console.log(line(plan.createOffering.length, 'elective offerings to create'));
console.log(line(plan.markElective.length, 'existing offerings to mark elective'));
console.log(line(plan.updateCapacity.length, 'capacities to change'));
console.log(line(plan.unchanged, 'already correct — no change'));
if (plan.blocked.length) console.log(line(plan.blocked.length, '\x1b[33mblocked (capacity below seats already taken)\x1b[0m'));
console.log();

const preview = (rows, label, fmt) => {
  if (!rows.length) return;
  console.log(`  ${label}:`);
  for (const r of rows.slice(0, 8)) console.log(`    ${fmt(r)}`);
  if (rows.length > 8) console.log(`    … and ${rows.length - 8} more`);
  console.log();
};
preview(plan.createOffering, 'Create', (r) => `${r.label.padEnd(12)} ${r.subject.padEnd(14)} capacity ${r.capacity ?? '∞'}`);
preview(plan.markElective, 'Mark elective', (r) => `${r.label.padEnd(12)} ${r.subject}`);
preview(plan.updateCapacity, 'Capacity', (r) => `${r.label.padEnd(12)} ${r.subject.padEnd(14)} ${r.from} → ${r.to}`);
preview(plan.blocked, 'Blocked', (r) => `${r.label.padEnd(12)} ${r.subject.padEnd(14)} wanted ${r.wanted}, ${r.taken} seats already taken`);

if (unmanaged.size || outOfBand.size) {
  console.log('  Already elective, left alone (this script only adds):');
  for (const [name, n] of unmanaged) console.log(`    ${name.padEnd(18)} ${n} division(s)  — not in the ELECTIVES config`);
  for (const [name, n] of outOfBand) console.log(`    ${name.padEnd(18)} ${n} division(s)  — offered outside its configured grades`);
  console.log('    Students in those divisions will see these too. Remove them in');
  console.log('    Classroom Mgmt → Subject Offerings if that is not intended.\n');
}

const totalWrites = plan.createSubject.length + plan.createOffering.length + plan.markElective.length + plan.updateCapacity.length;

if (!APPLY) {
  console.log(`  Dry run — nothing written. ${totalWrites} change(s) would be made.`);
  console.log('  Re-run with --apply to commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

if (totalWrites === 0) {
  console.log('  Nothing to do.\n');
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
let written = 0;

for (const section of sections) {
  const level = section.gradeId?.level;
  for (const def of ELECTIVES) {
    if (!def.grades.includes(level)) continue;

    const subject = await Subject.findOneAndUpdate(
      { name: def.name },
      { $setOnInsert: { name: def.name, code: def.code } },
      { upsert: true, new: true }
    );

    const offering = await SubjectOffering.findOne({
      sectionId: section._id, subjectId: subject._id, termId: chosenTerm._id,
    });

    if (!offering) {
      // The section's class teacher is used as the default owner. That matters
      // beyond cosmetics: a TEACHER at OWN scope only sees registrations for
      // sections they teach in, so an offering with no teacher would sit in
      // nobody's review queue except an admin's. Reassign in Classroom Mgmt.
      await SubjectOffering.create({
        sectionId: section._id, subjectId: subject._id, termId: chosenTerm._id,
        teacherId: section.classTeacherId ?? null,
        isElective: true, capacity: def.capacity,
      });
      written++;
      continue;
    }

    let dirty = false;
    if (!offering.isElective) { offering.isElective = true; dirty = true; }
    if (!offering.teacherId && section.classTeacherId) {
      offering.teacherId = section.classTeacherId;
      dirty = true;
    }

    if ((offering.capacity ?? null) !== def.capacity) {
      const taken = def.capacity === null ? 0 : await SubjectRegistration.countDocuments({
        subjectOfferingId: offering._id, status: { $in: ['PENDING', 'APPROVED'] },
      });
      if (def.capacity === null || def.capacity >= taken) { offering.capacity = def.capacity; dirty = true; }
    }

    if (dirty) { await offering.save(); written++; }
  }
}

const totalElectives = await SubjectOffering.countDocuments({ isElective: true, termId: chosenTerm._id });
await mongoose.disconnect();

console.log(`\n  Applied ${written} change(s).`);
console.log(`  ${totalElectives} elective offerings now exist for ${chosenTerm.name}.\n`);
console.log('  Next: assign a teacher to each in Classroom Mgmt → Subject Offerings.');
console.log('  Students in those divisions can register immediately.\n');
