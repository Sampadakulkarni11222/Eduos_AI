import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { sendSuccess } from '../../utils/response.js';
import * as halls from './examHalls.service.js';
import * as rooms from './rooms.service.js';

/**
 * @swagger
 * tags:
 *   - { name: Exam rooms, description: "Exam timetable and halls (rooms, seating, invigilators, status), Rooms & Classes (home rooms with history) and room shifts" }
 *
 * /exam-rooms/sittings:
 *   get: { summary: "Exam timetable (staff): papers with times, rooms, invigilators and status", tags: [Exam rooms], responses: { 200: { description: Papers } } }
 *   post: { summary: "Schedule a paper (exam office: any; teacher: a class test for a subject they teach), with clash checks and seating", tags: [Exam rooms], responses: { 201: { description: Scheduled } } }
 * /exam-rooms/my-exams:
 *   get: { summary: "A student's or parent's own exam timetable with room and own seat", tags: [Exam rooms], responses: { 200: { description: Own exams } } }
 * /exam-rooms/duties:
 *   get: { summary: "Invigilation duties (own; the exam office may ask for anyone or the whole roster)", tags: [Exam rooms], responses: { 200: { description: Duties } } }
 * /exam-rooms/rooms:
 *   get: { summary: "Rooms & Classes: each class's home room, strength against capacity, rooms and occupants, today's shifts", tags: [Exam rooms], responses: { 200: { description: Rooms and classes } } }
 * /exam-rooms/shifts:
 *   get: { summary: "Room shifts (requests and applied)", tags: [Exam rooms], responses: { 200: { description: Shifts } } }
 *   post: { summary: "Move a class to another room (administrator/principal apply; a teacher requests)", tags: [Exam rooms], responses: { 201: { description: Shift } } }
 */
const router = Router();
router.use(authenticate);

/** The route admits any of these keys (the service decides scope). */
const anyOf = (...keys) => (req, _res, next) => {
  const held = keys.map((k) => req.actor?.permissions?.[k]).filter(Boolean);
  if (!held.length) throw new AppError(`Missing permission: ${keys.join(' or ')}`, 403);
  req.scope = held.includes('ALL') ? 'ALL' : held[0];
  next();
};
const EXAM_WRITE = anyOf('exams.schedule', 'exams.manage');
const ROOM_WRITE = anyOf('facilities.manage', 'timetable.manage');
const SHIFT_WRITE = anyOf('facilities.request', 'facilities.manage', 'timetable.manage');
const read = requirePermission('timetable.read');
const ok = (fn, status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), 'OK', status));

// ── Exam timetable and halls ─────────────────────────────────────────────
router.get('/sittings', read, ok((req) => halls.listSittings(req.actor, req.query)));
router.post('/sittings', EXAM_WRITE, ok((req) => halls.createSitting(req.actor, req.body), 201));
router.get('/sittings/:id', read, ok((req) => halls.getSitting(req.actor, req.params.id)));
router.patch('/sittings/:id', EXAM_WRITE, ok((req) => halls.updateSitting(req.actor, req.params.id, req.body)));
router.delete('/sittings/:id', EXAM_WRITE, ok((req) => halls.deleteSitting(req.actor, req.params.id)));
router.post('/sittings/:id/venue', EXAM_WRITE, ok((req) => halls.changeVenue(req.actor, req.params.id, req.body)));
router.post('/sittings/:id/delay', EXAM_WRITE, ok((req) => halls.delaySitting(req.actor, req.params.id, req.body)));
router.post('/sittings/:id/status', EXAM_WRITE, ok((req) => halls.setStatus(req.actor, req.params.id, req.body)));
router.post('/sittings/:id/reseat', EXAM_WRITE, ok((req) => halls.reseat(req.actor, req.params.id, req.body)));
router.post('/sittings/:id/seat', EXAM_WRITE, ok((req) => halls.moveSeat(req.actor, req.params.id, req.body)));
router.get('/sittings/:id/door-list', read, ok((req) => halls.doorList(req.actor, req.params.id)));
router.get('/sittings/:id/seating.csv', read, asyncHandler(async (req, res) => {
  const out = await halls.seatingCsv(req.actor, req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.csv);
}));
router.get('/my-exams', read, ok((req) => halls.myExams(req.actor, req.query)));
router.get('/duties', read, ok((req) => halls.duties(req.actor, { ...req.query, all: req.query.all === 'true' })));
router.get('/invigilators', EXAM_WRITE, ok((req) => halls.invigilatorOptions(req.actor, req.query)));
router.get('/free-rooms', read, ok((req) => rooms.freeRooms(req.actor, { ...req.query, periods: req.query.periods ? String(req.query.periods).split(',').map(Number) : null })));

// ── Rooms & Classes ──────────────────────────────────────────────────────
router.get('/rooms', read, ok((req) => rooms.roomsAndClasses(req.actor, req.query)));
router.get('/rooms/where', read, ok((req) => rooms.sectionRoomOn(req.actor, req.query)));
router.get('/rooms/history/:sectionId', read, ok((req) => rooms.sectionHistory(req.actor, req.params.sectionId)));
router.put('/rooms/home', ROOM_WRITE, ok((req) => rooms.assignHomeRoom(req.actor, req.body)));
router.get('/settings', read, ok(() => rooms.getSettings()));
router.put('/settings', ROOM_WRITE, ok((req) => rooms.setSettings(req.actor, req.body)));

// ── Room shifts ──────────────────────────────────────────────────────────
router.get('/shifts', read, ok((req) => rooms.listShifts(req.actor, req.query)));
router.post('/shifts/check', SHIFT_WRITE, ok((req) => rooms.checkShift(req.actor, req.body)));
router.post('/shifts', SHIFT_WRITE, ok((req) => rooms.createShift(req.actor, req.body), 201));
router.post('/shifts/:id/decide', ROOM_WRITE, ok((req) => rooms.decideShift(req.actor, req.params.id, req.body)));
router.post('/shifts/:id/cancel', SHIFT_WRITE, ok((req) => rooms.cancelShift(req.actor, req.params.id, req.body)));

export default router;
