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

  // Seats — what a school has bought, and what it may actually use.
  //
  // The same split as the fee-plan keys above, for the same reason: `.read` and
  // `.request` are what a school does about its own seats, and `.approve` is
  // the platform's authority to release them. A School Admin holds the first
  // two and must never hold the third — that is what stops a school allocating
  // itself seats by paying for them, and it is enforced by the grants below
  // rather than by anything in the UI. `.manage` is the platform's own act of
  // selling a school its base seats.
  { key: 'seats.read', group: 'admin', description: "View a school's seat purchase, allocation and history" },
  { key: 'seats.request', group: 'admin', description: 'Request extra seats for a school and pay for them' },
  { key: 'seats.manage', group: 'admin', description: 'Sell a school seats and correct its seat balance' },
  { key: 'seats.approve', group: 'admin', description: 'Approve or reject a paid extra-seat request' },
  // What a school pays per seat. Separate from `seats.manage` — selling a
  // school seats at the agreed rate and deciding what that rate IS are
  // different authorities, and only the second one changes what every future
  // request costs. A School Admin holds neither, so a school cannot price its
  // own seats; `seats.read` is what lets it see the rate it will be charged.
  { key: 'seats.pricing.manage', group: 'admin', description: "Set a school's per-seat price and manage its pricing history" },

  // How a school's portals look, and the option lists its forms offer.
  //
  // Reading is not here at all: the render-time theme endpoint carries no
  // permission, because every role has to paint its own portal and the payload
  // is the school's own branding. Reading the full configuration rides on the
  // existing `settings.manage`. This key is the authority to CHANGE it, and it
  // is platform-level for the reason the Settings screen has always given —
  // branding is managed by the EduOS team, not by each school. Widening that is
  // one edit: remove it from SUPER_ADMIN_ONLY below.
  { key: 'customization.manage', group: 'admin', description: "Configure a school's theme, branding and dropdown values" },

  // The address a school's portal is served at — a platform subdomain or the
  // school's own domain. `.read` lets a School Admin see its own address and
  // the DNS records it has to create; `.manage` is configuring, verifying and
  // activating one, which is the platform's call: an address going live
  // changes where a school's sign-in page is served from.
  { key: 'domains.read', group: 'admin', description: "View a school's domain and the DNS records it requires" },
  { key: 'domains.manage', group: 'admin', description: "Configure, verify and activate a school's subdomain or custom domain" },

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

  // ── Institution operations (see docs/erp-operations) ───────────────────
  //
  // Approvals. Who may decide a given stage is set by the stage itself (its
  // approver role, or a named approver, or a delegate); `approvals.decide` is
  // only the precondition for deciding anything at all. A requester can never
  // decide their own request, whatever they hold.
  { key: 'approvals.read', group: 'governance', description: 'View approval requests addressed to or raised by you (ALL: every request)' },
  { key: 'approvals.submit', group: 'governance', description: 'Raise an approval request' },
  { key: 'approvals.decide', group: 'governance', description: 'Approve, reject, return, delegate or escalate a request at a stage you are the approver of' },
  { key: 'approvals.configure', group: 'governance', description: 'Configure approval stages, thresholds and delegations' },
  { key: 'governance.read', group: 'governance', description: 'View board/committee meetings, agendas, minutes and resolutions you are invited to (ALL: every meeting)' },
  { key: 'governance.manage', group: 'governance', description: 'Schedule meetings, prepare agendas, record minutes, resolutions and actions' },

  // Institution profile and organization structure.
  { key: 'institution.read', group: 'organization', description: 'View the institution profile, affiliations and public disclosures' },
  { key: 'institution.manage', group: 'organization', description: 'Edit the institution profile, campuses, affiliations and terminology' },
  { key: 'org.read', group: 'organization', description: 'View the organization structure map' },
  { key: 'org.manage', group: 'organization', description: 'Manage departments, positions, reporting lines and appointments' },

  // Administration department.
  { key: 'correspondence.read', group: 'administration', description: 'View the inward/outward correspondence register (OWN: assigned items)' },
  { key: 'correspondence.manage', group: 'administration', description: 'Register, assign, draft replies to and dispatch correspondence' },
  { key: 'compliance.read', group: 'administration', description: 'View the compliance calendar, returns, licences, policies, notices and trainings' },
  { key: 'compliance.manage', group: 'administration', description: 'Prepare returns, track licences, publish policies, review notices and run trainings' },
  { key: 'contracts.read', group: 'administration', description: 'View agreements and their obligations' },
  { key: 'contracts.manage', group: 'administration', description: 'Draft, track and renew agreements' },
  { key: 'verification.read', group: 'administration', description: 'See clearance STATUS of staff, drivers and vendors (never the evidence)' },
  { key: 'verification.manage', group: 'administration', description: 'Run background verification checks and attach evidence' },
  { key: 'verification.decide', group: 'administration', description: 'Give the final institutional clearance decision' },
  { key: 'events.read', group: 'administration', description: 'View institutional events and their plans' },
  { key: 'events.manage', group: 'administration', description: 'Propose and run events, fests, meetings and visits' },
  { key: 'facilities.read', group: 'administration', description: 'View facilities, bookings and work orders' },
  { key: 'facilities.request', group: 'administration', description: 'Book a room or report a maintenance issue' },
  { key: 'facilities.manage', group: 'administration', description: 'Manage facilities, confirm bookings and run work orders' },
  // Raising a concern is open to every staff member and student; reading cases
  // is for designated officers only. Reports are never shown to anyone else.
  { key: 'safeguarding.report', group: 'sensitive', description: 'Report a safeguarding concern (you see only your own reports)' },
  { key: 'safeguarding.manage', group: 'sensitive', description: 'Designated officer: handle safeguarding, POCSO, POSH and anti-ragging cases' },

  // Finance operations.
  { key: 'payroll.read', group: 'finance', description: 'View payroll runs and totals (OWN: your own payslips)' },
  { key: 'payroll.prepare', group: 'finance', description: 'Maintain pay structures and statutory rules; calculate payroll runs' },
  { key: 'payroll.approve', group: 'finance', description: 'Approve a calculated payroll run' },
  { key: 'payroll.sensitive.read', group: 'sensitive', description: 'See salary components and bank details of other employees' },
  { key: 'procurement.read', group: 'finance', description: 'View purchase requests, orders, receipts and invoices (OWN: your requests)' },
  { key: 'procurement.request', group: 'finance', description: 'Raise a purchase request' },
  { key: 'procurement.manage', group: 'finance', description: 'Run procurement: quotes, orders, receipts, invoices and payment status' },
  { key: 'budget.read', group: 'finance', description: 'View budgets, commitments and actuals' },
  { key: 'budget.manage', group: 'finance', description: 'Prepare budgets and explain variances' },
  { key: 'funding.read', group: 'finance', description: 'View funding proposals, grants and loans' },
  { key: 'funding.manage', group: 'finance', description: 'Prepare funding proposals and compare offers' },

  // Marketing and admissions.
  { key: 'marketing.read', group: 'admissions', description: 'View campaigns, creative assets and enrolment analytics' },
  { key: 'marketing.manage', group: 'admissions', description: 'Plan campaigns and manage creative assets' },

  // Newsroom and community.
  { key: 'community.read', group: 'community', description: 'Read the institution newsroom and circles you belong to' },
  { key: 'community.post', group: 'community', description: 'Draft newsroom stories and post in circles' },
  { key: 'community.moderate', group: 'community', description: 'Review, publish, hide and take down posts and comments' },
  { key: 'mentoring.participate', group: 'community', description: 'Offer or request mentoring from seniors and alumni' },

  // Campus world.
  { key: 'campus.map.read', group: 'campus', description: 'Open the campus map (layers are limited by your other permissions)' },

  // Syllabus: modules, their timelines and what was taught.
  { key: 'syllabus.read', group: 'academics', description: 'See module plans and progress (OWN: your own classes or those of your children; ALL: the whole school)' },
  { key: 'syllabus.manage', group: 'academics', description: 'Plan modules and record what was taught (OWN: the subjects you teach)' },

  // Digital lectures and online meetings.
  { key: 'lectures.read', group: 'academics', description: 'See and join online classes and meetings you are invited to (ALL: every one in the school)' },
  { key: 'lectures.manage', group: 'academics', description: 'Schedule, change and cancel online classes and meetings (OWN: the ones you host)' },

  // Outbound messaging (WhatsApp/SMS/email) log and preferences.
  { key: 'messaging.read', group: 'communication', description: 'View the outbound message log and delivery states' },
  { key: 'messaging.manage', group: 'communication', description: 'Configure message templates and send operational notifications' },
  // ── School platform completion (feat/school-platform-complete) ──
  // Analytics workspace and quarterly decision reports.
  { key: 'analytics.workspace.read', group: 'analytics', description: 'Open the analytics workspace: department figures, custom periods and comparisons (ALL: every department; OWN: your own department or classes)' },
  { key: 'analytics.export', group: 'analytics', description: 'Download analytics tables as CSV or PDF (exports respect the same scope as the screen)' },
  { key: 'reports.quarterly.read', group: 'analytics', description: 'Read the quarterly decision reports addressed to you' },
  { key: 'reports.quarterly.manage', group: 'analytics', description: 'Configure, regenerate and distribute quarterly reports' },
  // Shared tasks and reminders (bills, renewals, services, inspections, follow-ups).
  { key: 'tasks.read', group: 'operations', description: 'See due items and reminders (OWN: assigned to you or your department; ALL: the whole school)' },
  { key: 'tasks.manage', group: 'operations', description: 'Create, assign, snooze, complete and escalate due items' },
  // Bills and service lifecycles.
  { key: 'bills.read', group: 'finance', description: 'See recurring bills, service contracts and their due dates' },
  { key: 'bills.manage', group: 'finance', description: 'Record bills, payments against them and service visits; configure recurrence' },
  // Science and computer laboratories.
  { key: 'labs.read', group: 'labs', description: 'See laboratories, stock, equipment and practical sessions (OWN: labs you are in charge of or sessions you teach)' },
  { key: 'labs.manage', group: 'labs', description: 'Run a lab: stock receipts, issue/return, stocktakes, equipment, calibration and practical sessions (OWN: labs you are in charge of)' },
  // Transport fleet, trips and checkpoints.
  { key: 'transport.fleet.manage', group: 'transport', description: 'Manage vehicles, their capacity, documents, services and breakdowns' },
  { key: 'transport.trips.operate', group: 'transport', description: 'Run trips: allocate seats, record boarding, alighting and safe handover (OWN: trips you are assigned to)' },
  { key: 'transport.tracking.read', group: 'transport', description: 'See live trip position and ETA (OWN: your own child\'s active trip only)' },
  { key: 'checkpoints.read', group: 'safety', description: 'See ID checkpoint events (gate, bus, lab, library) (OWN: your own child)' },
  { key: 'checkpoints.manage', group: 'safety', description: 'Manage ID cards and checkpoint devices; revoke lost cards' },
  { key: 'visitors.manage', group: 'safety', description: 'Register visitors and contractors, issue and close passes, authorise pickups' },
  // Optional camera event review (off until a school configures it).
  { key: 'camera.devices.manage', group: 'safety', description: 'Register cameras, approved locations and purposes, retention and health' },
  { key: 'camera.events.review', group: 'sensitive', description: 'Review unverified camera observations and decide on them (trained staff only)' },
  // PTM, review calls and parent–teacher conversations.
  { key: 'ptm.read', group: 'engagement', description: 'See PTM rounds and slots (OWN: your own bookings or your own slots)' },
  { key: 'ptm.manage', group: 'engagement', description: 'Create PTM rounds, set availability and run meetings (OWN: your own slots)' },
  { key: 'ptm.book', group: 'engagement', description: 'Book, reschedule or cancel a PTM slot for your own child' },
  { key: 'reviewcalls.manage', group: 'engagement', description: 'Open and follow up parent review calls and agreed actions (OWN: assigned to you)' },
  { key: 'conversations.use', group: 'engagement', description: 'Message about a child: parents with their child\'s teachers, teachers with the parents of their pupils' },
  // Staff cover and leave.
  { key: 'staffleave.apply', group: 'people', description: 'Apply for your own staff leave and see your balance' },
  { key: 'staffleave.manage', group: 'people', description: 'Approve staff leave, set leave policies and balances' },
  { key: 'cover.manage', group: 'people', description: 'Arrange substitute cover for absent teachers' },
  // Clubs, sports, arts and showcases.
  { key: 'clubs.read', group: 'activities', description: 'See clubs, teams, sessions and fixtures (OWN: the ones you belong to or your child\'s)' },
  { key: 'clubs.manage', group: 'activities', description: 'Run clubs and teams: sessions, attendance, fixtures and results (OWN: the ones you coach)' },
  { key: 'clubs.join', group: 'activities', description: 'Ask to join a club or team (for yourself or your child)' },
  { key: 'showcase.publish', group: 'activities', description: 'Prepare and publish achievement and top-ranker showcases' },
  // Alumni, digests and external publishing.
  { key: 'alumni.directory.read', group: 'community', description: 'Browse the alumni directory (only people who chose to be listed)' },
  { key: 'alumni.manage', group: 'community', description: 'Verify alumni, manage batches, reunions and transitions to alumni access' },
  { key: 'digest.read', group: 'community', description: 'Read the daily learning and trends digest' },
  { key: 'digest.manage', group: 'community', description: 'Choose approved sources and review digest items before they are published' },
  { key: 'social.publish', group: 'community', description: 'Send approved public newsroom posts to the school\'s connected social accounts' },
  { key: 'social.connect', group: 'community', description: 'Connect and disconnect the school\'s social media accounts' },
  // Sustainability, sanitation and recognition.
  { key: 'sustainability.read', group: 'sustainability', description: 'See greenery, waste, water and energy records and recognition progress' },
  { key: 'sustainability.manage', group: 'sustainability', description: 'Record measurements, trees, waste and sanitation checks; run eco-club activities' },
  { key: 'sustainability.verify', group: 'sustainability', description: 'Verify eco activities and award points' },
  // Report cards, admissions form, hostel passes, finance extras, AI drafts.
  { key: 'reportcards.manage', group: 'academics', description: 'Prepare, moderate and publish term report cards' },
  { key: 'hostel.outpass.request', group: 'hostel', description: 'Request an out-pass for yourself or your child' },
  { key: 'hostel.outpass.manage', group: 'hostel', description: 'Approve out-passes and record exit and return at the gate' },
  { key: 'fees.concessions.manage', group: 'fees', description: 'Define fee concessions and apply them (with approval)' },
  { key: 'accounts.export', group: 'finance', description: 'Export vouchers and GST summaries for the accountant (Tally-compatible)' },
  { key: 'ai.drafts.use', group: 'ai', description: 'Ask the assistant for a draft (letter, minutes, lesson plan, remarks) that you review before using' },
];

