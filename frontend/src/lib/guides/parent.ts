import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const parentGuide: RoleGuide = {
  slug: 'parent',
  hubTitle: 'Parent Hub',
  hubDesc: 'How to follow your child\'s school life in EduOS.',
  heroText: 'Attendance, homework, results, fees and school news for your child, all in one place.',
  quickActions: ['attendance', 'performance', 'assignments', 'payments', 'tickets'],
  help: {
    title: 'Still need help?',
    text: 'Raise a request with the school and track the reply.',
    label: 'Open Support',
    href: '/parent/tickets',
  },
  topics: [
    {
      id: 'dashboard', title: 'Your children at a glance', category: 'Home Base', icon: '◳',
      href: '/parent', openLabel: 'Open Dashboard',
      summary: 'The dashboard shows each child\'s day and the things that need your attention.',
      highlights: [
        { label: 'Today', text: 'Your child\'s classes for today.' },
        { label: 'Class Information', text: 'Class teacher and class representative.' },
        { label: 'Cards', text: 'Attendance, performance, fees pending and upcoming exams, each linking to the full details.' },
        { label: 'Upcoming Events & Announcements', text: 'Holidays, exams and school notices.' },
      ],
      tips: ['If you have more than one child at the school, tabs with their names let you switch between them on each page.'],
    },
    {
      id: 'performance', title: 'Results and report card', category: 'My Child', icon: '◉',
      href: '/parent/performance', openLabel: 'Open Performance',
      summary: 'Your child\'s marks by exam and subject, and the school-issued report card.',
      highlights: [
        { label: 'Marks Breakdown', text: 'Every published exam and subject mark.' },
        { label: 'Summary', text: 'Overall average, best subject and the subject that needs support.' },
        { label: 'Report card', text: 'Download the report card as a PDF.' },
      ],
    },
    {
      id: 'student-view', title: 'Growth at a glance', category: 'My Child', icon: '◈',
      href: '/parent/student-view', openLabel: 'Open Student View',
      summary: 'Your child\'s growth score, with an explanation of how it is built. Every point is explained, so nothing is a black box.',
    },
    {
      id: 'attendance', title: 'Attendance', category: 'My Child', icon: '☱',
      href: '/parent/attendance', openLabel: 'Open Attendance',
      summary: 'Your child\'s monthly attendance: percentage, present and absent days, and working days.',
      steps: ['Pick a month to see the breakdown.'],
      tips: ['If attendance falls below 75%, a warning is shown so you can follow up.'],
    },
    {
      id: 'assignments', title: 'Homework and assignments', category: 'My Child', icon: '✐',
      href: '/parent/assignments', openLabel: 'Open Assignments',
      summary: 'See what homework your child has, when it is due, and whether it was submitted.',
      steps: ['Switch between Upcoming and Past.', 'Filter by subject or chapter.'],
    },
    {
      id: 'timetable', title: 'Class timetable', category: 'My Child', icon: '▥',
      href: '/parent/timetable', openLabel: 'Open Timetable',
      summary: 'Your child\'s weekly class schedule.',
      steps: ['Switch between Day, Week and Month, and move with ‹ Prev / Today / Next ›.'],
    },
    {
      id: 'material', title: 'Course material', category: 'My Child', icon: '❑',
      href: '/parent/material', openLabel: 'Open Course Material',
      summary: 'Study materials teachers have shared with parents.',
      steps: ['Search by title and click Download / View.'],
    },
    {
      id: 'study-help', title: 'Study help for your child', category: 'My Child', icon: '✦',
      href: '/parent/study-help', openLabel: 'Open Study Help',
      summary: 'Help your child with a subject and topic they are studying.',
      steps: [
        'Choose a subject (only your child\'s subjects are listed) and type a topic, e.g. fractions.',
        'Say what would help most and click "Ask for help".',
      ],
      tips: [
        'Some answers are a study plan built from your child\'s own classes and results; these are free.',
        'AI-written answers use AI credits. Use "Add credits" when you run out.',
      ],
    },
    {
      id: 'calendar', title: 'Calendar & events', category: 'School Life', icon: '▤',
      href: '/parent/calendar', openLabel: 'Open Calendar & Events',
      summary: 'Upcoming holidays, exams and school events.',
    },
    {
      id: 'announcements', title: 'Announcements', category: 'School Life', icon: '◍',
      href: '/parent/announcements', openLabel: 'Open Announcements',
      summary: 'School notices and circulars meant for you and your child\'s class.',
    },
    {
      id: 'medical', title: 'Medical record', category: 'School Life', icon: '✚',
      href: '/parent/medical', openLabel: 'Open Medical Records',
      summary: 'Keep your child\'s health information up to date for the school.',
      steps: [
        'Review blood group, height and weight, emergency contact, allergies and regular medications.',
        'Update details, add medical history and upload reports, then save.',
      ],
    },
    {
      id: 'library', title: 'Library', category: 'School Life', icon: '▢',
      href: '/parent/library', openLabel: 'Open Library',
      summary: 'Books your child has checked out, with due dates and fines, and a search of the school catalogue.',
    },
    {
      id: 'transport', title: 'Bus & transport', category: 'School Life', icon: '⛒',
      href: '/parent/transport', openLabel: 'Open Transport',
      summary: 'Your child\'s bus route, vehicle number and stop, and the driver\'s name and contact number.',
    },
    {
      id: 'payments', title: 'Pay fees', category: 'Account', icon: '₹',
      href: '/parent/payments', openLabel: 'Open Payments',
      summary: 'Your fee invoices and balances. Pay outstanding fees online.',
      steps: [
        'See the total outstanding and the pending invoices.',
        'Click Pay on an invoice and complete the payment in the secure checkout.',
      ],
      tips: [
        'An invoice is only marked paid once the payment has actually gone through.',
        'If your school has not switched on online payment, pay at the school office instead.',
      ],
    },
    {
      id: 'ai-credits', title: 'AI credits', category: 'Account', icon: '✦',
      href: '/parent/ai-credits', openLabel: 'Open AI Credits',
      summary: 'Your free monthly allowance for AI-written answers, and how to add more.',
      highlights: [
        { label: 'Costs 1 credit', text: 'An AI-written explanation, practice set, flashcards, notes or mind map.' },
        { label: 'Always free', text: 'Questions about attendance, fees, results, timetable and homework.' },
      ],
      steps: ['Check "Credits left".', 'Click "Add credits" to buy a top-up; past purchases are listed under "Top-up history".'],
    },
    {
      id: 'documents', title: 'Documents & circulars', category: 'Account', icon: '🗎',
      href: '/parent/documents', openLabel: 'Open Documents',
      summary: 'Report cards, certificates and letters the school has shared with you, and your child\'s ID card.',
      steps: ['Open a document from the list.', 'Click "🪪 Student ID Card" to download the ID card.'],
    },
    {
      id: 'tickets', title: 'Contact the school', category: 'Account', icon: '✉',
      href: '/parent/tickets', openLabel: 'Open Support',
      summary: 'Raise a request with the school and follow the conversation.',
      steps: [
        'Click "+ New ticket", enter a subject and message.',
        'Under "Route to", choose who should handle it: class teacher, admin office, warden, librarian or principal.',
        'Raise the ticket, then read and answer replies here.',
      ],
    },
    askAgentTopic({
      askAbout: [
        'your child\'s attendance', 'their timetable and subjects', 'results and the report card', 'homework',
        'fees, invoices and how to pay', 'announcements and the calendar', 'leave applications', 'their medical record',
        'your tickets and documents',
      ],
      canDo: ['update your child\'s medical record', 'raise a ticket with the school'],
      examples: ['What are my child\'s pending fees?', 'How was my child\'s attendance this month?', 'What homework is due this week?'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
