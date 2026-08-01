import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { encrypt } from '../utils/crypto.js';

/**
 * Upserts a document that carries a unique index on something *other* than _id.
 *
 * This script pins fixed _ids so it can be re-run safely. That works on a
 * database only this script has touched — but a document created by another
 * seed (`npm run seed:school`) has its own _id and the same natural key, and
 * inserting a second one violates the unique index. That is exactly how
 * `npm run migrate` used to die after `npm run seed:school`:
 *
 *   E11000 duplicate key … academicyears index: name_1 dup key: { name: "2026-27" }
 *
 * So: resolve by natural key first and adopt whatever _id is already there,
 * falling back to the fixed _id only when nothing exists yet. The caller uses
 * the returned id for everything downstream, so references stay consistent
 * whichever seed created the document.
 *
 * createdAt goes in $setOnInsert rather than $set, so re-running does not
 * rewrite the creation time of rows that were already there.
 */
async function upsertByNaturalKey(db, collection, naturalKey, fixedId, fields = {}, unset = null) {
  const existing = await db.collection(collection).findOne(naturalKey);
  const _id = existing?._id ?? fixedId;

  const update = {
    $set: { ...naturalKey, ...fields, updatedAt: new Date() },
    $setOnInsert: { createdAt: new Date() },
  };
  if (unset) update.$unset = unset;

  await db.collection(collection).updateOne({ _id }, update, { upsert: true });
  return _id;
}

