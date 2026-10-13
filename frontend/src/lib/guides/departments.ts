import type { GuideTopic, RoleGuide } from './types';
import { notificationsTopic, accessTip, signInTopic } from './shared';
import { opsTopics } from './ops';

/** Guides for the department portals: HR, marketing, compliance, trustees and alumni. */
const common: GuideTopic[] = [signInTopic(), { ...notificationsTopic, tips: [accessTip] }];

export const hrGuide: RoleGuide = {
  slug: 'hr',
  hubTitle: 'HR & Payroll Hub',
  hubDesc: 'How to run verification, payroll, people records and training in EduOS.',
  heroText: 'Verify new staff, run payroll, keep the organisation map current and track mandatory training.',
  quickActions: ['today', 'ops-payroll', 'ops-verification', 'ops-organization'],
  help: {
    title: 'Waiting on a decision?',
    text: 'Approvals shows where each of your requests is and who has it now.',
    label: 'Open Approvals',
    href: '/hr/approvals',
  },
  topics: [
    {
      id: 'today', title: 'Today', category: 'Workspace', icon: '☀', isNew: true,
      href: '/hr', openLabel: 'Open Today',
      summary: 'What needs you now: verifications in progress, the payroll run for this month, people not yet placed in the structure and trainings coming up.',
      steps: ['Start here each day.', 'Click a card to open the record behind it.'],
      tips: ['A figure shows "Not available" when its data has not been entered yet.'],
    },
    ...opsTopics('hr'),
    ...common,
  ],
};

export const marketingGuide: RoleGuide = {
  slug: 'marketing',
  hubTitle: 'Marketing & Admissions Hub',
  hubDesc: 'How to grow enquiries and turn them into admissions in EduOS.',
  heroText: 'Follow every enquiry, run campaigns, get posters and posts approved, and keep the newsroom alive.',
  quickActions: ['today', 'admissions', 'ops-marketing', 'ops-newsroom'],
  help: {
    title: 'Need a poster or post approved?',
    text: 'Creative goes for approval before it is used. Approvals shows where it is.',
    label: 'Open Approvals',
    href: '/marketing/approvals',
  },
  topics: [
    {
      id: 'today', title: 'Today', category: 'Workspace', icon: '☀', isNew: true,
      href: '/marketing', openLabel: 'Open Today',
      summary: 'What needs you now: new enquiries, follow-ups due, counselling appointments, campaigns running and posts waiting for review.',
      steps: ['Start here each day.', 'Click a card to open the record behind it.'],
    },
    {
      id: 'admissions', title: 'Admission CRM', category: 'Growth', icon: '◌', isNew: true,
      href: '/marketing/admissions', openLabel: 'Open Admission CRM',
      summary: 'Every enquiry from first contact to admission.',
      steps: [
        'Add an enquiry with the parent\'s contact details, the class sought and where they heard about you.',
        'Move it through the stages as you follow up, and add a note each time.',
        'Mark it admitted or lost with the reason, so the funnel stays accurate.',
      ],
    },
    ...opsTopics('marketing'),
    ...common,
  ],
};

export const complianceGuide: RoleGuide = {
  slug: 'compliance',
  hubTitle: 'Compliance & Safeguarding Hub',
  hubDesc: 'How to keep the institution compliant and its children safe in EduOS.',
  heroText: 'Track every obligation, return and licence, and handle safeguarding concerns in confidence.',
  quickActions: ['today', 'ops-safeguarding', 'ops-compliance', 'ops-correspondence'],
  help: {
    title: 'A deadline is close?',
    text: 'The Compliance Centre lists every return, licence and notice with its due date.',
    label: 'Open Compliance Centre',
    href: '/compliance/compliance',
  },
  topics: [
    {
      id: 'today', title: 'Today', category: 'Workspace', icon: '☀', isNew: true,
      href: '/compliance', openLabel: 'Open Today',
      summary: 'What needs you now: open safeguarding cases, returns due, licences about to expire, notices to act on and letters awaiting a reply.',
      steps: ['Start here each day.', 'Click a card to open the record behind it.'],
    },
    {
      id: 'safeguarding-cases', title: 'Handling safeguarding cases', category: 'Safety', icon: '🛡', isNew: true,
      summary: 'As the designated officer, you see every concern raised and manage it to closure on the Safeguarding page.',
      steps: [
        'Open a case to read the concern and who raised it.',
        'Record each action taken, including any report made to the police or child welfare authorities, with the date.',
        'Close the case with the outcome once every action is complete.',
      ],
      tips: [
        'Where the law requires a report to the authorities, make it without waiting for anyone\'s approval. EduOS records the report; it does not make it for you.',
        'Case details are encrypted and are never shown in the audit log.',
      ],
    },
    ...opsTopics('compliance'),
    ...common,
  ],
};

export const trusteeGuide: RoleGuide = {
  slug: 'trustee',
  hubTitle: 'Governing Body Hub',
  hubDesc: 'How trustees and board members follow the institution in EduOS.',
  heroText: 'See the institution\'s health, prepare for meetings and decide what is waiting for the board.',
  quickActions: ['overview', 'ops-governance', 'ops-approvals', 'ops-budgets'],
  help: {
    title: 'Preparing for a meeting?',
    text: 'Board & Committees has the agenda, past minutes and open actions.',
    label: 'Open Board & Committees',
    href: '/trustee/governance',
  },
  topics: [
    {
      id: 'overview', title: 'Overview', category: 'Workspace', icon: '☀', isNew: true,
      href: '/trustee', openLabel: 'Open Overview',
      summary: 'The institution at a glance: enrolment, finances, compliance standing, the next meeting and decisions waiting for the board.',
      tips: ['You see summaries, not individual students\' or staff members\' records.', 'A figure shows "Not available" when its data has not been entered yet.'],
    },
    ...opsTopics('trustee'),
    ...common,
  ],
};

export const alumnusGuide: RoleGuide = {
  slug: 'alumnus',
  hubTitle: 'Alumni Hub',
  hubDesc: 'How to stay in touch with your institution in EduOS.',
  heroText: 'Read the news, join your batch\'s circle and offer to mentor current students.',
  quickActions: ['home', 'ops-mentoring', 'ops-campus'],
  help: {
    title: 'Want to give back?',
    text: 'Offer to mentor current students in studies, careers or college choices.',
    label: 'Open Mentoring',
    href: '/alumnus/mentoring',
  },
  topics: [
    {
      id: 'home', title: 'Home', category: 'Workspace', icon: '☀', isNew: true,
      href: '/alumnus', openLabel: 'Open Home',
      summary: 'News from your institution, alumni circles and mentoring in one place.',
      steps: ['Read and react to stories.', 'Join the circle for your batch.'],
    },
    ...opsTopics('alumnus'),
    ...common,
  ],
};
