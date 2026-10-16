import type { GuideTopic } from './types';
import opsRoutes from '../ops-routes.json';

/**
 * Guide topics for the institution-operations pages (lib/ops-routes.json).
 * Every portal that shows these pages in its sidebar appends opsTopics(slug),
 * so the guide always lists exactly the pages that portal's sidebar shows.
 */
type OpsContent = Omit<GuideTopic, 'id' | 'href' | 'icon' | 'title'> & { title?: string };

const CONTENT: Record<string, OpsContent> = {
  today: {
    category: 'Command Centre',
    summary: 'A single page with what needs you now: decisions waiting on you, overdue work, deadlines coming up and the numbers that matter for your role.',
    highlights: [
      { label: 'Needs you', text: 'Approvals, overdue returns, expiring licences and agreements, open safeguarding actions and tasks assigned to you.' },
      { label: 'Honest numbers', text: 'A figure shows "Not available" when the data behind it has not been entered yet, never a misleading zero.' },
    ],
    steps: ['Start the day here.', 'Click any card to open the record or page behind it.'],
  },
  approvals: {
    category: 'Command Centre',
    summary: 'One inbox for every decision: leave, purchases, payroll, events, returns, verification and more. You only see a request when it is your turn.',
    workflow: ['Raised', 'Reviewed', 'Approved / Returned / Rejected'],
    steps: [
      '"Waiting on me" lists requests at your stage. Open one to see the details, history and attachments.',
      'Approve, return it for changes with a note, or reject it with a reason.',
      '"My requests" shows what you raised and where each one is. You can withdraw or resubmit a returned request.',
      'Going away? Use "Delegation" to let a colleague decide in your place for a set period.',
    ],
    tips: [
      'You can never approve something you raised yourself, or where you have declared a conflict of interest.',
      'An overdue or urgent request can be escalated to the next approver with the Escalate button.',
    ],
  },
  campus: {
    category: 'Command Centre',
    summary: 'Your campus as a 3D world, full page: every building, room and department, who is in each classroom from today\'s attendance register, which teacher is teaching what, the module they are on, exams, bookings, repairs and events. Click anything for detail and jump to the page where the work is done.',
    highlights: [
      { label: 'Live classrooms', text: 'A classroom shows present out of enrolled from today\'s register, the lesson and teacher from the timetable and the module from the teacher\'s plan. It says "register not taken" until the register is marked, and changes within half a minute of the teacher marking it.' },
      { label: 'Departments', text: 'Click a department to light up where it works and see its head, people and live figures, with buttons to its pages.' },
    ],
    steps: [
      'The map opens full page. Use Exit full page, or press Esc, to return to the portal; Hide panels leaves just the campus.',
      'Drag with the left mouse button to move around, the right button to rotate, and scroll to zoom. On a phone, drag and pinch.',
      'Click a department chip to find it on the map and read its figures. Click one of its rooms to go there.',
      'Click a building, then Enter building, to see its rooms with students at their desks and the teacher at the board. Click a classroom for the headcount, the week\'s attendance, the lesson, the teacher and the module with its next topic.',
      'Staff can drag the time slider, or press Play the day, to see the timetable at another time of today. The headcount stays today\'s register, and the clock says Preview.',
      'Use the buttons in a panel to book the room, report an issue, open the module plan or go to the related page.',
      'Switch to List for a plain list of spaces and departments. It shows the same information.',
      'A room in session shows Live now under its usual details: the teacher (and who they are covering for), the class and subject, the period with a countdown, whether the register is marked, present out of strength, late arrivals, a practical or club session, and when it last changed. It refreshes every 15 seconds while the panel is open.',
      'See details opens one live page for a room, class, teacher, bus, lab, department, zone or the gate, refreshed every 15 seconds. Each part has Open full page when the school has a page for it, such as attendance, timetable, labs or fleet.',
      'Every panel over the map has a fold button that turns it into a slim chip; click the chip to open it again. Collapse all folds them together. Your choices are remembered on this device.',
      'Parents and students see their own class first: what is happening now, who is teaching, the class strength and how many are present, today\'s timetable and what is next, their own status today and their bus. Teachers see their current and next class with present counts.',
    ],
    tips: [
      'You only see the spaces your role is allowed to see. Restricted areas are hidden or shown without detail, and headcounts, teachers and department figures are shown to staff only.',
      'The figures drawn in a room follow the register\'s count but are illustrative. Nobody is located or tracked.',
      'The named list of who is present, absent or late is shown only to the class teacher, the class\'s subject teachers, a confirmed substitute and school leadership. Families see counts for their own class and never another child\'s name or attendance.',
    ],
  },
  lectures: {
    category: 'Learning',
    summary: 'Online classes and meetings: lectures, doubt sessions, parent meetings and staff meetings. Join from here, and find recordings, notes and material afterwards.',
    steps: [
      'Upcoming lists the classes you host or are invited to. Join opens 15 minutes before the start.',
      'Teachers schedule for the classes they teach; the principal and administration can invite anyone, including whole staff roles. A class can repeat weekly.',
      'Choose a built-in room (no account needed) or paste a Google Meet, Zoom or Teams link.',
      'Everyone invited is told in EduOS, by email and on WhatsApp where they agreed to it, and reminded shortly before the start.',
      'After the class, add the recording link, notes and material. Past & recordings keeps them for the class.',
    ],
    tips: ['The host sees who opened the link from EduOS. How long someone stayed is known only to the meeting service.'],
  },
  syllabus: {
    category: 'Learning',
    summary: 'Each subject laid out as modules with dates and topics. Teachers record what they taught after a lesson; the principal sees every subject and every teacher against the plan.',
    workflow: ['Plan modules', 'Record lessons', 'Module complete'],
    steps: [
      'Open a subject to see its modules on a timeline, with today marked.',
      'Teachers: add a module with a start date, a finish date and its topics, one per line.',
      'After a lesson choose Record a lesson, tick the topics you finished and note any homework. Ticking the last topic completes the module.',
      'The principal starts on By teacher: who is on track, who is behind and who has not recorded a lesson this week. Click a teacher to see their subjects.',
      'Students and parents see the plan for their own class, without the edit buttons.',
    ],
    tips: [
      'The bar is what has been recorded. The thin line on it is where the plan expects the class to be today.',
      'The module being taught also shows on the campus map, in the classroom where the lesson is happening.',
    ],
  },
  correspondence: {
    category: 'Administration',
    summary: 'Letters and circulars from the board, government, university and district office: log them, assign an owner, draft a reply, get it approved, dispatch it and close it with proof.',
    workflow: ['Received', 'Acknowledged', 'Reply drafted', 'With principal', 'Approved', 'Dispatched', 'Closed'],
    steps: [
      'Log an incoming letter with its sender, reference and due date, and attach the scan.',
      'Assign an owner. Tasks found in the letter are suggested for you to confirm.',
      'Draft the reply and send it to the principal for approval.',
      'Record how it was dispatched and attach the acknowledgement, then close it.',
    ],
    tips: ['Use "Remind me" to get a reminder before the reply is due. "Past deadline" lists everything overdue.'],
  },
  compliance: {
    category: 'Administration',
    summary: 'Everything the school must file, hold or do for regulators: obligations, regulatory returns, licences, policies, trainings and official notices.',
    highlights: [
      { label: 'Returns', text: 'Prepare data for returns such as UDISE+ or AISHE from your records, have it reviewed and approved, then record the submission with its acknowledgement.' },
      { label: 'Licences', text: 'Certificates and registrations with expiry dates and renewal reminders.' },
      { label: 'Accreditation', text: 'Prepare for NAAC, NBA or an inspection: list the evidence each criterion needs, give each item an owner, attach the proof and see how much is ready. An item counts as ready only with its evidence attached.' },
      { label: 'Notices', text: 'Circulars from boards, government and the district office, with the actions they require.' },
    ],
    tips: [
      'EduOS does not file anything with a government portal itself. A return is marked submitted only after you record the acknowledgement from the portal.',
      'Requirements in the starting catalogue are marked "Under review" until your school confirms they apply.',
    ],
  },
  verification: {
    category: 'Administration',
    summary: 'Background checks for staff, teachers, drivers and vendors: consent, the checks done, and the principal\'s final decision.',
    workflow: ['Consent', 'Checks', 'Principal decision'],
    steps: [
      'Click "Start background verification" and choose the person and the checks needed.',
      'Record consent, then record the result of each check with its evidence.',
      'When all checks are done, it goes to the principal for the final decision.',
    ],
    tips: ['Clearances expire. Expired and not-cleared people are listed under their own tabs.', 'Details are visible only to people allowed to see them.'],
  },
  events: {
    category: 'Administration',
    summary: 'Events, fests, meetings and visits from proposal to close: budget, approval, preparation tasks, rooms and the final outcome.',
    workflow: ['Proposed', 'Approval', 'Preparing', 'Live', 'Completed'],
    steps: [
      'Click "Propose an event" and add the date, venue, audience and budget.',
      'Once approved, add preparation tasks and owners.',
      'After the event, record the outcome and attendance.',
    ],
  },
  facilities: {
    category: 'Administration',
    summary: 'Rooms and spaces, bookings and maintenance.',
    steps: [
      'Spaces lists every room with its capacity and facilities.',
      'Book a room for a time slot. Clashes with the timetable and other bookings are checked for you.',
      'Report a maintenance issue with a photo. Maintenance tracks it until it is fixed.',
    ],
  },
  contracts: {
    category: 'Administration',
    summary: 'Vendor, service, lease, transport and partnership agreements with their values, documents and renewal dates.',
    steps: ['Add an agreement with its party, value, start and end dates, and attach the signed copy.', 'Agreements due for renewal are flagged before they lapse.'],
  },
  governance: {
    category: 'Governance',
    summary: 'Trustee, school management committee and governing body meetings: agenda, minutes, resolutions and follow-up actions.',
    workflow: ['Scheduled', 'Agenda', 'Held', 'Minutes approved'],
    steps: [
      'Create a meeting with the body, date and agenda.',
      'After the meeting, record minutes and resolutions.',
      'Assign actions with owners and due dates. "Open board actions" tracks them.',
    ],
    tips: ['Meeting updates to members are sent by WhatsApp only when it is set up and the member has agreed. Otherwise they arrive in the app.'],
  },
  payroll: {
    category: 'Finance',
    summary: 'Pay structures, statutory rules, monthly payroll runs, the bank file, payment confirmation and statutory exports (PF, ESI, professional tax and TDS).',
    workflow: ['Inputs', 'Calculated', 'Approved', 'Bank file', 'Paid', 'Closed'],
    steps: [
      'Set each person\'s monthly pay structure under "Pay structures".',
      'Start a run for the month, enter attendance and adjustments, and calculate.',
      'Send it for approval. After approval, download the bank file.',
      'A different person confirms payment from the bank statement before the run is closed.',
    ],
    tips: [
      'Statutory rules (such as the PF wage ceiling) are versioned by date, so past months are always calculated with the rules that applied then.',
      'Bank account and salary details are visible only to people with permission to see them.',
    ],
  },
  procurement: {
    category: 'Finance',
    summary: 'Purchase requests, quotes, purchase orders, goods receipts, vendor invoices, payments and assets.',
    workflow: ['Draft', 'Approval', 'PO', 'Received', 'Invoiced', 'Pay approved', 'Paid'],
    steps: [
      'Raise a purchase request with items, estimated cost and the budget it uses.',
      'Add quotes. Above the school\'s limit, more than one quote is required.',
      'After approval, issue the order, record what was received and enter the vendor invoice.',
      'Payment is approved only when the order, receipt and invoice match.',
    ],
    tips: ['Duplicate invoices and purchases split to stay under an approval limit are flagged.'],
  },
  budgets: {
    category: 'Finance',
    summary: 'Budgets by department with what has been committed and spent, plus funding proposals and loan comparison.',
    steps: ['Create a budget for the year and its lines.', 'Commitments and actual spending update from procurement as orders and payments happen.', 'Use funding proposals to compare grants and loans, including monthly instalments.'],
  },
  payslips: {
    category: 'My Work',
    summary: 'Your payslips for each approved payroll month.',
    steps: ['Open a month to see earnings, deductions and net pay.'],
  },
  organization: {
    category: 'People',
    summary: 'Departments, positions and the people in them, built from appointments. It updates as people join, move and leave.',
    steps: ['Browse the chart by department.', 'Staff not yet placed in the structure are listed so they can be appointed to a position.'],
  },
  institution: {
    category: 'People',
    summary: 'Your institution\'s profile: legal entity, campuses, affiliations and recognition, the terms used (school or college), intake capacity and public disclosures.',
    tips: ['A completeness check shows what is still missing from the profile.'],
  },
  marketing: {
    category: 'Growth',
    summary: 'The admissions funnel, campaigns, posters and banners, seats and offers, and counselling appointments.',
    steps: [
      'Enrolment funnel shows enquiries through to admissions, by source.',
      'Campaigns tracks each campaign\'s spend and the enquiries it brought in.',
      'Creative holds posters, banners and social posts. They go for approval before use.',
      'Seats & offers shows capacity, offers and the waitlist. Counselling lists tours and interviews.',
    ],
  },
  newsroom: {
    category: 'Community',
    summary: 'Your school\'s own social space: stories, events, achievements, circles and mentoring.',
    steps: [
      'Read and react to posts. Save the ones you want to keep.',
      'Write a post if your role allows it. Unless you are a moderator, a moderator reviews it before it appears.',
      'Join circles for clubs, classes or alumni batches.',
      'Staff who publish to social media see "Also post to social media" in the composer: tick Facebook, Instagram, X, LinkedIn or YouTube for a story whose audience is Public (anyone). Each story then shows how each network went, and "Share to social" shares a published story later.',
    ],
    tips: [
      'Photos of students appear only when the school has the right consent for them. Manage your family\'s consent under the Consent tab.',
      'A network without a connected account is "Simulated": nothing is posted, and the story says so. If the option is missing, an administrator can switch social publishing on under Tenant Settings.',
    ],
  },
  mentoring: {
    category: 'Community',
    summary: 'Seniors and alumni who offer to help with studies, careers and college choices.',
    steps: ['Browse mentors and ask for mentoring, or offer to mentor.', 'Mentoring for students always takes place under staff supervision.'],
  },
  safeguarding: {
    category: 'Safety',
    summary: 'Raise a concern about a child\'s safety or well-being. Child-protection reporting never waits for internal approval.',
    steps: [
      'Describe what you saw or were told, when and where. Write the facts in the words used.',
      'Submit. The designated safeguarding officer is told straight away.',
    ],
    tips: [
      'If a child is in immediate danger, call 112 or Childline 1098 first.',
      'Reports are confidential. Only the safeguarding team can see them.',
    ],
  },
  policies: {
    title: 'Policies & trainings',
    category: 'My Work',
    summary: 'Policies to read and acknowledge, your upcoming trainings (such as POCSO awareness), and how the school may contact you.',
    steps: ['Open each policy, read it and click Acknowledge.', 'Check upcoming trainings and their dates.', 'Choose whether you agree to WhatsApp, SMS or email messages.'],
  },
  messaging: {
    category: 'Communication',
    summary: 'Every WhatsApp, SMS and email notification the school tried to send, with its real delivery status.',
    highlights: [
      { label: 'Honest status', text: '"Simulated" means no messaging provider is connected yet, so nothing left the system. "No consent" means the person has not agreed to that channel. Quiet hours hold messages until morning.' },
    ],
  },
  analytics: {
    category: 'Command Centre',
    summary: 'The school figures for any period, compared with an earlier one: students and admissions, academics, finance, procurement, people, facilities, engagement and services. You only see the departments your role runs.',
    highlights: [
      { label: 'Defined numbers', text: 'Tap "i" on a card for exactly what it counts, from which records and on which date. Cash is counted on the payment date, billing on the invoice date.' },
      { label: 'Honest comparisons', text: '"Not available" means the records do not cover that period; "not comparable" means the comparison is missing or zero. Neither is shown as 0.' },
    ],
    steps: [
      'Choose a period (this month, quarter, academic or financial year, or your own dates) and what to compare it with.',
      'Start on Overview, then open a department tab for every figure, its trend and its breakdown. "Show table" gives the numbers of a chart as a table.',
      'Open the records behind a figure with its link. Export CSV or Print for the same figures you see.',
    ],
  },
  reports: {
    title: 'Quarterly reports',
    category: 'Command Centre',
    summary: 'A report for each quarter, generated automatically after it ends: figures with the prior quarter and the same quarter last year, budget variance, renewals coming up, achievements and decisions waiting.',
    steps: ['Open a version to read it, or download it as PDF or CSV.', 'If figures were corrected, generate a new version with a reason. Earlier versions are kept unchanged.'],
    tips: ['Department heads see their own section; the principal and administrator see the whole report.'],
  },
  tasks: {
    title: 'My tasks',
    category: 'My Work',
    summary: 'Everything that is due — bills, licence renewals, services, inspections, follow-ups — with its owner, due date, reminders and the evidence that closed it.',
    workflow: ['Due', 'Acknowledged', 'Completed (with evidence)'],
    steps: [
      'Mine lists what you own or are the delegate for. Exceptions lists what is overdue or critical.',
      'Acknowledge a task to show you have it, snooze it with a reason, or complete it with a note and evidence.',
      'Add a task for anything with a due date; a repeating task creates the next one when you complete it.',
    ],
    tips: ['Overdue tasks are escalated to the department lead after a day and to the principal after a week.'],
  },
  // PTM, review calls, conversations, staff leave and cover, term report cards.
  ptm: {
    category: 'Parents & PTM',
    summary: 'Parent–teacher meetings. The principal opens a round; teachers give their available times; families book a slot for each child with each teacher; teachers meet with a short child briefing and record what was agreed.',
    workflow: ['Round opened', 'Teachers add times', 'Families book', 'Meeting held', 'Outcome and actions'],
    steps: [
      'Principal or administration: New round, with the dates, classes, mode (in person, online or both), slot length, buffer and how late families may change.',
      'Teachers: Add availability for a day and time window. Slots of the round\'s length are made inside it; block any you cannot keep.',
      'Families: each child is listed with their teachers. Pick a time for each. A time that overlaps one you already booked is refused, so book back-to-back instead.',
      'All slots gone? Join the waiting list. If someone cancels, the slot is held for you and you are told; accept it in time.',
      'On the day the teacher checks the family in (or marks a no-show), opens the child briefing and records a summary, agreed actions and the next follow-up. Staff actions become tasks with reminders.',
    ],
    tips: [
      'Families are reminded the day before and an hour before. Online meetings use a private room, joined from Digital Lectures. Meetings are never recorded.',
      'Fees appear in the briefing only for people allowed to see the child\'s fees. Safeguarding concerns are never written in PTM notes: use Report a safeguarding concern.',
      'Families can say which language they prefer, ask for an interpreter or note access needs when booking.',
    ],
  },
  'review-calls': {
    category: 'Parents & PTM',
    summary: 'Follow-up calls with a family about attendance, progress, behaviour support, well-being or (for those allowed) fees: each attempt, private notes, agreed actions and the next follow-up, until the case is closed.',
    workflow: ['Opened', 'Scheduled', 'Reached', 'Actions agreed', 'Closed'],
    steps: [
      'Open a review call for a pupil you teach, with a reason and a follow-up date.',
      'Log every attempt: the channel and whether the family was reached. After three failed tries the page suggests another channel.',
      'Keep private notes. Only you, the class teacher and the principal see them.',
      'Agree actions with an owner and a due date: staff actions become tasks and escalate when overdue.',
      'Close the case with an outcome and a note; reopen it if needed.',
    ],
    tips: ['Calls are never recorded.', 'The child briefing shows attendance, marks, syllabus progress, homework and activities.'],
  },
  conversations: {
    title: 'Parent messages',
    category: 'Parents & PTM',
    summary: 'Messages about a child between a family and the child\'s teachers or the principal, with attachments and read receipts.',
    steps: [
      'New message: choose the child and the teacher (families) or the pupil and the parent (teachers), then write.',
      'A tick shows when the other person has read your message.',
      'Teachers: messages from families waiting more than 48 hours are on the Unanswered tab. Set your office hours so families know when you reply.',
      'A teacher or the principal can close a conversation when it is resolved.',
    ],
    tips: [
      'Phone numbers are removed from messages and never shown: the school\'s platform is the channel. For an emergency, call the school office.',
      'The principal can read any conversation for oversight; each such read is logged.',
    ],
  },
  'staff-leave': {
    category: 'Organisation',
    summary: 'Apply for leave and see your balance for the leave year (April to March). HR and the principal approve, set leave policies and export loss-of-pay days for payroll.',
    workflow: ['Applied', 'Approved / Rejected', 'Cancelled (balance restored)'],
    steps: [
      'Apply for leave: choose the type, the dates (or a half day where allowed) and a reason. Sundays and school holidays are not counted.',
      'Your balance changes only when the leave is approved. Cancelling an approved leave restores the days.',
      'HR and principal: approve or reject on All staff; set entitlement and carry-forward on Policies & LOP; set up the year\'s balances once at the start of the year.',
      'Loss-of-pay days (leave without pay and absences marked as loss of pay) are listed per person for payroll.',
    ],
    tips: ['You cannot approve your own leave.', 'Lessons you are covering for absent colleagues are listed on My leave.'],
  },
  cover: {
    category: 'Organisation',
    summary: 'Substitute cover for absent teachers: who is away today, which lessons that affects, who is free to take them, and the confirmed cover plan.',
    workflow: ['Absence (leave or marked)', 'Lessons affected', 'Substitute confirmed', 'Everyone told'],
    steps: [
      'Teachers on approved leave appear automatically. Use Mark someone absent for an unplanned absence.',
      'For each affected lesson choose Find a substitute: teachers free in that period and within the cover limits are listed, same subject first.',
      'Confirm one. The absent teacher, the substitute and the class are told once, and the substitute can mark that period\'s register.',
      'Cancel cover if plans change; the period shows as uncovered again.',
    ],
    tips: ['A period can be covered once, and nobody covers two classes at the same time.', 'Going over the daily or weekly cover limit needs a reason.'],
  },
  'report-cards': {
    category: 'Learning',
    summary: 'Term report cards with scholastic marks (periodic test, notebook, subject enrichment, half-yearly or annual exam), co-scholastic grades, discipline, attendance, remarks and the result, published to families as a PDF.',
    workflow: ['Prepared from published marks', 'Class teacher approves', 'Principal approves', 'Published'],
    steps: [
      'Class teachers: choose the class and term, then Prepare from published marks. Marks not yet published show as pending.',
      'Subject teachers enter the hand-marked components (notebook, subject enrichment) for their subjects.',
      'The class teacher adds co-scholastic grades (A/B/C), discipline and remarks, and approves.',
      'The principal approves and publishes. Families and students see the card and can download the PDF.',
      'A correction after publishing sends the card back through approval and publishes a new version; the earlier version is kept.',
    ],
    tips: ['The structure is a template: the default follows a CBSE-style term card, and a school can use its own components and weightings.'],
  },
  // ── Transport and safety ────────────────────────────────────────────────
  fleet: {
    category: 'Transport & Safety',
    summary: 'Vehicles with their lawful seating and papers, today\'s trips with seats, boarding and safe handover, a live board of where each vehicle last reported, and transport alerts.',
    workflow: ['Planned', 'Seats allocated', 'On the way', 'Reconciled', 'Completed'],
    steps: [
      'Vehicles: add each bus with its lawful seating, usable seats and the expiry of its permit, insurance, fitness and pollution certificates. Every date becomes a reminder in Tasks.',
      'Trips: "Plan the day\'s trips" creates a morning pickup and afternoon drop for each route with a registered vehicle and seats the enrolled students, never more than the usable seats.',
      'Open a trip to record boarding (or let the bus card reader do it), mark no-shows, and at a drop hand each child only to an adult the screen lists as authorised. If nobody authorised is there, keep the child with the school.',
      'Reconcile at the end: anyone allocated but not accounted for is named and alerted. A trip with an unmatched student needs a note to close.',
      'If a bus breaks down, record the breakdown and use "Substitute vehicle"; the new vehicle must seat everyone already allocated.',
    ],
    tips: [
      'A vehicle with expired papers, in service or broken down cannot run a trip.',
      'Arrival times are estimates from distance and speed; a stale or offline GPS is labelled as such. Manual boarding always works.',
      'Drivers and attendants without a current background clearance are blocked or flagged, as the school has chosen.',
    ],
  },
  'bus-duty': {
    category: 'Transport & Safety',
    summary: 'The trips where you are the attendant: the students with a seat, boarding, handover at each stop and the end-of-trip check.',
    steps: [
      'Open today\'s trip and start it when the bus leaves.',
      'Tap Boarded as each child gets on (a card reader may do this for you), or No-show if they were not at the stop.',
      'At a drop, choose Hand over and pick the adult from the list after checking their ID. A restricted adult is shown as "Do not release".',
      'If nobody authorised is at the stop, choose "keep with school". The family and the transport office are told.',
      'Reconcile and complete the trip when every child is accounted for.',
    ],
    tips: ['You only see trips you are assigned to.'],
  },
  'bus-today': {
    category: 'Transport & Safety',
    summary: 'Today\'s bus for your child: whether the trip has started, their stop, whether they boarded, an estimated arrival and who received them.',
    steps: ['Open the page during the trip and press Refresh for the latest status.', 'The arrival time is an estimate; the school messages you about real delays or changes.'],
    tips: ['You see only your own child\'s trip, never other children or the driver\'s other trips.'],
  },
  gate: {
    category: 'Transport & Safety',
    summary: 'The front gate: visitors and contractors with host approval and badges, child pickup and release, ID card checkpoints and the emergency roster.',
    workflow: ['Pre-registered', 'Host approved', 'Checked in', 'Checked out'],
    steps: [
      'Visitors: pre-register a visit; the host approves it in EduOS. At arrival check their photo ID, record its type and last four characters, and issue a badge with an expiry.',
      'Pickup & release: find the student to see every guardian, authorised adult, delegate and custody restriction, then record the release to the adult who is here.',
      'Checkpoints: see today\'s gate, bus, lab and library scans; refused cards and flagged departures stand out. Staff can record a scan by hand.',
      'ID cards: issue a card, mark it lost or revoked (scans are then refused and alerted), or replace it; the old card\'s history stays linked.',
      'Emergency roster: who is on the register today and not released, plus visitors on site. Download the CSV to print a copy.',
    ],
    tips: [
      'A checkpoint scan shows that a card was presented at a place and time. It is not proof of where anyone is now.',
      'A child leaving through the gate with no recorded release or out-pass is flagged.',
      'Gate scans can suggest attendance to class teachers but never change the register.',
    ],
  },
  pickup: {
    category: 'Transport & Safety',
    summary: 'Who may collect your child. Add someone for a limited time, confirmed with a code sent to your phone, and see today\'s gate and bus checkpoints.',
    steps: [
      'Choose "Let someone collect", enter their name, relationship and until when, and confirm with the code sent to your phone.',
      'Withdraw a delegate at any time. Recent handovers show who received your child, where and when.',
    ],
    tips: ['The person must show photo ID. If nobody authorised comes, your child stays safely with the school and you are called.'],
  },
  outpass: {
    category: 'Transport & Safety',
    summary: 'Hostel out-passes: requests from residents and guardians, your approval, the exit and return at the gate, and late returns.',
    workflow: ['Guardian confirms', 'Warden approves', 'Out', 'Returned'],
    steps: [
      'A student\'s own request first waits for their guardian to confirm in the app; a guardian\'s request comes straight to you.',
      'Approve or decline (with a reason). Record the exit and the return, or let a gate card scan record them.',
      'A resident not back by the expected time plus the grace period raises one alert to the wardens and the guardians.',
    ],
  },
  'my-outpass': {
    category: 'Transport & Safety',
    summary: 'Ask for a hostel out-pass, confirm your child\'s request, and follow it until the return.',
    steps: [
      'Choose "Request out-pass", give the dates, reason, destination and escort.',
      'Guardians: when your child asks, open the request and choose "I confirm" or "I do not agree".',
      'You are told when the warden decides, when your child leaves and returns, and if the return is late.',
    ],
  },
  camera: {
    category: 'Transport & Safety',
    summary: 'Optional pilot, switched off by default. Approved cameras report observations (a possibly unattended room, a possible aggression, a camera offline), which stay unverified until a trained reviewer decides.',
    workflow: ['Unverified', 'Reviewed', 'Referred to safeguarding if needed'],
    steps: [
      'Open an observation: an unattended-room observation is shown next to the timetable, the teacher\'s check-in, cover and leave.',
      'Record your decision with notes. Changing an earlier decision needs a reason; both are kept.',
      'A confirmed or follow-up aggression observation can be referred to the safeguarding officer as a new case.',
      'Pilot measures show the false-alert rate and the time to review, for the school\'s evaluation.',
    ],
    tips: [
      'No face identification, emotion inference, behaviour scores or live streams to parents. Cameras are never allowed in toilets, washrooms or changing rooms.',
      'Observations never appear in feeds, the campus map, ordinary analytics or parent views.',
    ],
  },
  'class-check-in': {
    category: 'Transport & Safety',
    summary: 'Mark yourself in class at the start of each period you teach or cover. It is the school\'s record that the class was attended.',
    steps: ['Choose the period and Check in. If you are covering for a colleague, give their staff id.'],
    tips: ['A check-in is never used to judge teaching.'],
  },
  labs: {
    category: 'Learning',
    summary: 'Science and computer labs in one place: chemicals and consumables in batches with expiry badges, every receipt, issue, return, use, breakage, disposal and stocktake in a ledger, instruments and their calibration, computers and software seats, practical sessions with a readiness check, and incidents.',
    workflow: ['Plan practical', 'Prepare', 'Readiness check', 'Safety checks', 'Supervised session', 'Complete'],
    highlights: [
      { label: 'Scan or type', text: 'Every batch, instrument and computer has a code (LB-, LE-, LD-). Scan the label into the box, or type the code, tag, serial or lot number when it will not scan.' },
      { label: 'Never below zero', text: 'Two people issuing from the same bottle at once cannot take it below zero, and an expired or quarantined batch cannot be issued at all.' },
      { label: 'First expiry first', text: 'When you issue, the batch that expires first is suggested, with how much is short.' },
      { label: 'Safe handling', text: 'Hazardous items are issued to the supervising teacher, never to a student. Disposal is done by staff with evidence attached.' },
    ],
    steps: [
      'Labs: set up a lab on a LAB room, with its in-charge, assistant and safety checklist.',
      'Stock: Receive new stock with its expiry date; open an item to issue, record use or damage, dispose, quarantine or release a batch. Reorder drafts a purchase request in Procurement.',
      'Stocktake: enter what is on the shelf; differences are recorded as adjustments with your reason. The ledger is never edited.',
      'Instruments: record a calibration with its certificate, log a repair (it goes out of service) and close it when fixed.',
      'Computers & software: register devices by tag, log repairs, decommission with the e-waste recycler\'s handover note, and assign software seats.',
      'Practicals: plan one with its materials and instruments, send it to the lab assistant, check readiness, tick the safety checks to start, mark attendance and complete it.',
      'Incidents: report a spill, breakage or injury; raise a work order for the room if needed. A child-welfare concern goes to Safeguarding.',
    ],
    tips: [
      'Units convert within mass (mg, g, kg) or volume (mL, L) only; the system never assumes a density.',
      'Expiries, calibrations, warranty and AMC ends, software renewals and low stock become tasks in My Tasks for the lab in-charge.',
      'Licence keys and passwords are never stored here; keep them in the school\'s password manager.',
    ],
  },
  bills: {
    category: 'Finance',
    summary: 'Recurring bills and service contracts — electricity, water, internet, AMCs, software, rent, security, housekeeping, waste, insurance — with payments confirmed against the bank, service visits, one renewals list, a review queue and the cost dashboard.',
    workflow: ['Bill recorded', 'Payment recorded', 'Confirmed by a second person', 'Paid'],
    highlights: [
      { label: 'Recorded is not paid', text: 'A payment counts as settling a bill only when someone other than the person who recorded it confirms it against the bank statement.' },
      { label: 'Renewals', text: 'Licences, agreements (with their notice deadline), warranties, AMCs, lab calibrations and software licences, sorted by when a decision is needed, with cost, owner and what happens if nothing is done.' },
      { label: 'Review queue', text: 'Bills well above their usual amount, possible duplicates, consumption jumps, overdue bills, payments without evidence and supplier invoices that did not match. Each flag states its rule and numbers; it is a prompt to check, not a finding.' },
    ],
    steps: [
      'Services & contracts: add each recurring service with its provider, account number, cycle, usual amount, owner and contract dates.',
      'Bills: record a bill when it arrives (attach it); record a payment with its receipt; a colleague confirms it with the bank reference.',
      'Snooze a bill reminder with a reason, or dispute a wrong bill. A revised bill keeps the old amount in its history.',
      'Services: close an AMC visit with the service report; the next visit is scheduled automatically.',
      'Cost dashboard: compare any period with last year or the previous period, by category and month.',
    ],
    tips: ['Every unpaid bill, expected bill, service visit and renewal is a task in My Tasks, and escalates when overdue.'],
  },
  concessions: {
    category: 'Finance',
    summary: 'Fee concession schemes (sibling, staff ward, merit, RTE, need-based) and concessions, credit notes and voids on issued invoices — each one approved before it changes anything.',
    workflow: ['Requested', 'Approved by the principal', 'Applied to the invoice'],
    steps: [
      'Add the schemes the school offers: a percentage, a fixed amount, or decided per case for need-based support.',
      'New request: find the invoice, choose a concession (or, with fee rights, a credit note or void), give the reason and attach any proof.',
      'The request goes to the approvals inbox. Once approved the invoice total goes down; the issued amount stays on record.',
    ],
    tips: [
      'An invoice cannot be reduced below what has already been paid — that is a refund, with its own approval.',
      'A void keeps the invoice as cancelled with the reason; nothing is deleted.',
    ],
  },
  'accounts-export': {
    category: 'Finance',
    summary: 'Everything the accountant needs for a date range: vouchers as a Tally import file (XML) or CSV, and a GST summary of fee lines the school has marked taxable.',
    steps: [
      'Choose the dates and Show to see the voucher counts and totals.',
      'Download Tally XML and import it in Tally (Gateway → Import → Vouchers). Create or map the ledger names first.',
      'Set the HSN/SAC code and GST rate on any taxable fee head (transport, uniforms, events). New invoices carry it; issued ones keep what they were issued with.',
    ],
    tips: [
      'Tuition is commonly exempt, but the school\'s accountant decides rates and exemptions; the system does not.',
      'Every voucher is checked to balance before the file is produced.',
    ],
  },
  // Alumni, newsroom social publishing, the daily digest and student profile links.
  alumni: {
    category: 'Community',
    summary: 'Former students and former staff in one community: alumni circles for the whole school and for each batch, a directory, passing-out years and the years staff served, and reunions.',
    highlights: [
      { label: 'Community only', text: 'An alumnus keeps the newsroom, alumni circles, directory, reunions and mentoring. They do not see student records, marks or fees — only their own archived enrolment history.' },
      { label: 'Consent per field', text: 'The directory shows a name and batch. Profession, city and links appear only for the fields that person switched on.' },
      { label: 'Batches and served years', text: 'Former students are grouped by passing-out year, section and house; former teachers appear under every year they served.' },
    ],
    steps: [
      'Community: write to your batch circle or the school-wide circle. Posts wait for the school to review them.',
      'Directory: search by name or batch year. My batch shows the people from your year.',
      'Reunions: reply Going, Maybe or Not going to events for your batch or for all alumni.',
      'My profile: add your profession, city and links, then choose which of them others may see, or take yourself off the directory.',
    ],
    tips: ['Your record shows your years and classes. Ask the school office for transcripts or a leaving certificate.'],
  },
  'alumni-manage': {
    title: 'Alumni',
    category: 'Community',
    summary: 'Move a graduating student or a member of staff who leaves to alumni, review alumni posts, plan reunions and correct batches.',
    workflow: ['Graduates or leaves', 'Moved to alumni', 'Student or staff sign-in closed', 'Alumni community'],
    steps: [
      'Manage alumni → Move to alumni: choose a student (graduated, left or transferred) or a member of staff (left, resigned or retired), with the passing-out year or the years served.',
      'Their old sign-in is closed and an alumni profile opens on the same account, joined to the school-wide circle and their batch (or the former-staff circle).',
      'Posts to review: publish or reject alumni posts; a rejection needs a reason the author sees.',
      'Reunions: create an event for one batch or for all alumni; invitees are told in the app.',
    ],
    tips: ['You see each person\'s consent choices, not the details they kept private.', 'Suspending an alumnus closes their alumni sign-in until you restore it.'],
  },
  social: {
    category: 'Community',
    summary: 'Share a public newsroom story, or a post with no identifiable child, to the school\'s Facebook, Instagram, X, LinkedIn and YouTube community accounts. Each network has its own line in the outbox.',
    workflow: ['Compose', 'Consent checked', 'Publish', 'Consent checked again', 'Per-network status'],
    highlights: [
      { label: 'Simulated — not posted', text: 'The network is not connected through its official API (Accounts tab), so the send is recorded as simulated. Nothing leaves the school.' },
      { label: 'Consent at publishing', text: 'Every child tagged in a story needs public-media consent. It is checked when you compose and again at the moment you publish; if any is missing, nothing is sent.' },
      { label: 'Never twice', text: 'A network that was sent or simulated is never sent again. Only a failed network can be retried.' },
      { label: 'Staff only', text: 'Parents, students and alumni can never publish to the school\'s accounts.' },
    ],
    steps: [
      'Compose: pick a published public story or write the text, choose the networks, and confirm no child can be identified if you are not sharing a story.',
      'Save to outbox, then Publish. Each network shows Queued, Sending, Sent, Failed or Simulated — not posted.',
      'Accounts: an administrator presses Connect for Meta, LinkedIn or X and signs in on that network\'s own page, then chooses the Facebook Page or LinkedIn organisation to post as. Disconnect revokes the access. YouTube community posts have no API and are marked "Not supported".',
    ],
    tips: ['Tokens and passwords are never typed into this screen.'],
  },
  digest: {
    category: 'Learning',
    summary: 'A short daily digest of headlines from news and learning feeds your school approved, matched to the interests you pick: science, technology, sports, careers, education policy and more.',
    steps: [
      'Interests: tick the topics you want. Your digest changes straight away.',
      'My digest: today\'s headlines with a short summary; the link opens the original site.',
      'Tick "Also email me" if you want a copy by email.',
      'Sources (administrators): approve a feed by its https address and tag it with interests; pause or read it now.',
    ],
    tips: [
      'Feeds are read once a day. Addresses inside the school\'s or any private network are refused, and very large feeds are skipped.',
      'Headlines are shown as plain text; nothing from a feed runs in your browser.',
    ],
  },
  'profile-links': {
    category: 'Community',
    summary: 'A student can add LinkedIn, Instagram, GitHub and a personal site to their profile. Other students and parents see them only if the student agrees and, for anyone under 18, a guardian agrees too.',
    steps: [
      'Student: add your links (full https addresses) and Save, then tick "Show my links" if you want others to see them.',
      'Guardian: open your child\'s card and tick "I agree" to let other students and parents see the links your child shared.',
    ],
    tips: ['Changing a link asks the guardian to agree again.', 'Teachers and school staff can always see a student\'s links; other families cannot unless both agree.'],
  },
  clubs: {
    category: 'Community',
    summary: 'Clubs and teams for sports (cricket, football, basketball, athletics, chess, yoga) and the arts (dance, singing, drama, visual arts). Families ask to join; a parent consents for a child under 18; the teacher in charge approves. Sessions, registers, fixtures, house points and kit are kept here, and each student has a participation portfolio.',
    workflow: ['Asked to join', 'Parent consent (under 18)', 'Teacher approves', 'Member or waiting list'],
    highlights: [
      { label: 'Fair places', text: 'A club has a set number of places. When it is full, approved students join a waiting list in the order they were approved, and the first in line gets the next free place automatically.' },
      { label: 'Consent first', text: 'A request from a student under 18 waits for a parent. A parent who asks for their child gives consent by asking. A student with no date of birth on record is treated as under 18.' },
      { label: 'Approved results only', text: 'House points and the portfolio count a result only after a second teacher has approved it; the teacher who recorded it cannot approve it.' },
    ],
    steps: [
      'Families: open Browse, choose a club and Ask to join (parents pick the child). Follow it under My requests; parents give or refuse consent there.',
      'Teachers in charge: decide requests under Requests, schedule sessions at a school venue (booked through Facilities) and take the register after each session.',
      'Fixtures & houses: schedule an inter-house or external fixture, set the team sheet, record the result; another teacher approves it before it counts.',
      "Kit: record the club's equipment, lend it to a member with a return date (a reminder lands on your task list) and mark it back or lost.",
      'Portfolio: every club, session attended, fixture and award a student has, for their records and applications.',
    ],
    tips: [
      'A session without a register becomes a task for the coach after it ends.',
      "Families never see other members' names or unapproved results.",
    ],
  },
  showcase: {
    category: 'Community',
    summary: "The school's showcase of previous class and term top rankers and achievements in sports, arts and olympiads, published by the school.",
    workflow: ['Drafted', 'Reviewed by a second person', 'Published', 'Withdrawn if needed'],
    highlights: [
      { label: 'From published results', text: 'Ranks are drawn only from exam results that are published. Equal marks share a rank and the next rank is skipped (1, 1, 3).' },
      { label: 'Top ranks only', text: 'The school sets a cut-off (for example the top 3). Nothing below it is ever shown, and never a full class list.' },
      { label: 'Consent', text: "A child appears only with their family's media consent. It is checked again when publishing (an entry without it is left out, with the reason) and every time the page is read." },
    ],
    steps: [
      'Everyone: open Showcase to see what the school has published; filter by academic, sports, arts or olympiad.',
      'Administration, the principal and marketing: under Prepare and publish, create a showcase, draw the top ranks for a class or grade, and add achievements from approved records and results.',
      'Someone other than the person who drafted an entry reviews it; then publish. Entries can be withdrawn at any time.',
    ],
    tips: ['Students and parents can read the showcase but can never publish to it.'],
  },
  // Sustainability, eco points, library labels and scan desk, AI drafts, online admission applications.
  sustainability: {
    category: 'Administration',
    summary: 'Greenery, waste, water, energy and sanitation in one register: trees with survival checks, waste by stream with vendor receipts, compost, monthly meter figures, sanitation duties that run as tasks, eco points for verified activities, and evidence packs to support SHVR, CSE Green Schools and Mission LiFE submissions.',
    workflow: ['Log', 'Attach evidence', 'Someone else verifies', 'Points count', 'Compile a pack'],
    highlights: [
      { label: 'Photo for every check', text: 'A survival check or sanitation check is recorded only with a photo (or the service slip).' },
      { label: 'Receipts', text: 'E-waste, sanitary and hazardous lab waste handed to a vendor needs the vendor\'s name and their receipt.' },
      { label: 'Never self-verified', text: 'Eco points exist only once someone other than the person who logged the activity has verified it.' },
      { label: 'Evidence, not filing', text: 'Evidence packs are evidence to support your submission. EduOS never files or submits anything to a programme.' },
    ],
    steps: [
      'Zones & teams (administration): add gardens, grounds, toilet blocks and tanks, and the classes, houses and eco clubs that earn points.',
      'Trees: record a planting with species, zone, date and who planted it; record survival checks with a photo. Survival is alive against planted.',
      'Waste: record each stream\'s weight, whether it was separated at source, where it went and the vendor\'s receipt. Water & energy: record each meter once a month.',
      'Sanitation: add toilet cleaning per block, pad dispensers, incinerators and tank cleaning. Each due date is a task in Tasks; record the check with a photo, or complete the task there.',
      'Activities & points: a teacher logs what their class or club did with photos; the principal, compliance officer or another teacher verifies it and the points count.',
      'Evidence packs (administration): choose a programme, compile for the academic year and download the CSV. Section headings are generic where the programme\'s exact form is not known; the pack says so.',
    ],
    tips: ['Per-student figures divide by the pupils on roll now.', 'Teachers see and log only for their own class and the clubs they lead.'],
  },
  'eco-points': {
    category: 'Community',
    summary: 'The school\'s eco points and each class, house and club\'s total, counting only activities a staff member has verified. Your class is marked.',
    steps: ['Open Eco points to see the totals and the latest verified activities.', 'Ask your class teacher how your class can join the next activity.'],
    tips: ['Only team totals are shown, never individual pupils.'],
  },
  'library-labels': {
    category: 'Learning',
    summary: 'Accession numbers for every physical copy (one running series for the school), printable Code 128 barcode labels, and a scan desk that issues and returns books with a keyboard-wedge barcode scanner.',
    workflow: ['Number copies', 'Print labels', 'Scan book', 'Scan student', 'Issued'],
    steps: [
      'Accession numbers & labels: choose a book and Number copies. Leave the count empty to number the copies the catalogue already has; enter a count to add new copies.',
      'Open the label sheet, Print it at 100% scale, then Mark as printed so the next batch shows only new labels.',
      'Scan desk → Issue: click the box, scan the book, then scan or type the student\'s admission number and press Enter.',
      'Scan desk → Return: scan the book. Any late fine is worked out as at the desk.',
    ],
    tips: ['A scanner is just a keyboard: it types the code and presses Enter.', 'A copy that is out cannot be issued again until it is returned.'],
  },
  'ai-drafts': {
    category: 'Command Centre',
    summary: 'Ask for a draft letter, circular, minutes from your notes, a lesson-plan outline or a report-card remark. Copy it, edit it and save it where it is used. Nothing is sent, published or saved from here.',
    highlights: [
      { label: 'Template without a key', text: 'When the school has no AI key configured, drafts come from templates and are labelled "Template draft (no AI key configured)".' },
      { label: 'Restricted details stay out', text: 'Sentences about health, safeguarding and similar matters, and phone numbers, emails and ID numbers, are removed before anything reaches a model.' },
      { label: 'Remarks', text: 'A report-card remark uses only marks bands and the attendance percentage. The pupil\'s name is never sent; it is put into the text shown to you.' },
    ],
    steps: ['Choose the kind of draft and fill in what you know.', 'Draft, then edit the text in the box and Copy it.', 'Paste it into the screen where it belongs (a circular, the minutes, the report card) and save it there.'],
    tips: ['The AI only drafts. A person reviews, edits and decides.'],
  },
  'online-applications': {
    category: 'Growth',
    summary: 'Applications made on the school\'s public online admission form, with the documents the family uploaded. Each one is already a NEW lead in the admissions CRM, where it is worked.',
    steps: [
      'Share the public form link (shown at the top) on the school website. Families need no account and pay nothing there.',
      'Open the CRM to contact the family and move the lead through its stages; the family sees a plain status when they check with their reference number.',
    ],
    tips: ['Families check status with the reference number and a code sent to the phone on the application, so they see only their own.'],
  },
  campaigns: {
    category: 'Growth',
    summary: 'Every campaign in one place. Offline: banners and hoardings, pamphlets, posters, newspaper ads, radio and local TV, open houses, seminars, referral drives, society activations and fair stalls, with where they appear, dates, quantity, vendor, cost, creative and approval. Online: the campaigns whose code your ads carry.',
    workflow: ['Draft', 'Sent for approval', 'Approved', 'Live', 'Completed'],
    steps: [
      'Press + Offline campaign. Give the channel, placements, dates, vendor and cost, attach the artwork, and link the vendor\'s bill if it is in Bills & Services.',
      'Send it for approval. Another person with marketing rights, or the principal, approves it or sends it back with a note.',
      'Open Tracking & QR: print the QR code or short link on the poster or pamphlet, quote the promo code on radio, and use the tracking phone number in print. Each brings enquiries back to this campaign.',
      'Under How did you hear, set the answers families pick on the online form and counsellors pick at enquiry.',
    ],
    tips: ['Results are counted from the admissions CRM: enquiries, visits, applications and admissions. Opens of the QR or link are counted too, but they are opens, not people.'],
  },
  connectors: {
    category: 'Growth',
    summary: 'Ad platforms in one list: Meta (Facebook and Instagram), Google Ads, Google Analytics 4, YouTube, LinkedIn and any CSV. Import each platform\'s report export for spend, impressions, clicks and leads, receive leads by webhook, or load a clearly labelled simulated sample.',
    steps: [
      'Export the report from the platform as the card describes (by day, with the campaign name), then press Import performance CSV. Bad rows are listed with their line number and skipped.',
      'Name your platform campaigns with the school campaign\'s code (e.g. ADM27 Open day) so spend is matched to that campaign.',
      'Import leads CSV, or set up the lead webhook, to turn lead-form leads into enquiries. A family already in the CRM (same phone or e-mail) gets a note, not a second enquiry.',
    ],
    tips: [
      '"Not connected" is normal: connect Meta, Google or LinkedIn at the top of the page (sign in on the platform\'s own page) to sync daily spend, clicks and leads; otherwise the CSV export is the working path. Re-syncing replaces days, never doubles them.',
      'Importing the same days again replaces the earlier figures, so spend is never counted twice. Simulated sample figures are never counted as spend.',
    ],
  },
  attribution: {
    category: 'Growth',
    summary: 'Which campaigns and channels bring enquiries, visits, applications and admissions, and what each costs: cost per enquiry, cost per admission and ROI.',
    steps: [
      'Choose the period of the enquiries. The charts show enquiries and cost per admission by channel; the tables break it down by offline and online campaign.',
      'Set the value of one admission (for example first-year fees) to see ROI.',
      'Download CSV to share the figures.',
    ],
    tips: ['Each enquiry is counted once, for the earliest way it was traced to a campaign. "Not known" means no source was recorded: ask families "How did you hear about us?" at enquiry.'],
  },
  // ── Part 2 gaps ──
  'support-plans': {
    category: 'Learning',
    summary: 'Student support plans. Staff open a plan when the risk signals, attendance or marks (or their own judgement) show a child needs help: a concern area, measurable goals with review dates, actions with owners, progress reviews and a closing outcome. Families see the summary and goals for their own child.',
    workflow: ['Signal or concern', 'Plan opened', 'Shared with family', 'Reviews', 'Closed with outcome'],
    highlights: [
      { label: 'From the risk signals', text: '"From risk signals" lists students the rule-based attendance and marks signals flag who have no plan yet, with the figure behind each one.' },
      { label: 'Measurable goals', text: 'Every goal has a measure, a target and a review date. Review dates and staff actions become tasks in My Tasks, with reminders.' },
      { label: 'What families see', text: 'Families see the summary, the goals and the review notes written for them, never internal notes or the safeguarding flag.' },
    ],
    steps: [
      'Open a plan from a signal or with "+ Open a plan": choose the concern area and write the summary in words a family can read.',
      'Add goals and actions. Share the plan with the family when you are ready; they can mark it as read and leave a comment.',
      'Record progress against a goal, then a review with a note for the family and the next review date.',
      'Close the plan with its outcome. You can reopen it if needed.',
    ],
    tips: ['No diagnoses, medication or clinical details: record a wellbeing referral only.', 'Safeguarding concerns go to the Safeguarding page; the plan only records that a referral was made, visible to authorised staff.'],
  },
  portfolio: {
    category: 'Learning',
    summary: 'A competency portfolio per student (communication, critical thinking, collaboration, creativity, digital, life skills and subject competencies). Evidence is read from school records and added by teachers; teachers rate each competency on a three-level rubric; students write reflections; anyone allowed to see it can download a PDF.',
    highlights: [
      { label: 'Evidence from records', text: 'Assignments, report-card co-scholastic grades, clubs and fixtures, showcase entries, lab practicals, class eco activities and approved co-curricular records, each linked to where it lives.' },
      { label: 'Rubric, not scores', text: 'Developing, proficient or advanced, with a comment. There are no numeric scores and nothing about behaviour.' },
      { label: 'Only your own', text: 'Parents see their own children and students their own portfolio.' },
    ],
    steps: ['Choose the student.', 'Teachers: Rate a competency or add evidence. Students: add your reflection.', 'Download the PDF to share at home or keep.'],
  },
  scenarios: {
    category: 'Command Centre',
    summary: 'What-if projections 1 to 5 years ahead from the school\'s current records: enrolment (intake and how many continue), fees (increase, concessions, collection), staffing (ratio, hires, increments), transport (vehicles needed for the riders) and budget.',
    highlights: [
      { label: 'Clearly a projection', text: 'Every figure is labelled a projection, not a forecast. Nothing here changes any record.' },
      { label: 'Assumptions shown', text: 'Each assumption shows where its starting value came from: the school\'s records, a stated default, or your edit.' },
      { label: 'Compare', text: 'Save scenarios and tick two to four to see them side by side with charts.' },
    ],
    steps: ['Check the current actuals at the top.', 'Edit the assumptions you want to test and Project.', 'Save it with a name; open "Saved and compare" to compare scenarios.'],
  },
  // Part 3: the school health room.
  health: {
    category: 'Health',
    summary: 'The health room. The school nurse records visits (complaint, vitals, what was done, time in and out, outcome), gives medicines from plans the parents consented to, keeps first-aid stock and expiry dates, drafts care notes, and records immunisations and screenings for the annual health card. Parents see their own child’s visits, medicines and care notes here.',
    highlights: [
      { label: 'Encrypted and audited', text: 'Every clinical detail is encrypted at rest, and every time someone opens a child’s record it is written to the audit log.' },
      { label: 'Parents decide', text: 'No medicine is given without the parent’s consent and the prescription. A care note reaches the class teacher only if the parent agrees to share it.' },
      { label: 'Two people for controlled medicines', text: 'A second person countersigns each dose of a controlled medicine.' },
    ],
    steps: ['Nurse: record a visit from Today; mark each dose due as given, missed or refused.', 'Parent: give consent to a medicine, upload the prescription, and choose whether a care note is shared.', 'Use Health cards to add screenings and immunisations and print the card.'],
    tips: ['Parents get a message only that there is an update, never the details, for the outcomes the school chose.'],
  },
  'care-notes': {
    category: 'Health',
    summary: 'Short care notes for children in the class you are class teacher of, which their parents agreed to share, e.g. "Severe nut allergy: EpiPen in the health room".',
    steps: ['Read the notes at the start of term and before trips.', 'Ask the school nurse about anything else; health records are not shown here.'],
    tips: ['A note disappears as soon as the parent stops sharing it.'],
  },
  'health-summary': {
    category: 'Health',
    summary: 'Health-room figures as counts only: visits by outcome, injuries, medication plans, missed doses, controlled doses to countersign and stock to replace. No names or clinical details.',
    steps: ['Choose the period.', 'Follow up stock or countersigning with the school nurse.'],
  },
  'teacher-presence': {
    category: 'Transport & Safety',
    summary: 'For each lesson on the timetable today: whether the teacher (or a substitute) is in class, from the teacher\'s class check-in or a "teacher present" camera observation that a trained reviewer confirmed.',
    highlights: [
      { label: 'No identification', text: 'The timetable names the teacher. A camera never identifies anyone; a reviewer only confirms that a teacher was present.' },
      { label: 'Honest gaps', text: '"No check-in yet" means no record, not that the class was unattended.' },
    ],
    steps: ['Choose the day and, if you like, a period.', 'Follow up a lesson with no check-in with the teacher or arrange cover.'],
    tips: ['Presence is never used to judge teaching.'],
  },
  shifts: {
    category: 'Administration',
    summary: 'Shifts give groups of classes their own school day: a primary morning shift and a secondary day shift, for example, each with its own arrival, assembly, periods, breaks, lunch, dispersal and clubs.',
    highlights: [
      { label: 'One shift per class', text: 'A class belongs to one shift; teachers may teach in any. Moving a class asks first.' },
      { label: 'No room clashes', text: 'Two classes of different shifts are never put in the same room at the same time: such a plan is refused and the clash is named.' },
      { label: 'One set of times', text: 'Saving a shift sets its classes\' timetable period times to the shift\'s period bells, so the timetable, cover, attendance and Campus World agree.' },
    ],
    steps: ['Choose New shift, or Edit an existing one.', 'Set the days, then the bells: periods carry their number; breaks, lunch and assembly a label.', 'Tick the classes in the shift and save.'],
    tips: ['Campus World shows each shift at its own point of the day: one may be at lunch while another has gone home.'],
  },
  'professional-profile': {
    category: 'Organisation',
    summary: 'Your qualifications (degree, institution, year), subjects and specialisations, years of experience, certifications such as CTET, and a short bio.',
    highlights: [
      { label: 'Your choice', text: 'Each part has its own "Show to families" switch, off until you turn it on. Families of the classes you teach then see only those parts.' },
      { label: 'Where it shows', text: 'Campus World\'s "who is teaching now", the live class page and the parent\'s teacher cards.' },
    ],
    steps: ['Fill in what you want to.', 'Turn on "Show to families" for the parts families may see.', 'Save, and check "What families see" at the bottom.'],
  },
  'staff-profiles': {
    category: 'Organisation',
    summary: 'HR: every staff member\'s professional profile, how complete it is and what each shares with families.',
    highlights: [{ label: 'Consent stays theirs', text: 'HR may correct qualifications and details; whether a part is shown to families is changed only by the person.' }],
    steps: ['Search for the person.', 'Open their profile, correct it and save.'],
  },
};

const PAGES = opsRoutes.pages as Record<string, { title: string; icon: string; hidden?: boolean }>;
const PORTAL_PAGES = opsRoutes.portals as Record<string, string[]>;
/** Portals whose own home page already is "Today" (see lib/portals.ts). */
const OWN_HOME = ['hr', 'marketing', 'compliance', 'trustee'];

export function opsTopics(slug: string): GuideTopic[] {
  return (PORTAL_PAGES[slug] ?? [])
    .filter((key) => PAGES[key] && !PAGES[key].hidden && !(key === 'today' && OWN_HOME.includes(slug)))
    .map((key) => {
      const { title, ...content } = CONTENT[key];
      const name = key === 'today' && slug === 'principal' ? 'Command Centre' : title ?? PAGES[key].title;
      return {
        id: `ops-${key}`,
        title: name,
        icon: PAGES[key].icon,
        href: `/${slug}/${key}`,
        openLabel: `Open ${name}`,
        isNew: true,
        ...content,
      };
    });
}
