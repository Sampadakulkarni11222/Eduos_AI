import { StudentGuardian } from '../../src/models/student.model.js';
import { Invoice, InvoiceLine } from '../../src/models/fee.model.js';
import { StaffLeave, LeaveBalance } from '../../src/models/staffLeave.model.js';
import { seedAskAiSchool } from './askAiSchool.js';
import { seedPerson, inSchool, OAK } from './mcpSchool.js';

/**
 * The school the multi-turn conversation harness (askAi.conversations.test.js)
 * talks to: seedAskAiSchool() (see askAiSchool.js) plus what the conversations
 * of the other roles need.
 *
 *   PARENT     father of Rahul Sharma (Class 6 A) AND of Riya Kapoor (Class 6 B):
 *              a parent with two children, in two classes
 *   Fees       Rahul INV-1001 ₹8,000 overdue (from seedSchool); Riya INV-1003 ₹2,500
 *              not yet due -- so "her fees" can never honestly be ₹8,000
 *   HR         one PENDING staff leave, applied by TEACHER (who has 12 days of casual leave)
 *   NURSE, ALUMNUS  people of those roles (no records: their honest answers are "none")
 *
 * Not a test file: vitest runs it only when imported.
 */
export async function seedConversationSchool() {
  const school = await seedAskAiSchool();
  for (const key of ['HR', 'NURSE', 'ALUMNUS']) {
    school.people[key] = await seedPerson({ roleKey: key, roleId: school.roleIds[key] });
  }
  const extra = await inSchool(OAK, async () => {
    await StudentGuardian.create({
      studentId: school.riya.student._id, guardianProfileId: school.people.PARENT.profile._id, relation: 'FATHER',
    });
    const day = 86_400_000;
    const inv3 = await Invoice.create({
      enrollmentId: school.riya.enrollment._id, invoiceNo: 'INV-1003', dueOn: new Date(Date.now() + 10 * day), totalPaise: 250000,
    });
    await InvoiceLine.create({ invoiceId: inv3._id, description: 'Transport — Term 1', amountPaise: 250000 });
    const from = new Date(Date.now() + 3 * day);
    const leave = await StaffLeave.create({
      refNo: 'SL-0001', profileId: school.people.TEACHER.profile._id, code: 'CL', leaveYear: String(from.getFullYear()),
      fromDate: from, toDate: from, days: 1, reason: 'Family function', status: 'PENDING',
      appliedByProfileId: school.people.TEACHER.profile._id,
    });
    // A casual-leave balance, so the teacher's own leave can actually be applied for.
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    await LeaveBalance.create({ profileId: school.people.TEACHER.profile._id, leaveYear: `${startYear}-${String(startYear + 1).slice(2)}`, code: 'CL', entitled: 12 });
    return { inv3, leave };
  });
  return { ...school, ...extra };
}

/**
 * Every person in the fixture by full name, with the school they belong to --
 * what the grounding check looks for in a reply. A name in a reply that is not
 * in the records the turn read (or in what the person typed) is invented.
 */
export const FIXTURE_PEOPLE = [
  'Rahul Sharma', 'Priya Verma', 'Aman Gupta', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra',
  'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', 'Rahul Riverside',
];
