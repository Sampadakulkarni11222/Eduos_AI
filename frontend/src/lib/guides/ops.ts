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
    summary: 'Your campus as a 3D world: buildings, rooms, what is scheduled now, bookings, open maintenance and events. Click a room to see its details and jump to the related page.',
    steps: [
      'Drag with the left mouse button to move around, the right button to rotate, and scroll to zoom. On a phone, drag and pinch.',
      'Click a building or room to open its panel: today\'s timetable, bookings, open issues and events.',
      'Use the buttons in the panel to book the room, report an issue or open the full record.',
      'Switch to List for a plain list of spaces. It shows the same information.',
    ],
    tips: ['You only see the spaces your role is allowed to see. Restricted areas are hidden or shown without detail.'],
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
    ],
    tips: ['Photos of students appear only when the school has the right consent for them. Manage your family\'s consent under the Consent tab.'],
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
