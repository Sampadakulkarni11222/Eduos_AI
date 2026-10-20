import { TEMPLATES } from '../messaging/messaging.service.js';

/**
 * The school automations (Part 7), and the built-in ones that already ran.
 *
 * Every SCHEDULED entry is something a person used to do by hand on a fixed
 * rhythm. Each one:
 *   - is switchable per school (AutomationSetting; the default below applies
 *     until the school chooses) and also follows the module's feature switch;
 *   - runs once per school per day (or week) at the school's chosen hour, never
 *     inside the quiet window (QUIET_START..QUIET_END, school time);
 *   - sends only through the operational outbox, so WhatsApp needs the
 *     recipient's opt-in, honours their quiet hours and is SIMULATED when no
 *     provider is configured; the in-app copy always goes;
 *   - never writes a record on someone's behalf: what it prepares is a draft
 *     (AutomationDraft) or a task, and a person confirms it.
 *
 * Messages to families default to OFF: a school switches them on knowingly.
 * Staff nudges, drafts and each student's own homework reminder default to ON.
 *
 * BUILT_IN entries are listed on the Automations page so the school sees the
 * whole picture; they are run by their own modules and switched there.
 */

export const QUIET_START = 21; // no automation sends from 21:00 ...
export const QUIET_END = 7; // ... until 07:00 school time

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const preview = (templateKey, vars) => TEMPLATES[templateKey].text(vars);

export const AUTOMATIONS = [
  {
    key: 'attendanceRegisterNudge',
    label: 'Register not marked: nudge the class teacher',
    description: 'On school days, a class whose day register has no marks by the set hour: its class teacher is reminded. Two hours later the principal gets one list of the classes still unmarked.',
    roles: ['TEACHER', 'PRINCIPAL'], audiences: ['TEACHER', 'PRINCIPAL'], defaultAudience: ['TEACHER', 'PRINCIPAL'],
    cadence: 'DAILY', schoolDaysOnly: true, defaultHour: 10, defaultEnabled: true, familyFacing: false,
    templateKey: 'REGISTER_NOT_MARKED', channels: 'In-app and WhatsApp (if opted in)',
    preview: () => preview('REGISTER_NOT_MARKED', { classes: 'Class 6 A', time: '10:00' }),
  },
  {
    key: 'homeworkDueReminders',
    label: 'Homework due tomorrow: remind the student',
    description: 'Each afternoon, students with homework due the next day that they have not submitted are reminded (their own reminder; parents are not messaged).',
    roles: ['STUDENT'], audiences: ['STUDENT', 'PARENT'], defaultAudience: ['STUDENT'],
    cadence: 'DAILY', defaultHour: 17, defaultEnabled: true, familyFacing: false,
    templateKey: 'HOMEWORK_DUE', channels: 'In-app and WhatsApp (if opted in)',
    preview: () => preview('HOMEWORK_DUE', { title: 'Fractions worksheet', subject: 'Mathematics', when: 'tomorrow' }),
  },
  {
    key: 'feeReminders',
    label: 'Fee due and overdue reminders, with escalation',
    description: 'Daily: families are reminded 3 days before an instalment is due, again when it is 1 day overdue and once more at 15 days overdue; at 15 days the finance office also gets a follow-up task. Once per invoice per stage.',
    roles: ['PARENT', 'FINANCE'], audiences: ['PARENT', 'FINANCE'], defaultAudience: ['PARENT', 'FINANCE'],
    cadence: 'DAILY', defaultHour: 10, defaultEnabled: false, familyFacing: true,
    templateKey: 'FEE_REMINDER', channels: 'In-app and WhatsApp (if opted in)',
    preview: () => preview('FEE_REMINDER', { dueOn: '20 Oct 2026' }),
  },
  {
    key: 'libraryOverdueDaily',
    label: 'Library overdue reminders',
    description: 'Daily: the borrower (and their family) is reminded about each overdue book, once a day per loan, exactly as the librarian\'s "Send reminders" button does.',
    roles: ['STUDENT', 'PARENT', 'LIBRARIAN'], audiences: ['STUDENT', 'PARENT'], defaultAudience: ['STUDENT', 'PARENT'],
    cadence: 'DAILY', defaultHour: 9, defaultEnabled: false, familyFacing: true,
    templateKey: 'LIBRARY_OVERDUE', channels: 'In-app and WhatsApp (if opted in)',
    preview: () => preview('LIBRARY_OVERDUE', { title: 'Wings of Fire', studentName: 'Aarav', dueOn: '2026-10-10', days: 3 }),
  },
  {
    key: 'principalDailyBriefing',
    label: 'Daily briefing to the principal and administrators',
    description: 'Every school morning: decisions waiting, tasks due, deadlines coming up and the headline figures, from the same Today page they open.',
    roles: ['PRINCIPAL', 'ADMIN'], audiences: ['PRINCIPAL', 'ADMIN'], defaultAudience: ['PRINCIPAL'],
    cadence: 'DAILY', schoolDaysOnly: true, defaultHour: 7, defaultEnabled: true, familyFacing: false,
    templateKey: 'DAILY_BRIEFING', channels: 'In-app and email',
    preview: () => preview('DAILY_BRIEFING', { date: '19 Oct 2026', summary: '3 decisions waiting, 5 tasks due, 2 deadlines this week' }),
  },
  {
    key: 'staffCoverSuggestions',
    label: 'Teacher absent: cover suggestions',
    description: 'Each school morning, for every teacher on leave or absent with lessons not yet covered, a draft lists the best free substitute for each period. The cover coordinator confirms each cover; nothing is assigned automatically.',
    roles: ['PRINCIPAL', 'ADMIN'], audiences: ['PRINCIPAL', 'ADMIN'], defaultAudience: ['PRINCIPAL', 'ADMIN'],
    cadence: 'DAILY', schoolDaysOnly: true, defaultHour: 7, defaultEnabled: true, familyFacing: false, feature: 'staffCover',
    templateKey: 'AUTOMATION_DRAFT_READY', channels: 'In-app (draft to confirm)',
    preview: () => preview('AUTOMATION_DRAFT_READY', { title: 'Cover for Ms Rao (4 periods) on 19 Oct' }),
  },
  {
    key: 'lowStockPurchaseDrafts',
    label: 'Low stock: purchase request draft',
    description: 'Weekly: health-room stock at or below its reorder level becomes a purchase-request draft for the person who buys it. Confirming creates a DRAFT purchase request, which still goes through approval.',
    roles: ['NURSE', 'ADMIN'], audiences: ['NURSE', 'ADMIN'], defaultAudience: ['NURSE', 'ADMIN'],
    cadence: 'WEEKLY', defaultWeekday: 1, defaultHour: 9, defaultEnabled: true, familyFacing: false, feature: 'healthRoom',
    templateKey: 'AUTOMATION_DRAFT_READY', channels: 'In-app (draft to confirm)',
    preview: () => preview('AUTOMATION_DRAFT_READY', { title: 'Purchase request: 3 health-room items at reorder level' }),
  },
  {
    key: 'admissionsFollowupReminder',
    label: 'Admissions follow-ups due today',
    description: 'Each morning, every admissions counsellor is told how many of their enquiries are overdue, due today or never contacted.',
    roles: ['MARKETING', 'ADMIN'], audiences: ['MARKETING', 'ADMIN'], defaultAudience: ['MARKETING'],
    cadence: 'DAILY', defaultHour: 9, defaultEnabled: true, familyFacing: false,
    templateKey: 'FOLLOWUPS_DUE', channels: 'In-app',
    preview: () => preview('FOLLOWUPS_DUE', { summary: '4 overdue, 2 due today, 1 never contacted' }),
  },
  {
    key: 'healthVisitFollowups',
    label: 'Health visit follow-up task',
    description: 'A child sent home or referred from the health room: a follow-up task for the nurse the next school day (reference number only; no names or details in the task).',
    roles: ['NURSE'], audiences: ['NURSE'], defaultAudience: ['NURSE'],
    cadence: 'DAILY', defaultHour: 16, defaultEnabled: true, familyFacing: false, feature: 'healthRoom',
    templateKey: null, channels: 'Task in the tasks queue',
    preview: () => 'Task: "Health visit follow-up (HV/2026/0012)", due tomorrow, for the school nurse.',
  },
  {
    key: 'weeklyParentDigest',
    label: 'Weekly digest per child (parents who opt in)',
    description: 'Every week, a parent who has opted in gets one short summary per child: days present, homework due next week, and whether a fee is due.',
    roles: ['PARENT'], audiences: ['PARENT'], defaultAudience: ['PARENT'], optIn: true,
    cadence: 'WEEKLY', defaultWeekday: 5, defaultHour: 17, defaultEnabled: true, familyFacing: true,
    templateKey: 'WEEKLY_CHILD_DIGEST', channels: 'In-app and WhatsApp (if opted in)',
    preview: () => preview('WEEKLY_CHILD_DIGEST', { studentName: 'Aarav', summary: 'present 4 of 5 days, 2 homework due next week, no fee due' }),
  },
  {
    key: 'birthdayGreetings',
    label: 'Birthday greetings (opt-in)',
    description: 'On a student\'s birthday, a greeting in the app, only for students whose family (or who themselves) opted in. Never shown to anyone else.',
    roles: ['STUDENT', 'PARENT'], audiences: ['STUDENT'], defaultAudience: ['STUDENT'], optIn: true,
    cadence: 'DAILY', defaultHour: 8, defaultEnabled: false, familyFacing: true,
    templateKey: 'BIRTHDAY_GREETING', channels: 'In-app only',
    preview: () => preview('BIRTHDAY_GREETING', { name: 'Aarav', school: 'Oakridge Academy' }),
  },
];

