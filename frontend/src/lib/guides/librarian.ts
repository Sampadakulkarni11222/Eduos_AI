import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const librarianGuide: RoleGuide = {
  slug: 'librarian',
  hubTitle: 'Library Hub',
  hubDesc: 'How to run the school library in EduOS.',
  heroText: 'Catalogue books, lend and receive them, decide requests, and share notes and question papers.',
  quickActions: ['books', 'requests', 'notes', 'question-papers'],
  help: {
    title: 'Got a question from a student or parent?',
    text: 'Library queries arrive as support tickets.',
    label: 'Open Support Tickets',
    href: '/librarian/tickets',
  },
  topics: [
    {
      id: 'dashboard', title: 'Library overview', category: 'Home Base', icon: '◫',
      href: '/librarian', openLabel: 'Open Dashboard',
      summary: 'Lending at a glance.',
      highlights: [
        { label: 'Counts', text: 'Total catalogue books, active issues and overdue returns.' },
        { label: 'Recent Issue Records', text: 'The latest lending activity, with a shortcut to Manage Lending.' },
        { label: 'Returned Today', text: 'Books that came back today.' },
      ],
    },
    {
      id: 'books', title: 'Catalogue and lending', category: 'Lending', icon: '▢',
      href: '/librarian/books', openLabel: 'Open Catalog & Lending',
      summary: 'Manage the catalogue and students\' check-out records.',
      steps: [
        'Catalog tab: click Add Book and enter the title, author, category, ISBN and number of copies. For a digital resource, choose "Digital resource" and add its link.',
        'Click Issue on a book, choose the student and set a due date.',
        'Issued Books tab: click Return when a book comes back. Overdue books accrue fines.',
      ],
    },
    {
      id: 'requests', title: 'Book requests', category: 'Lending', icon: '⇄',
      href: '/librarian/requests', openLabel: 'Open Book Requests',
      summary: 'Students ask for a copy of a book. Approving a request issues the book.',
      steps: ['Filter by Waiting, Approved, Rejected, Withdrawn or All.', 'Click "Approve & issue" to lend the copy, or Refuse.'],
      tips: ['"Approve & issue" is disabled while no copy of the book is free.'],
    },
    {
      id: 'notes', title: 'Library notes', category: 'Resources', icon: '✎',
      href: '/librarian/notes', openLabel: 'Open Library Notes',
      summary: 'Study notes filed by class, subject, academic year, exam and language.',
      steps: [
        'Add a note: enter a title, class, subject, academic year, exam and language.',
        'Write the note text, or attach a file, and save it to the library.',
        'Use Remove to take a note down.',
      ],
    },
    {
      id: 'question-papers', title: 'Question papers', category: 'Resources', icon: '❑',
      href: '/librarian/question-papers', openLabel: 'Open Question Papers',
      summary: 'Past question papers filed by class, subject, academic year, exam and language.',
      steps: ['Add a paper with its class, subject, year, exam and language, and attach the file.', 'Students find them under Question Papers in their portal.'],
    },
    {
      id: 'announcements', title: 'Notice board', category: 'Communication', icon: '◍',
      href: '/librarian/announcements', openLabel: 'Open Announcements',
      summary: 'School notices and library updates.',
    },
    {
      id: 'tickets', title: 'Library queries', category: 'Communication', icon: '✉',
      href: '/librarian/tickets', openLabel: 'Open Support Tickets',
      summary: 'Support enquiries routed to the library.',
      steps: ['Open a ticket, read the conversation, then type a reply and press Send.'],
    },
    askAgentTopic({
      askAbout: ['the library summary', 'overdue books', 'the catalogue and loans', 'book requests waiting for you', 'students', 'announcements and the calendar', 'library queries'],
      canDo: ['add, update or remove books', 'lend and return books', 'approve or refuse book requests', 'reply to library queries'],
      examples: ['Which books are overdue?', 'Is "Introduction to Algorithms" available?', 'Show pending book requests'],
      notYet: ['library notes', 'question papers'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
