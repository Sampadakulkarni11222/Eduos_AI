/**
 * Human-readable labels for audit-log action codes.
 *
 * The backend's auditLogger middleware emits dot-separated action strings
 * (e.g. "auth.login", "student.create"). This map turns them into labels
 * that non-technical users can scan without a decoder ring.
 */

const ACTION_LABELS: Record<string, string> = {
  // ── Auth ──
  'auth.login':           'User logged in',
  'auth.logout':          'User logged out',
  'auth.profile_select':  'Switched active profile',
  'auth.create':          'Account created',

  // ── Students ──
  'student.create':       'Student created',
  'student.update':       'Student updated',
  'student.delete':       'Student deleted',

  // ── Attendance ──
  'attendance.mark':      'Attendance marked',
  'attendance.create':    'Attendance recorded',

  // ── Assignments ──
  'assignment.create':    'Assignment created',
  'assignment.update':    'Assignment updated',
  'assignment.delete':    'Assignment deleted',
  'assignment.grade':     'Assignment graded',
  'assignment.submit':    'Assignment submitted',

  // ── Admissions ──
  'lead.create':          'Admission lead added',
  'lead.update':          'Admission lead updated',

  // ── Fees & Invoices ──
  'fees.payment':         'Payment recorded',
  'invoice.create':       'Invoice created',

  // ── Announcements ──
  'announcement.create':  'Announcement published',

  // ── Tickets ──
  'ticket.create':        'Support ticket raised',
  'ticket.reply':         'Ticket reply sent',

  // ── Medical ──
  'medical.save':         'Medical record saved',

  // ── Transport ──
  'transport.createRoute':'Transport route created',
  'transport.createStop': 'Transport stop added',
  'transport.enroll':     'Student enrolled in transport',

  // ── Library ──
  'library.createBook':   'Book added to library',
  'library.issueBook':    'Book issued',
  'library.returnBook':   'Book returned',

  // ── Documents ──
  'document.create':      'Document uploaded',
  'document.delete':      'Document deleted',

  // ── Hostel ──
  'hostel.createRoom':    'Hostel room created',
  'hostel.allocateRoom':  'Hostel room allocated',
  'hostel.vacateRoom':    'Hostel room vacated',

  // ── Enrollments ──
  'enrollments.create':   'Student enrolled in class',

  // ── Academics ──
  'academics.create':     'Academic record created',

  // ── Calendar ──
  'calendar.create':      'Calendar event created',

  // ── Exams ──
  'exams.create':         'Exam marks entered',

  // ── Users ──
  'users.create':         'User account created',

  // ── Roles / Permissions ──
  'roles.create':         'Role permission changed',
  'roles.delete':         'Role permission revoked',

  // ── AI ──
  'ai.create':            'AI action performed',

  // ── WhatsApp ──
  'whatsapp.create':      'WhatsApp message sent',
};

/**
 * Turn a technical action code like "auth.login" into a human label.
 * Falls back to auto-formatting: "foo.barBaz" → "Foo bar baz".
 */
export function humanAuditLabel(action: string): string {
  if (!action) return 'Unknown action';
  const mapped = ACTION_LABELS[action];
  if (mapped) return mapped;

  // Auto-format: split on dot, camelCase → spaces, title-case the first word
  const parts = action
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → spaces
    .replace(/[._]/g, ' ')                   // dots/underscores → spaces
    .toLowerCase()
    .trim();
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}
