import { registerMetric } from '../analytics/catalogue.js';
import { ClubMembership, ClubSession } from '../../models/club.model.js';
import { Section } from '../../models/academics.model.js';
import { within, earliest, pct, asOf, onRollAt } from '../analytics/metrics/helpers.js';

/**
 * Clubs and co-curricular metrics (engagement department). Counts only: no
 * student names leave this file.
 */

const since = (ctx) => ctx.memo('clubsSince', () => earliest(ClubSession, 'startsAt'));

registerMetric({
  key: 'engagement.club_participation', department: 'engagement', label: 'Students in at least one club',
  definition: 'Students on roll at the end of the period who were members of at least one club or team then (joined on or before it and not left), as a share of students on roll. Broken down by grade.',
  numerator: 'Students on roll who were club members', denominator: 'Students on roll',
  unit: 'percent', kind: 'stock', dateBasis: 'As of the last day of the period', sources: ['ClubMembership', 'Enrollment'], link: '/clubs', version: 1,
  since: (ctx) => ctx.memo('clubMemberSince', () => earliest(ClubMembership, 'joinedAt')),
  compute: async (ctx) => {
    const at = asOf(ctx.period);
    const { rows } = await onRollAt(ctx, at);
    if (!rows.length) return { value: null, records: 0, note: 'No students on roll then.' };
    const members = await ClubMembership.find({
      joinedAt: { $ne: null, $lte: at },
      $or: [{ status: 'ACTIVE' }, { status: 'LEFT', leftAt: { $gt: at } }],
    }).select('studentId').lean();
    const inClub = new Set(members.map((m) => String(m.studentId)));
    const sections = new Map((await Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).populate('gradeId', 'name level').lean()).map((s) => [String(s._id), s.gradeId]));
    const byGrade = new Map();
    for (const r of rows) {
      const g = sections.get(String(r.sectionId));
      const key = g?.name ?? 'Unknown';
      const t = byGrade.get(key) ?? { level: g?.level ?? 99, on: 0, members: 0 };
      t.on += 1;
      if (inClub.has(String(r.studentId))) t.members += 1;
      byGrade.set(key, t);
    }
    const yes = rows.filter((r) => inClub.has(String(r.studentId))).length;
    return {
      value: pct(yes, rows.length), records: rows.length, detail: { members: yes, onRoll: rows.length },
      breakdown: [...byGrade.entries()].sort((a, b) => a[1].level - b[1].level).map(([label, t]) => ({ label, value: pct(t.members, t.on) })),
    };
  },
});

registerMetric({
  key: 'engagement.club_sessions_held', department: 'engagement', label: 'Club sessions held as planned',
  definition: 'Of the club sessions scheduled to start in the period (and already started), the share held with the register taken. Cancelled sessions and sessions with no register count as not held.',
  numerator: 'Sessions held (register taken)', denominator: 'Sessions scheduled',
  unit: 'percent', kind: 'flow', dateBasis: 'Session start', sources: ['ClubSession'], link: '/clubs', version: 1,
  since,
  compute: async (ctx) => {
    const end = ctx.period.end < ctx.now ? ctx.period.end : ctx.now;
    const rows = await ClubSession.find({ startsAt: { $gte: ctx.period.start, $lt: end } }).select('status').lean();
    const held = rows.filter((r) => r.status === 'HELD').length;
    const cancelled = rows.filter((r) => r.status === 'CANCELLED').length;
    return {
      value: pct(held, rows.length), records: rows.length, detail: { planned: rows.length, held, cancelled, notRecorded: rows.length - held - cancelled },
      breakdown: [{ label: 'Held', value: held }, { label: 'Cancelled', value: cancelled }, { label: 'No register', value: rows.length - held - cancelled }],
    };
  },
});

registerMetric({
  key: 'engagement.club_attendance', department: 'engagement', label: 'Attendance at club sessions',
  definition: 'Present marks as a share of all marks in the club registers of sessions held in the period. Excused absences count as marks.',
  numerator: 'Present marks', denominator: 'All register marks',
  unit: 'percent', kind: 'flow', dateBasis: 'Session start', sources: ['ClubSession.attendance'], link: '/clubs', version: 1,
  since,
  compute: async (ctx) => {
    const rows = await ClubSession.find({ ...within('startsAt', ctx.period), status: 'HELD' }).select('attendance').lean();
    const marks = rows.flatMap((r) => r.attendance ?? []);
    const present = marks.filter((m) => m.status === 'PRESENT').length;
    return { value: pct(present, marks.length), records: marks.length, detail: { sessions: rows.length, present, marks: marks.length } };
  },
});