const grants = (pairs) => pairs.map(([key, scope]) => ({ key, scope }));

/**
 * Permission keys reserved for SUPER_ADMIN. They sit above a single school, so
 * the school-level roles below subtract them from their otherwise-full grant —
 * that keeps every pre-existing role's effective permissions unchanged.
 */
export const SUPER_ADMIN_ONLY = [
  'schools.read', 'schools.manage',
  'seats.manage', 'seats.approve', 'seats.pricing.manage',
  'customization.manage',
  'domains.manage',
];

/**
 * The assistant permission, withheld from SUPER_ADMIN.
 *
 * `ai.copilot.use` is the single gate on every way into the assistant — the
 * web agent, its confirmation and capability endpoints, the tutor, AI credits,
 * and both WhatsApp entry points all require it, and the MCP catalogue is
 * built only for an actor holding it. Withholding it here is therefore the
 * whole exclusion, enforced by the authorization layer every other role goes
 * through rather than by a SUPER_ADMIN branch in the AI code.
 *
 * Why exclude it at all: SUPER_ADMIN is a platform role that can act across
 * schools. Requests it makes without naming a school run outside any tenant,
 * where the tenant filter that confines every other caller is simply absent —
 * so an assistant answer could span schools. Writes are already refused in
 * that state (assertSchoolContext in agent/orchestrator.js), but the honest
 * position is that the assistant is a school-level tool and a platform
 * administrator has the console for platform work.
 *
 * Nothing else about SUPER_ADMIN changes: it keeps every other permission in
 * the catalog, including ai.insights.read, which drives the risk and analytics
 * screens rather than the assistant.
 */
