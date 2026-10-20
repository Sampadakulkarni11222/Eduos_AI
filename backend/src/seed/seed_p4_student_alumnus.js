import { AlumniProfile } from '../models/alumni.model.js';
import { AlumniOpportunity } from '../models/alumniOpportunity.model.js';
import { Student } from '../models/student.model.js';
import { CalendarEvent } from '../models/calendarEvent.model.js';
import { DocumentType } from '../models/documentRequest.model.js';
import * as docs from '../modules/documentRequests/documentRequest.service.js';
import * as opps from '../modules/p4StudentAlumnus/opportunities.service.js';

/**
 * Sample data for the part-4 student and alumnus features (fictional):
 *   - the demo alumnus's archived school record (so their certificate requests
 *     and "Your school record" have something to stand on) and a pending
 *     character-certificate request in the school office's queue;
 *   - the alumni "give back" board: four published offers from sample alumni
 *     (one open to every class), one from the demo alumnus waiting for review,
 *     and the demo student's interest in one of them;
 *   - a board-registration (LOC) check on the school calendar for Classes 10 and 12.
 */
const DAY = 86_400_000;
const soon = (days) => new Date(Date.now() + days * DAY);

export async function seedP4StudentAlumnus({ section, attempt, who }) {
  const HR = who.HR;
  if (!HR) return;

  await section('Alumni certificates and give-back board (sample)', AlumniOpportunity, async () => {
    const notes = [];
    // 1. The demo alumnus's archived record.
    const me = who.ALUMNUS ? await AlumniProfile.findOne({ profileId: who.ALUMNUS.profile._id }) : null;
    if (me && !me.studentId) {
      const s = await Student.create({
        admissionNo: 'OAK-2006-0412', firstName: 'Demo', lastName: 'Alumnus', dob: new Date(Date.UTC(2000, 4, 12)), gender: 'OTHER', status: 'INACTIVE',
      });
      me.studentId = s._id;
      await me.save();
      notes.push('archived record for the demo alumnus');
      const character = await DocumentType.findOne({ name: /character certificate/i, isActive: true }).lean();
      if (character) {
        await attempt('alumni certificate request', () => docs.createRequest(who.ALUMNUS.actor, {
          documentTypeId: String(character._id), purpose: 'Verification for a new employer (sample)', requiredBy: soon(14).toISOString().slice(0, 10),
        }));
        notes.push('a character-certificate request waiting in the office queue');
      }
    }

    // 2. The give-back board. Sample alumni have no login, so their offers are
    //    entered as the alumni coordinator (HR) recorded them, with the alumnus named.
    const posted = [
      ['CAREER_TALK', 'A day in the life of a doctor (sample)', 'An informal talk about medicine as a career: entrance exams, the years of training and what the work is really like. Questions welcome.', 'City General Hospital (sample)', 'Library hall', 'IN_PERSON', 20, 'ALL_STUDENTS', 'Sample Ananya Iyer', 'Class of 2018'],
      ['INTERNSHIP', 'Two-week summer internship in software testing (sample)', 'For Class 11 and 12 students curious about software. Supervised, in office hours, with a certificate at the end. The school arranges consent and travel.', 'Sample Tech Pvt Ltd', 'Bengaluru', 'HYBRID', 40, 'SENIOR_STUDENTS', 'Sample Kabir Rao', 'Class of 2019'],
      ['MENTORING', 'Mentoring for JEE and NEET aspirants (sample)', 'One online session a month on study plans, mock-test analysis and handling exam stress. Arranged and supervised by the school.', null, null, 'ONLINE', null, 'SENIOR_STUDENTS', 'Sample Meera Nair', 'Class of 2022'],
      ['SCHOLARSHIP', 'Alumni merit scholarship 2027 (sample)', 'Two scholarships towards the first year of college for students of this school. Apply through the school office with your Class 12 results.', 'Oakridge Alumni Association (sample)', null, 'IN_PERSON', 90, 'SENIOR_STUDENTS', 'Sample Ananya Iyer', 'Class of 2018'],
    ];
    for (const [kind, title, description, organisation, location, mode, applyIn, audience, name, batch] of posted) {
      // eslint-disable-next-line no-await-in-loop
      await AlumniOpportunity.create({
        kind, title, description, organisation, location, mode, applyBy: applyIn ? soon(applyIn) : null, audience,
        postedByProfileId: HR.profile._id, postedByName: name, postedByRole: 'HR', batchLabel: batch, status: 'PUBLISHED',
        review: { byProfileId: HR.profile._id, at: new Date(), note: null },
      });
    }
    notes.push(`${posted.length} published offers`);
    if (who.ALUMNUS) {
      await attempt('alumnus offer', () => opps.create(who.ALUMNUS.actor, {
        kind: 'CAREER_TALK', title: 'How software teams work (sample)', description: 'A 40-minute talk for Classes 9 to 12 on what software engineers do all day, with time for questions.', mode: 'ONLINE', audience: 'SENIOR_STUDENTS',
      }));
      notes.push('one offer from the demo alumnus waiting for review');
    }
    if (who.STUDENT) {
      const talk = await AlumniOpportunity.findOne({ audience: 'ALL_STUDENTS', status: 'PUBLISHED' }).lean();
      if (talk) await attempt('student interest', () => opps.interest(who.STUDENT.actor, String(talk._id), { note: 'I want to be a doctor. (Sample.)' }));
    }

    // 3. The board-registration check on the calendar.
    if (!(await CalendarEvent.exists({ title: /LOC details check/ }))) {
      await CalendarEvent.create({
        title: 'Board LOC details check, Classes 10 and 12 (sample)', type: 'EVENT', startsAt: soon(3), endsAt: soon(3),
        description: 'Students and parents check name, date of birth, parents\' names and subjects before the school submits the List of Candidates. (Sample.)',
        createdByProfileId: HR.profile._id,
      });
      notes.push('a board LOC check on the calendar');
    }
    return notes.join('; ');
  });
}
