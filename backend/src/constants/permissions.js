/**
 * Default permission catalog + system role grants.
 * This is the seed data only — the source of truth at runtime is the
 * `permissions` and `roles` collections in MongoDB, which can be extended
 * dynamically via the /api/v1/permissions and /api/v1/roles APIs.
 *
 * Scope semantics (enforced in services via req.actor / req.scope):
 *  ALL → whole school
 *  OWN → teacher's own classes, parent's own children, or student's own record
 */

export const PERMISSION_CATALOG = [
  // admin
  { key: 'users.read', group: 'admin', description: 'View user accounts' },
  { key: 'users.manage', group: 'admin', description: 'Create, update, deactivate users' },
  { key: 'roles.manage', group: 'admin', description: 'Create roles and assign permissions to them' },
  { key: 'permissions.manage', group: 'admin', description: 'Create or modify permission keys' },
  { key: 'settings.manage', group: 'admin', description: 'Manage school-wide settings' },
  { key: 'audit.read', group: 'admin', description: 'View audit logs' },

  // students
  { key: 'students.read', group: 'students', description: 'View student records' },
  { key: 'students.manage', group: 'students', description: 'Create or update student records' },
  { key: 'enrollments.manage', group: 'students', description: 'Enroll/transfer/withdraw students' },

  // academics structure
  { key: 'academics.structure.manage', group: 'academics', description: 'Manage years/terms/grades/sections/subjects/offerings' },
  { key: 'timetable.read', group: 'academics', description: 'View timetable' },
  { key: 'timetable.manage', group: 'academics', description: 'Manage timetable' },

  // attendance
  { key: 'attendance.read', group: 'academics', description: 'View attendance' },
  { key: 'attendance.mark', group: 'academics', description: 'Mark attendance' },
  { key: 'attendance.regularize', group: 'academics', description: 'Correct/regularize past attendance' },

  // assignments
  { key: 'assignments.read', group: 'academics', description: 'View assignments' },
  { key: 'assignments.manage', group: 'academics', description: 'Create/update assignments' },
  { key: 'submissions.submit', group: 'academics', description: "Submit a student's assignment" },
  { key: 'submissions.grade', group: 'academics', description: 'Grade assignment submissions' },

  // course material
  { key: 'materials.read', group: 'academics', description: 'View course materials' },
  { key: 'materials.manage', group: 'academics', description: 'Upload/edit/delete course materials' },

  // exams & marks
  { key: 'exams.manage', group: 'academics', description: 'Create/update exams and exam subjects' },
  { key: 'marks.read', group: 'academics', description: 'View marks' },
  { key: 'marks.enter', group: 'academics', description: 'Enter marks' },
  { key: 'marks.publish', group: 'academics', description: 'Publish marks / report cards' },
  { key: 'reportcards.read', group: 'academics', description: 'View report cards' },

  // fees
  { key: 'fees.structure.manage', group: 'fees', description: 'Manage fee heads and fee structures' },
  { key: 'fees.read', group: 'fees', description: 'View fee invoices' },
  { key: 'fees.manage', group: 'fees', description: 'Manage fee invoices' },
  { key: 'fees.pay', group: 'fees', description: 'Make a fee payment' },
  { key: 'fees.payments.refund', group: 'fees', description: 'Refund a fee payment' },

  // communication
  { key: 'announcements.read', group: 'communication', description: 'View announcements' },
  { key: 'announcements.publish', group: 'communication', description: 'Publish announcements' },
  { key: 'calendar.read', group: 'communication', description: 'View calendar events' },
  { key: 'calendar.manage', group: 'communication', description: 'Manage calendar events' },

  // tickets
  { key: 'tickets.read', group: 'support', description: 'View support tickets' },
  { key: 'tickets.create', group: 'support', description: 'Raise a support ticket' },
  { key: 'tickets.respond', group: 'support', description: 'Reply to a support ticket' },
  { key: 'tickets.manage', group: 'support', description: 'Assign/close support tickets' },

  // sensitive
  { key: 'medical.read', group: 'sensitive', description: "View a student's medical record" },
  { key: 'medical.manage', group: 'sensitive', description: "Update a student's medical record" },

  // admissions
  { key: 'admissions.read', group: 'admissions', description: 'View admission leads/pipeline' },
  { key: 'admissions.manage', group: 'admissions', description: 'Create/update admission leads' },

  // Library
  { key: 'library.read', group: 'library', description: 'View book catalog and lending records' },
  { key: 'library.manage', group: 'library', description: 'Add books and manage lending (issue/return)' },

  // Hostel
  { key: 'hostel.read', group: 'hostel', description: 'View hostel rooms, allocations, and student directory' },
  { key: 'hostel.manage', group: 'hostel', description: 'Manage hostel rooms and allocations' },

  // Transport
  { key: 'transport.read', group: 'transport', description: 'View transport routes, stops, and bus enrollments' },
  { key: 'transport.manage', group: 'transport', description: 'Manage transport routes, stops, and bus enrollments' },

  // AI & analytics (stand-in integrations — see ARCHITECTURE.md)
  { key: 'ai.copilot.use', group: 'ai', description: 'Use the AI copilot/chat assistant' },
  { key: 'ai.insights.read', group: 'ai', description: "View AI-generated growth/risk insights" },
  { key: 'analytics.school.read', group: 'analytics', description: 'View school-wide analytics' },
  { key: 'analytics.class.read', group: 'analytics', description: 'View class-level analytics' },
  { key: 'analytics.child.read', group: 'analytics', description: "View a child's analytics" },
];

