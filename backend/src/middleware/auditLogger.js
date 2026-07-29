import { AuditLog } from '../models/auditLog.model.js';

// The audit trail stores request bodies verbatim, so credential-bearing fields
// would otherwise be written to the database in plaintext (POST /auth/login
// carries the password; OTP verify carries the live code).
const SENSITIVE_FIELDS = new Set([
  'password', 'newPassword', 'currentPassword', 'confirmPassword',
  'code', 'otp', 'token', 'accessToken', 'refreshToken', 'idToken', 'secret',
]);

export function redact(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : redact(val, depth + 1);
  }
  return out;
}

const mapRouteToAction = (method, path, reqBody, resData) => {
  // Normalize path by removing /api/v1 and prefix/suffix slashes
  let p = path.replace(/^\/api\/v1/, '').replace(/^\/|\/$/g, '');

  let action = '';
  let entityType = '';
  let entityId = resData?.id || resData?._id || null;

  if (p.startsWith('auth/login')) {
    action = 'auth.login';
    entityType = 'Account';
  } else if (p.startsWith('auth/logout')) {
    action = 'auth.logout';
    entityType = 'Account';
  } else if (p.startsWith('auth/otp/verify') || p.startsWith('auth/otp/email/verify')) {
    action = 'auth.login';
    entityType = 'Account';
  } else if (p.startsWith('auth/profile/select')) {
    action = 'auth.profile_select';
    entityType = 'Profile';
    entityId = reqBody?.profileId || null;
  } else if (p.startsWith('students')) {
    entityType = 'Student';
    if (method === 'POST') action = 'student.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'student.update';
    else if (method === 'DELETE') action = 'student.delete';
  } else if (p.startsWith('attendance/mark')) {
    action = 'attendance.mark';
    entityType = 'Attendance';
  } else if (p.startsWith('assignments/grade')) {
    action = 'assignment.grade';
    entityType = 'Assignment';
    entityId = reqBody?.assignmentId || null;
  } else if (p.startsWith('assignments/submit')) {
    action = 'assignment.submit';
    entityType = 'Assignment';
    entityId = reqBody?.assignmentId || null;
  } else if (p.startsWith('assignments')) {
    entityType = 'Assignment';
    if (method === 'POST') action = 'assignment.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'assignment.update';
    else if (method === 'DELETE') action = 'assignment.delete';
  } else if (p.startsWith('admissions/leads')) {
    entityType = 'Lead';
    if (method === 'POST') action = 'lead.create';
    else action = 'lead.update';
  } else if (p.startsWith('fees/payments')) {
    action = 'fees.payment';
    entityType = 'Fee';
    entityId = reqBody?.invoiceId || null;
  } else if (p.startsWith('fees/invoices')) {
    entityType = 'Invoice';
    if (method === 'POST') action = 'invoice.create';
  } else if (p.startsWith('announcements')) {
    entityType = 'Announcement';
    if (method === 'POST') action = 'announcement.create';
  } else if (p.startsWith('tickets/reply')) {
    action = 'ticket.reply';
    entityType = 'Ticket';
    entityId = reqBody?.ticketId || null;
  } else if (p.startsWith('tickets')) {
    entityType = 'Ticket';
    if (method === 'POST') action = 'ticket.create';
  } else if (p.startsWith('medical')) {
    action = 'medical.save';
    entityType = 'MedicalRecord';
    entityId = reqBody?.studentId || null;
  } else if (p.startsWith('transport/routes')) {
    entityType = 'TransportRoute';
    if (method === 'POST') action = 'transport.createRoute';
  } else if (p.startsWith('transport/stops')) {
    entityType = 'TransportStop';
    if (method === 'POST') action = 'transport.createStop';
  } else if (p.startsWith('transport/enroll')) {
    action = 'transport.enroll';
    entityType = 'BusEnrollment';
    entityId = reqBody?.studentId || null;
  } else if (p.startsWith('library/books')) {
    entityType = 'Book';
    if (method === 'POST') action = 'library.createBook';
  } else if (p.startsWith('library/issues')) {
    entityType = 'BookIssue';
    if (method === 'POST') action = 'library.issueBook';
    else if (p.includes('return')) action = 'library.returnBook';
  } else if (p.startsWith('documents')) {
    entityType = 'Document';
    if (method === 'POST') action = 'document.create';
    else if (method === 'DELETE') action = 'document.delete';
  } else if (p.startsWith('hostel/rooms')) {
    entityType = 'HostelRoom';
    if (method === 'POST') action = 'hostel.createRoom';
  } else if (p.startsWith('hostel/allocations')) {
    entityType = 'HostelAllocation';
    if (method === 'POST') action = 'hostel.allocateRoom';
    else if (p.includes('vacate')) action = 'hostel.vacateRoom';
  }

  // Fallback generic mapper
  if (!action) {
    const parts = p.split('/');
    const resource = parts[0] || 'system';
    const singleName = resource.charAt(0).toUpperCase() + resource.slice(1).replace(/s$/, '');
    entityType = entityType || singleName;

    let suffix = 'update';
    if (method === 'POST') suffix = 'create';
    else if (method === 'DELETE') suffix = 'delete';
    action = `${resource}.${suffix}`;
  }

  return { action, entityType, entityId };
};

export const auditLogger = (req, res, next) => {
  // Only log write operations (POST, PUT, DELETE, PATCH)
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  const originalSend = res.send;
  res.send = function (body) {
    originalSend.apply(res, arguments);

    // Only audit successful requests (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      Promise.resolve().then(async () => {
        try {
          let parsedBody = {};
          if (typeof body === 'string') {
            try {
              parsedBody = JSON.parse(body);
            } catch (e) {}
          } else if (typeof body === 'object') {
            parsedBody = body;
          }

          const resData = parsedBody?.data || parsedBody;

          // Map the action
          const { action, entityType, entityId } = mapRouteToAction(
            req.method,
            req.originalUrl || req.url || req.path,
            req.body,
            resData
          );

          // Retrieve actor profile ID
          let actorProfileId = req.actor?.profileId || null;
          if (!actorProfileId) {
            // For login/verify actions, profile details might be in the response
            actorProfileId = resData?.profile?.id || resData?.profile?._id || null;
          }

          const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
          const safeBody = redact(req.body);

          await AuditLog.create({
            actorProfileId,
            action,
            entityType,
            entityId: entityId ? String(entityId) : null,
            before: req.method !== 'POST' ? safeBody : undefined,
            after: req.method !== 'DELETE' ? safeBody : undefined,
            channel: 'WEB',
            ip,
          });
        } catch (err) {
          console.error('Audit logger failed to store log:', err);
        }
      });
    }
  };

  next();
};
