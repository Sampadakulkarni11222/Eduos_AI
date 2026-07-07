/**
 * One demo Account + Profile per system role, seeded by npm run seed so
 * every category of user in the system has something to log in with and
 * test permissions/scopes against immediately.
 *
 * Staff-type roles (OWNER/ADMIN/PRINCIPAL/TEACHER/FINANCE/LIBRARIAN/WARDEN)
 * get an email + password for POST /auth/login.
 * Guardian/student roles (PARENT/STUDENT) are phone-only — they sign in via
 * POST /auth/otp/request + /auth/otp/verify, matching how those roles are
 * expected to authenticate in production (no password set).
 */

export const DEMO_PASSWORD = 'ChangeMe@123!';

export const DEMO_USERS = [
  { roleKey: 'OWNER', displayName: 'Default Owner', phone: '+910000000000', email: 'owner@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'ADMIN', displayName: 'Demo Admin', phone: '+910000000001', email: 'admin@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'PRINCIPAL', displayName: 'Demo Principal', phone: '+910000000002', email: 'principal@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'TEACHER', displayName: 'Demo Teacher', phone: '+910000000003', email: 'teacher@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'FINANCE', displayName: 'Demo Finance', phone: '+910000000004', email: 'finance@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'LIBRARIAN', displayName: 'Demo Librarian', phone: '+910000000005', email: 'librarian@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'WARDEN', displayName: 'Demo Warden', phone: '+910000000006', email: 'warden@schoolerp.com', password: DEMO_PASSWORD },
  { roleKey: 'PARENT', displayName: 'Demo Parent', phone: '+910000000007', email: null, password: null },
  { roleKey: 'STUDENT', displayName: 'Demo Student', phone: '+910000000008', email: null, password: null },
];
