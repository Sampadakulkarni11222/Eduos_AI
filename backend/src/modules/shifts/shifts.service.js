import mongoose from 'mongoose';
import { SchoolShift, BELL_KINDS } from '../../models/schoolShift.model.js';
import { Section } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Facility } from '../../models/facility.model.js';
import { AppError } from '../../utils/AppError.js';
import { forgetCached } from '../../utils/shortCache.js';
import { toMin } from '../campus/day-plan.js';

/**
 * School shifts: named school days with their own bell schedules, and the
 * class sections assigned to each. Saving a shift
 *   1. checks its bells (valid times, no two school bells overlapping, each
 *      period number once),
 *   2. checks a section is in one shift only (or moves it, when asked),
 *   3. refuses a plan where two classes of DIFFERENT shifts would be in the
 *      same room at the same time (a class's period takes its shift's bell
 *      times; the room is the timetabled room, else the class's home room),
 *   4. then sets the times of the assigned classes' timetable periods to the
 *      shift's period bells, so the timetable, cover, attendance and Campus
 *      World all read one set of times.
 * Teachers may teach in any shift; their own double bookings are the
 * timetable's to check, not a shift's.
 */

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const bad = (msg, code = 'BAD_SHIFT', details = []) => new AppError(msg, 400, details, code);
const labelOf = (sec) => `${sec?.gradeId?.name ?? ''} ${sec?.name ?? ''}`.trim();

function cleanBells(bells) {
  if (!Array.isArray(bells) || !bells.length) throw bad('A shift needs a bell schedule: at least one period.');
  if (bells.length > 40) throw bad('A bell schedule has at most 40 bells.');
  const out = bells.map((b, i) => {
    const kind = String(b?.kind ?? '').toUpperCase();
    if (!BELL_KINDS.includes(kind)) throw bad(`Bell ${i + 1}: kind must be one of ${BELL_KINDS.join(', ')}.`);
    const start = String(b.start ?? ''); const end = String(b.end ?? '');
    if (!TIME.test(start) || !TIME.test(end)) throw bad(`Bell ${i + 1}: times must look like 07:45.`);
    if (toMin(end) <= toMin(start)) throw bad(`Bell ${i + 1}: it must end after it starts.`);
    const periodNo = kind === 'PERIOD' ? Number(b.periodNo) : null;
    if (kind === 'PERIOD' && !(Number.isInteger(periodNo) && periodNo >= 1 && periodNo <= 20)) throw bad(`Bell ${i + 1}: a period needs its number (1-20).`);
    return { kind, label: b.label ? String(b.label).slice(0, 60) : null, periodNo, start, end };
  }).sort((a, b) => toMin(a.start) - toMin(b.start));
  if (!out.some((b) => b.kind === 'PERIOD')) throw bad('A bell schedule needs at least one period.');
  const nos = out.filter((b) => b.kind === 'PERIOD').map((b) => b.periodNo);
  if (new Set(nos).size !== nos.length) throw bad('Each period number may appear once in a shift.');
  const school = out.filter((b) => b.kind !== 'CLUBS');
  for (let i = 1; i < school.length; i++) {
    if (toMin(school[i].start) < toMin(school[i - 1].end)) throw bad(`"${school[i - 1].label ?? school[i - 1].kind.toLowerCase()}" (${school[i - 1].start}-${school[i - 1].end}) overlaps "${school[i].label ?? school[i].kind.toLowerCase()}" (${school[i].start}-${school[i].end}).`, 'BELLS_OVERLAP');
  }
  return out;
}

function cleanBody(body, existing = null) {
  const out = {};
  if (body.code !== undefined || !existing) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw bad('Give the shift a short code (letters and numbers, up to 20).');
    out.code = code;
  }
  if (body.name !== undefined || !existing) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 80) throw bad('Give the shift a name (up to 80 characters).');
    out.name = name;
  }
  if (body.daysOfWeek !== undefined) {
    const days = [...new Set((body.daysOfWeek ?? []).map(Number))].filter((d) => DAYS.includes(d)).sort();
    if (!days.length) throw bad('Choose the days the shift runs.');
    out.daysOfWeek = days;
  }
  if (body.bells !== undefined || !existing) out.bells = cleanBells(body.bells);
  if (body.color !== undefined) out.color = body.color ? String(body.color).slice(0, 16) : null;
  if (body.note !== undefined) out.note = body.note ? String(body.note).slice(0, 400) : null;
  if (body.sectionIds !== undefined) {
    if (!Array.isArray(body.sectionIds)) throw bad('sectionIds must be a list.');
    for (const id of body.sectionIds) if (!mongoose.isValidObjectId(id)) throw bad('A section id is not valid.');
    out.sectionIds = [...new Set(body.sectionIds.map(String))];
  }
  return out;
}

