import type { RoleKey } from './types';

export interface NavItem {
  label: string;
  icon: string; // unicode glyph, matching the prototype's geometric marks
  href: string;
  badge?: string;
  ready: boolean; // false → ships in a later phase, renders disabled
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}
export interface Portal {
  /** Which role this portal is for. */
  role: RoleKey;
  /** Route segment under /(portal). */
  slug: string;
  /** body class that activates the accent theme in design-system.css. */
  themeClass:
    | 'role-admin'
    | 'role-teacher'
    | 'role-parent'
    | 'role-principal'
    | 'role-student'
    | 'role-super-admin'
    | 'role-librarian'
    | 'role-warden';
  label: string;
  sublabel: string;
  icon: string;
  nav: NavGroup[];
}

const item = (label: string, icon: string, href: string, opts: Partial<NavItem> = {}): NavItem => ({
  label, icon, href, ready: false, ...opts,
});

/** Roles that share the admin portal (owner sees the same surface). */
export const ROLE_TO_SLUG: Record<RoleKey, string> = {
  SUPER_ADMIN: 'super-admin',
  ADMIN: 'admin',
  TEACHER: 'teacher',
  PARENT: 'parent', STUDENT: 'student',
  PRINCIPAL: 'principal',
  FINANCE: 'finance', LIBRARIAN: 'librarian', WARDEN: 'warden',
};

