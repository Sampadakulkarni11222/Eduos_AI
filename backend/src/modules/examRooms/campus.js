import { ExamSitting } from '../../models/examRoom.model.js';
import { Section } from '../../models/academics.model.js';
import { profileNames } from '../ops/common.js';
import { localParts } from '../campus/day-plan.js';
import { LIVE_SITTING, dayKey, sectionLabel, shiftsOn, sittingWindow } from './occupancy.js';

/**
 * What Campus World and the live room page need from exam halls and room
 * shifts for one day: the papers with their rooms, seat counts per class and
 * invigilators, and the applied temporary shifts. Figures only; no names of
 * pupils. Invigilator names are for staff; the callers drop them for families.
 */
export async function campusDayExtras(ymd) {
  const [rows, shifts] = await Promise.all([
    ExamSitting.find({ date: dayKey(ymd), status: { $in: LIVE_SITTING } }).lean(),
    shiftsOn(ymd),
  ]);
  if (!rows.length) return { sittings: [], shifts };
  const sections = new Map((await Section.find({ _id: { $in: rows.flatMap((r) => r.sectionIds ?? []) } }).populate('gradeId', 'name').lean()).map((s) => [String(s._id), s]));
  const names = await profileNames(rows.flatMap((r) => (r.venues ?? []).flatMap((v) => v.invigilatorProfileIds ?? [])));
  const sittings = rows.map((r) => {
    const w = sittingWindow(r);
    const classes = (r.sectionIds ?? []).map((id) => sectionLabel(sections.get(String(id)))).join(', ');
    return {
      id: String(r._id), title: r.title, subject: r.subjectName ?? null, classes, sectionIds: (r.sectionIds ?? []).map(String), start: w.start, end: w.end,
      venues: (r.venues ?? []).map((v) => {
        const bySection = {};
        for (const x of v.seats ?? []) bySection[String(x.sectionId)] = (bySection[String(x.sectionId)] ?? 0) + 1;
        const invigilators = (v.invigilatorProfileIds ?? []).map((id) => names.get(String(id)) ?? 'Invigilator');
        const seated = v.seats?.length ?? 0;
        return {
          facilityId: String(v.facilityId), seated, capacity: v.capacity ?? null, bySection, invigilators,
          label: `Exam in progress: ${classes} ${r.subjectName ?? r.title}, ${seated} students, invigilators: ${invigilators.length ? invigilators.join(', ') : 'none assigned'}`,
        };
      }),
    };
  });
  return { sittings, shifts };
}

/** The paper a class is sitting at an instant, if any (for the live class page). */
export async function sectionExamAt(sectionId, at = new Date()) {
  const { ymd, minutes } = localParts(at);
  const day = await campusDayExtras(ymd);
  const s = day.sittings.find((x) => x.sectionIds.includes(String(sectionId)) && x.start <= minutes && x.end > minutes);
  return s ?? null;
}