/** Already automatic before Part 7: shown on the page, run and switched by their own modules. */
export const BUILT_IN = [
  { key: 'absenteeAlerts', label: 'Absent or late: parents told after the register is saved', where: 'Attendance (event, as soon as the register is taken)', link: '/attendance' },
  { key: 'ptmReminders', label: 'PTM reminders (a day and an hour before) and follow-up tasks from outcomes', where: 'PTM', link: '/ptm' },
  { key: 'taskEscalation', label: 'Task reminders and escalation of overdue work', where: 'Tasks (hourly)', link: '/tasks' },
  { key: 'renewals', label: 'Licence, insurance, agreement, AMC and vehicle-document renewals', where: 'Bills and fleet (daily)', link: '/bills' },
  { key: 'labsDue', label: 'Lab expiries, calibrations and reorder tasks', where: 'Labs (daily)', link: '/labs' },
  { key: 'busDelays', label: 'Bus delay and GPS alerts to the transport office', where: 'Fleet (every 5 minutes)', link: '/fleet' },
  { key: 'quietRelease', label: 'Messages held for quiet hours sent in the morning', where: 'Messages (every 15 minutes)', link: '/messaging' },
  { key: 'lectureReminders', label: 'Online-class reminders 15 minutes before', where: 'Lectures', link: '/lectures' },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key);
export const automationDef = (key) => AUTOMATIONS.find((a) => a.key === key) ?? null;
export const weekdayName = (n) => WEEKDAYS[n] ?? null;
export { WEEKDAYS };
