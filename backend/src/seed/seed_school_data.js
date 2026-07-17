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
import { Profile } from '../models/profile.model.js';
import { Role } from '../models/role.model.js';
import { Permission } from '../models/permission.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';
import { AcademicYear, Term, Grade, Section, Subject, SubjectOffering } from '../models/academics.model.js';
import { AttendanceRecord } from '../models/attendanceRecord.model.js';
import { Exam, ExamSubject, Mark } from '../models/exam.model.js';
import { Assignment, Submission } from '../models/assignment.model.js';
import { Invoice, InvoiceLine, Payment } from '../models/fee.model.js';
import { TimetableSlot } from '../models/timetableSlot.model.js';
import { HostelRoom, HostelAllocation } from '../models/hostel.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../models/transport.model.js';

import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../constants/permissions.js';

const DEMO_PASSWORD = 'ChangeMe@123!';

async function seedSchool() {
  logger.info('Connecting to MongoDB for full school seeding...');
  const localUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/school_erp';
  await mongoose.connect(localUri);
  logger.info('Connected. Cleaning database for a fresh seed...');

  // Clear existing school collections
  const collectionsToClear = [
    'accounts', 'profiles', 'permissions', 'roles', 'students', 'studentguardians',
    'enrollments', 'academicyears', 'terms', 'grades', 'sections', 'subjects',
    'subjectofferings', 'attendancerecords', 'exams', 'examsubjects', 'marks',
    'assignments', 'submissions', 'invoices', 'invoicelines', 'payments',
    'timetableslots', 'hostelrooms', 'hostelallocations', 'transportroutes',
    'transportstops', 'busenrollments'
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
    { key: 'OWNER', name: 'Default Owner', phone: '+910000000000', email: 'owner@schoolerp.com' },
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
    });
  }

  // 4. Seed 8 Teachers (with names, emails, and phone numbers)
  logger.info('Creating 8 Teacher accounts...');
  const teacherDefs = [
    { name: 'Arjun Sharma (Math)', email: 'teacher@schoolerp.com', phone: '+910000000003' }, // Primary Demo Teacher
    { name: 'Priya Patel (Science)', email: 'priya.science@schoolerp.com', phone: '+910000000011' },
    { name: 'Amit Joshi (English)', email: 'amit.english@schoolerp.com', phone: '+910000000012' },
    { name: 'Sunita Rao (History)', email: 'sunita.history@schoolerp.com', phone: '+910000000013' },
    { name: 'Rajesh Kumar (Geography)', email: 'rajesh.geography@schoolerp.com', phone: '+910000000014' },
    { name: 'Neha Singh (Computer)', email: 'neha.computer@schoolerp.com', phone: '+910000000015' },
    { name: 'Vikram Malhotra (Physics)', email: 'vikram.physics@schoolerp.com', phone: '+910000000016' },
    { name: 'Kavita Reddy (Chemistry)', email: 'kavita.chemistry@schoolerp.com', phone: '+910000000017' }
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

  const sections = [];
  const sectionNames = ['A', 'B'];
  for (const grade of grades) {
    for (const secName of sectionNames) {
      // Assign class teachers from our 8 teachers pool
      const teacherIdx = Math.floor(Math.random() * teacherProfiles.length);
      const section = await Section.create({
        gradeId: grade._id,
        name: secName,
        classTeacherId: teacherProfiles[teacherIdx]._id,
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
  logger.info('Creating Subject Offerings (mapping teachers to subjects & sections)...');
  const offerings = [];
  for (const section of sections) {
    for (const subject of subjects) {
      // Map subjects to teachers logically based on index
      let teacherProfile = teacherProfiles[0]; // Math -> Arjun Sharma
      if (subject.code === 'SCI') teacherProfile = teacherProfiles[1]; // Science -> Priya Patel
      if (subject.code === 'ENG') teacherProfile = teacherProfiles[2]; // English -> Amit Joshi
      if (subject.code === 'SOC') teacherProfile = teacherProfiles[3]; // Social -> Sunita Rao
      if (subject.code === 'COMP') teacherProfile = teacherProfiles[5]; // Computer -> Neha Singh

      const offering = await SubjectOffering.create({
        sectionId: section._id,
        subjectId: subject._id,
        termId: midtermTerm._id,
        teacherId: teacherProfile._id,
      });
      offerings.push(offering);
    }
  }

  // 8. Seed 60 Students and Parents per Division (720 total)
  logger.info('Generating 60 students and parents per division (12 sections * 60 = 720 students total)...');
  const accountsToInsert = [];
  const profilesToInsert = [];
  const studentsToInsert = [];
  const guardiansToInsert = [];
  const enrollmentsToInsert = [];

  const firstNames = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Vivaan', 'Ira', 'Aditya', 'Riya', 'Reyansh', 'Saanvi', 'Krishna', 'Myra', 'Ishaan', 'Zoya', 'Arjun', 'Aanya', 'Dhruv', 'Kiara', 'Pranav', 'Zara', 'Atharv', 'Tanya', 'Dev', 'Kriti', 'Arnav', 'Navya', 'Ayaan', 'Siddhi', 'Shaurya', 'Avani'];
  const lastNames = ['Sharma', 'Patel', 'Mehta', 'Rao', 'Singh', 'Joshi', 'Kumar', 'Sen', 'Gupta', 'Nair', 'Iyer', 'Reddy', 'Choudhury', 'Khan', 'Varma', 'Bose', 'Kapoor', 'Shah', 'Ali', 'Mishra', 'Verma', 'Pathak', 'Saxena', 'Bhat', 'Bhatt', 'Deshmukh', 'Kulkarni', 'Dutt', 'Trivedi', 'Jha'];

  let count = 0;
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];
    const grade = grades.find((g) => g._id.toString() === section.gradeId.toString());
    const gradeLabel = grade ? grade.name : 'Class';

    for (let i = 1; i <= 60; i++) {
      count++;
      const first = firstNames[count % firstNames.length];
      const last = lastNames[count % lastNames.length];
      const displayName = `${first} ${last}`;
      const admissionNo = `ADM-2026-${String(count).padStart(4, '0')}`;

      // Student Account & Profile IDs
      const sAccId = new mongoose.Types.ObjectId();
      const sProfId = new mongoose.Types.ObjectId();
      const sStudentId = new mongoose.Types.ObjectId();
      const sEnrollId = new mongoose.Types.ObjectId();

      const sPhone = `+910000003${String(count).padStart(3, '0')}`;
      const sEmail = `student.${count}@schoolerp.com`;

      accountsToInsert.push({
        _id: sAccId,
        phoneE164: sPhone,
        email: sEmail,
        passwordHash,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      profilesToInsert.push({
        _id: sProfId,
        accountId: sAccId,
        roleId: roleMap.get('STUDENT'),
        displayName: `${displayName} (${gradeLabel}–${section.name} #${i})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      studentsToInsert.push({
        _id: sStudentId,
        admissionNo,
        firstName: first,
        lastName: last,
        dob: new Date(2012, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
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
      const pAccId = new mongoose.Types.ObjectId();
      const pProfId = new mongoose.Types.ObjectId();

      const pPhone = `+910000004${String(count).padStart(3, '0')}`;
      const pEmail = `parent.${count}@schoolerp.com`;

      accountsToInsert.push({
        _id: pAccId,
        phoneE164: pPhone,
        email: pEmail,
        passwordHash,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      profilesToInsert.push({
        _id: pProfId,
        accountId: pAccId,
        roleId: roleMap.get('PARENT'),
        displayName: `Parent of ${first}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      guardiansToInsert.push({
        studentId: sStudentId,
        guardianProfileId: pProfId,
        relation: i % 2 === 0 ? 'FATHER' : 'MOTHER',
        isPrimary: true,
        pickupAuthorized: true,
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

  for (const section of sections) {
    const secOfferings = offerings.filter(o => o.sectionId.toString() === section._id.toString());
    if (secOfferings.length === 0) continue;
    
    for (const day of days) {
      for (const p of periods) {
        // Pick an offering cyclically
        const offering = secOfferings[(day * p.no) % secOfferings.length];
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
  logger.info('Seeding Midterm Exams and Student Marks...');
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

    // Find enrolled students in the section
    const secEnrollments = enrollments.filter(e => e.sectionId.toString() === offering.sectionId.toString());
    for (const e of secEnrollments) {
      const marks = Math.floor(Math.random() * 8) + 12; // 12 - 20 marks
      await Submission.create({
        assignmentId: assignment._id,
        enrollmentId: e._id,
        status: 'GRADED',
        submittedAt: new Date('2026-08-14'),
        marks,
        feedback: marks > 16 ? 'Excellent analysis' : 'Review chapters again',
      });
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

  logger.info('====================================================');
  logger.info('  FULL SCHOOL SEEDING COMPLETED SUCCESSFULLY!  🚀');
  logger.info('====================================================');
  logger.info('Credentials seeded:');
  logger.info(' - Owner:     owner@schoolerp.com / ChangeMe@123!');
  logger.info(' - Admin:     admin@schoolerp.com / ChangeMe@123!');
  logger.info(' - Principal: principal@schoolerp.com / ChangeMe@123!');
  logger.info(' - Teacher 1: teacher@schoolerp.com / ChangeMe@123! (+910000000003)');
  logger.info(' - Teacher 2: priya.science@schoolerp.com / ChangeMe@123! (+910000000011)');
  logger.info(' - Student 1: student.1@schoolerp.com / ChangeMe@123! (+910000003001)');
  logger.info(' - Parent 1:  parent.1@schoolerp.com / ChangeMe@123! (+910000004001)');
  logger.info('====================================================');

  await mongoose.disconnect();
  process.exit(0);
}

seedSchool().catch((err) => {
  logger.error('School Seeding failed:', err);
  process.exit(1);
});
