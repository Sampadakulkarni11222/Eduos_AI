import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { encrypt } from '../utils/crypto.js';

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
  logger.info('Harmonizing Academic Years and Terms…');
  const academicYearId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4ae1');
  const termId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4af1');

  await db.collection('academicyears').updateOne(
    { _id: academicYearId },
    {
      $set: {
        name: '2026-27',
        startsOn: new Date('2026-06-01T00:00:00.000Z'),
        endsOn: new Date('2027-05-31T00:00:00.000Z'),
        isCurrent: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await db.collection('terms').updateOne(
    { _id: termId },
    {
      $set: {
        academicYearId,
        name: 'Midterm',
        startsOn: new Date('2026-06-01T00:00:00.000Z'),
        endsOn: new Date('2026-11-30T00:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
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

  // Create Enrollments
  const aaravEnrollmentId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b51');
  const diyaEnrollmentId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4b52');

  await db.collection('enrollments').updateOne(
    { _id: aaravEnrollmentId },
    {
      $set: {
        studentId: aaravId,
        sectionId: sectionAId,
        academicYearId,
        rollNo: 12,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await db.collection('enrollments').updateOne(
    { _id: diyaEnrollmentId },
    {
      $set: {
        studentId: diyaId,
        sectionId: sectionAId,
        academicYearId,
        rollNo: 14,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
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
  const examId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bd1');
  const examSubjectId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4be1');
  const markId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bc1');

  await db.collection('exams').updateOne(
    { _id: examId },
    {
      $set: {
        termId,
        name: 'Midterm Exam',
        startsOn: new Date('2026-09-10T00:00:00.000Z'),
        endsOn: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await db.collection('examsubjects').updateOne(
    { _id: examSubjectId },
    {
      $set: {
        examId,
        subjectOfferingId: mathOfferingId,
        examDate: new Date('2026-09-12T00:00:00.000Z'),
        maxMarks: 100,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
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
  const assignmentId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4be1');
  const submissionId = new mongoose.Types.ObjectId('60d5ec3ad57f8a12e84d4bd1');

  await db.collection('assignments').updateOne(
    { _id: assignmentId },
    {
      $set: {
        subjectOfferingId: mathOfferingId,
        title: 'Math homework 1',
        description: 'Solve equations on page 42.',
        type: 'HOMEWORK',
        dueAt: new Date('2026-06-21T00:00:00.000Z'),
        maxMarks: 10,
        createdByProfileId: teacherProfile._id,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await db.collection('submissions').updateOne(
    { _id: submissionId },
    {
      $set: {
        assignmentId,
        enrollmentId: aaravEnrollmentId,
        status: 'GRADED',
        submittedAt: new Date('2026-06-20T14:00:00.000Z'),
        marks: 9,
        feedback: 'Great job!',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      $unset: {
        studentId: '',
        studentName: ''
      }
    }
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