const grants = (pairs) => pairs.map(([key, scope]) => ({ key, scope }));

const ALL_EXCEPT = (...excluded) =>
  PERMISSION_CATALOG.filter((p) => !excluded.includes(p.key)).map((p) => ({ key: p.key, scope: 'ALL' }));

export const SYSTEM_ROLES = [
  {
    key: 'OWNER',
    name: 'Owner',
    description: 'Full, unrestricted access',
    grants: PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'ALL' })),
  },
  {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Manages day-to-day school operations',
    grants: ALL_EXCEPT('permissions.manage', 'fees.payments.refund'),
  },
  {
    key: 'PRINCIPAL',
    name: 'Principal',
    description: 'Oversight across the whole school',
    grants: grants([
      ['users.read', 'ALL'],
      ['students.read', 'ALL'],
      ['attendance.read', 'ALL'],
      ['attendance.regularize', 'ALL'],
      ['assignments.read', 'ALL'],
      ['marks.read', 'ALL'],
      ['marks.publish', 'ALL'],
      ['reportcards.read', 'ALL'],
      ['materials.read', 'ALL'],
      ['materials.manage', 'ALL'],
      ['fees.read', 'ALL'],
      ['timetable.read', 'ALL'],
      ['timetable.manage', 'ALL'],
      ['announcements.read', 'ALL'],
      ['announcements.publish', 'ALL'],
      ['calendar.read', 'ALL'],
      ['calendar.manage', 'ALL'],
      ['tickets.read', 'ALL'],
      ['tickets.manage', 'ALL'],
      ['audit.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
      ['ai.insights.read', 'ALL'],
      ['analytics.school.read', 'ALL'],
      ['analytics.class.read', 'ALL'],
    ]),
  },
  {
    key: 'TEACHER',
    name: 'Teacher',
    description: 'Manages their own classes',
    grants: grants([
      ['students.read', 'OWN'],
      ['attendance.read', 'OWN'],
      ['attendance.mark', 'OWN'],
      ['assignments.read', 'OWN'],
      ['assignments.manage', 'OWN'],
      ['submissions.grade', 'OWN'],
      ['materials.read', 'OWN'],
      ['materials.manage', 'OWN'],
      ['marks.read', 'OWN'],
      ['marks.enter', 'OWN'],
      ['marks.publish', 'OWN'],
      // Read-only — allergy/emergency-contact visibility for a teacher's own
      // students; medical.manage stays parent/admin-only.
      ['medical.read', 'OWN'],
      ['timetable.read', 'OWN'],
      ['announcements.read', 'ALL'],
      ['announcements.publish', 'OWN'],
      ['calendar.read', 'ALL'],
      ['calendar.manage', 'OWN'],
      ['tickets.read', 'OWN'],
      ['tickets.respond', 'OWN'],
      ['ai.copilot.use', 'OWN'],
      ['analytics.class.read', 'OWN'],
    ]),
  },
  {
    key: 'PARENT',
    name: 'Parent',
    description: "Views their own children's records",
    grants: grants([
      ['students.read', 'OWN'],
      ['attendance.read', 'OWN'],
      ['assignments.read', 'OWN'],
      ['marks.read', 'OWN'],
      ['reportcards.read', 'OWN'],
      ['materials.read', 'OWN'],
      ['fees.read', 'OWN'],
      ['fees.pay', 'OWN'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['timetable.read', 'OWN'],
      ['tickets.read', 'OWN'],
      ['tickets.create', 'OWN'],
      ['medical.read', 'OWN'],
      ['medical.manage', 'OWN'],
      ['ai.copilot.use', 'OWN'],
      ['analytics.child.read', 'OWN'],
    ]),
  },
  {
    key: 'STUDENT',
    name: 'Student',
    description: 'Views their own records',
    grants: grants([
      ['students.read', 'OWN'],
      ['attendance.read', 'OWN'],
      ['assignments.read', 'OWN'],
      ['submissions.submit', 'OWN'],
      ['marks.read', 'OWN'],
      ['reportcards.read', 'OWN'],
      ['materials.read', 'OWN'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['timetable.read', 'OWN'],
      ['ai.copilot.use', 'OWN'],
    ]),
  },
  {
    key: 'FINANCE',
    name: 'Finance',
    description: 'Manages fees and payments',
    grants: grants([
      ['students.read', 'ALL'],
      ['fees.structure.manage', 'ALL'],
      ['fees.read', 'ALL'],
      ['fees.manage', 'ALL'],
      ['fees.payments.refund', 'ALL'],
      ['announcements.read', 'ALL'],
      ['analytics.school.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
  {
    key: 'LIBRARIAN',
    name: 'Librarian',
    description: 'Manages the school library catalog and lending',
    grants: grants([
      ['library.read', 'ALL'],
      ['library.manage', 'ALL'],
      ['students.read', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['tickets.read', 'ALL'],
      ['tickets.respond', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
  {
    key: 'WARDEN',
    name: 'Warden',
    description: 'Manages hostel facilities and student welfare',
    grants: grants([
      ['hostel.read', 'ALL'],
      ['hostel.manage', 'ALL'],
      ['medical.read', 'ALL'],
      ['students.read', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['tickets.read', 'ALL'],
      ['tickets.manage', 'ALL'],
      ['tickets.respond', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
];
