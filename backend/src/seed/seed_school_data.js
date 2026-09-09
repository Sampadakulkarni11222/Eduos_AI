// seed_school_data.js
// Seeds a complete, realistic, multi-role school dataset (students, parents, teachers, wardens, admins,
// academic terms, subjects, subject offerings, timetables, attendance, exams, marks, assignments, submissions, invoices).

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Import Models
import { Account } from '../models/account.model.js';
import { School } from '../models/school.model.js';
import { runWithTenant } from '../tenancy/tenantContext.js';
import { Profile } from '../models/profile.model.js';
import { Role } from '../models/role.model.js';
import { Permission } from '../models/permission.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';
import { AcademicYear, Term, Grade, Section, Subject, SubjectOffering } from '../models/academics.model.js';
import { AttendanceRecord } from '../models/attendanceRecord.model.js';
import { MedicalRecord } from '../models/medicalRecord.model.js';
import { encrypt } from '../utils/crypto.js';
import { Exam, ExamSubject, Mark } from '../models/exam.model.js';
import { Assignment, Submission } from '../models/assignment.model.js';
import { Invoice, InvoiceLine, Payment } from '../models/fee.model.js';
import { TimetableSlot } from '../models/timetableSlot.model.js';
import { HostelRoom, HostelAllocation } from '../models/hostel.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../models/transport.model.js';
import { CalendarEvent } from '../models/calendarEvent.model.js';

import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../constants/permissions.js';

const DEMO_PASSWORD = 'ChangeMe@123!';

/**
 * Seeded data belongs to a school.
 *
 * Every school-owned collection is now scoped by the acting school, so data
 * written with no school would be invisible to every portal. The demo data is
 * Oakridge's; override with SEED_SCHOOL_SLUG / SEED_SCHOOL_NAME.
 */
const SEED_SCHOOL_SLUG = (process.env.SEED_SCHOOL_SLUG || 'oakridge').toLowerCase();
const SEED_SCHOOL_NAME = process.env.SEED_SCHOOL_NAME || 'Oakridge Academy';

async function ensureSeedSchool() {
  await School.updateOne(
    { slug: SEED_SCHOOL_SLUG },
    { $setOnInsert: { slug: SEED_SCHOOL_SLUG, name: SEED_SCHOOL_NAME } },
    { upsert: true },
  );
  return SEED_SCHOOL_SLUG;
}

