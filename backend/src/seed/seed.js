import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Permission } from '../models/permission.model.js';
import { Role } from '../models/role.model.js';
import { Account } from '../models/account.model.js';
import { Profile } from '../models/profile.model.js';
import { Student } from '../models/student.model.js';
import { Book, BookIssue } from '../models/library.model.js';
import { HostelRoom, HostelAllocation } from '../models/hostel.model.js';
import { seedDocuments, auditDocumentFiles, pruneStaleDocuments } from './seed_documents.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../constants/permissions.js';
import { DEMO_USERS } from '../constants/demoUsers.js';

async function seed() {
  await mongoose.connect(env.MONGO_URI);
  logger.info('Connected to MongoDB for seeding');

  logger.info(`Seeding ${PERMISSION_CATALOG.length} permissions...`);
  for (const p of PERMISSION_CATALOG) {
    await Permission.updateOne(
      { key: p.key },
      { $set: { group: p.group, description: p.description, isSystem: true } },
      { upsert: true }
    );
  }

  logger.info(`Seeding ${SYSTEM_ROLES.length} system roles...`);
  for (const r of SYSTEM_ROLES) {
    await Role.updateOne(
      { key: r.key },
      {
        $set: {
          name: r.name,
          description: r.description ?? '',
          isSystem: true,
          permissions: r.grants,
        },
      },
      { upsert: true }
    );
  }

  logger.info(`Seeding ${DEMO_USERS.length} demo users (one per role)...`);
  for (const u of DEMO_USERS) {
    const role = await Role.findOne({ key: u.roleKey });
    if (!role) {
      logger.warn(`Skipping demo user for unknown role: ${u.roleKey}`);
      continue;
    }

    let account = await Account.findOne({ phoneE164: u.phone });
    if (!account) {
      // Omit email entirely when absent — the sparse unique index only
      // excludes documents missing the field, not ones explicitly set to null.
      const passwordHash = u.password ? await bcrypt.hash(u.password, env.BCRYPT_SALT_ROUNDS) : null;
      account = await Account.create({
        phoneE164: u.phone,
        ...(u.email && { email: u.email }),
        passwordHash,
      });
    } else if (u.password) {
      // Always update the password hash on re-seed (handles credential changes)
      account.passwordHash = await bcrypt.hash(u.password, env.BCRYPT_SALT_ROUNDS);
      if (u.email && !account.email) account.email = u.email;
      await account.save();
    }

    const existingProfile = await Profile.findOne({ accountId: account._id, roleId: role._id });
    if (!existingProfile) {
      await Profile.create({ accountId: account._id, roleId: role._id, displayName: u.displayName });
      const credential = u.password ? `${u.email} / ${u.password}` : `phone ${u.phone} (OTP login)`;
      logger.info(`  ✔  ${u.roleKey.padEnd(10)} → ${credential}`);
    } else {
      logger.info(`  -  ${u.roleKey.padEnd(10)} → already exists, password updated`);
    }
  }

  // ─── Demo Library Books ───────────────────────────────────
  const bookCount = await Book.countDocuments();
  if (bookCount === 0) {
    logger.info('Seeding demo library books...');
    const demoBooks = [
      { title: 'The Alchemist', author: 'Paulo Coelho', isbn: '978-0-06-112008-4', category: 'Fiction', totalCopies: 5, availableCopies: 4, publisher: 'HarperCollins', publishedYear: 1988 },
      { title: 'Mathematics for Class 10', author: 'R.D. Sharma', isbn: '978-93-5097-001-2', category: 'Textbook', totalCopies: 20, availableCopies: 18, publisher: 'Dhanpat Rai', publishedYear: 2022 },
      { title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', isbn: '978-81-7371-146-6', category: 'Biography', totalCopies: 8, availableCopies: 7, publisher: 'Universities Press', publishedYear: 1999 },
      { title: 'Science for Class 9', author: 'NCERT', isbn: '978-81-7450-634-9', category: 'Textbook', totalCopies: 25, availableCopies: 23, publisher: 'NCERT', publishedYear: 2021 },
      { title: 'English Grammar & Composition', author: 'Wren & Martin', isbn: '978-81-219-0189-8', category: 'Reference', totalCopies: 12, availableCopies: 11, publisher: 'S. Chand', publishedYear: 2015 },
      { title: 'Harry Potter and the Philosopher Stone', author: 'J.K. Rowling', isbn: '978-0-7475-3269-9', category: 'Fiction', totalCopies: 6, availableCopies: 5, publisher: 'Bloomsbury', publishedYear: 1997 },
      { title: 'The Diary of a Young Girl', author: 'Anne Frank', isbn: '978-0-553-29698-7', category: 'Biography', totalCopies: 4, availableCopies: 4, publisher: 'Bantam Books', publishedYear: 1947 },
      { title: 'History of India', author: 'Romila Thapar', isbn: '978-0-14-303304-5', category: 'History', totalCopies: 6, availableCopies: 6, publisher: 'Penguin', publishedYear: 2002 },
    ];
    await Book.insertMany(demoBooks);
    logger.info(`  ✔  ${demoBooks.length} demo books seeded`);

    // Create 1 active lending record
    const firstBook = await Book.findOne({ title: 'The Alchemist' });
    if (firstBook) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);
      await BookIssue.create({
        bookId: firstBook._id,
        borrowerName: 'Demo Student',
        issuedAt: new Date(),
        dueDate,
        status: 'ACTIVE',
      });
      logger.info('  ✔  1 demo book issue created');
    }
  } else {
    logger.info(`  -  Library already has ${bookCount} books, skipping`);
  }

  // ─── Demo Hostel Rooms ────────────────────────────────────
  const roomCount = await HostelRoom.countDocuments();
  if (roomCount === 0) {
    logger.info('Seeding demo hostel rooms...');
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
          status: i === 3 ? 'MAINTENANCE' : 'ACTIVE',
        });
      }
    }
    await HostelRoom.insertMany(rooms);
    logger.info(`  ✔  ${rooms.length} demo hostel rooms seeded (50 total, 25 boys + 25 girls)`);

    // Allocate some students to rooms to show occupancy
    const students = await Student.find({ deletedAt: null }).limit(15);
    const activeRooms = await HostelRoom.find({ status: 'ACTIVE' }).limit(5);
    let allocated = 0;
    for (let i = 0; i < Math.min(students.length, 12); i++) {
      const room = activeRooms[Math.floor(i / 3) % activeRooms.length];
      if (!room) continue;
      const existing = await HostelAllocation.findOne({ studentId: students[i]._id, status: 'ACTIVE' });
      if (!existing) {
        await HostelAllocation.create({
          roomId: room._id,
          studentId: students[i]._id,
          status: 'ACTIVE',
          allottedAt: new Date(),
        });
        allocated++;
      }
    }
    logger.info(`  ✔  ${allocated} students allocated to hostel rooms`);
  } else {
    logger.info(`  -  Hostel already has ${roomCount} rooms, skipping`);
  }

  // ─── Course Materials / Documents ─────────────────────────
  logger.info('Seeding course material documents...');
  await pruneStaleDocuments();
  const docResult = await seedDocuments();
  if (docResult.created) logger.info(`  ✔  ${docResult.created} document(s) seeded with real files on disk`);

  // Any document whose file is missing is reported now rather than discovered
  // later as a 404 by a student trying to open their syllabus.
  const audit = await auditDocumentFiles();
  if (audit.broken.length) {
    logger.warn(`  ✘  ${audit.broken.length} of ${audit.total} document(s) reference a file that is NOT in local storage:`);
    for (const b of audit.broken) logger.warn(`       ${b.title} → ${b.fileUrl}  (id ${b.id})`);
    logger.warn('       These will 404 on view/download. Re-upload them, or remove the stale rows.');
  } else {
    logger.info(`  ✔  all ${audit.total} document file(s) present in local storage`);
  }

  logger.info('Seed complete.');
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err);
  process.exit(1);
});