export const AI_ASSISTANT_PERMISSION = 'ai.copilot.use';

/**
 * Authorities no general-purpose role receives by default.
 *
 * The school ADMIN otherwise holds nearly every key, and the platform
 * SUPER_ADMIN every key. These four are kept from both so that separation of
 * duties holds out of the box: Finance/HR prepare payroll and the Principal
 * approves it; salary and bank details stay with Finance/HR; safeguarding cases
 * stay with the designated officer (COMPLIANCE); the final clearance of a staff
 * member or driver is the Principal's. A school that wants otherwise grants the
 * key deliberately through Access & Permissions, which is audited.
 */
export const RESTRICTED_BY_DEFAULT = [
  'payroll.approve',
  // Camera observations about children are reviewed only by named, trained staff.
  'camera.events.review',
  // Preparing pay (structures, inputs, adjustments) belongs to finance and HR. An administrator
  // holding it could add an adjustment to their own line and send the run for approval.
  'payroll.prepare',
  'payroll.sensitive.read',
  'safeguarding.manage',
  'verification.decide',
];

/** Keys every staff role holds for the shared operations surfaces. */
const STAFF_OPERATIONS = [
  ['approvals.read', 'OWN'],
  ['approvals.submit', 'OWN'],
  ['facilities.read', 'ALL'],
  ['facilities.request', 'OWN'],
  ['procurement.request', 'OWN'],
  ['procurement.read', 'OWN'],
  ['payroll.read', 'OWN'],
  ['safeguarding.report', 'OWN'],
  ['events.read', 'ALL'],
  ['institution.read', 'ALL'],
  ['org.read', 'ALL'],
  ['community.read', 'ALL'],
  ['community.post', 'OWN'],
  ['campus.map.read', 'ALL'],
  ['lectures.read', 'OWN'],
  ['lectures.manage', 'OWN'],
];

