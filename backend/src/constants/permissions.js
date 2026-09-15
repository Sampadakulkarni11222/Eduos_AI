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

  // Platform-level governance. These two keys exist so a Super Admin can run
  // school onboarding and School Admin accounts across schools; every
  // school-level role is deliberately excluded from them.
  { key: 'schools.read', group: 'admin', description: 'View the schools on the platform and their School Admins' },
  { key: 'schools.manage', group: 'admin', description: 'Create schools and manage their School Admin accounts' },

  // students
  { key: 'students.read', group: 'students', description: 'View student records' },
  { key: 'students.manage', group: 'students', description: 'Create or update student records' },
  { key: 'enrollments.manage', group: 'students', description: 'Enroll/transfer/withdraw students' },

  // academics structure
  { key: 'academics.structure.manage', group: 'academics', description: 'Manage years/terms/grades/sections/subjects/offerings' },
  // Reading the school's structure is a staff concern. It is low-sensitivity
  // on its own, but it is still roster metadata — the full list of grades,
  // sections and who teaches what — and a family has no reason to enumerate it.
  { key: 'academics.read', group: 'academics', description: 'View school structure (years/terms/grades/sections/subjects/offerings)' },
  { key: 'timetable.read', group: 'academics', description: 'View timetable' },
  { key: 'timetable.manage', group: 'academics', description: 'Manage timetable' },

  // attendance
  { key: 'attendance.read', group: 'academics', description: 'View attendance' },
  { key: 'attendance.mark', group: 'academics', description: 'Mark attendance' },
  { key: 'attendance.regularize', group: 'academics', description: 'Correct/regularize past attendance' },
  { key: 'registrations.apply', group: 'academics', description: 'Register for elective subjects' },
  { key: 'registrations.review', group: 'academics', description: 'Approve or reject elective subject registrations' },
  { key: 'leave.apply', group: 'academics', description: 'Apply for a leave of absence' },
  { key: 'leave.read', group: 'academics', description: 'View leave application status' },
  { key: 'leave.review', group: 'academics', description: 'Approve or reject leave applications' },

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

  // Fee-plan and payment governance.
  //
  // The split here is the whole point of the approval workflow: `.request` and
  // `.review` are preparation, `.approve` is authority. Finance holds the
  // first two and must never hold the third — that is what stops a payment or
  // an installment plan becoming final without an admin, and it is enforced by
  // which keys each role is granted below, not by anything in the UI.
  { key: 'fees.plan.request', group: 'fees', description: 'Draft and submit a student installment/payment plan' },
  { key: 'fees.plan.review', group: 'fees', description: 'Review a submitted installment plan and send it for admin approval' },
  { key: 'fees.plan.approve', group: 'fees', description: 'Approve, reject and publish student installment plans' },
  { key: 'fees.payments.approve', group: 'fees', description: 'Approve, reject, publish and amend finalized student payment records' },

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

  // Student self-service requests (co-curricular achievements, profile corrections).
  // Both are student-raised and class-teacher-reviewed, so each has a separate
  // "request" and "review" key rather than one shared manage key.
  { key: 'cocurricular.read', group: 'students', description: 'View co-curricular activity records and requests' },
  { key: 'cocurricular.request', group: 'students', description: 'Request that a co-curricular activity be added to a profile' },
  { key: 'cocurricular.review', group: 'students', description: 'Approve or reject co-curricular activity requests' },
  { key: 'profile.edit.request', group: 'students', description: 'Request a correction to profile information' },
  { key: 'profile.edit.review', group: 'students', description: 'Approve or reject student profile edit requests' },

  // Library
  { key: 'library.read', group: 'library', description: 'View book catalog and lending records' },
  { key: 'library.manage', group: 'library', description: 'Add books and manage lending (issue/return)' },
  // A student asks for a copy; a librarian holding library.manage decides.
  // Deliberately separate from library.read: browsing the catalogue and asking
  // for a book off it are different acts, and only the second creates a record.
  { key: 'library.request', group: 'library', description: 'Request a book to be issued' },

  // Hostel
  { key: 'hostel.read', group: 'hostel', description: 'View hostel rooms, allocations, and student directory' },
  { key: 'hostel.manage', group: 'hostel', description: 'Manage hostel rooms and allocations' },

  // Transport
  { key: 'transport.read', group: 'transport', description: 'View transport routes, stops, and bus enrollments' },
  { key: 'transport.manage', group: 'transport', description: 'Manage transport routes, stops, and bus enrollments' },
  // A student asks for a seat on a route; a transport.manage holder decides.
  // transport.read stays staff-only: browsing routes to choose one is a
  // self-service read of name, stops and fare, not the operational view.
  { key: 'transport.request', group: 'transport', description: 'Request a place on a transport route' },

  // AI & analytics (stand-in integrations — see ARCHITECTURE.md)
  { key: 'ai.copilot.use', group: 'ai', description: 'Use the AI copilot/chat assistant' },
  { key: 'ai.insights.read', group: 'ai', description: "View AI-generated growth/risk insights" },
  { key: 'analytics.school.read', group: 'analytics', description: 'View school-wide analytics' },
  { key: 'analytics.class.read', group: 'analytics', description: 'View class-level analytics' },
  { key: 'analytics.child.read', group: 'analytics', description: "View a child's analytics" },
];

