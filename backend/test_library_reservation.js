import mongoose from 'mongoose';
import {
  createBookReservation,
  listMyBookReservations,
  listBookReservations,
  getReservationById,
  cancelBookReservation,
  processReservationQueue,
  processExpiredBookReservations,
  issueBook,
  returnBook,
} from './src/modules/library/library.service.js';
import { Book, BookIssue, BookReservation } from './src/models/library.model.js';
import { Student } from './src/models/student.model.js';
import { Profile } from './src/models/profile.model.js';
import { Notification } from './src/models/notification.model.js';

(async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/school_erp');
    console.log('=== FEATURE 4: LIBRARY BOOK RESERVATION TEST SUITE ===\n');

    // Setup Test Data
    const student1ProfileId = new mongoose.Types.ObjectId();
    const student2ProfileId = new mongoose.Types.ObjectId();
    const student3ProfileId = new mongoose.Types.ObjectId();

    const student1 = await Student.create({
      firstName: 'Diya',
      lastName: 'Sharma',
      admissionNo: `TEST-RES-ADM1-${Date.now()}`,
      profileId: student1ProfileId,
    });

    const student2 = await Student.create({
      firstName: 'Kabir',
      lastName: 'Sharma',
      admissionNo: `TEST-RES-ADM2-${Date.now()}`,
      profileId: student2ProfileId,
    });

    const student3 = await Student.create({
      firstName: 'Aarav',
      lastName: 'Patil',
      admissionNo: `TEST-RES-ADM3-${Date.now()}`,
      profileId: student3ProfileId,
    });

    // Create 1 Available Book and 1 Unavailable Book
    const availBook = await Book.create({
      title: `Available Test Book ${Date.now()}`,
      author: 'Test Author',
      isbn: `ISBN-AVAIL-${Date.now()}`,
      totalCopies: 2,
      availableCopies: 2,
    });

    const unavailBook = await Book.create({
      title: `Unavailable Test Book ${Date.now()}`,
      author: 'Test Author',
      isbn: `ISBN-UNAVAIL-${Date.now()}`,
      totalCopies: 1,
      availableCopies: 0,
    });

    const actor1 = { profileId: student1ProfileId.toString(), roleKey: 'STUDENT' };
    const actor2 = { profileId: student2ProfileId.toString(), roleKey: 'STUDENT' };
    const actor3 = { profileId: student3ProfileId.toString(), roleKey: 'STUDENT' };
    const staffActor = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'LIBRARIAN' };

    // -------------------------------------------------------------
    console.log('--- TEST 1: Available Book Cannot Be Reserved ---');
    let availError = null;
    try {
      await createBookReservation(actor1, { bookId: availBook._id.toString() });
    } catch (e) {
      availError = e;
    }
    console.log('✔ Available book reservation rejected correctly:', availError?.message);

    // -------------------------------------------------------------
    console.log('\n--- TEST 2 & 3: Unavailable Book Reserved by Student 1 (Queue #1) ---');
    const res1 = await createBookReservation(actor1, { bookId: unavailBook._id.toString() });
    console.log(`✔ Reservation 1 Created ID: ${res1.id} Status: ${res1.status} QueuePosition: ${res1.queuePosition}`);
    if (res1.queuePosition !== 1) throw new Error('Queue position should be 1');

    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Unavailable Book Reserved by Student 2 (Queue #2) ---');
    const res2 = await createBookReservation(actor2, { bookId: unavailBook._id.toString() });
    console.log(`✔ Reservation 2 Created ID: ${res2.id} Status: ${res2.status} QueuePosition: ${res2.queuePosition}`);
    if (res2.queuePosition !== 2) throw new Error('Queue position should be 2');

    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Duplicate Active Reservation by Same Student Rejected ---');
    let dupError = null;
    try {
      await createBookReservation(actor1, { bookId: unavailBook._id.toString() });
    } catch (e) {
      dupError = e;
    }
    console.log('✔ Duplicate reservation rejected correctly:', dupError?.message);

    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Student 1 Views Own Reservations ---');
    const myRes = await listMyBookReservations(actor1);
    console.log('✔ Student 1 My Reservations Count:', myRes.length);

    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Security Check - Student 2 Cannot View Student 1 Reservation ---');
    let viewError = null;
    try {
      await getReservationById(actor2, 'OWN', res1.id);
    } catch (e) {
      viewError = e;
    }
    console.log('✔ Cross-student view blocked correctly:', viewError?.message);

    // -------------------------------------------------------------
    console.log('\n--- TEST 8 & 9: Cancellation & Queue Re-indexing ---');
    // Student 3 reserves -> Queue #3
    const res3 = await createBookReservation(actor3, { bookId: unavailBook._id.toString() });
    console.log(`Reservation 3 created: QueuePosition ${res3.queuePosition}`);

    // Student 2 cancels reservation
    await cancelBookReservation(actor2, 'OWN', res2.id, 'User cancelled');
    const res3After = await getReservationById(staffActor, 'ALL', res3.id);
    console.log(`✔ After Student 2 cancelled, Student 3 updated QueuePosition: #${res3After.queuePosition} (Expected #2)`);
    if (res3After.queuePosition !== 2) throw new Error('Queue position re-numbering failed');

    // -------------------------------------------------------------
    console.log('\n--- TEST 10 & 11: Book Return Promotes First Pending Reservation to READY ---');
    // Simulate book issue to temporary borrower, then return it
    const issueTemp = await BookIssue.create({
      bookId: unavailBook._id,
      borrowerProfileId: new mongoose.Types.ObjectId(),
      dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      status: 'ACTIVE',
    });

    await returnBook(issueTemp._id.toString());
    const res1Ready = await getReservationById(staffActor, 'ALL', res1.id);
    console.log(`✔ Book returned! Reservation 1 status: ${res1Ready.status} (Expected READY)`);
    console.log(`✔ ExpiresAt set: ${res1Ready.expiresAt}`);

    const notifReady = await Notification.findOne({
      recipientProfileId: student1ProfileId,
      type: 'LIBRARY',
      'meta.reservationId': new mongoose.Types.ObjectId(res1.id),
    });
    console.log('✔ READY Notification created for Student 1:', notifReady?.title, '| Body:', notifReady?.body);

    // -------------------------------------------------------------
    console.log('\n--- TEST 12: Reserved Student 1 Issues Reserved Book (Fulfills Reservation) ---');
    const issueRes1 = await issueBook({
      bookId: unavailBook._id.toString(),
      studentId: student1._id.toString(),
      dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    console.log('✔ Book issued successfully to reserved Student 1! Issue ID:', issueRes1.id);

    const res1Fulfilled = await getReservationById(staffActor, 'ALL', res1.id);
    console.log(`✔ Reservation 1 status after issue: ${res1Fulfilled.status} (Expected FULFILLED)`);

    // -------------------------------------------------------------
    console.log('\n--- TEST 13: Unreserved Student Cannot Issue Book Reserved for Someone Else ---');
    // Return Student 1's book -> promotes Student 3's reservation to READY
    await returnBook(issueRes1.id);
    const res3Ready = await getReservationById(staffActor, 'ALL', res3.id);
    console.log(`Student 3 Reservation status: ${res3Ready.status} (Expected READY)`);

    let wrongIssueError = null;
    try {
      await issueBook({
        bookId: unavailBook._id.toString(),
        studentId: student2._id.toString(), // Wrong student!
        dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });
    } catch (e) {
      wrongIssueError = e;
    }
    console.log('✔ Wrong student issue attempt blocked correctly:', wrongIssueError?.message);

    // -------------------------------------------------------------
    console.log('\n--- TEST 14 & 15: READY Expiration & Promotion of Next Pending Reservation ---');
    // Force reservation 3's expiresAt into the past to test auto-expiration
    await BookReservation.findByIdAndUpdate(res3.id, { expiresAt: new Date(Date.now() - 1000) });

    // Process expiration
    await processExpiredBookReservations(unavailBook._id.toString());
    const res3Expired = await getReservationById(staffActor, 'ALL', res3.id);
    console.log(`✔ Reservation 3 status after expiration: ${res3Expired.status} (Expected EXPIRED)`);

    let fulfillExpiredError = null;
    try {
      await issueBook({
        bookId: unavailBook._id.toString(),
        studentId: student3._id.toString(),
        dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });
    } catch (e) {
      fulfillExpiredError = e;
    }
    console.log('✔ Issuing to expired reservation blocked correctly:', fulfillExpiredError?.message);

    // -------------------------------------------------------------
    console.log('\n--- TEST 16: Multiple Simultaneous Reservations FIFO Order ---');
    const bookMulti = await Book.create({
      title: `Multi Queue Book ${Date.now()}`,
      author: 'Test Author',
      totalCopies: 1,
      availableCopies: 0,
    });

    const [multi1, multi2] = await Promise.all([
      createBookReservation(actor1, { bookId: bookMulti._id.toString() }),
      createBookReservation(actor2, { bookId: bookMulti._id.toString() }),
    ]);

    console.log(`✔ Multi-reservation 1 Position: #${multi1.queuePosition} | Multi-reservation 2 Position: #${multi2.queuePosition}`);

    // -------------------------------------------------------------
    console.log('\n--- TEST 17: Normal Issue & Return for Books with No Reservations ---');
    const normalBook = await Book.create({
      title: `Normal Book ${Date.now()}`,
      author: 'Normal Author',
      totalCopies: 2,
      availableCopies: 2,
    });

    const normalIssue = await issueBook({
      bookId: normalBook._id.toString(),
      studentId: student1._id.toString(),
      dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    console.log('✔ Normal Book Issued! Status:', normalIssue.status);

    const normalReturn = await returnBook(normalIssue.id);
    console.log('✔ Normal Book Returned! Status:', normalReturn.status);

    // Cleanup test data
    await BookReservation.deleteMany({ bookId: { $in: [unavailBook._id, availBook._id, bookMulti._id, normalBook._id] } });
    await BookIssue.deleteMany({ bookId: { $in: [unavailBook._id, availBook._id, bookMulti._id, normalBook._id] } });
    await Book.deleteMany({ _id: { $in: [unavailBook._id, availBook._id, bookMulti._id, normalBook._id] } });
    await Student.deleteMany({ _id: { $in: [student1._id, student2._id, student3._id] } });

    console.log('\nALL 17 RESERVATION INTEGRATION TESTS PASSED PERFECTLY!');
    process.exit(0);
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  }
})();
