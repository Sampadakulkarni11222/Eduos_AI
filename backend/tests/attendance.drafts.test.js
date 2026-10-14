import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as drafts from '../src/modules/attendance/draft.service.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';

// These tests are about who may mark, not when: they mark a fixed past Tuesday,
// so the back-dating window (attendance.dateWindow.test.js) is opened wide here.
const savedBackdate = process.env.ATTENDANCE_BACKDATE_DAYS;
beforeAll(() => { process.env.ATTENDANCE_BACKDATE_DAYS = '100000'; });
afterAll(() => {
  if (savedBackdate === undefined) delete process.env.ATTENDANCE_BACKDATE_DAYS;
  else process.env.ATTENDANCE_BACKDATE_DAYS = savedBackdate;
});


/**
 * Flashcard drafts: same authorization as marking, optimistic concurrency
 * between devices, roster-change detection, and the guarantee that a draft is
 * never attendance.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);
const permsOf = (roleKey) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });
const actor = (roleKey, profileId) => ({ roleKey, profileId: String(profileId), permissions: permsOf(roleKey) });

const classTeacher = new mongoose.Types.ObjectId();
const otherTeacher = new mongoose.Types.ObjectId();
let section;
let otherSection;
let e1; let e2; let foreign;
const DATE = '2026-03-10';

const enrol = async (sec, admissionNo) => {
  const st = await Student.create({ admissionNo, firstName: admissionNo, lastName: 'X' });
  return Enrollment.create({ studentId: st._id, sectionId: sec._id, academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
};

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 7', level: 7 });
    section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: classTeacher });
    otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: otherTeacher });
    e1 = await enrol(section, 'D-1');
    e2 = await enrol(section, 'D-2');
    foreign = await enrol(otherSection, 'D-9');
  });
});

const T = () => actor('TEACHER', classTeacher);
const base = () => ({ sectionId: String(section._id), date: DATE, periodNo: null });

describe('attendance drafts', () => {
  it('saves, resumes and is never counted as attendance', async () => {
    const saved = await inOak(() => drafts.saveDraft(T(), 'OWN', {
      ...base(), version: 0, cursor: 1,
      entries: [{ enrollmentId: String(e1._id), status: 'ABSENT' }, { enrollmentId: String(e2._id), passed: true }],
    }));
    expect(saved.version).toBe(1);
    const again = await inOak(() => drafts.getDraft(T(), 'OWN', base()));
    expect(again.cursor).toBe(1);
    expect(again.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ enrollmentId: String(e1._id), status: 'ABSENT', passed: false }),
      expect.objectContaining({ enrollmentId: String(e2._id), status: null, passed: true }),
    ]));
    expect(await inOak(() => AttendanceRecord.countDocuments({}))).toBe(0);
  });

  it('refuses a save based on a stale version (two devices)', async () => {
    const first = await inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 0, entries: [] }));
    await inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: first.version, entries: [{ enrollmentId: String(e1._id), status: 'PRESENT' }] }));
    await expect(inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: first.version, entries: [] })))
      .rejects.toMatchObject({ statusCode: 409, code: 'DRAFT_CONFLICT' });
  });

  it('rejects students from another section and duplicate entries', async () => {
    await expect(inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 0, entries: [{ enrollmentId: String(foreign._id), status: 'PRESENT' }] })))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 0, entries: [{ enrollmentId: String(e1._id), status: 'PRESENT' }, { enrollmentId: String(e1._id), status: 'ABSENT' }] })))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('a teacher cannot keep a draft for a register they cannot mark', async () => {
    await expect(inOak(() => drafts.saveDraft(actor('TEACHER', otherTeacher), 'OWN', { ...base(), version: 0, entries: [] })))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => drafts.getDraft(actor('PARENT', new mongoose.Types.ObjectId()), 'OWN', base())))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('reports students who joined or left since the draft began', async () => {
    await inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 0, entries: [{ enrollmentId: String(e2._id), status: 'PRESENT' }] }));
    let joined;
    await inOak(async () => {
      await Enrollment.updateOne({ _id: e2._id }, { $set: { status: 'TRANSFERRED' } });
      joined = await enrol(section, 'D-3');
    });
    const d = await inOak(() => drafts.getDraft(T(), 'OWN', base()));
    expect(d.rosterChanges.added).toEqual([String(joined._id)]);
    expect(d.rosterChanges.removed).toEqual([String(e2._id)]);
    expect(d.entries).toHaveLength(0);
  });

  it('submitting marks only decided students; discard removes the draft', async () => {
    await inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 0, entries: [{ enrollmentId: String(e1._id), status: 'ABSENT' }, { enrollmentId: String(e2._id), passed: true }] }));
    await inOak(() => attendance.markAttendance(T(), 'OWN', { ...base(), entries: [{ enrollmentId: String(e1._id), status: 'ABSENT' }] }));
    await inOak(() => drafts.discardDraft(T(), 'OWN', base()));
    const rows = await inOak(() => AttendanceRecord.find({}).lean());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ABSENT');
    expect(await inOak(() => drafts.getDraft(T(), 'OWN', base()))).toBeNull();
    // A tab still holding the old version learns the draft is gone.
    await expect(inOak(() => drafts.saveDraft(T(), 'OWN', { ...base(), version: 1, entries: [] })))
      .rejects.toMatchObject({ code: 'DRAFT_GONE' });
  });

  it('the roster carries admission number for telling same-name students apart', async () => {
    const r = await inOak(() => attendance.getRoster(T(), 'OWN', String(section._id), DATE));
    expect(r.roster.map((x) => x.admissionNo).sort()).toEqual(['D-1', 'D-2']);
  });
});