const grants = (pairs) => pairs.map(([key, scope]) => ({ key, scope }));

/**
 * Permission keys reserved for SUPER_ADMIN. They sit above a single school, so
 * the school-level roles below subtract them from their otherwise-full grant —
 * that keeps every pre-existing role's effective permissions unchanged.
 */
export const SUPER_ADMIN_ONLY = ['schools.read', 'schools.manage'];

const ALL_EXCEPT = (...excluded) =>
  PERMISSION_CATALOG.filter((p) => !excluded.includes(p.key)).map((p) => ({ key: p.key, scope: 'ALL' }));

export const SYSTEM_ROLES = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Platform administrator — manages schools and their School Admin accounts',
    grants: PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'ALL' })),
  },
  {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Manages day-to-day school operations',
    grants: ALL_EXCEPT('permissions.manage', 'fees.payments.refund', ...SUPER_ADMIN_ONLY),
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
      ['leave.read', 'ALL'],
      ['leave.review', 'ALL'],
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
      ['academics.structure.manage', 'ALL'],
      ['academics.read', 'ALL'],
      ['registrations.review', 'ALL'],
      ['cocurricular.read', 'ALL'],
      ['cocurricular.review', 'ALL'],
      ['profile.edit.review', 'ALL'],
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
      ['leave.read', 'OWN'],
      ['leave.review', 'OWN'],
      ['assignments.read', 'OWN'],
      ['assignments.manage', 'OWN'],
      ['submissions.grade', 'OWN'],
      ['materials.read', 'OWN'],
      ['materials.manage', 'OWN'],
      ['marks.read', 'OWN'],
      ['marks.enter', 'OWN'],
      ['marks.publish', 'OWN'],
      // Scoped OWN: the review queue and every decision are filtered to
      // electives in sections this teacher actually teaches.
      ['registrations.review', 'OWN'],
      // Class-teacher review of student-raised requests. OWN keeps each teacher
      // to the sections they are class teacher of.
      ['cocurricular.read', 'OWN'],
      ['cocurricular.review', 'OWN'],
      ['profile.edit.review', 'OWN'],
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
      // Grade/section/subject lists, for pickers. ALL because the structure is
      // school-wide by nature; what a teacher may *do* with a class is still
      // scoped OWN by every other permission above.
      ['academics.read', 'ALL'],
    ]),
  },
  {
    key: 'PARENT',
    name: 'Parent',
    description: "Views their own children's records",
    grants: grants([
      ['students.read', 'OWN'],
      ['attendance.read', 'OWN'],
      ['leave.read', 'OWN'],
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
      ['leave.apply', 'OWN'],
      ['leave.read', 'OWN'],
      ['registrations.apply', 'OWN'],
      ['cocurricular.read', 'OWN'],
      ['cocurricular.request', 'OWN'],
      ['profile.edit.request', 'OWN'],
      // The catalog itself isn't owned by anyone; OWN here means "your own
      // issued-books list", which listIssues() enforces server-side by
      // overriding any studentId a non-ALL-scope caller sends.
      ['library.read', 'OWN'],
      ['library.request', 'OWN'],
      ['transport.request', 'OWN'],
      ['assignments.read', 'OWN'],
      ['submissions.submit', 'OWN'],
      ['marks.read', 'OWN'],
      ['reportcards.read', 'OWN'],
      ['materials.read', 'OWN'],
      ['fees.read', 'OWN'],
      ['fees.pay', 'OWN'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['timetable.read', 'OWN'],
      // Helpdesk: students raise and follow their own tickets. OWN scope keeps
      // them to their own threads; replying to others stays staff-only.
      ['tickets.read', 'OWN'],
      ['tickets.create', 'OWN'],
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
      // Recording a payment is the role's day job. Without this the Finance
      // portal's "Record payment" action was hidden and POST /fees/payments
      // refused it, while every other fee capability was granted.
      ['fees.pay', 'ALL'],
      ['fees.payments.refund', 'ALL'],
      // Finance prepares and reviews; it does not approve. `fees.plan.approve`
      // and `fees.payments.approve` are deliberately absent — a payment Finance
      // registers stays PENDING_ADMIN_APPROVAL, and an installment plan it
      // reviews goes to an admin rather than live. Granting either key here
      // would undo the separation of duties the whole workflow exists for.
      ['fees.plan.request', 'ALL'],
      ['fees.plan.review', 'ALL'],
      ['announcements.read', 'ALL'],
      ['analytics.school.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
      // Fee structures are defined per academic year and grade.
      ['academics.read', 'ALL'],
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
      ['academics.read', 'ALL'],
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
      ['academics.read', 'ALL'],
    ]),
  },
];