/** Every room a class uses at each time of the week, under a given set of shifts. */
async function roomUse(shifts) {
  const sectionShift = new Map();
  for (const s of shifts) for (const id of s.sectionIds ?? []) sectionShift.set(String(id), s);
  const ids = [...sectionShift.keys()];
  if (!ids.length) return [];
  const [slots, homes, sections] = await Promise.all([
    TimetableSlot.find({ sectionId: { $in: ids } }).select('sectionId dayOfWeek periodNo startTime endTime room subjectOfferingId').lean(),
    Facility.find({ sectionId: { $in: ids } }).select('sectionId code name').lean(),
    Section.find({ _id: { $in: ids } }).populate('gradeId', 'name').lean(),
  ]);
  const home = new Map(homes.map((f) => [String(f.sectionId), f.code || f.name]));
  const label = new Map(sections.map((s) => [String(s._id), labelOf(s)]));
  const out = [];
  for (const slot of slots) {
    const sid = String(slot.sectionId);
    const shift = sectionShift.get(sid);
    const days = shift.daysOfWeek?.length ? shift.daysOfWeek : [1, 2, 3, 4, 5, 6];
    if (!days.includes(slot.dayOfWeek)) continue;
    const bell = (shift.bells ?? []).find((b) => b.kind === 'PERIOD' && Number(b.periodNo) === Number(slot.periodNo));
    // A period the shift has no bell for does not happen in that shift.
    if (!bell) continue;
    const room = slot.room || home.get(sid);
    if (!room) continue;
    out.push({ room, dow: slot.dayOfWeek, s: toMin(bell.start), e: toMin(bell.end), start: bell.start, end: bell.end, sectionId: sid, className: label.get(sid) ?? sid, shiftCode: shift.code, periodNo: slot.periodNo });
  }
  return out;
}