export const PORTALS: Record<string, Portal> = {
  admin: {
    role: 'ADMIN', slug: 'admin', themeClass: 'role-admin',
    label: 'Admin Console', sublabel: 'Admin Console', icon: '🏛️',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', '◫', '/admin', { ready: true }),
        item('Tickets', '✉', '/admin/tickets', { ready: true }),
      ]},
      { title: 'PEOPLE', items: [
        item('User Management', '◉', '/admin/users', { ready: true }),
        item('Student Classes', '◑', '/admin/student-classes', { ready: true }),
        item('Teacher Classes', '◐', '/admin/teacher-classes', { ready: true }),
        item('Admission CRM', '◌', '/admin/admissions', { ready: true }),
        item('Medical Records', '✚', '/admin/medical', { ready: true }),
      ]},
      { title: 'ACADEMIC OPS', items: [
        item('Classroom Mgmt', '▦', '/admin/classrooms', { ready: true }),
        item('Subject Registrations', '⊕', '/admin/registrations', { ready: true }),
        item('Attendance', '☱', '/admin/attendance', { ready: true }),
        item('Calendar & Events', '▤', '/admin/calendar', { ready: true }),
        item('Timetable Builder', '▥', '/admin/timetable', { ready: true }),
      ]},
      { title: 'FINANCE', items: [ item('Payments & Fees', '₹', '/admin/payments', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', '◍', '/admin/announcements', { ready: true }),
        item('Library Books', '▢', '/admin/library', { ready: true }),
        item('Transport Routes', '⛒', '/admin/transport', { ready: true }),
        item('Documents', '🗎', '/admin/documents', { ready: true }),
      ]},
      { title: 'SYSTEM', items: [
        item('Audit Logs', '▷', '/admin/audit', { ready: true }),
        item('Access & Permissions', '🔐', '/admin/permissions', { ready: true }),
        item('Tenant Settings', '⚙', '/admin/settings', { ready: true }),
      ]},
    ],
  },
  teacher: {
    role: 'TEACHER', slug: 'teacher', themeClass: 'role-teacher',
    label: 'Teacher Portal', sublabel: 'Teacher Portal', icon: '👩‍🏫',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', '◫', '/teacher', { ready: true }) ]},
      { title: 'TEACHING', items: [
        item('My Classes', '◐', '/teacher/classes', { ready: true }),
        item('Attendance', '☱', '/teacher/attendance', { ready: true }),
        item('Timetable', '▥', '/teacher/timetable', { ready: true }),
        item('Assignments', '✎', '/teacher/assignments', { ready: true }),
        item('Exams & Performance', '◌', '/teacher/exams', { ready: true }),
      ]},
      { title: 'CONTENT', items: [ item('Course Material', '❑', '/teacher/material', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', '◍', '/teacher/announcements', { ready: true }),
        item('Calendar', '▤', '/teacher/calendar', { ready: true }),
        item('Parent Queries', '✉', '/teacher/tickets', { ready: true }),
      ]},
      { title: 'STUDENTS', items: [
        item('Subject Registrations', '⊕', '/teacher/registrations', { ready: true }),
        // Class-teacher approvals for the two things a student may raise about
        // their own record: co-curricular achievements and profile corrections.
        item('Student Requests', '✓', '/teacher/student-requests', { ready: true }),
        item('Medical Records', '✚', '/teacher/medical', { ready: true }),
      ]},
    ],
  },
  parent: {
    role: 'PARENT', slug: 'parent', themeClass: 'role-parent',
    label: 'Parent Portal', sublabel: 'Parent Portal', icon: '👨‍👩‍👧',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', '◳', '/parent', { ready: true }) ]},
      { title: 'MY CHILD', items: [
        item('Performance', '◉', '/parent/performance', { ready: true }),
        item('Student View', '◈', '/parent/student-view', { ready: true }),
        item('Attendance', '☱', '/parent/attendance', { ready: true }),
        item('Assignments', '✐', '/parent/assignments', { ready: true }),
        item('Timetable', '▥', '/parent/timetable', { ready: true }),
        item('Course Material', '❑', '/parent/material', { ready: true }),
        item('Study Help', '✦', '/parent/study-help', { ready: true }),
      ]},
      { title: 'SCHOOL LIFE', items: [
        item('Calendar & Events', '▤', '/parent/calendar', { ready: true }),
        item('Announcements', '◍', '/parent/announcements', { ready: true }),
        item('Medical Records', '✚', '/parent/medical', { ready: true }),
        item('Library', '▢', '/parent/library', { ready: true }),
        item('Transport', '⛒', '/parent/transport', { ready: true }),
      ]},
      { title: 'ACCOUNT', items: [
        item('Payments', '₹', '/parent/payments', { ready: true }),
        item('AI Credits', '✦', '/parent/ai-credits', { ready: true }),
        item('Documents', '🗎', '/parent/documents', { ready: true }),
        item('Support', '✉', '/parent/tickets', { ready: true }),
      ]},
    ],
  },
  student: {
    role: 'STUDENT', slug: 'student', themeClass: 'role-student',
    label: 'Student Portal', sublabel: 'Student Portal', icon: '🎒',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', '◳', '/student', { ready: true }) ]},
      { title: 'ACADEMICS', items: [
        item('Subject Registration', '⊕', '/student/subjects', { ready: true }),
        item('Timetable', '▥', '/student/timetable', { ready: true }),
        item('Assignments', '✐', '/student/assignments', { ready: true }),
        item('Performance', '◉', '/student/performance', { ready: true }),
        item('Attendance', '☱', '/student/attendance', { ready: true }),
        item('Course Material', '❑', '/student/material', { ready: true }),
        item('Study Help', '✦', '/student/study-help', { ready: true }),
      ]},
      { title: 'SCHOOL LIFE', items: [
        item('Calendar & Events', '▤', '/student/calendar', { ready: true }),
        item('Announcements', '◍', '/student/announcements', { ready: true }),
        item('Library', '▢', '/student/library', { ready: true }),
        item('Transport', '⛒', '/student/transport', { ready: true }),
        item('Documents', '🗎', '/student/documents', { ready: true }),
      ]},
      { title: 'ACCOUNT', items: [
        item('Payments', '₹', '/student/payments', { ready: true }),
        item('AI Credits', '✦', '/student/ai-credits', { ready: true }),
        item('My Profile', '◉', '/student/profile', { ready: true }),
        item('Help & Support', '✉', '/student/tickets', { ready: true }),
      ]},
    ],
  },
  principal: {
    role: 'PRINCIPAL', slug: 'principal', themeClass: 'role-principal',
    label: 'Principal Dashboard', sublabel: 'Leadership', icon: '🎓',
    nav: [
      { title: 'OVERVIEW', items: [ item('School Intelligence', '◫', '/principal', { ready: true }) ]},
      { title: 'ACADEMIC', items: [
        item('Performance & Risk', '◔', '/principal/risk', { ready: true }),
        item('Teacher Workload', '◐', '/principal/workload', { ready: true }),
      ]},
      { title: 'OPERATIONS', items: [
        item('Attendance Trends', '◷', '/principal/attendance', { ready: true }),
        item('Fee Health', '₹', '/principal/fees', { ready: true }),
      ]},
      { title: 'PEOPLE', items: [ item('Staff Directory', '◇', '/principal/staff', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', '◉', '/principal/announcements', { ready: true }),
        item('Escalated Tickets', '✉', '/principal/tickets', { ready: true }),
      ]},
      { title: 'GOVERNANCE', items: [ item('Audit Logs', '▷', '/principal/audit', { ready: true }) ]},
    ],
  },
  'super-admin': {
    role: 'SUPER_ADMIN', slug: 'super-admin', themeClass: 'role-super-admin',
    label: 'Super Admin Console', sublabel: 'Platform Administration', icon: '🛡️',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', '◫', '/super-admin', { ready: true }),
      ]},
      { title: 'SCHOOLS', items: [
        item('Schools & Admins', '🏫', '/super-admin/schools', { ready: true }),
        item('School Dashboards', '◪', '/super-admin/dashboards', { ready: true }),
      ]},
      { title: 'SYSTEM', items: [
        item('Audit Logs', '▷', '/super-admin/audit', { ready: true }),
        item('Access & Permissions', '🔐', '/super-admin/permissions', { ready: true }),
      ]},
    ],
  },
  librarian: {
    role: 'LIBRARIAN', slug: 'librarian', themeClass: 'role-librarian',
    label: 'Library Portal', sublabel: 'Lending & Catalog', icon: '📚',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', '◫', '/librarian', { ready: true }),
        item('Catalog & Lending', '▢', '/librarian/books', { ready: true }),
      ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', '◍', '/librarian/announcements', { ready: true }),
        item('Support Tickets', '✉', '/librarian/tickets', { ready: true }),
      ]},
    ],
  },
  warden: {
    role: 'WARDEN', slug: 'warden', themeClass: 'role-warden',
    label: 'Hostel Portal', sublabel: 'Warden Workspace', icon: '🔑',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', '◫', '/warden', { ready: true }),
        item('Room Management', '▦', '/warden/rooms', { ready: true }),
        item('Hostel Students', '◈', '/warden/students', { ready: true }),
      ]},
      { title: 'HEALTH & CARE', items: [
        item('Medical Records', '✚', '/warden/medical', { ready: true }),
      ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', '◍', '/warden/announcements', { ready: true }),
        item('Support Tickets', '✉', '/warden/tickets', { ready: true }),
      ]},
    ],
  },
  finance: {
    role: 'FINANCE', slug: 'finance', themeClass: 'role-admin',
    label: 'Finance Portal', sublabel: 'Finance Operations', icon: '💰',
    nav: [
      { title: 'WORKSPACE', items: [
        { label: 'Dashboard', icon: '◫', href: '/finance', ready: true },
      ]},
      { title: 'FINANCE', items: [
        { label: 'Payments & Fees', icon: '₹', href: '/finance/payments', ready: true },
        { label: 'Reports', icon: '📊', href: '/finance/reports', ready: true }
      ]}
    ],
  },
};

export function portalForRole(role: RoleKey): Portal {
  return PORTALS[ROLE_TO_SLUG[role]];
}
