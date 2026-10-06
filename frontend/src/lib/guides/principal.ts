import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const principalGuide: RoleGuide = {
  slug: 'principal',
  hubTitle: 'Principal Hub',
  hubDesc: 'How to read the school\'s health and act on it in EduOS.',
  heroText: 'See how the school is doing today, find the students who need attention, and follow up.',
  quickActions: ['intelligence', 'risk', 'attendance', 'fees', 'tickets'],
  help: {
    title: 'Need a record of who did what?',
    text: 'The audit log shows every important action taken in the school portal.',
    label: 'Open Audit Logs',
    href: '/principal/audit',
  },
  topics: [
    {
      id: 'intelligence', title: 'School Intelligence', category: 'Overview', icon: '◫',
      href: '/principal', openLabel: 'Open School Intelligence',
      summary: 'How the school is doing today, and where to look first.',
      highlights: [
        { label: 'Needs attention first', text: 'The highest-probability risk flags across the school.' },
        { label: 'Risk counts', text: 'Students at high and medium risk, and all flagged signals.' },
        { label: 'Operations', text: 'Attendance flags, fees collected/pending/overdue, and staffing: teaching staff, classes with a class teacher, and subject offerings without a teacher.' },
      ],
      tips: ['A student is flagged once a signal crosses a risk threshold; one student can carry several flags.'],
    },
    {
      id: 'risk', title: 'Performance & risk', category: 'Academic', icon: '◔',
      href: '/principal/risk', openLabel: 'Open Performance & Risk',
      summary: 'Every flagged signal with the reasons behind it. Filter, sort and drill into any student.',
      steps: [
        'Search by student or class, and filter by grade, category and risk level (High, Medium, Low/monitoring).',
        'Click Details on a student to see why they were flagged, their attendance, recent results and guardians.',
        'Act from the details panel: call or email the parent, or notify or call the class teacher.',
      ],
    },
    {
      id: 'workload', title: 'Teacher workload', category: 'Academic', icon: '◐',
      href: '/principal/workload', openLabel: 'Open Teacher Workload',
      summary: 'How sections and subject offerings are distributed across grades.',
      highlights: [{ label: 'Totals', text: 'Total grades, sections and offerings, then a row per grade with its sections.' }],
    },
    {
      id: 'attendance', title: 'Attendance trends', category: 'Operations', icon: '◷',
      href: '/principal/attendance', openLabel: 'Open Attendance Trends',
      summary: 'Daily attendance across all sections.',
      steps: ['Pick a section and date to see each student\'s status.'],
    },
    {
      id: 'fees', title: 'Fee health', category: 'Operations', icon: '₹',
      href: '/principal/fees', openLabel: 'Open Fee Health',
      summary: 'School-wide fee collection: total billed, collected and pending, and every invoice.',
      steps: ['Search invoices by invoice number, student or class.'],
    },
    {
      id: 'staff', title: 'Staff directory', category: 'People', icon: '◇',
      href: '/principal/staff', openLabel: 'Open Staff Directory',
      summary: 'Teaching staff, the subjects they teach, their classes and how to reach them.',
      steps: ['Search by name, subject, class or contact, or filter by subject.'],
    },
    {
      id: 'announcements', title: 'Announcements', category: 'Communication', icon: '◉',
      href: '/principal/announcements', openLabel: 'Open Announcements',
      summary: 'Publish and manage school-wide announcements.',
      workflow: ['Write', 'Choose audience', 'Preview', 'Publish'],
      steps: [
        'Write a title and content, and optionally attach a file.',
        'Choose everyone, a class (a whole grade or one section) or a subject, and how to notify people.',
        'Click Preview to see exactly who will receive it, then Publish.',
      ],
    },
    {
      id: 'tickets', title: 'Escalated tickets', category: 'Communication', icon: '✉',
      href: '/principal/tickets', openLabel: 'Open Escalated Tickets',
      summary: 'Support tickets that need the principal\'s attention.',
      steps: ['Open a ticket to read the conversation, then type a reply and press Send.'],
    },
    {
      id: 'audit', title: 'Audit log', category: 'Governance', icon: '▷',
      href: '/principal/audit', openLabel: 'Open Audit Logs',
      summary: 'A record of important actions in the school portal.',
      steps: ['Filter by role, action (e.g. student.create) or month.', 'Each entry shows who acted, on what, through which channel and when.'],
    },
    askAgentTopic({
      askAbout: [
        'at-risk students and growth scores', 'attendance across the school, including who is absent today', 'fees, invoices and fee plans',
        'students and guardians', 'classes, subjects and the timetable', 'exams, marks and report cards', 'assignments',
        'announcements and the calendar', 'leave, elective and student requests', 'tickets', 'staff and users', 'documents and audit logs',
      ],
      canDo: [
        'set up grades, sections, subjects and terms and assign teachers', 'add timetable slots', 'publish marks',
        'post announcements and calendar events, and notify people or send a WhatsApp message', 'review leave and decide elective and student requests',
        'update tickets', 'move a fee plan through approval', 'add or update course material',
      ],
      examples: ['Which students are at high risk?', 'Who is absent today?', 'How much fee is pending?'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
