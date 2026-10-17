import { Book, BookIssue } from '../models/library.model.js';
import { BookHold, HostelRollCall, StatutoryCommittee } from '../models/supportRoles.model.js';
import { Lead, LeadInteraction } from '../models/lead.model.js';
import { Student } from '../models/student.model.js';
import * as desk from '../modules/library/library.desk.js';
import * as life from '../modules/hostel/life.service.js';
import * as privacy from '../modules/compliance/privacy.service.js';

/**
 * Sample data for the part-4 support-role screens. Fictional throughout,
 * written through the services so tasks, audit entries and counters are what
 * the screens would have produced:
 *
 *   library desk   reservations (one ready on the hold shelf, two queued), a term
 *                  reading challenge, a fine already settled
 *   hostel life    last night's roll call (submitted, everyone accounted for), this
 *                  week's mess menu, an open incident with a call home, a resolved one
 *   follow-ups     next-action dates on open enquiries (some overdue, some today) and
 *                  a few logged calls
 *   data protection  POCSO, ICC and safety committees (SMC left out, so the checklist
 *                  shows a gap), three data requests (one past its date), a closed breach
 */
const DAY = 86_400_000;
const IST = 330 * 60_000;
const ymd = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);

export async function seedP4SupportRoles({ section, attempt, who }) {
  const L = who.LIBRARIAN?.actor;
  const W = who.WARDEN?.actor;
  const M = who.MARKETING?.actor;
  const C = who.COMPLIANCE?.actor;

  if (L) {
    await section('Library desk (reservations, reading challenge)', BookHold, async () => {
      // Titles whose every copy is out: the natural candidates for a queue.
      const out = await Book.find({ deletedAt: null, resourceType: { $ne: 'DIGITAL' }, availableCopies: 0, totalCopies: { $gte: 1 } }).select('_id').limit(2).lean();
      const shelf = await Book.findOne({ deletedAt: null, resourceType: { $ne: 'DIGITAL' }, availableCopies: { $gte: 2 } }).select('_id').lean();
      const students = await Student.find({ deletedAt: null }).select('_id').skip(20).limit(6).lean();
      let made = 0;
      if (shelf && students[0]) { if (await attempt('ready hold', () => desk.placeHold(L, { bookId: String(shelf._id), studentId: String(students[0]._id) }))) made += 1; }
      for (const [i, b] of out.entries()) {
        for (const s of students.slice(1 + i * 2, 3 + i * 2)) {
          // eslint-disable-next-line no-await-in-loop
          if (await attempt('queued hold', () => desk.placeHold(L, { bookId: String(b._id), studentId: String(s._id), note: 'Asked at the desk' }))) made += 1;
        }
      }
      const start = new Date(Date.now() - 45 * DAY);
      await attempt('reading challenge', () => desk.createChallenge(L, { title: 'Term reading challenge: 5 books', description: 'Any five books borrowed and returned this term.', startsOn: ymd(start), endsOn: ymd(new Date(Date.now() + 45 * DAY)), targetBooks: 5 }));
      const fined = await BookIssue.findOne({ status: 'RETURNED', fineAmount: { $gt: 0 } }).select('_id').lean();
      if (fined) await attempt('settled fine', () => desk.settleFine(L, String(fined._id), { status: 'PAID' }));
      return `${made} reservation(s), 1 reading challenge`;
    });
  }

  if (W) {
    await section('Hostel life (roll call, mess menu, incidents)', HostelRollCall, async () => {
      const residents = await life.residents();
      if (!residents.length) return 'no hostel residents to seed for';
      const last = ymd(new Date(Date.now() - DAY));
      const r = await attempt('roll call', () => life.startRollCall(W, { date: last, session: 'NIGHT' }));
      if (r) {
        const late = r.entries.find((e) => e.status === 'UNMARKED');
        if (late) await attempt('late arrival', () => life.markRollCall(W, r.id, { entries: [{ studentId: late.studentId, status: 'LATE', note: 'Back from the evening study hall at 21:35' }] }));
        await attempt('everyone else present', () => life.markRollCall(W, r.id, { allPresent: true }));
        await attempt('submit', () => life.submitRollCall(W, r.id));
      }
      const meals = [
        ['Poha, banana, milk', 'Rice, dal tadka, aloo gobi, roti, curd', 'Bhel, lemon water', 'Roti, paneer butter masala, jeera rice, salad'],
        ['Idli, sambar, chutney', 'Rajma, rice, roti, cucumber raita', 'Biscuits, tea or milk', 'Roti, mixed veg, dal makhani, rice'],
        ['Aloo paratha, curd', 'Chole, rice, roti, salad', 'Sprouts chaat', 'Veg pulao, kadhi, papad'],
        ['Upma, boiled egg or sprouts', 'Sambar rice, beans poriyal, buttermilk', 'Fruit', 'Roti, egg curry or paneer bhurji, rice'],
        ['Dosa, chutney', 'Rice, dal, bhindi fry, roti', 'Samosa, tea or milk', 'Veg biryani, raita'],
        ['Puri, aloo sabzi', 'Khichdi, kadhi, papad', 'Cake slice, milk', 'Roti, malai kofta, rice, kheer'],
        ['Bread, omelette or paneer sandwich', 'Special lunch: veg pulao, paneer, gulab jamun', 'Popcorn', 'Roti, dal, seasonal sabzi, rice'],
      ];
      await attempt('mess menu', () => life.saveMenu(W, { days: meals.map(([breakfast, lunch, snacks, dinner], day) => ({ day, breakfast, lunch, snacks, dinner })), notes: 'Jain and egg-free options on request at the counter.' }));
      const a = residents[1] ?? residents[0];
      const b = residents[2] ?? residents[0];
      const open = await attempt('open incident', () => life.createIncident(W, { studentIds: [a.studentId], category: 'LATE_RETURN', severity: 'MEDIUM', occurredAt: new Date(Date.now() - 2 * DAY), description: 'Returned to the hostel at 21:50 after the 21:00 in-time, without informing the duty warden.', actionTaken: 'Spoke with the student; reminded of the in-time.' }));
      if (open) await attempt('parent call', () => life.logParentContact(W, open.id, { guardianName: 'Parent', channel: 'CALL', summary: 'Informed the parent; they will speak to the child. Agreed to call the warden before any late return.' }));
      const done = await attempt('resolved incident', () => life.createIncident(W, { studentIds: [b.studentId], category: 'HOMESICKNESS', severity: 'LOW', occurredAt: new Date(Date.now() - 9 * DAY), description: 'New resident unsettled in the first week; not eating dinner well.', actionTaken: 'Paired with a senior buddy; daily check-in.' }));
      if (done) await attempt('resolve', () => life.resolveIncident(W, done.id, { resolution: 'Settled in by the second week; eating well and joined the evening games.' }));
      return `${residents.length} residents on the roll call, menu for the week, 2 incidents`;
    });
  }

  if (M) {
    await section('Admissions follow-ups (next actions, calls)', null, async () => {
      if (await LeadInteraction.exists({ body: { $regex: '^Follow-up call' } })) return 'kept (already has data)';
      const open = await Lead.find({ stage: { $in: ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION'] } }).sort({ createdAt: -1 }).limit(12).lean();
      let n = 0;
      for (const [i, l] of open.entries()) {
        const when = i % 3 === 0 ? new Date(Date.now() - (i + 1) * DAY) : i % 3 === 1 ? new Date(Date.now() + 2 * 3600_000) : new Date(Date.now() + (i + 2) * DAY);
        // eslint-disable-next-line no-await-in-loop
        await Lead.updateOne({ _id: l._id, nextActionAt: null }, { $set: { nextActionAt: when } });
        if (i % 2 === 0 && l.stage !== 'NEW') {
          // eslint-disable-next-line no-await-in-loop
          await LeadInteraction.create({ leadId: l._id, type: 'CALL', body: 'Follow-up call: shared the fee structure and transport routes; family comparing two schools.', authorProfileId: M.profileId, createdAt: new Date(Date.now() - (i + 2) * DAY) });
          n += 1;
        }
      }
      return `${open.length} enquiries with a next action, ${n} calls logged`;
    });
  }

  if (C) {
    await section('Data protection and committees', StatutoryCommittee, async () => {
      const year = new Date().getUTCFullYear();
      await attempt('POCSO committee', () => privacy.saveCommittee(C, { kind: 'POCSO', members: [{ name: 'Principal (Chair)', role: 'Chair' }, { name: 'Senior counsellor', role: 'Member' }, { name: 'Woman teacher representative', role: 'Member' }, { name: 'Parent representative', role: 'Member', external: true }], constitutedOn: `${year}-04-10`, lastMeetingOn: ymd(new Date(Date.now() - 40 * DAY)), displayedOnWebsite: true, displayedOnNoticeBoard: true }));
      await attempt('ICC', () => privacy.saveCommittee(C, { kind: 'ICC_POSH', members: [{ name: 'Senior woman teacher', role: 'Presiding officer' }, { name: 'HR officer', role: 'Member' }, { name: 'NGO member', role: 'External member', external: true }], constitutedOn: `${year - 1}-06-01`, reviewDueOn: ymd(new Date(Date.now() - 10 * DAY)), displayedOnWebsite: true }));
      await attempt('Safety committee', () => privacy.saveCommittee(C, { kind: 'SCHOOL_SAFETY', members: [{ name: 'Administrator', role: 'Convenor' }, { name: 'Transport in-charge', role: 'Member' }, { name: 'Parent representative', role: 'Member', external: true }], constitutedOn: `${year}-05-02`, displayedOnNoticeBoard: true }));
      await attempt('request 1', () => privacy.createRequest(C, { kind: 'CORRECTION', requesterName: 'A parent of Class 7', requesterRelation: 'PARENT', contact: 'via the office', details: "Child's date of birth is wrong on the ID card.", receivedAt: new Date(Date.now() - 6 * DAY).toISOString() }));
      await attempt('request 2', () => privacy.createRequest(C, { kind: 'ERASURE', requesterName: 'A former parent', requesterRelation: 'PARENT', details: 'Remove our child\'s photos from the newsletter archive.', receivedAt: new Date(Date.now() - 35 * DAY).toISOString() }));
      const done = await attempt('request 3', () => privacy.createRequest(C, { kind: 'ACCESS', requesterName: 'A staff member', requesterRelation: 'SELF', details: 'A copy of my personal data held by the school.', receivedAt: new Date(Date.now() - 20 * DAY).toISOString() }));
      if (done) await attempt('close request 3', () => privacy.updateRequest(C, done.id, { identityVerified: true, status: 'COMPLETED', outcome: 'Summary of the personal data held, with its purposes, shared in person.' }));
      const b = await attempt('breach', () => privacy.createBreach(C, { title: 'Class list emailed to the wrong parent group', discoveredAt: new Date(Date.now() - 50 * DAY).toISOString(), affectedCount: 38, childrenAffected: true, dataCategories: ['names', 'class', 'roll numbers'], containment: 'Recipients asked to delete; recall sent the same hour.' }));
      if (b) await attempt('breach closed', () => privacy.updateBreach(C, b.id, { boardIntimatedAt: new Date(Date.now() - 50 * DAY + 4 * 3600_000).toISOString(), boardReportAt: new Date(Date.now() - 48 * DAY).toISOString(), principalsInformedAt: new Date(Date.now() - 49 * DAY).toISOString(), status: 'CLOSED' }));
      return '3 committees, 3 data requests, 1 breach (closed)';
    });
  }
}
