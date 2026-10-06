import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const teacherGuide: RoleGuide = {
  slug: 'teacher',
  hubTitle: 'Teacher Hub',
  hubDesc: 'Everything you need to run your classes in EduOS.',
  heroText: 'Plan your classes, manage attendance, review assignments and quizzes, and keep your students on track.',
  quickActions: ['attendance', 'assignments', 'quizzes', 'exams', 'leave', 'tickets'],
  help: {
    title: 'Still need help?',
    text: 'Raise a ticket with the school office and they will get back to you.',
    label: 'Open Parent Queries',
    href: '/teacher/tickets',
  },
  topics: [
    {
      id: 'dashboard', title: 'Your teaching dashboard', category: 'Home Base', icon: '◫',
      href: '/teacher', openLabel: 'Open Dashboard',
      summary: 'Your teaching day at a glance.',
      highlights: [
        { label: 'Attendance Today', text: 'Today\'s classes, with a link to your full timetable.' },
        { label: 'Grading Queue', text: 'Assignments waiting for marks.' },
        { label: 'Counts', text: 'Total classes and sections, upcoming exams, pending assignments and course materials.' },
        { label: 'Recent Notifications', text: 'The latest announcements for you.' },
      ],
    },
    {
      id: 'classes', title: 'View my classes', category: 'Teaching', icon: '◐',
      href: '/teacher/classes', openLabel: 'Open My Classes',
      summary: 'Every section you teach or are class teacher of, with each student\'s details.',
      steps: [
        'Search by division or student name.',
        'Click "View More" on a student to see personal info, guardian contacts, medical record, this month\'s attendance, exam marks and assignments.',
      ],
    },
    {
      id: 'attendance', title: 'Keep attendance on track.', category: 'Teaching', icon: '☱',
      href: '/teacher/attendance', openLabel: 'Open Attendance',
      summary: 'One-tap attendance marking for your sections.',
      workflow: ['Pick class & period', 'Mark all present', 'Change exceptions', 'Save'],
      steps: [
        'Choose the class and either a subject period or "Whole day".',
        'Click "Mark all present", then change the students who are absent or late.',
        'Save. You will see "✓ Attendance saved".',
        'For many records at once use "⇧ Bulk upload": download the CSV template, fill it in and upload it. Rows with errors are listed so you can fix and re-upload them.',
      ],
      tips: [
        'A period can only be marked by the teacher timetabled for it.',
        'Whole-day attendance can only be marked by the section\'s class teacher.',
      ],
    },
    {
      id: 'timetable', title: 'Know what\'s coming next.', category: 'Teaching', icon: '▥',
      href: '/teacher/timetable', openLabel: 'Open Timetable',
      summary: 'Your weekly schedule across all your sections.',
      steps: [
        'Switch between This Week and This Month, or Day/Week/Month in the calendar.',
        'Filter by day, class or period, or by time.',
        'Click a class to see its details.',
      ],
    },
    {
      id: 'assignments', title: 'From assignment to submission.', category: 'Teaching', icon: '✎',
      href: '/teacher/assignments', openLabel: 'Open Assignments',
      summary: 'Set homework, projects and worksheets, then review and grade what students submit.',
      workflow: ['Create', 'Students submit', 'Review work', 'Enter marks & feedback'],
      steps: [
        'Create an assignment: choose the class and subject, title, type, chapter, due date and maximum marks.',
        'Optionally attach a worksheet or document. Students see it as "📎 Material".',
        'Open Submissions to see who has submitted, view each piece of work, and enter marks and feedback (e.g. "Good work — revise Q4").',
        'Filter by class, subject or chapter.',
      ],
    },
    {
      id: 'quizzes', title: 'Create auto-graded quizzes', category: 'Teaching', icon: '☑', isNew: true,
      href: '/teacher/quizzes', openLabel: 'Open Quizzes',
      summary: 'Build multiple-choice quizzes for your classes. They are graded automatically the moment a student submits.',
      workflow: ['Create Quiz', 'Add questions', 'Publish', 'Students attempt', 'See results'],
      steps: [
        'Click "Create Quiz", pick your class and subject, give it a title and instructions, and optionally set a duration in minutes (leave it blank for no time limit).',
        'Click "+ Add Question", type the question, add 2 to 6 options and select the one correct answer. Set the marks for the question.',
        'Click "Publish Quiz". Only students in that class can see it; for an elective, only students approved for that elective.',
        'Open Results to see each student\'s score and percentage, plus the class average, highest and lowest.',
      ],
      tips: [
        'Once any student has started a quiz, its questions are locked to keep results fair, and it cannot be deleted. Unpublish it instead to hide it.',
        'Each student gets one attempt. A timed quiz submits itself when time runs out.',
        'A quiz with no questions cannot be published.',
      ],
    },
    {
      id: 'exams', title: 'Track student progress.', category: 'Teaching', icon: '◌',
      href: '/teacher/exams', openLabel: 'Open Exams & Performance',
      summary: 'Enter exam marks for your classes and view published results.',
      steps: [
        'Under "Marks entry", select the exam and the subject/paper you teach.',
        'Enter marks for the whole class, with an optional grade and remarks. Press Enter for the next student, Shift+Enter for the previous one, and Tab to move across a row.',
        'Publish the marks. Published marks are locked.',
        'Select a student to see their published results.',
      ],
      tips: ['If no papers are set up for an exam, ask an admin to attach your subject to it.'],
    },
    {
      id: 'material', title: 'Share course materials.', category: 'Content', icon: '❑',
      href: '/teacher/material', openLabel: 'Open Course Material',
      summary: 'Share notes, worksheets and resources with your sections.',
      steps: [
        'Click "Upload Material", enter a title and choose the section.',
        'Upload a file or paste a link, and choose who can see it: students, parents or both.',
        'Edit or delete materials from the list. Search by title or filter by section.',
      ],
    },
    {
      id: 'announcements', title: 'Stay connected with announcements.', category: 'Communication', icon: '◍',
      href: '/teacher/announcements', openLabel: 'Open Announcements',
      summary: 'Read school notices and post announcements to the classes and subjects you teach.',
      workflow: ['Write', 'Choose your class or subject', 'Preview', 'Publish'],
      steps: [
        'Write a title and content and optionally attach a file.',
        'Choose one of your classes or subjects as the audience, and how to notify (App, Email).',
        'Click Preview to check who will receive it, then Publish.',
      ],
    },
    {
      id: 'calendar', title: 'School calendar', category: 'Communication', icon: '▤',
      href: '/teacher/calendar', openLabel: 'Open Calendar',
      summary: 'School events, exams and holidays in one place.',
      steps: ['Browse upcoming events, holidays, exams and sports days.', 'Use "+ Add Event" to add an event for your classes.'],
    },
    {
      id: 'tickets', title: 'Manage queries and support.', category: 'Communication', icon: '✉',
      href: '/teacher/tickets', openLabel: 'Open Parent Queries',
      summary: 'Questions parents route to you as the class teacher.',
      steps: [
        'Open a query to read the conversation and who it is regarding.',
        'Type a reply and press Send.',
      ],
      tips: ['Messages that arrived over WhatsApp are marked "via WhatsApp".'],
    },
    {
      id: 'registrations', title: 'Approve elective requests', category: 'Students', icon: '⊕',
      href: '/teacher/registrations', openLabel: 'Open Subject Registrations',
      summary: 'Elective subject requests from students in your classes.',
      steps: ['Filter by Pending, Approved, Rejected or All.', 'Approve a request, or Reject it with an optional reason the student will see.'],
    },
    {
      id: 'student-requests', title: 'Review student requests', category: 'Students', icon: '✓',
      href: '/teacher/student-requests', openLabel: 'Open Student Requests',
      summary: 'As class teacher you verify two kinds of requests from your students: co-curricular achievements and profile corrections.',
      steps: [
        'Choose co-curricular achievements or profile corrections, and filter by status.',
        'Open a request to see the details and any supporting document.',
        'Approve it to add it to the student\'s record, or Reject it with a reason the student can act on (required).',
      ],
    },
    {
      id: 'leave', title: 'Approve leave requests', category: 'Students', icon: '⛱',
      href: '/teacher/leave', openLabel: 'Open Leave Requests',
      summary: 'Leave applications from students in your classes.',
      steps: [
        'Filter by Pending, Approved, Rejected or All.',
        'Check the dates and reason, then Approve, or Reject with an optional reason the student will see ("Confirm reject").',
      ],
    },
    {
      id: 'medical', title: 'Medical records for your class', category: 'Students', icon: '✚',
      href: '/teacher/medical', openLabel: 'Open Medical Records',
      summary: 'Health records for students in your homeroom class.',
      steps: [
        'Choose the grade, section and student.',
        'Review or update blood group, emergency contact, allergies, medications and history.',
      ],
      tips: ['You only see students of the section you are class teacher of.'],
    },
    {
      id: 'transport', title: 'Student transport', category: 'Students', icon: '⛒',
      href: '/teacher/transport', openLabel: 'Open Transport',
      summary: 'Route, stop and vehicle for the students you teach. This view is read-only.',
      steps: ['Pick one of your classes, or "All my classes".', 'See each student\'s route, vehicle, pickup/drop and status.'],
    },
    askAgentTopic({
      askAbout: [
        'your classes, subjects and timetable', 'your students and their guardians', 'attendance in your classes',
        'exams, marks and report cards', 'assignments and submissions', 'announcements and the calendar',
        'leave, elective and student requests waiting for you', 'medical records of your class', 'parent queries', 'course material',
      ],
      canDo: [
        'mark attendance (one class or in bulk)', 'enter and publish marks', 'create assignments and grade submissions',
        'post an announcement to your class', 'approve or reject leave and elective requests',
        'approve or reject co-curricular and profile-correction requests', 'reply to parent queries', 'add or update course material',
      ],
      examples: ['Which classes do I teach today?', 'Mark everyone in 6 A present for period 2', 'Show pending submissions for my algebra worksheet'],
      notYet: ['quizzes'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
