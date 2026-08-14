import type { RoleKey } from './types';

export interface NavItem {
  label: string;
  icon: string; // unicode glyph, matching the prototype's geometric marks
  href: string;
  badge?: string;
  ready: boolean; // false ΓåÆ ships in a later phase, renders disabled
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
    | 'role-owner'
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
  ADMIN: 'admin', OWNER: 'owner',
  TEACHER: 'teacher',
  PARENT: 'parent', STUDENT: 'student',
  PRINCIPAL: 'principal',
  FINANCE: 'finance', LIBRARIAN: 'librarian', WARDEN: 'warden',
};

export const PORTALS: Record<string, Portal> = {
  admin: {
    role: 'ADMIN', slug: 'admin', themeClass: 'role-admin',
    label: 'Admin Console', sublabel: 'Admin Console', icon: '≡ƒÅ¢∩╕Å',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', 'Γù½', '/admin', { ready: true }),
        item('Tickets', 'Γ£ë', '/admin/tickets', { ready: true }),
      ]},
      { title: 'PEOPLE', items: [
        item('User Management', 'Γùë', '/admin/users', { ready: true }),
        item('Student Classes', 'Γùæ', '/admin/student-classes', { ready: true }),
        item('Teacher Classes', 'ΓùÉ', '/admin/teacher-classes', { ready: true }),
        item('Admission CRM', 'Γùî', '/admin/admissions', { ready: true }),
        item('Medical Records', 'Γ£Ü', '/admin/medical', { ready: true }),
        item('Incident Reports', 'ΓÜæ', '/admin/incidents', { ready: true }),
      ]},
      { title: 'ACADEMIC OPS', items: [
        item('Classroom Mgmt', 'Γûª', '/admin/classrooms', { ready: true }),
        item('Attendance', 'Γÿ▒', '/admin/attendance', { ready: true }),
        item('Leave Applications', 'Γèÿ', '/admin/leave', { ready: true }),
        item('Calendar & Events', 'Γûñ', '/admin/calendar', { ready: true }),
        item('Timetable Builder', 'ΓûÑ', '/admin/timetable', { ready: true }),
      ]},
      { title: 'FINANCE', items: [ item('Payments & Fees', 'Γé╣', '/admin/payments', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', 'Γùì', '/admin/announcements', { ready: true }),
        item('Library Books', 'Γûó', '/admin/library', { ready: true }),
        item('Transport Routes', 'Γ¢Æ', '/admin/transport', { ready: true }),
        item('Documents', '≡ƒùÄ', '/admin/documents', { ready: true }),
      ]},
      { title: 'SYSTEM', items: [
        item('Audit Logs', 'Γû╖', '/admin/audit', { ready: true }),
        item('Access & Permissions', '≡ƒöÉ', '/admin/permissions', { ready: true }),
        item('Tenant Settings', 'ΓÜÖ', '/admin/settings', { ready: true }),
      ]},
    ],
  },
  teacher: {
    role: 'TEACHER', slug: 'teacher', themeClass: 'role-teacher',
    label: 'Teacher Portal', sublabel: 'Teacher Portal', icon: '≡ƒæ⌐ΓÇì≡ƒÅ½',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', 'Γù½', '/teacher', { ready: true }) ]},
      { title: 'TEACHING', items: [
        item('My Classes', 'ΓùÉ', '/teacher/classes', { ready: true }),
        item('Attendance', 'Γÿ▒', '/teacher/attendance', { ready: true }),
        item('Leave Applications', 'Γèÿ', '/teacher/leave', { ready: true }),
        item('Timetable', 'ΓûÑ', '/teacher/timetable', { ready: true }),
        item('Assignments', 'Γ£Ä', '/teacher/assignments', { ready: true }),
        item('Exams & Performance', 'Γùî', '/teacher/exams', { ready: true }),
      ]},
      { title: 'CONTENT', items: [ item('Course Material', 'Γ¥æ', '/teacher/material', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', 'Γùì', '/teacher/announcements', { ready: true }),
        item('Calendar', 'Γûñ', '/teacher/calendar', { ready: true }),
        item('Messages', 'Γ£ë', '/teacher/messages', { ready: true }),
        item('Parent Queries', 'Γ£ë', '/teacher/tickets', { ready: true }),
      ]},
      { title: 'STUDENTS', items: [
        item('Medical Records', 'Γ£Ü', '/teacher/medical', { ready: true }),
        item('Incidents', 'ΓÜæ', '/teacher/incidents', { ready: true }),
      ]},
    ],
  },
  parent: {
    role: 'PARENT', slug: 'parent', themeClass: 'role-parent',
    label: 'Parent Portal', sublabel: 'Parent Portal', icon: '≡ƒæ¿ΓÇì≡ƒæ⌐ΓÇì≡ƒæº',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', 'Γù│', '/parent', { ready: true }) ]},
      { title: 'MY CHILD', items: [
        item('Performance', 'Γùë', '/parent/performance', { ready: true }),
        item('Student View', 'Γùê', '/parent/student-view', { ready: true }),
        item('Attendance', 'Γÿ▒', '/parent/attendance', { ready: true }),
        item('Assignments', 'Γ£É', '/parent/assignments', { ready: true }),
        item('Timetable', 'ΓûÑ', '/parent/timetable', { ready: true }),
        item('Course Material', 'Γ¥æ', '/parent/material', { ready: true }),
        item('Study Help', 'Γ£ª', '/parent/study-help', { ready: true }),
      ]},
      { title: 'SCHOOL LIFE', items: [
        item('Calendar & Events', 'Γûñ', '/parent/calendar', { ready: true }),
        item('Announcements', 'Γùì', '/parent/announcements', { ready: true }),
        item('Medical Records', 'Γ£Ü', '/parent/medical', { ready: true }),
        item('Library', 'Γûó', '/parent/library', { ready: true }),
        item('Transport', 'Γ¢Æ', '/parent/transport', { ready: true }),
        item('Hostel Pass', '≡ƒÜ¬', '/parent/hostel-pass', { ready: true }),
      ]},
      { title: 'ACCOUNT', items: [
        item('Payments', 'Γé╣', '/parent/payments', { ready: true }),
        item('AI Credits', 'Γ¥å', '/parent/ai-credits', { ready: true }),
        item('Documents', '≡ƒù╕', '/parent/documents', { ready: true }),
        item('Messages', 'Γ£ë', '/parent/messages', { ready: true }),
        item('Support', 'Γ£ë', '/parent/tickets', { ready: true }),
      ]},
    ],
  },
  student: {
    role: 'STUDENT', slug: 'student', themeClass: 'role-student',
    label: 'Student Portal', sublabel: 'Student Portal', icon: '≡ƒÄÆ',
    nav: [
      { title: 'WORKSPACE', items: [ item('Dashboard', 'Γù│', '/student', { ready: true }) ]},
      { title: 'ACADEMICS', items: [
        item('Timetable', 'ΓûÑ', '/student/timetable', { ready: true }),
        item('Assignments', 'Γ£É', '/student/assignments', { ready: true }),
        item('Performance', 'Γùë', '/student/performance', { ready: true }),
        item('Attendance', 'Γÿ▒', '/student/attendance', { ready: true }),
        item('Course Material', 'Γ¥æ', '/student/material', { ready: true }),
        item('Study Help', 'Γ£ª', '/student/study-help', { ready: true }),
      ]},
      { title: 'SCHOOL LIFE', items: [
        item('Calendar & Events', 'Γûñ', '/student/calendar', { ready: true }),
        item('Announcements', 'Γùì', '/student/announcements', { ready: true }),
        item('Library', 'Γûó', '/student/library', { ready: true }),
        item('Transport', 'Γ¢Æ', '/student/transport', { ready: true }),
        item('Documents', '≡ƒùÄ', '/student/documents', { ready: true }),
        item('Hostel Pass', '≡ƒÜ¬', '/student/hostel-pass', { ready: true }),
      ]},
      { title: 'ACCOUNT', items: [
        item('Payments', 'Γé╣', '/student/payments', { ready: true }),
        item('AI Credits', 'Γ£ª', '/student/ai-credits', { ready: true }),
        item('My Profile', 'Γùë', '/student/profile', { ready: true }),
        item('Help & Support', 'Γ£ë', '/student/tickets', { ready: true }),
      ]},
    ],
  },
  principal: {
    role: 'PRINCIPAL', slug: 'principal', themeClass: 'role-principal',
    label: 'Principal Dashboard', sublabel: 'Leadership', icon: '≡ƒÄô',
    nav: [
      { title: 'OVERVIEW', items: [ item('School Intelligence', 'Γù½', '/principal', { ready: true }) ]},
      { title: 'ACADEMIC', items: [
        item('Performance & Risk', 'Γùö', '/principal/risk', { ready: true }),
        item('Teacher Workload', 'ΓùÉ', '/principal/workload', { ready: true }),
      ]},
      { title: 'OPERATIONS', items: [
        item('Attendance Trends', 'Γù╖', '/principal/attendance', { ready: true }),
        item('Fee Health', 'Γé╣', '/principal/fees', { ready: true }),
      ]},
      { title: 'PEOPLE', items: [ item('Staff Directory', 'Γùç', '/principal/staff', { ready: true }) ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', 'Γùë', '/principal/announcements', { ready: true }),
        item('Escalated Tickets', 'Γ£ë', '/principal/tickets', { ready: true }),
      ]},
      { title: 'GOVERNANCE', items: [ item('Audit Logs', 'Γû╖', '/principal/audit', { ready: true }) ]},
    ],
  },
  owner: {
    role: 'OWNER', slug: 'owner', themeClass: 'role-owner',
    label: 'Owner Console', sublabel: 'Governance & Analytics', icon: '≡ƒææ',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', 'Γù½', '/owner', { ready: true }),
        item('Admissions CRM', 'Γùî', '/owner/admissions', { ready: true }),
      ]},
      { title: 'SYSTEM', items: [
        item('Audit Logs', 'Γû╖', '/owner/audit', { ready: true }),
        item('Access & Permissions', '≡ƒöÉ', '/owner/permissions', { ready: true }),
        item('Tenant Settings', 'ΓÜÖ', '/owner/settings', { ready: true }),
      ]},
    ],
  },
  librarian: {
    role: 'LIBRARIAN', slug: 'librarian', themeClass: 'role-librarian',
    label: 'Library Portal', sublabel: 'Lending & Catalog', icon: '≡ƒôÜ',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', 'Γù½', '/librarian', { ready: true }),
        item('Catalog & Lending', 'Γûó', '/librarian/books', { ready: true }),
      ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', 'Γùì', '/librarian/announcements', { ready: true }),
        item('Support Tickets', 'Γ£ë', '/librarian/tickets', { ready: true }),
      ]},
    ],
  },
  warden: {
    role: 'WARDEN', slug: 'warden', themeClass: 'role-warden',
    label: 'Hostel Portal', sublabel: 'Warden Workspace', icon: '≡ƒöæ',
    nav: [
      { title: 'WORKSPACE', items: [
        item('Dashboard', 'Γù½', '/warden', { ready: true }),
        item('Room Management', 'Γûª', '/warden/rooms', { ready: true }),
        item('Hostel Students', 'Γùê', '/warden/students', { ready: true }),
        item('Hostel Passes', '≡ƒÜ¬', '/warden/passes', { ready: true }),
      ]},
      { title: 'HEALTH & CARE', items: [
        item('Medical Records', 'Γ£Ü', '/warden/medical', { ready: true }),
        item('Incidents', 'ΓÜæ', '/warden/incidents', { ready: true }),
      ]},
      { title: 'COMMUNICATION', items: [
        item('Announcements', 'Γùì', '/warden/announcements', { ready: true }),
        item('Support Tickets', 'Γ£ë', '/warden/tickets', { ready: true }),
      ]},
    ],
  },
  finance: {
    role: 'FINANCE', slug: 'finance', themeClass: 'role-admin',
    label: 'Finance Portal', sublabel: 'Finance Operations', icon: '≡ƒÆ░',
    nav: [
      { title: 'WORKSPACE', items: [
        { label: 'Dashboard', icon: 'Γù½', href: '/finance', ready: true },
      ]},
      { title: 'FINANCE', items: [
        { label: 'Payments & Fees', icon: 'Γé╣', href: '/finance/payments', ready: true },
        { label: 'Reports', icon: '≡ƒôè', href: '/finance/reports', ready: true }
      ]}
    ],
  },
};

export function portalForRole(role: RoleKey): Portal {
  return PORTALS[ROLE_TO_SLUG[role]];
}