async function runMigration() {
  logger.info('Connecting to MongoDB for migration…');
  await mongoose.connect(env.MONGO_URI);
  logger.info('Connected successfully!');

  const db = mongoose.connection.db;

  // 1. Resolve Profile IDs for role-scoped permissions
  logger.info('Resolving system profile IDs…');
  const roles = await db.collection('roles').find().toArray();
  const studentRole = roles.find(r => r.key === 'STUDENT');
  const parentRole = roles.find(r => r.key === 'PARENT');
  const teacherRole = roles.find(r => r.key === 'TEACHER');

  if (!studentRole || !parentRole || !teacherRole) {
    throw new Error('System roles not seeded. Please run npm run seed first.');
  }

  const studentProfile = await db.collection('profiles').findOne({ roleId: studentRole._id });
  const parentProfile = await db.collection('profiles').findOne({ roleId: parentRole._id });
  const teacherProfile = await db.collection('profiles').findOne({ roleId: teacherRole._id });

  if (!studentProfile || !parentProfile || !teacherProfile) {
    throw new Error('Demo profiles not found. Please run npm run seed first.');
  }

  logger.info(`Resolved Demo Student Profile: ${studentProfile._id}`);
  logger.info(`Resolved Demo Parent Profile: ${parentProfile._id}`);
  logger.info(`Resolved Demo Teacher Profile: ${teacherProfile._id}`);

  // 2. Create Current Academic Year & Term
  // `academicyears.name` is uniquely indexed, so this must adopt an existing
  // "2026-27" rather than trying to insert a second one under a fixed _id.
  logger.info('Harmonizing Academic Years and Terms…');
  const academicYearId = await upsertByNaturalKey(
    db,
    'academicyears',
    { name: '2026-27' },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4ae1'),
    {
      startsOn: new Date('2026-06-01T00:00:00.000Z'),
      endsOn: new Date('2027-05-31T00:00:00.000Z'),
      isCurrent: true
    }
  );
  logger.info(`Using academic year ${academicYearId}`);

  const termId = await upsertByNaturalKey(
    db,
    'terms',
    { academicYearId, name: 'Midterm' },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4af1'),
    {
      startsOn: new Date('2026-06-01T00:00:00.000Z'),
      endsOn: new Date('2026-11-30T00:00:00.000Z')
    }
  );

  // 3. Students
  logger.info('Reshaping students and creating enrollments…');
  const aaravId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b31');
  const diyaId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b32');
  const sectionAId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b21');

  // Update Aarav Sharma with profileId, delete custom/mismatching fields directly on Student
  await db.collection('students').updateOne(
    { _id: aaravId },
    {
      $set: {
        profileId: studentProfile._id,
        status: 'ACTIVE',
        deletedAt: null
      },
      $unset: {
        fullName: '',
        sectionId: '',
        rollNo: ''
      }
    }
  );

  // Update Diya Patel
  await db.collection('students').updateOne(
    { _id: diyaId },
    {
      $set: {
        profileId: null,
        status: 'ACTIVE',
        deletedAt: null
      },
      $unset: {
        fullName: '',
        sectionId: '',
        rollNo: ''
      }
    }
  );

  // Create Enrollments.
  // `{studentId, academicYearId}` is uniquely indexed — a student already
  // enrolled for this year by another seed must be updated, not duplicated.
  const aaravEnrollmentId = await upsertByNaturalKey(
    db,
    'enrollments',
    { studentId: aaravId, academicYearId },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b51'),
    { sectionId: sectionAId, rollNo: 12, status: 'ACTIVE' }
  );

  const diyaEnrollmentId = await upsertByNaturalKey(
    db,
    'enrollments',
    { studentId: diyaId, academicYearId },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b52'),
    { sectionId: sectionAId, rollNo: 14, status: 'ACTIVE' }
  );

  // 4. StudentGuardians
  logger.info('Linking student guardians to demo parent…');
  const guardianId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b41');
  await db.collection('studentguardians').updateOne(
    { _id: guardianId },
    {
      $set: {
        studentId: aaravId,
        guardianProfileId: parentProfile._id,
        relation: 'FATHER',
        isPrimary: true,
        pickupAuthorized: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        guardianName: '',
        relationship: '',
        phone: '',
        email: ''
      }
    }
  );

  // 5. SubjectOfferings
  logger.info('Linking subject offerings to demo teacher…');
  const mathOfferingId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4ba1');
  await db.collection('subjectofferings').updateOne(
    { _id: mathOfferingId },
    {
      $set: {
        sectionId: sectionAId,
        subjectId: new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b91'),
        termId,
        teacherId: teacherProfile._id,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        sectionName: '',
        subject: '',
        teacherName: ''
      }
    }
  );

  // 6. Invoices
  logger.info('Linking invoices to enrollments…');
  const invoiceAId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b61');
  const invoiceBId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b62');

  await db.collection('invoices').updateOne(
    { _id: invoiceAId },
    {
      $set: {
        enrollmentId: aaravEnrollmentId,
        dueOn: new Date('2026-07-15T00:00:00.000Z'),
        status: 'PENDING',
        totalPaise: 5000000,
        paidPaise: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentId: '',
        studentName: '',
        class: ''
      }
    }
  );

  await db.collection('invoices').updateOne(
    { _id: invoiceBId },
    {
      $set: {
        enrollmentId: diyaEnrollmentId,
        dueOn: new Date('2026-07-15T00:00:00.000Z'),
        status: 'PAID',
        totalPaise: 5000000,
        paidPaise: 5000000,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentId: '',
        studentName: '',
        class: ''
      }
    }
  );

  // 7. Payments
  logger.info('Linking payments to invoices…');
  const paymentId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b81');
  await db.collection('payments').updateOne(
    { _id: paymentId },
    {
      $set: {
        invoiceId: invoiceBId,
        amountPaise: 5000000,
        mode: 'BANK',
        status: 'SUCCESS',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        invoiceNo: '',
        studentName: '',
        class: ''
      }
    }
  );

  // 8. Exams & ExamSubjects & Marks
  logger.info('Creating exams and exam subjects, linking marks…');
  const markId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bc1');

  const examId = await upsertByNaturalKey(
    db,
    'exams',
    { termId, name: 'Midterm Exam' },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bd1'),
    {
      startsOn: new Date('2026-09-10T00:00:00.000Z'),
      endsOn: new Date('2026-09-20T00:00:00.000Z')
    }
  );

  // `{examId, subjectOfferingId}` is uniquely indexed.
  const examSubjectId = await upsertByNaturalKey(
    db,
    'examsubjects',
    { examId, subjectOfferingId: mathOfferingId },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4be1'),
    { examDate: new Date('2026-09-12T00:00:00.000Z'), maxMarks: 100 }
  );

  await db.collection('marks').updateOne(
    { _id: markId },
    {
      $set: {
        examSubjectId,
        enrollmentId: aaravEnrollmentId,
        marks: 85,
        gradeLabel: 'A',
        remarks: 'Excellent work',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        enteredByProfileId: teacherProfile._id,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentId: '',
        studentName: '',
        subjectId: '',
        examName: '',
        maxMarks: '',
        pct: ''
      }
    }
  );

  // 9. Assignments & Submissions
  logger.info('Creating assignments and linking submissions…');
  const assignmentId = await upsertByNaturalKey(
    db,
    'assignments',
    { subjectOfferingId: mathOfferingId, title: 'Math homework 1' },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4be1'),
    {
      description: 'Solve equations on page 42.',
      type: 'HOMEWORK',
      dueAt: new Date('2026-06-21T00:00:00.000Z'),
      maxMarks: 10,
      createdByProfileId: teacherProfile._id,
      deletedAt: null
    }
  );

  // `{assignmentId, enrollmentId}` is uniquely indexed.
  await upsertByNaturalKey(
    db,
    'submissions',
    { assignmentId, enrollmentId: aaravEnrollmentId },
    new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bd1'),
    {
      status: 'GRADED',
      submittedAt: new Date('2026-06-20T14:00:00.000Z'),
      marks: 9,
      feedback: 'Great job!'
    },
    { studentId: '', studentName: '' }
  );

  // 10. Lead status → stage
  logger.info('Correcting CRM Lead stage…');
  const leadId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bf1');
  await db.collection('leads').updateOne(
    { _id: leadId },
    {
      $set: {
        stage: 'APPLICATION',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        status: ''
      }
    }
  );

  // 11. Risk Predictions
  logger.info('Correcting Risk Predictions…');
  const riskId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4c51');
  await db.collection('riskpredictions').updateOne(
    { _id: riskId },
    {
      $set: {
        enrollmentId: aaravEnrollmentId,
        type: 'ACADEMIC_DECLINE', // match backend enum type
        level: 'LOW',
        probability: 0.15,
        topFeatures: [
          {
            feature: 'Homework submission delay',
            value: '2 days',
            contribution: 0.05
          }
        ],
        modelVersion: 'heuristic-v1',
        computedAt: new Date('2026-06-29T00:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentName: '',
        class: ''
      }
    }
  );

  // 12. Growth Scores
  logger.info('Correcting Growth Scores…');
  const growthId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4c41');
  await db.collection('growthscores').updateOne(
    { _id: growthId },
    {
      $set: {
        enrollmentId: aaravEnrollmentId,
        period: '2026-06',
        score: 88,
        breakdown: [
          {
            component: 'acad',
            label: 'Academic Progression',
            raw: 89,
            normalized: 90,
            weight: 40,
            points: 36,
            detail: 'Consistent performance in weekly quizzes.'
          }
        ],
        computedAt: new Date('2026-06-29T00:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentName: '',
        band: '',
        components: ''
      }
    }
  );

  // 13. Timetable Slots
  logger.info('Linking Timetable Slots…');
  const timetableSlotId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bb1');
  await db.collection('timetableslots').updateOne(
    { _id: timetableSlotId },
    {
      $set: {
        sectionId: sectionAId,
        dayOfWeek: 1,
        periodNo: 1,
        startTime: '08:30',
        endTime: '09:15',
        subjectOfferingId: mathOfferingId,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        subject: '',
        teacher: '',
        isBreak: ''
      }
    }
  );

  // 14. Medical Records (with encryption!)
  logger.info('Encrypting medical records at rest…');
  const medicalId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b31'); // custom _id is Aarav's ID

  const emergencyContact = {
    name: 'Rajesh Sharma',
    phone: '+919876543210',
    relation: 'FATHER'
  };
  const allergies = ['Peanuts'];
  const medications = [];
  const history = 'No major conditions.';

  const emergencyContactEnc = encrypt(emergencyContact);
  const allergiesEnc = encrypt(allergies);
  const medicationsEnc = encrypt(medications);
  const historyEnc = encrypt(history);

  await db.collection('medicalrecords').updateOne(
    { _id: medicalId },
    {
      $set: {
        studentId: aaravId,
        bloodGroup: 'O+',
        heightCm: 165,
        weightKg: 58,
        emergencyContactEnc,
        allergiesEnc,
        medicationsEnc,
        historyEnc,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        emergencyContact: '',
        allergies: '',
        medications: '',
        history: ''
      }
    }
  );

  logger.info('Migration complete!');
  await mongoose.disconnect();
}

runMigration().catch(err => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
