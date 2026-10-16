import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { sendSuccess } from '../../utils/response.js';
import * as campus from './campus.service.js';
import { campusLayers } from './layers.service.js';
import { liveDetail, myView } from './live-detail.service.js';
import { campusMoment, momentFromQuery } from './moment.service.js';
import { ownStudentIds } from '../safety/shared.js';
import { Enrollment } from '../../models/student.model.js';
import * as insights from '../insights/insights.service.js';
import { pulse } from '../insights/pulse.service.js';
import { roleDashboard } from '../insights/dashboards.service.js';
import { inbox as approvalInbox } from '../approvals/approval.service.js';
import { shortCache, permissionKey, BOARD_CACHE_MS } from '../../utils/shortCache.js';

/**
 * @swagger
 * tags:
 *   - { name: Campus, description: Permission-filtered campus world (buildings, rooms, scheduled use, bookings, maintenance) }
 *   - { name: Insights, description: Role home screens and the principal's daily briefing }
 */
export const campusRouter = Router();
// Live answers are polled every 15 seconds while open; a short cache absorbs double clicks without going stale.
const LIVE_CACHE_MS = Math.min(BOARD_CACHE_MS, 5000);
campusRouter.use(authenticate);
// The map depends on the school, the reader's role and grants, and the options —
// nothing personal — so readers with the same grants share one answer for a few seconds.
campusRouter.get('/map', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const opts = { campusCode: req.query.campusCode || undefined, at: req.query.at || null, date: req.query.date || null };
  // Families get their own class's numbers in the day plan, so their answer is their own.
  const who = ['PARENT', 'STUDENT'].includes(req.actor.roleKey) ? `${req.actor.profileId}:` : '';
  const key = `campus:${req.actor.tenantId}:${who}${req.actor.roleKey}:${permissionKey(req.actor.permissions)}:${opts.campusCode ?? ''}:${opts.at ?? ''}:${opts.date ?? ''}`;
  sendSuccess(res, await shortCache(key, BOARD_CACHE_MS, () => campus.campusMap(req.actor, opts)));
}));
// Operational layers (labs, transport bay, cover, tasks, gate, activities, greenery),
// each limited to readers whose permissions allow the underlying read. Readers whose
// labs or tasks are scoped to their own records get an answer of their own.
campusRouter.get('/layers', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const a = req.actor;
  const own = a.permissions?.['labs.read'] === 'OWN' || a.permissions?.['tasks.read'] === 'OWN';
  const key = `campus-layers:${a.tenantId}:${own ? a.profileId : `${a.roleKey}:${permissionKey(a.permissions)}`}`;
  sendSuccess(res, await shortCache(key, BOARD_CACHE_MS, () => campusLayers(a)));
}));
// Live detail of one room, class, teacher, bus, lab, department, zone or the gate,
// limited to what the reader may see (families: their own class only). Personal
// answers, so each reader gets their own for a few seconds.
campusRouter.get('/live', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const a = req.actor;
  const kind = String(req.query.kind ?? '');
  const id = req.query.id ? String(req.query.id) : null;
  sendSuccess(res, await shortCache(`campus-live:${a.tenantId}:${a.profileId}:${kind}:${id ?? ''}`, LIVE_CACHE_MS, () => liveDetail(a, { kind, id })));
}));
// The reader's own corner of the campus: a parent's child's class, a student's
// own class, a teacher's current and next class, a staff member's departments.
campusRouter.get('/my-view', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const a = req.actor;
  const studentId = req.query.studentId ? String(req.query.studentId) : null;
  sendSuccess(res, await shortCache(`campus-mine:${a.tenantId}:${a.profileId}:${studentId ?? ''}`, LIVE_CACHE_MS, () => myView(a, { studentId })));
}));
// The school day at a moment (now, or a date and time staff pick): open or closed, each
// shift's bell, where each class is. Families: now only, with numbers for their own class.
campusRouter.get('/moment', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const a = req.actor;
  const family = ['PARENT', 'STUDENT', 'ALUMNUS'].includes(a.roleKey);
  const at = family ? null : momentFromQuery({ date: req.query.date || null, at: req.query.at || null });
  const ownSectionIds = new Set();
  if (a.roleKey === 'PARENT' || a.roleKey === 'STUDENT') {
    const kids = await ownStudentIds(a);
    if (kids.length) for (const e of await Enrollment.find({ studentId: { $in: kids }, status: 'ACTIVE' }).select('sectionId').lean()) ownSectionIds.add(String(e.sectionId));
  }
  const key = `campus-moment:${a.tenantId}:${family ? a.profileId : 'staff'}:${req.query.date ?? ''}:${req.query.at ?? ''}`;
  sendSuccess(res, await shortCache(key, LIVE_CACHE_MS, () => campusMoment({ at: at ?? new Date(), viewer: { family, ownSectionIds } })));
}));
campusRouter.get('/facilities/:id', requirePermission('campus.map.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await campus.facilityDetail(req.actor, req.params.id, { at: req.query.at || null }))));

export const insightsRouter = Router();
insightsRouter.use(authenticate);
insightsRouter.get('/home', asyncHandler(async (req, res) =>
  sendSuccess(res, await shortCache(`home:${req.actor.tenantId}:${req.actor.profileId}`, BOARD_CACHE_MS, () => insights.home(req.actor)))));
// Charts, activity, department tiles and a briefing, each limited to what the caller may read.
insightsRouter.get('/pulse', asyncHandler(async (req, res) => {
  sendSuccess(res, await shortCache(`pulse:${req.actor.tenantId}:${req.actor.profileId}`, BOARD_CACHE_MS, async () => {
    const decisions = req.actor.permissions?.['approvals.read'] ? (await approvalInbox(req.actor).catch(() => [])).length : 0;
    return pulse(req.actor, { decisions });
  }));
}));
// The signed-in person's own dashboard (teacher's classes, a parent's child, a student's record,
// a staff role's queue). Scope is decided in the service from the session; a parent may name one
// of their own children. Cached per person, child and period like the pulse board.
insightsRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 0;
  const child = typeof req.query.child === 'string' && /^[a-f0-9]{24}$/i.test(req.query.child) ? req.query.child : null;
  if (req.query.child && !child) throw new AppError('child must be a student id', 400, [], 'BAD_CHILD');
  return sendSuccess(res, await shortCache(`dashboard:${req.actor.tenantId}:${req.actor.profileId}:${child ?? ''}:${days}`, BOARD_CACHE_MS, () => roleDashboard(req.actor, { days, child })));
}));