async function seedSchool() {
  logger.info('Connecting to MongoDB for full school seeding...');
  // Uses env.MONGO_URI rather than re-deriving the URI, so this script cannot
  // drift from the app's resolution rules. It previously hand-rolled
  // `MONGO_URI_ATLAS ?? MONGO_URI`, which meant the one script that deletes
  // thirty collections still pointed at the production cluster whenever that
  // variable was set — the exact failure the gate in env.js exists to prevent,
  // reintroduced by the most destructive file in the repo.
  const safeUri = env.MONGO_URI.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
  logger.info(`Target → ${safeUri} (source=${env.MONGO_URI_SOURCE}, NODE_ENV=${env.NODE_ENV})`);
  if (env.MONGO_ATLAS_IGNORED) {
    logger.warn('MONGO_URI_ATLAS is set but was IGNORED — Atlas is only used when NODE_ENV=production.');
  }

  // Checked BEFORE connecting: deleting thirty collections is not something to
  // do by accident against a remote cluster, and a database we are going to
  // refuse is one we should not dial at all.
  const isLocal = /localhost|127\.0\.0\.1/.test(env.MONGO_URI);
  if (!isLocal && process.argv.indexOf('--allow-remote') === -1) {
    logger.error(
      `REFUSING to wipe a non-local database (${safeUri}). This seed deletes every school collection. ` +
        'Re-run with --allow-remote if you are certain.'
    );
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  await ensureSeedSchool();
  logger.info('Connected. Cleaning database for a fresh seed...');

  // Clear existing school collections
  const collectionsToClear = [
    'accounts', 'profiles', 'permissions', 'roles', 'students', 'studentguardians',
    'enrollments', 'academicyears', 'terms', 'grades', 'sections', 'subjects',
    'subjectofferings', 'attendancerecords', 'exams', 'examsubjects', 'marks',
    'assignments', 'submissions', 'invoices', 'invoicelines', 'payments',
    'timetableslots', 'hostelrooms', 'hostelallocations', 'transportroutes',
    'transportstops', 'busenrollments', 'calendarevents', 'medicalrecords',
    'subjectregistrations'
  ];
  for (const c of collectionsToClear) {
    await mongoose.connection.db.collection(c).deleteMany({});
  }
  logger.info('Database cleared.');

  // Pre-hash password once to speed up seed execution
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // 1. Seed Permissions & Roles
  logger.info('Seeding Permissions & Roles...');
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ ...p, isSystem: true });
  }
  const roleMap = new Map();
  for (const r of SYSTEM_ROLES) {
    const roleDoc = await Role.create({
      name: r.name,
      key: r.key,
      description: r.description ?? '',
      isSystem: true,
      permissions: r.grants,
    });
    roleMap.set(r.key, roleDoc._id);
  }

  // 2. Academic Year & Term
  logger.info('Creating Academic Year & Terms...');
  const acYear = await AcademicYear.create({
    name: '2026-27',
    startsOn: new Date('2026-06-01'),
    endsOn: new Date('2027-05-31'),
    isCurrent: true,
  });

  const midtermTerm = await Term.create({
    academicYearId: acYear._id,
    name: 'Midterm',
    startsOn: new Date('2026-06-01'),
    endsOn: new Date('2026-11-30'),
  });

  const finalTerm = await Term.create({
    academicYearId: acYear._id,
    name: 'Finals',
    startsOn: new Date('2026-12-01'),
    endsOn: new Date('2027-05-31'),
  });

  // 3. Seed Core System Staff Users (Owner, Admin, Principal, Warden, Librarian, Finance)
  logger.info('Creating school management staff accounts...');
  const staffToCreate = [
    { key: 'ADMIN', name: 'Demo Admin', phone: '+910000000001', email: 'admin@schoolerp.com' },
    { key: 'PRINCIPAL', name: 'Demo Principal', phone: '+910000000002', email: 'principal@schoolerp.com' },
    { key: 'FINANCE', name: 'Demo Finance', phone: '+910000000004', email: 'finance@schoolerp.com' },
    { key: 'LIBRARIAN', name: 'Demo Librarian', phone: '+910000000005', email: 'librarian@schoolerp.com' },
    { key: 'WARDEN', name: 'Demo Warden', phone: '+910000000006', email: 'warden@schoolerp.com' },
  ];
  for (const staff of staffToCreate) {
    const acc = await Account.create({
      phoneE164: staff.phone,
      email: staff.email,
      passwordHash,
      status: 'ACTIVE',
    });
    await Profile.create({
      accountId: acc._id,
      roleId: roleMap.get(staff.key),
      displayName: staff.name,
      tenantId: SEED_SCHOOL_SLUG, tenantName: SEED_SCHOOL_NAME,
    });
  }

  // The two OTP-only demo identities must point at real school records so
  // their portals exercise the same populated paths as the staff accounts.
  const demoStudentAccount = await Account.create({
    phoneE164: '+910000000008',
    passwordHash: null,
    status: 'ACTIVE',
  });
  const demoStudentProfile = await Profile.create({
    accountId: demoStudentAccount._id,
    roleId: roleMap.get('STUDENT'),
    displayName: 'Demo Student',
    tenantId: SEED_SCHOOL_SLUG, tenantName: SEED_SCHOOL_NAME,
  });
  const demoParentAccount = await Account.create({
    phoneE164: '+910000000007',
    passwordHash: null,
    status: 'ACTIVE',
  });
  const demoParentProfile = await Profile.create({
    accountId: demoParentAccount._id,
    roleId: roleMap.get('PARENT'),
    displayName: 'Demo Parent',
    tenantId: SEED_SCHOOL_SLUG, tenantName: SEED_SCHOOL_NAME,
  });

  // 4. Seed 15 Teachers (3 per subject, with names, emails, and phone numbers).
  // Three teachers per subject is the minimum that lets every one of the 12
  // sections get every subject every day without any teacher being double
  // booked — see the Subject Offerings section below for the math.
  logger.info('Creating 15 Teacher accounts...');
  const teacherDefs = [
    { name: 'Arjun Sharma (Math)', email: 'teacher@schoolerp.com', phone: '+910000000003' }, // Primary Demo Teacher
    { name: 'Priya Patel (Science)', email: 'priya.science@schoolerp.com', phone: '+910000000011' },
    { name: 'Amit Joshi (English)', email: 'amit.english@schoolerp.com', phone: '+910000000012' },
    { name: 'Sunita Rao (History)', email: 'sunita.history@schoolerp.com', phone: '+910000000013' },
    { name: 'Rajesh Kumar (Geography)', email: 'rajesh.geography@schoolerp.com', phone: '+910000000014' },
    { name: 'Neha Singh (Computer)', email: 'neha.computer@schoolerp.com', phone: '+910000000015' },
    { name: 'Vikram Malhotra (Physics)', email: 'vikram.physics@schoolerp.com', phone: '+910000000016' },
    { name: 'Kavita Reddy (Chemistry)', email: 'kavita.chemistry@schoolerp.com', phone: '+910000000017' },
    { name: 'Deepak Nair (Math)', email: 'deepak.math@schoolerp.com', phone: '+910000000018' },
    { name: 'Meera Iyer (Math)', email: 'meera.math@schoolerp.com', phone: '+910000000019' },
    { name: 'Sneha Kapoor (English)', email: 'sneha.english@schoolerp.com', phone: '+910000000020' },
    { name: 'Rohan Mehta (English)', email: 'rohan.english@schoolerp.com', phone: '+910000000021' },
    { name: 'Anjali Desai (Social Science)', email: 'anjali.social@schoolerp.com', phone: '+910000000022' },
    { name: 'Karan Bhatia (Computer)', email: 'karan.computer@schoolerp.com', phone: '+910000000023' },
    { name: 'Pooja Menon (Computer)', email: 'pooja.computer@schoolerp.com', phone: '+910000000024' },
  ];
  const teacherProfiles = [];
  for (const tDef of teacherDefs) {
    const acc = await Account.create({
      phoneE164: tDef.phone,
      email: tDef.email,
      passwordHash,
      status: 'ACTIVE',
    });
    const profile = await Profile.create({
      accountId: acc._id,
      roleId: roleMap.get('TEACHER'),
      displayName: tDef.name,
      tenantId: SEED_SCHOOL_SLUG, tenantName: SEED_SCHOOL_NAME,
    });
    teacherProfiles.push(profile);
  }

  // 5. Seed Grades & Sections
  logger.info('Creating Grades & Sections...');
  const grades = [];
  for (let i = 5; i <= 10; i++) {
    const grade = await Grade.create({
      name: `Class ${i}`,
      level: i,
    });
    grades.push(grade);
  }

  // Shuffle once and hand out distinct teachers as class teachers, one per
  // section — 12 sections need 12 distinct teachers out of the 15 available,
  // so every section gets its own class teacher and nobody doubles up.
  const shuffledTeachers = [...teacherProfiles];
  for (let i = shuffledTeachers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledTeachers[i], shuffledTeachers[j]] = [shuffledTeachers[j], shuffledTeachers[i]];
  }
  let classTeacherCursor = 0;

  const sections = [];
  const sectionNames = ['A', 'B'];
  for (const grade of grades) {
    for (const secName of sectionNames) {
      const classTeacher = shuffledTeachers[classTeacherCursor++];
      const section = await Section.create({
        gradeId: grade._id,
        name: secName,
        classTeacherId: classTeacher._id,
      });
      sections.push(section);
    }
  }

  // 6. Seed Subjects
  logger.info('Creating Subjects...');
  const subjectDefs = [
    { name: 'Mathematics', code: 'MATH' },
    { name: 'Science', code: 'SCI' },
    { name: 'English', code: 'ENG' },
    { name: 'Social Science', code: 'SOC' },
    { name: 'Computer Science', code: 'COMP' }
  ];
  const subjects = [];
  for (const sDef of subjectDefs) {
    const subject = await Subject.create(sDef);
    subjects.push(subject);
  }

  // 7. Seed Subject Offerings
  //
  // Each subject gets a POOL of 3 teachers instead of one fixed teacher for
  // the whole school. With 12 sections needing every subject every day
  // (5 periods x 5 days = 25 slots/week per section), a single teacher would
  // need to be in up to 12 places during the same period — impossible. Each
  // teacher below only ever owns 12/3 = 4 sections for their subject, which
  // (combined with the per-section stagger in the timetable step) keeps
  // every teacher's own sections on different periods, so nobody is ever
  // double-booked.
  logger.info('Creating Subject Offerings (mapping teacher pools to subjects & sections)...');
  const subjectTeacherPools = {
    MATH: [teacherProfiles[0], teacherProfiles[8], teacherProfiles[9]],
    SCI: [teacherProfiles[1], teacherProfiles[6], teacherProfiles[7]],
    ENG: [teacherProfiles[2], teacherProfiles[10], teacherProfiles[11]],
    SOC: [teacherProfiles[3], teacherProfiles[4], teacherProfiles[12]],
    COMP: [teacherProfiles[5], teacherProfiles[13], teacherProfiles[14]],
  };
  const offerings = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    for (const subject of subjects) {
      const pool = subjectTeacherPools[subject.code];
      const teacherProfile = pool[sectionIndex % pool.length];

      const offering = await SubjectOffering.create({
        sectionId: section._id,
        subjectId: subject._id,
        termId: midtermTerm._id,
        teacherId: teacherProfile._id,
      });
      offerings.push(offering);
    }
  }

  // Electives: offered to every section but, unlike the core subjects above,
  // not automatic — a student picks these on /student/subjects and a teacher
  // approves. Seat caps are deliberately small so the "full" state is reachable
  // in a demo without registering 60 students.
  // Kept OUT of `offerings` on purpose. That array drives the timetable
  // (whose no-double-booking stagger assumes exactly 5 subjects per section —
  // see the comment above), plus exam subjects and assignments. Electives are
  // opt-in and have no roster until students register, so scheduling them or
  // generating assignments for them would be wrong on all three counts.
  logger.info('Creating elective offerings (student-registerable)...');
  const electiveDefs = [
    { name: 'French', code: 'FRE', capacity: 20 },
    { name: 'Music', code: 'MUS', capacity: 15 },
    { name: 'Robotics', code: 'ROB', capacity: 12 },
  ];
  const electiveTeacherPool = [teacherProfiles[2], teacherProfiles[5], teacherProfiles[13]];
  const electiveOfferings = [];
  for (const [i, def] of electiveDefs.entries()) {
    const subject = await Subject.create({ name: def.name, code: def.code });
    for (const [sectionIndex, section] of sections.entries()) {
      electiveOfferings.push(await SubjectOffering.create({
        sectionId: section._id,
        subjectId: subject._id,
        termId: midtermTerm._id,
        teacherId: electiveTeacherPool[(sectionIndex + i) % electiveTeacherPool.length]._id,
        isElective: true,
        capacity: def.capacity,
      }));
    }
  }
  logger.info(`Created ${electiveOfferings.length} elective offerings across ${sections.length} sections.`);

  // 8. Seed 60 Students and Parents per Division (720 total)
  logger.info('Generating 60 students and parents per division (12 sections * 60 = 720 students total)...');
  const accountsToInsert = [];
  const profilesToInsert = [];
  const studentsToInsert = [];
  const guardiansToInsert = [];
  const enrollmentsToInsert = [];
  const medicalRecordsToInsert = [];

  const firstNames = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Vivaan', 'Ira', 'Aditya', 'Riya', 'Reyansh', 'Saanvi', 'Krishna', 'Myra', 'Ishaan', 'Zoya', 'Arjun', 'Aanya', 'Dhruv', 'Kiara', 'Pranav', 'Zara', 'Atharv', 'Tanya', 'Dev', 'Kriti', 'Arnav', 'Navya', 'Ayaan', 'Siddhi', 'Shaurya', 'Avani'];
  const lastNames = ['Sharma', 'Patel', 'Mehta', 'Rao', 'Singh', 'Joshi', 'Kumar', 'Sen', 'Gupta', 'Nair', 'Iyer', 'Reddy', 'Choudhury', 'Khan', 'Varma', 'Bose', 'Kapoor', 'Shah', 'Ali', 'Mishra', 'Verma', 'Pathak', 'Saxena', 'Bhat', 'Bhatt', 'Deshmukh', 'Kulkarni', 'Dutt', 'Trivedi', 'Jha'];
  const localities = ['Green Park', 'Lake View Colony', 'Sunrise Nagar', 'Riverdale Enclave', 'Maple Heights', 'Silver Oak Layout', 'Rosewood Society', 'Hillcrest Gardens', 'Palm Grove', 'Cedar Residency'];
  const cities = ['Pune', 'Bengaluru', 'Hyderabad', 'Nashik', 'Nagpur', 'Indore'];

  let count = 0;
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];
    const grade = grades.find((g) => g._id.toString() === section.gradeId.toString());
    const gradeLabel = grade ? grade.name : 'Class';

    for (let i = 1; i <= 60; i++) {
      count++;
      // Indexed independently (not both by the same `count % 30`) so first/last
      // names don't lock together into the same 30 repeating full-name pairs.
      const first = firstNames[count % firstNames.length];
      const last = lastNames[Math.floor(count / firstNames.length) % lastNames.length];
      const displayName = `${first} ${last}`;
      const admissionNo = `ADM-2026-${String(count).padStart(4, '0')}`;

      // Student Account & Profile IDs
      const sAccId = count === 1 ? demoStudentAccount._id : new mongoose.Types.ObjectId();
      const sProfId = count === 1 ? demoStudentProfile._id : new mongoose.Types.ObjectId();
      const sStudentId = new mongoose.Types.ObjectId();
      const sEnrollId = new mongoose.Types.ObjectId();

      const sPhone = `+910000003${String(count).padStart(3, '0')}`;
      const sEmail = `student.${count}@schoolerp.com`;

      if (count !== 1) {
        accountsToInsert.push({
          _id: sAccId,
          phoneE164: sPhone,
          email: sEmail,
          passwordHash,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      if (count !== 1) {
        profilesToInsert.push({
          _id: sProfId,
          accountId: sAccId,
          roleId: roleMap.get('STUDENT'),
          displayName: `${displayName} (${gradeLabel}–${section.name} #${i})`,
          tenantId: SEED_SCHOOL_SLUG,
          tenantName: SEED_SCHOOL_NAME,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      studentsToInsert.push({
        _id: sStudentId,
        admissionNo,
        firstName: first,
        lastName: last,
        dob: new Date(2012, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        address: `${100 + count}, ${localities[count % localities.length]}, ${cities[count % cities.length]}`,
        profileId: sProfId,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      enrollmentsToInsert.push({
        _id: sEnrollId,
        studentId: sStudentId,
        sectionId: section._id,
        academicYearId: acYear._id,
        rollNo: i,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Parent Account & Profile IDs
      const pAccId = count === 1 ? demoParentAccount._id : new mongoose.Types.ObjectId();
      const pProfId = count === 1 ? demoParentProfile._id : new mongoose.Types.ObjectId();

      const pPhone = `+910000004${String(count).padStart(3, '0')}`;
      const pEmail = `parent.${count}@schoolerp.com`;

      if (count !== 1) {
        accountsToInsert.push({
          _id: pAccId,
          phoneE164: pPhone,
          email: pEmail,
          passwordHash,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      if (count !== 1) {
        profilesToInsert.push({
          _id: pProfId,
          accountId: pAccId,
          roleId: roleMap.get('PARENT'),
          displayName: `Parent of ${first}`,
          tenantId: SEED_SCHOOL_SLUG,
          tenantName: SEED_SCHOOL_NAME,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const relation = i % 2 === 0 ? 'FATHER' : 'MOTHER';
      guardiansToInsert.push({
        studentId: sStudentId,
        guardianProfileId: pProfId,
        relation,
        isPrimary: true,
        pickupAuthorized: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Dummy medical record for every student — realistic height/weight for
      // the grade's typical age band, an emergency contact matching the
      // guardian just created above, and a minority with an allergy/
      // medication/history note so the UI has something to show besides
      // empty fields.
      const heightCm = Math.round(110 + (grade.level - 5) * 8 + (Math.random() * 10 - 5));
      const weightKg = Math.round(28 + (grade.level - 5) * 5 + (Math.random() * 8 - 4));
      const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
      const allergyPool = ['Peanuts', 'Dust', 'Pollen', 'Penicillin', 'Lactose', 'Shellfish'];
      const medicationPool = ['Cetirizine 5mg as needed', 'Inhaler (Salbutamol) as needed', 'Vitamin D supplement'];
      const historyPool = ['Mild asthma, managed', 'Seasonal allergic rhinitis', 'Fractured arm (2024), fully healed'];
      const hasAllergy = Math.random() < 0.2;
      const hasMedication = Math.random() < 0.1;
      const hasHistory = Math.random() < 0.15;

      medicalRecordsToInsert.push({
        studentId: sStudentId,
        bloodGroup: bloodGroups[Math.floor(Math.random() * bloodGroups.length)],
        heightCm,
        weightKg,
        emergencyContactEnc: encrypt({ name: `Parent of ${first}`, phone: pPhone, relation }),
        // allergies/medications are always string[] (never null) per MedicalDto —
        // the panel does rec.medications.length unconditionally, matching how
        // the normal save flow always sends an array (possibly empty).
        allergiesEnc: encrypt(hasAllergy ? [allergyPool[Math.floor(Math.random() * allergyPool.length)]] : []),
        medicationsEnc: encrypt(hasMedication ? [medicationPool[Math.floor(Math.random() * medicationPool.length)]] : []),
        historyEnc: encrypt(hasHistory ? historyPool[Math.floor(Math.random() * historyPool.length)] : null),
        attachmentsEnc: encrypt([]),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  logger.info(`Inserting ${accountsToInsert.length} accounts...`);
  await Account.insertMany(accountsToInsert);
  logger.info(`Inserting ${profilesToInsert.length} profiles...`);
  const studentProfiles = await Profile.insertMany(profilesToInsert);
  logger.info(`Inserting ${studentsToInsert.length} students...`);
  await Student.insertMany(studentsToInsert);
  logger.info(`Inserting ${enrollmentsToInsert.length} enrollments...`);
  const enrollments = await Enrollment.insertMany(enrollmentsToInsert);
  logger.info(`Inserting ${guardiansToInsert.length} student guardian links...`);
  await StudentGuardian.insertMany(guardiansToInsert);
  logger.info(`Inserting ${medicalRecordsToInsert.length} medical records...`);
  await MedicalRecord.insertMany(medicalRecordsToInsert);

  // Appoint a class representative per section — the roll-1 student.
  //
  // Sections are created before enrolments exist, so this could not be set at
  // creation time and never got set at all: every section had a null CR, so
  // the field was invisible in a fresh environment even though the student and
  // parent portals both render it.
  logger.info('Appointing class representatives...');
  let crCount = 0;
  for (const section of sections) {
    const rep = enrollments.find(
      (e) => e.sectionId.toString() === section._id.toString() && e.rollNo === 1
    );
    if (!rep) continue;
    await Section.updateOne({ _id: section._id }, { $set: { classRepresentativeId: rep.studentId } });
    crCount++;
  }
  logger.info(`  ✔  ${crCount} class representatives appointed`);


  // 9. Seed Timetable Slots
  logger.info('Seeding weekly timetables for all sections...');
  const days = [1, 2, 3, 4, 5]; // Mon to Fri
  const periods = [
    { no: 1, start: '08:30', end: '09:15' },
    { no: 2, start: '09:15', end: '10:00' },
    { no: 3, start: '10:15', end: '11:00' },
    { no: 4, start: '11:00', end: '11:45' },
    { no: 5, start: '12:30', end: '13:15' }
  ];

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const secOfferings = offerings.filter(o => o.sectionId.toString() === section._id.toString());
    if (secOfferings.length === 0) continue;

    for (const day of days) {
      for (const p of periods) {
        // Pick an offering cyclically, staggered by sectionIndex. Every
        // subject has a 3-teacher pool split across sections via
        // `sectionIndex % 3` (see Subject Offerings above); adding
        // sectionIndex here too means the 4 sections sharing a teacher for a
        // given subject always land on 4 different periods for it, since
        // their indices differ by 3 and are therefore never congruent mod 5
        // (gcd(3,5)=1) — so the same teacher is never needed in two places
        // at once. Without this offset every section used the identical
        // (day + p.no - 1) rotation, so the same subject — and thus the same
        // teacher — landed on the exact same period in every section.
        const offering = secOfferings[(day + p.no - 1 + sectionIndex) % secOfferings.length];
        await TimetableSlot.create({
          sectionId: section._id,
          dayOfWeek: day,
          periodNo: p.no,
          startTime: p.start,
          endTime: p.end,
          subjectOfferingId: offering._id,
        });
      }
    }
  }

  // 10. Seed Attendance Records (Last 10 days)
  logger.info('Seeding 10 days of attendance history for all students...');
  const attendanceStatuses = ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'PRESENT', 'PRESENT', 'ABSENT'];
  for (let dOffset = 0; dOffset < 10; dOffset++) {
    const date = new Date();
    date.setDate(date.getDate() - dOffset);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // Skip weekends
    
    for (const enrollment of enrollments) {
      const status = attendanceStatuses[Math.floor(Math.random() * attendanceStatuses.length)];
      await AttendanceRecord.create({
        enrollmentId: enrollment._id,
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        periodNo: null,
        status,
        note: status === 'LATE' ? 'Late bus' : status === 'ABSENT' ? 'Fever' : '',
        source: 'WEB',
        markedByProfileId: teacherProfiles[0]._id, // Demo Teacher marked it
      });
    }
  }

  // 11. Seed Invoices & Payments
  logger.info('Seeding school fee invoices and bank payments...');
  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const invoiceNo = `INV-2026-${String(i + 1).padStart(4, '0')}`;
    const totalPaise = 4500000; // 45,000 INR
    const status = i % 3 === 0 ? 'PENDING' : i % 3 === 1 ? 'PAID' : 'PARTIAL';
    const paidPaise = status === 'PAID' ? totalPaise : status === 'PARTIAL' ? 2000000 : 0;

    const invoice = await Invoice.create({
      enrollmentId: enrollment._id,
      invoiceNo,
      dueOn: new Date('2026-10-15'),
      status,
      totalPaise,
      paidPaise,
    });

    await InvoiceLine.create({
      invoiceId: invoice._id,
      description: 'Term 1 Tuition Fee',
      amountPaise: 4000000,
    });

    await InvoiceLine.create({
      invoiceId: invoice._id,
      description: 'Library & Laboratory Fee',
      amountPaise: 50000,
    });

    if (paidPaise > 0) {
      await Payment.create({
        invoiceId: invoice._id,
        amountPaise: paidPaise,
        mode: 'BANK',
        gatewayRef: `TXN-${Math.floor(Math.random() * 100000000)}`,
        status: 'SUCCESS',
      });
    }
  }

  // 12. Seed Exams & Exam Marks
  // Two exams on purpose: "Midterm Evaluation" is fully published (so the
  // student/parent "grades" views and Ask Agent have real published results
  // to show), while "Unit Test 1" is deliberately left editable — a teacher
  // needs at least one exam whose marks aren't 100% PUBLISHED to enter/edit,
  // otherwise every row in Enter Marks is permanently locked by design.
  logger.info('Seeding Midterm Exam (published) and Unit Test 1 (editable) with Student Marks...');
  const exam = await Exam.create({
    termId: midtermTerm._id,
    name: 'Midterm Evaluation',
    startsOn: new Date('2026-09-10'),
    endsOn: new Date('2026-09-20'),
  });

  for (const offering of offerings) {
    const examSubject = await ExamSubject.create({
      examId: exam._id,
      subjectOfferingId: offering._id,
      examDate: new Date('2026-09-12'),
      maxMarks: 100,
    });

    // Find enrolled students in the section
    const secEnrollments = enrollments.filter(e => e.sectionId.toString() === offering.sectionId.toString());
    for (const e of secEnrollments) {
      const marks = Math.floor(Math.random() * 35) + 65; // Generate realistic grades 65 - 100
      let gradeLabel = 'A';
      if (marks < 75) gradeLabel = 'C';
      else if (marks < 90) gradeLabel = 'B';

      await Mark.create({
        examSubjectId: examSubject._id,
        enrollmentId: e._id,
        marks,
        gradeLabel,
        remarks: marks > 90 ? 'Outstanding performance' : 'Good job',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        enteredByProfileId: offering.teacherId || teacherProfiles[0]._id,
      });
    }
  }

  const unitTestExam = await Exam.create({
    termId: midtermTerm._id,
    name: 'Unit Test 1',
    startsOn: new Date('2026-11-03'),
    endsOn: new Date('2026-11-07'),
  });

  for (const offering of offerings) {
    const examSubject = await ExamSubject.create({
      examId: unitTestExam._id,
      subjectOfferingId: offering._id,
      examDate: new Date('2026-11-05'),
      maxMarks: 50,
    });

    const secEnrollments = enrollments.filter(e => e.sectionId.toString() === offering.sectionId.toString());
    for (let i = 0; i < secEnrollments.length; i++) {
      // Every 3rd student: no Mark row at all (still PENDING — not entered),
      // so "Enter marks" also has genuinely blank rows to fill in, not just
      // pre-filled drafts to edit.
      if (i % 3 === 2) continue;
      const e = secEnrollments[i];
      const marks = Math.floor(Math.random() * 20) + 30; // 30 - 50
      await Mark.create({
        examSubjectId: examSubject._id,
        enrollmentId: e._id,
        marks,
        gradeLabel: marks >= 45 ? 'A' : marks >= 38 ? 'B' : 'C',
        remarks: 'Good effort',
        status: 'DRAFT',
        enteredByProfileId: offering.teacherId || teacherProfiles[0]._id,
      });
    }
  }

  // 13. Seed Assignments & Submissions
  logger.info('Seeding Assignments and submissions...');
  for (const offering of offerings) {
    const assignment = await Assignment.create({
      subjectOfferingId: offering._id,
      title: 'Chapter 1 Assignment',
      description: 'Please answer the review questions at the end of Chapter 1.',
      type: 'HOMEWORK',
      dueAt: new Date('2026-08-15'),
      maxMarks: 20,
      createdByProfileId: offering.teacherId || teacherProfiles[0]._id,
    });

    // A second assignment that nobody has handed in yet.
    //
    // Every seeded submission used to be GRADED, which meant no student could
    // submit anything — the API refuses to change a graded submission — and no
    // teacher had anything to grade. A demo dataset where the two main actions
    // in the module are both impossible is not a useful demo, and it made the
    // submission flow untestable without hand-editing the database.
    const openAssignment = await Assignment.create({
      subjectOfferingId: offering._id,
      title: 'Chapter 2 Worksheet',
      description: 'Complete the practice worksheet for Chapter 2 and attach your work.',
      type: 'HOMEWORK',
      dueAt: new Date('2026-09-30'),
      maxMarks: 20,
      createdByProfileId: offering.teacherId || teacherProfiles[0]._id,
    });

    // Find enrolled students in the section
    const secEnrollments = enrollments.filter(e => e.sectionId.toString() === offering.sectionId.toString());
    for (const [i, e] of secEnrollments.entries()) {
      const marks = Math.floor(Math.random() * 8) + 12; // 12 - 20 marks
      await Submission.create({
        assignmentId: assignment._id,
        enrollmentId: e._id,
        status: 'GRADED',
        submittedAt: new Date('2026-08-14'),
        marks,
        feedback: marks > 16 ? 'Excellent analysis' : 'Review chapters again',
      });

      // A third of the class has handed the new one in but not been marked, so
      // the teacher's grading queue is non-empty; the rest have nothing
      // recorded, so those students can actually submit.
      if (i % 3 === 0) {
        await Submission.create({
          assignmentId: openAssignment._id,
          enrollmentId: e._id,
          status: 'SUBMITTED',
          submittedAt: new Date('2026-09-20'),
          attachments: [],
        });
      }
    }
  }

  // 14. Seed Hostel Rooms & Allocations
  logger.info('Seeding hostel rooms and allocations...');
  const rooms = [];
  const blocks = [{ block: 'A', type: 'BOYS' }, { block: 'B', type: 'GIRLS' }];
  for (const { block, type } of blocks) {
    for (let i = 1; i <= 25; i++) {
      rooms.push({
        roomNo: `${block}${String(i).padStart(2, '0')}`,
        block,
        floor: i <= 5 ? 'Ground' : i <= 10 ? 'First' : i <= 15 ? 'Second' : i <= 20 ? 'Third' : 'Fourth',
        capacity: 4,
        type,
        status: 'ACTIVE',
      });
    }
  }
  const createdRooms = await HostelRoom.insertMany(rooms);

  // Allocate 15 students to hostel rooms
  const hostelStudents = enrollments.slice(0, 15);
  for (let i = 0; i < hostelStudents.length; i++) {
    const studentEnroll = hostelStudents[i];
    const room = createdRooms[Math.floor(i / 3) % createdRooms.length];
    await HostelAllocation.create({
      roomId: room._id,
      studentId: studentEnroll.studentId,
      status: 'ACTIVE',
      allottedAt: new Date(),
    });
  }

  // 15. Seed Transport
  logger.info('Seeding Transport Routes & Bus Enrollments...');
  const route = await TransportRoute.create({
    name: 'North Route - Bus 12',
    operatorName: 'SafeTravels Corp',
    vehicleNo: 'KA-01-MC-7890',
    driverName: 'Ramesh Gowda',
    driverPhone: '+919988776655',
  });

  const stop = await TransportStop.create({
    routeId: route._id,
    name: 'Main Gate Circle',
    sequenceNo: 1,
    etaMinutesFromStart: 10,
  });

  // Enroll 10 students
  const transportStudents = enrollments.slice(10, 20);
  for (const sEnroll of transportStudents) {
    await BusEnrollment.create({
      studentId: sEnroll.studentId,
      routeId: route._id,
      stopId: stop._id,
      academicYearId: acYear._id,
      direction: 'BOTH',
    });
  }

  // 16. Seed Calendar Events
  logger.info('Seeding calendar events (holidays, exams, PTM, sports day)...');
  await CalendarEvent.insertMany([
    {
      title: 'Independence Day',
      description: 'School closed for the national holiday.',
      type: 'HOLIDAY',
      startsAt: new Date('2026-08-15'),
      endsAt: new Date('2026-08-15'),
      audience: { all: true },
    },
    {
      title: 'Midterm Evaluation',
      description: 'Midterm exams across all sections — see subject timetable for detailed schedule.',
      type: 'EXAM',
      startsAt: new Date('2026-09-10'),
      endsAt: new Date('2026-09-20'),
      audience: { all: true },
    },
    {
      title: 'Parent-Teacher Meeting',
      description: 'Term 1 progress discussion with class teachers.',
      type: 'PTM',
      startsAt: new Date('2026-09-25'),
      endsAt: new Date('2026-09-25'),
      audience: { all: true },
    },
    {
      title: 'Annual Sports Day',
      description: 'Inter-house athletics and games at the main ground.',
      type: 'SPORTS',
      startsAt: new Date('2026-10-05'),
      endsAt: new Date('2026-10-05'),
      audience: { all: true },
    },
    {
      title: 'Diwali Break',
      description: 'School closed for the festival break.',
      type: 'HOLIDAY',
      startsAt: new Date('2026-11-08'),
      endsAt: new Date('2026-11-12'),
      audience: { all: true },
    },
    {
      title: 'Science Exhibition',
      description: 'Student project showcase, open to parents.',
      type: 'EVENT',
      startsAt: new Date('2026-11-20'),
      endsAt: new Date('2026-11-20'),
      audience: { all: true },
    },
  ]);

  logger.info('====================================================');
  logger.info('  FULL SCHOOL SEEDING COMPLETED SUCCESSFULLY!  🚀');
  logger.info('====================================================');
  logger.info('Credentials seeded:');
  logger.info(' - Owner:     owner@schoolerp.com / ChangeMe@123!');
  logger.info(' - Admin:     admin@schoolerp.com / ChangeMe@123!');
  logger.info(' - Principal: principal@schoolerp.com / ChangeMe@123!');
  logger.info(' - Teacher 1: teacher@schoolerp.com / ChangeMe@123! (+910000000003)');
  logger.info(' - Teacher 2: priya.science@schoolerp.com / ChangeMe@123! (+910000000011)');
  logger.info(' - Student:   OTP only (+910000000008)');
  logger.info(' - Parent:    OTP only (+910000000007)');
  logger.info('====================================================');

  await mongoose.disconnect();
  process.exit(0);
}

runWithTenant(SEED_SCHOOL_SLUG, seedSchool).catch((err) => {
  logger.error('School Seeding failed:', err);
  process.exit(1);
});