/** Keys a student, parent or alumnus holds for the community surfaces. */
const FAMILY_COMMUNITY = [
  ['institution.read', 'ALL'],
  ['community.read', 'OWN'],
  ['campus.map.read', 'OWN'],
  ['safeguarding.report', 'OWN'],
  ['lectures.read', 'OWN'],
];

/** Later grants of the same key replace earlier ones. */
const merge = (...lists) => {
  const byKey = new Map();
  for (const list of lists) for (const [key, scope] of list) byKey.set(key, scope);
  return grants([...byKey.entries()]);
};

const ALL_EXCEPT = (...excluded) =>
  PERMISSION_CATALOG.filter((p) => !excluded.includes(p.key)).map((p) => ({ key: p.key, scope: 'ALL' }));

/**
 * Keys the platform role does not hold even though it holds the rest of the
 * catalogue: child-protection case files and individual salary and bank
 * details belong to the school, not to the platform operator.
 */
export const PLATFORM_WITHHELD = ['safeguarding.manage', 'payroll.sensitive.read', 'camera.events.review'];

export const SYSTEM_ROLES = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Platform administrator — manages schools and their School Admin accounts',
    // Platform support does not get child-protection cases or payroll
    // internals by default either — see RESTRICTED_BY_DEFAULT.
    grants: ALL_EXCEPT(AI_ASSISTANT_PERMISSION, ...PLATFORM_WITHHELD),
  },
  {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Manages day-to-day school operations',
    grants: ALL_EXCEPT('permissions.manage', 'fees.payments.refund', ...SUPER_ADMIN_ONLY, ...RESTRICTED_BY_DEFAULT),
  },
  {
    key: 'PRINCIPAL',
    name: 'Principal',
    description: 'Oversight across the whole school',
    grants: merge([
      // School platform completion.
      ['analytics.workspace.read', 'ALL'],
      ['analytics.export', 'ALL'],
      ['reports.quarterly.read', 'ALL'],
      ['reports.quarterly.manage', 'ALL'],
      ['tasks.read', 'ALL'],
      ['tasks.manage', 'ALL'],
      ['bills.read', 'ALL'],
      ['labs.read', 'ALL'],
      ['transport.tracking.read', 'ALL'],
      ['checkpoints.read', 'ALL'],
      ['visitors.manage', 'ALL'],
      ['ptm.read', 'ALL'],
      ['ptm.manage', 'ALL'],
      ['reviewcalls.manage', 'ALL'],
      ['conversations.use', 'ALL'],
      ['staffleave.apply', 'OWN'],
      ['staffleave.manage', 'ALL'],
      ['cover.manage', 'ALL'],
      ['clubs.read', 'ALL'],
      ['clubs.manage', 'ALL'],
      ['showcase.publish', 'ALL'],
      ['alumni.directory.read', 'ALL'],
      ['alumni.manage', 'ALL'],
      ['digest.read', 'ALL'],
      ['digest.manage', 'ALL'],
      ['social.publish', 'ALL'],
      ['sustainability.read', 'ALL'],
      ['sustainability.manage', 'ALL'],
      ['sustainability.verify', 'ALL'],
      ['reportcards.manage', 'ALL'],
      ['hostel.outpass.manage', 'ALL'],
      ['ai.drafts.use', 'ALL'],
      ['camera.events.review', 'ALL'],
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
    ], STAFF_OPERATIONS, [
      // The accountable approver. Decides at the stages addressed to the
      // principal; never at a stage on their own request.
      ['approvals.read', 'ALL'],
      ['approvals.decide', 'ALL'],
      ['approvals.configure', 'ALL'],
      ['governance.read', 'ALL'],
      ['governance.manage', 'ALL'],
      ['institution.manage', 'ALL'],
      ['correspondence.read', 'ALL'],
      ['compliance.read', 'ALL'],
      ['contracts.read', 'ALL'],
      ['verification.read', 'ALL'],
      ['verification.decide', 'ALL'],
      ['events.manage', 'ALL'],
      ['facilities.request', 'ALL'],
      ['payroll.read', 'ALL'],
      ['payroll.approve', 'ALL'],
      ['procurement.read', 'ALL'],
      ['budget.read', 'ALL'],
      ['funding.read', 'ALL'],
      ['marketing.read', 'ALL'],
      ['community.read', 'ALL'],
      ['community.post', 'ALL'],
      ['community.moderate', 'ALL'],
      ['messaging.read', 'ALL'],
      ['lectures.read', 'ALL'],
      ['lectures.manage', 'ALL'],
      ['syllabus.read', 'ALL'],
      ['syllabus.manage', 'ALL'],
    ]),
  },
  {
    key: 'TEACHER',
    name: 'Teacher',
    description: 'Manages their own classes',
    grants: merge([
      // School platform completion.
      ['analytics.workspace.read', 'OWN'],
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['labs.read', 'OWN'],
      ['labs.manage', 'OWN'],
      ['ptm.read', 'OWN'],
      ['ptm.manage', 'OWN'],
      ['reviewcalls.manage', 'OWN'],
      ['conversations.use', 'OWN'],
      ['staffleave.apply', 'OWN'],
      ['clubs.read', 'ALL'],
      ['clubs.manage', 'OWN'],
      ['digest.read', 'ALL'],
      ['sustainability.read', 'ALL'],
      ['sustainability.manage', 'OWN'],
      ['sustainability.verify', 'OWN'],
      ['reportcards.manage', 'OWN'],
      ['alumni.directory.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
      ['transport.trips.operate', 'OWN'],
      ['syllabus.read', 'OWN'],
      ['syllabus.manage', 'OWN'],
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
    ], STAFF_OPERATIONS),
  },
  {
    key: 'PARENT',
    name: 'Parent',
    description: "Views their own children's records",
    grants: merge([
      // School platform completion.
      ['ptm.read', 'OWN'],
      ['ptm.book', 'OWN'],
      ['conversations.use', 'OWN'],
      ['transport.tracking.read', 'OWN'],
      ['checkpoints.read', 'OWN'],
      ['clubs.read', 'OWN'],
      ['clubs.join', 'OWN'],
      ['hostel.outpass.request', 'OWN'],
      ['sustainability.read', 'ALL'],
      ['digest.read', 'ALL'],
      ['syllabus.read', 'OWN'],
      ['students.read', 'OWN'],
      ['attendance.read', 'OWN'],
      // A parent applies for leave and sees borrowed books for their own children only.
      ['leave.apply', 'OWN'],
      ['library.read', 'OWN'],
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
    ], FAMILY_COMMUNITY),
  },
  {
    key: 'STUDENT',
    name: 'Student',
    description: 'Views their own records',
    grants: merge([
      // School platform completion.
      ['clubs.read', 'OWN'],
      ['clubs.join', 'OWN'],
      ['sustainability.read', 'ALL'],
      ['digest.read', 'ALL'],
      ['alumni.directory.read', 'ALL'],
      ['hostel.outpass.request', 'OWN'],
      ['syllabus.read', 'OWN'],
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
    ], FAMILY_COMMUNITY, [['community.post', 'OWN'], ['mentoring.participate', 'OWN']]),
  },
  {
    key: 'FINANCE',
    name: 'Finance',
    description: 'Manages fees and payments',
    grants: merge([
      // School platform completion.
      ['analytics.workspace.read', 'OWN'],
      ['analytics.export', 'OWN'],
      ['reports.quarterly.read', 'OWN'],
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['bills.read', 'ALL'],
      ['bills.manage', 'ALL'],
      ['staffleave.apply', 'OWN'],
      ['fees.concessions.manage', 'ALL'],
      ['accounts.export', 'ALL'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
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
    ], STAFF_OPERATIONS, [
      // Prepares and pays; never approves its own payroll (payroll.approve is
      // the Principal's) — same separation as the fee approval workflow above.
      ['approvals.read', 'ALL'],
      ['approvals.decide', 'ALL'],
      ['payroll.read', 'ALL'],
      ['payroll.prepare', 'ALL'],
      ['payroll.sensitive.read', 'ALL'],
      ['procurement.read', 'ALL'],
      ['procurement.manage', 'ALL'],
      ['budget.read', 'ALL'],
      ['budget.manage', 'ALL'],
      ['funding.read', 'ALL'],
      ['funding.manage', 'ALL'],
      ['contracts.read', 'ALL'],
      ['verification.read', 'ALL'],
    ]),
  },
  {
    key: 'LIBRARIAN',
    name: 'Librarian',
    description: 'Manages the school library catalog and lending',
    grants: merge([
      // School platform completion.
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['staffleave.apply', 'OWN'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
      ['library.read', 'ALL'],
      ['library.manage', 'ALL'],
      ['students.read', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['tickets.read', 'ALL'],
      ['tickets.respond', 'ALL'],
      ['ai.copilot.use', 'ALL'],
      ['academics.read', 'ALL'],
    ], STAFF_OPERATIONS),
  },
  {
    key: 'WARDEN',
    name: 'Warden',
    description: 'Manages hostel facilities and student welfare',
    grants: merge([
      // School platform completion.
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['staffleave.apply', 'OWN'],
      ['hostel.outpass.manage', 'ALL'],
      ['checkpoints.read', 'ALL'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
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
    ], STAFF_OPERATIONS),
  },
  // ── Institution operations roles ───────────────────────────────────────
  {
    key: 'HR',
    name: 'HR & Payroll',
    description: 'Recruitment, staff records, verification and payroll preparation',
    grants: merge(STAFF_OPERATIONS, [
      // School platform completion.
      ['analytics.workspace.read', 'OWN'],
      ['reports.quarterly.read', 'OWN'],
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['staffleave.apply', 'OWN'],
      ['staffleave.manage', 'ALL'],
      ['cover.manage', 'ALL'],
      ['alumni.manage', 'ALL'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
      ['users.read', 'ALL'],
      ['org.manage', 'ALL'],
      ['payroll.read', 'ALL'],
      ['payroll.prepare', 'ALL'],
      ['payroll.sensitive.read', 'ALL'],
      ['verification.read', 'ALL'],
      ['verification.manage', 'ALL'],
      ['approvals.decide', 'ALL'],
      ['compliance.read', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
  {
    key: 'MARKETING',
    name: 'Marketing & Admissions',
    description: 'Campaigns, creative assets, enquiries, counselling and enrolment',
    grants: merge(STAFF_OPERATIONS, [
      // School platform completion.
      ['analytics.workspace.read', 'OWN'],
      ['tasks.read', 'OWN'],
      ['tasks.manage', 'OWN'],
      ['staffleave.apply', 'OWN'],
      ['showcase.publish', 'ALL'],
      ['social.publish', 'ALL'],
      ['alumni.directory.read', 'ALL'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
      ['admissions.read', 'ALL'],
      ['admissions.manage', 'ALL'],
      ['marketing.read', 'ALL'],
      ['marketing.manage', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['academics.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
  {
    key: 'COMPLIANCE',
    name: 'Compliance & Safeguarding Officer',
    description: 'Designated officer for safeguarding, statutory compliance, policies and training',
    grants: merge(STAFF_OPERATIONS, [
      // School platform completion.
      ['analytics.workspace.read', 'OWN'],
      ['reports.quarterly.read', 'OWN'],
      ['tasks.read', 'ALL'],
      ['tasks.manage', 'ALL'],
      ['bills.read', 'ALL'],
      ['staffleave.apply', 'OWN'],
      ['visitors.manage', 'ALL'],
      ['checkpoints.read', 'ALL'],
      ['camera.devices.manage', 'ALL'],
      ['camera.events.review', 'ALL'],
      ['sustainability.read', 'ALL'],
      ['sustainability.manage', 'ALL'],
      ['sustainability.verify', 'ALL'],
      ['digest.read', 'ALL'],
      ['ai.drafts.use', 'OWN'],
      ['users.read', 'ALL'],
      ['compliance.read', 'ALL'],
      ['compliance.manage', 'ALL'],
      ['safeguarding.manage', 'ALL'],
      // Newsroom reports and photo-consent flags are sent to the safeguarding
      // officer, who must be able to act on them.
      ['community.moderate', 'ALL'],
      ['correspondence.read', 'ALL'],
      ['contracts.read', 'ALL'],
      ['verification.read', 'ALL'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['ai.copilot.use', 'ALL'],
    ]),
  },
  {
    key: 'TRUSTEE',
    name: 'Trustee / Governing Body Member',
    description: 'Governance: meetings, resolutions, board-level approvals and institution health',
    grants: grants([
      // School platform completion.
      ['analytics.workspace.read', 'ALL'],
      ['reports.quarterly.read', 'OWN'],
      ['digest.read', 'ALL'],
      ['lectures.read', 'OWN'],
      ['governance.read', 'OWN'],
      ['approvals.read', 'OWN'],
      ['approvals.decide', 'OWN'],
      ['institution.read', 'ALL'],
      ['org.read', 'ALL'],
      ['budget.read', 'ALL'],
      ['funding.read', 'ALL'],
      ['compliance.read', 'ALL'],
      ['community.read', 'ALL'],
      ['campus.map.read', 'OWN'],
      ['announcements.read', 'ALL'],
      ['calendar.read', 'ALL'],
      ['ai.copilot.use', 'OWN'],
      // Every adult in the school can raise a concern; they see only their own reports.
      ['safeguarding.report', 'OWN'],
    ]),
  },
  {
    key: 'ALUMNUS',
    name: 'Alumnus',
    description: 'Verified former student: newsroom, alumni circles and mentoring',
    grants: merge(FAMILY_COMMUNITY, [
      // School platform completion.
      ['alumni.directory.read', 'ALL'],
      ['digest.read', 'ALL'],
      ['clubs.read', 'OWN'],
      ['community.post', 'OWN'],
      ['mentoring.participate', 'OWN'],
      ['ai.copilot.use', 'OWN'],
    ]),
  },
];