/** Two classes of different shifts in one room at overlapping times. */
export async function roomConflicts(shifts) {
  const use = await roomUse(shifts);
  const byKey = new Map();
  for (const u of use) {
    const k = `${u.room}|${u.dow}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(u);
  }
  const out = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].s < list[i].e; j++) {
        const a = list[i]; const b = list[j];
        if (a.shiftCode === b.shiftCode || a.sectionId === b.sectionId) continue;
        out.push({ room: a.room, day: DOW[a.dow], dayOfWeek: a.dow, from: a.s > b.s ? a.start : b.start, to: a.e < b.e ? a.end : b.end, classes: [`${a.className} (${a.shiftCode}, period ${a.periodNo})`, `${b.className} (${b.shiftCode}, period ${b.periodNo})`] });
      }
    }
  }
  return out;
}

function present(s, labels) {
  return {
    id: String(s._id), code: s.code, name: s.name, color: s.color ?? null, active: s.active !== false,
    daysOfWeek: s.daysOfWeek ?? [], bells: (s.bells ?? []).map((b) => ({ kind: b.kind, label: b.label ?? null, periodNo: b.periodNo ?? null, start: b.start, end: b.end })),
    periods: (s.bells ?? []).filter((b) => b.kind === 'PERIOD').length,
    startsAt: (s.bells ?? []).filter((b) => b.kind !== 'CLUBS').map((b) => b.start).sort()[0] ?? null,
    endsAt: (s.bells ?? []).filter((b) => b.kind !== 'CLUBS').map((b) => b.end).sort().pop() ?? null,
    sections: (s.sectionIds ?? []).map((id) => ({ id: String(id), name: labels.get(String(id)) ?? 'Unknown class' })),
    note: s.note ?? null, updatedAt: s.updatedAt ?? null,
  };
}

async function sectionLabels() {
  const sections = await Section.find({}).populate('gradeId', 'name level').lean();
  sections.sort((a, b) => (a.gradeId?.level ?? 0) - (b.gradeId?.level ?? 0) || String(a.name).localeCompare(String(b.name)));
  return { sections, labels: new Map(sections.map((s) => [String(s._id), labelOf(s)])) };
}

/** GET /shifts — the shifts, the classes in each, classes in none, and any room clashes between shifts. */
export async function list() {
  const [shifts, { sections, labels }] = await Promise.all([SchoolShift.find({ active: true }).sort({ code: 1 }).lean(), sectionLabels()]);
  const assigned = new Set(shifts.flatMap((s) => (s.sectionIds ?? []).map(String)));
  return {
    shifts: shifts.map((s) => present(s, labels)),
    unassigned: sections.filter((s) => !assigned.has(String(s._id))).map((s) => ({ id: String(s._id), name: labels.get(String(s._id)) })),
    sections: sections.map((s) => ({ id: String(s._id), name: labels.get(String(s._id)) })),
    conflicts: await roomConflicts(shifts),
    bellKinds: BELL_KINDS,
    note: 'Saving a shift sets its classes\' timetable period times to the shift\'s period bells.',
  };
}

/** Times of the assigned classes' timetable periods follow the shift's period bells. */
async function syncTimetable(shift) {
  const ids = (shift.sectionIds ?? []).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return 0;
  let n = 0;
  for (const b of shift.bells.filter((x) => x.kind === 'PERIOD')) {
    // eslint-disable-next-line no-await-in-loop
    const r = await TimetableSlot.updateMany({ sectionId: { $in: ids }, periodNo: b.periodNo, $or: [{ startTime: { $ne: b.start } }, { endTime: { $ne: b.end } }] }, { $set: { startTime: b.start, endTime: b.end } });
    n += r.modifiedCount ?? 0;
  }
  return n;
}

async function save(actor, id, body) {
  const existing = id ? await SchoolShift.findById(id) : null;
  if (id && (!existing || existing.active === false)) throw new AppError('Shift not found', 404);
  const data = cleanBody(body ?? {}, existing);
  if (data.code) {
    const clash = await SchoolShift.findOne({ code: data.code, ...(existing ? { _id: { $ne: existing._id } } : {}) }).select('_id active').lean();
    if (clash?.active !== false && clash) throw new AppError(`Another shift already uses the code ${data.code}.`, 409, [], 'SHIFT_CODE_TAKEN');
    if (clash) await SchoolShift.deleteOne({ _id: clash._id });
  }
  if (data.sectionIds) {
    const found = await Section.countDocuments({ _id: { $in: data.sectionIds } });
    if (found !== data.sectionIds.length) throw new AppError('A class in the list was not found.', 404);
  }
  const others = await SchoolShift.find({ active: true, ...(existing ? { _id: { $ne: existing._id } } : {}) }).lean();
  const mine = { ...(existing ? existing.toObject() : { daysOfWeek: [1, 2, 3, 4, 5, 6], sectionIds: [] }), ...data };
  // A class belongs to one shift: move it when asked, otherwise say where it is.
  const taken = [];
  for (const o of others) {
    const overlap = (o.sectionIds ?? []).map(String).filter((x) => (mine.sectionIds ?? []).map(String).includes(x));
    if (overlap.length) taken.push({ shift: o, ids: overlap });
  }
  if (taken.length && !body?.moveSections) {
    const { labels } = await sectionLabels();
    throw new AppError(`${taken.flatMap((t) => t.ids.map((x) => labels.get(x))).join(', ')} already belong to ${taken.map((t) => t.shift.name).join(', ')}. Move them to this shift?`, 409, taken.map((t) => ({ shift: t.shift.code, sections: t.ids })), 'SECTION_IN_OTHER_SHIFT');
  }
  const plan = [...others.map((o) => {
    const t = taken.find((x) => String(x.shift._id) === String(o._id));
    return t ? { ...o, sectionIds: (o.sectionIds ?? []).filter((x) => !t.ids.includes(String(x))) } : o;
  }), mine];
  const conflicts = await roomConflicts(plan);
  if (conflicts.length) {
    throw new AppError(`Two shifts would use the same room at the same time: ${conflicts.slice(0, 3).map((c) => `${c.room} on ${c.day} ${c.from}-${c.to} (${c.classes.join(' and ')})`).join('; ')}${conflicts.length > 3 ? `, and ${conflicts.length - 3} more` : ''}.`, 409, conflicts.slice(0, 20), 'SHIFT_ROOM_CONFLICT');
  }
  for (const t of taken) {
    // eslint-disable-next-line no-await-in-loop
    await SchoolShift.updateOne({ _id: t.shift._id }, { $pull: { sectionIds: { $in: t.ids.map((x) => new mongoose.Types.ObjectId(x)) } } });
  }
  let doc;
  if (existing) {
    Object.assign(existing, data, { updatedByProfileId: actor?.profileId ?? null });
    doc = await existing.save();
  } else {
    doc = await SchoolShift.create({ daysOfWeek: [1, 2, 3, 4, 5, 6], ...data, updatedByProfileId: actor?.profileId ?? null });
  }
  const retimed = await syncTimetable(doc);
  forgetCached('campus');
  const { labels } = await sectionLabels();
  return { ...present(doc.toObject(), labels), retimedPeriods: retimed, moved: taken.flatMap((t) => t.ids.map((x) => labels.get(x))) };
}

export const create = (actor, body) => save(actor, null, body);
export const update = (actor, id, body) => {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Shift not found', 404);
  return save(actor, id, body);
};

/** Retire a shift: its classes go back to the timetable's own times (nothing is rewritten). */
export async function remove(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Shift not found', 404);
  const s = await SchoolShift.findById(id);
  if (!s || s.active === false) throw new AppError('Shift not found', 404);
  s.active = false;
  s.sectionIds = [];
  s.updatedByProfileId = actor?.profileId ?? null;
  await s.save();
  forgetCached('campus');
  return { id: String(s._id), retired: true };
}

/** One class's shift and bells. */
export async function forSection(sectionId) {
  if (!mongoose.isValidObjectId(sectionId)) throw new AppError('Section not found', 404);
  const sec = await Section.findById(sectionId).populate('gradeId', 'name').lean();
  if (!sec) throw new AppError('Section not found', 404);
  const s = await SchoolShift.findOne({ active: true, sectionIds: sec._id }).lean();
  const { labels } = await sectionLabels();
  return { sectionId: String(sec._id), className: labelOf(sec), shift: s ? present(s, labels) : null };
}
