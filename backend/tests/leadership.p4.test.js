import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

// Certificates are written where uploads live: a throwaway directory, set before any module reads it.
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'eduos-leadership-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

const { inSchool, OAK, RIVER, seedSchool, seedPerson, todayKey } = await import('./support/mcpSchool.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { Subject, SubjectOffering, Term } = await import('../src/models/academics.model.js');
const { TimetableSlot } = await import('../src/models/timetableSlot.model.js');
const { DocumentType, DocumentRequest } = await import('../src/models/documentRequest.model.js');
const { Budget } = await import('../src/models/finance.model.js');
const { BoardMeeting } = await import('../src/models/governance.model.js');
const { BoardPack } = await import('../src/models/boardPack.model.js');
const { IssuedCertificate } = await import('../src/models/issuedCertificate.model.js');
const academics = await import('../src/modules/leadership/academics.service.js');
const boardPack = await import('../src/modules/leadership/boardpack.service.js');
const certificates = await import('../src/modules/leadership/certificates.service.js');
const { renderBoardPackPdf } = await import('../src/modules/leadership/pdf.js');
const governance = await import('../src/modules/governance/governance.service.js');

/**
 * Part 4 leadership: the principal's school-wide attendance and teacher
 * workload, the board pack (live, frozen, read receipts, questions, PDF),
 * governance record rules (recusal, held meetings) and certificates generated
 * from the record with a no-dues check.
 */
let s;
let trustee;
let outsider;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const dayKey = (offset) => { const t = todayKey(); return new Date(t.getTime() - offset * DAY); };

afterAll(() => rmSync(UPLOAD_DIR, { recursive: true, force: true }));

beforeEach(async () => {
  s = await seedSchool();
  trustee = await seedPerson({ roleKey: 'TRUSTEE', roleId: s.roleIds.TRUSTEE, displayName: 'Mrs Trustee' });
  outsider = await seedPerson({ roleKey: 'TRUSTEE', roleId: s.roleIds.TRUSTEE, displayName: 'Other Trustee' });
});

function pdfBytes(render, arg) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    render(out, arg);
  });
}

describe('school-wide attendance for the principal', () => {
  it('lists classes, registers not taken today and students below 75%', async () => {
    // Rahul: absent on 6 of the last 8 school days; Priya present on all.
    await inOak(async () => {
      for (let i = 1; i <= 8; i += 1) {
        await AttendanceRecord.create({ enrollmentId: s.rahul.enrollment._id, date: dayKey(i), periodNo: null, status: i <= 6 ? 'ABSENT' : 'PRESENT' });
        await AttendanceRecord.create({ enrollmentId: s.priya.enrollment._id, date: dayKey(i), periodNo: null, status: 'PRESENT' });
      }
    });
    const o = await inOak(() => academics.attendanceOverview(s.people.PRINCIPAL.actor, {}));
    expect(o.threshold).toBe(75);
    expect(o.classes.map((c) => c.class)).toEqual(['Class 6 A', 'Class 6 B']);
    const a = o.classes.find((c) => c.class === 'Class 6 A');
    expect(a.pctPresent).toBeGreaterThan(0);
    // 6 B (Riya) has no register today; 6 A is partly marked (Aman not marked).
    expect(o.today.notMarked.map((r) => r.class)).toEqual(['Class 6 B']);
    expect(o.today.partlyMarked.map((r) => r.class)).toEqual(['Class 6 A']);
    const low = o.belowThreshold.find((x) => x.admissionNo === 'OAK-1');
    expect(low).toBeTruthy();
    expect(low.pctPresent).toBeLessThan(75);
    expect(o.belowThreshold.some((x) => x.admissionNo === 'OAK-2')).toBe(false);
    expect(o.trend.length).toBeGreaterThanOrEqual(8);
    // A different threshold changes the list; another school sees none of this.
    const strict = await inOak(() => academics.attendanceOverview(s.people.PRINCIPAL.actor, { threshold: 101 }));
    expect(strict.threshold).toBe(100);
    const river = await inSchool(RIVER, () => academics.attendanceOverview(s.people.RIVER_ADMIN.actor, {}));
    expect(river.belowThreshold).toHaveLength(0);
    expect(river.classes).toHaveLength(1);
  });

  it('refuses a bad range', async () => {
    await expect(inOak(() => academics.attendanceOverview(s.people.PRINCIPAL.actor, { from: '2026-10-10', to: '2026-10-01' }))).rejects.toMatchObject({ code: 'BAD_RANGE' });
    await expect(inOak(() => academics.attendanceOverview(s.people.PRINCIPAL.actor, { from: 'yesterday' }))).rejects.toMatchObject({ code: 'BAD_DATE' });
  });
});

describe('teacher workload from the timetable', () => {
  it('counts periods a week per teacher, class-teacher duty and flags over the cap', async () => {
    await inOak(async () => {
      const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
      const maths = await Subject.create({ name: 'Mathematics' });
      const sci = await Subject.create({ name: 'Science' });
      const oA = await SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: maths._id, termId: term._id, teacherId: s.people.TEACHER.profile._id });
      const oB = await SubjectOffering.create({ sectionId: s.sectionB._id, subjectId: sci._id, termId: term._id, teacherId: s.people.TEACHER.profile._id });
      for (let d = 1; d <= 6; d += 1) {
        for (let p = 1; p <= 4; p += 1) {
          await TimetableSlot.create({ sectionId: s.sectionA._id, dayOfWeek: d, periodNo: p, startTime: `${String(8 + p).padStart(2, '0')}:00`, endTime: `${String(8 + p).padStart(2, '0')}:40`, subjectOfferingId: oA._id });
        }
        await TimetableSlot.create({ sectionId: s.sectionB._id, dayOfWeek: d, periodNo: 1, startTime: '09:00', endTime: '09:40', subjectOfferingId: oB._id });
        await TimetableSlot.create({ sectionId: s.sectionB._id, dayOfWeek: d, periodNo: 5, startTime: '11:00', endTime: '11:20', subjectOfferingId: null }); // a break
      }
    });
    const w = await inOak(() => academics.teacherWorkload(s.people.PRINCIPAL.actor, { cap: 20 }));
    const t = w.teachers.find((x) => x.profileId === String(s.people.TEACHER.profile._id));
    expect(t.periodsPerWeek).toBe(30);
    expect(t.perDay).toEqual([5, 5, 5, 5, 5, 5]);
    expect(t.subjects).toEqual(['Mathematics', 'Science']);
    expect(t.classes).toEqual(['Class 6 A', 'Class 6 B']);
    expect(t.classTeacherOf).toEqual(['Class 6 A']);
    expect(t.flags).toContain('OVER_CAP');
    // 6 B period 1 and 6 A period 1 both start at 09:00 on every day: the same teacher in two rooms at once.
    expect(t.flags).toContain('CLASH');
    expect(t.clashCount).toBe(6);
    expect(t.clashes[0]).toEqual({ day: 'Mon', at: '09:00', classes: ['Class 6 A', 'Class 6 B'] });
    expect(w.summary.withClashes).toBe(1);
    expect(w.summary.overCap).toBe(1);
    const relaxed = await inOak(() => academics.teacherWorkload(s.people.PRINCIPAL.actor, {}));
    expect(relaxed.cap).toBe(30);
    expect(relaxed.teachers.find((x) => x.profileId === String(s.people.TEACHER.profile._id)).flags).not.toContain('OVER_CAP');
  });
});

async function heldMeeting({ conflicts = false } = {}) {
  const P = s.people.PRINCIPAL.actor;
  return inOak(async () => {
    const m = await governance.create(P, { body: 'TRUST_BOARD', title: 'Board meeting', quorum: 2, memberProfileIds: [trustee.actor.profileId, s.people.PRINCIPAL.actor.profileId, s.people.FINANCE.actor.profileId], memberRoles: { [trustee.actor.profileId]: 'CHAIR' }, scheduledAt: new Date(Date.now() + 3 * DAY).toISOString() });
    await governance.setAgenda(P, 'ALL', m.id, { items: [{ title: 'Accounts', decisionNeeded: true }, { title: 'Bus contract with a trustee relative', decisionNeeded: true }] });
    if (conflicts) await governance.rsvp(trustee.actor, 'OWN', m.id, { conflicts: [{ agendaOrder: 2, declaration: 'My brother owns the bus company.' }] });
    return m;
  });
}

describe('governance record rules', () => {
  it('keeps a member who declared a conflict out of that item\'s vote', async () => {
    const m = await heldMeeting({ conflicts: true });
    const got = await inOak(() => governance.get(trustee.actor, 'OWN', m.id));
    expect(got.myConflicts).toEqual([{ agendaOrder: 2, declaration: 'My brother owns the bus company.' }]);
    expect(got.members.find((x) => x.name === 'Mrs Trustee').rsvp).toBe('PENDING'); // declaring alone keeps the response
    await inOak(() => BoardMeeting.updateOne({ _id: m.id }, { $set: { scheduledAt: new Date(Date.now() - DAY) } }));
    const full = await inOak(() => governance.get(s.people.PRINCIPAL.actor, 'ALL', m.id));
    const attendance = full.members.map((x) => ({ memberId: x._id, attended: true }));
    await expect(inOak(() => governance.record(s.people.PRINCIPAL.actor, 'ALL', m.id, { attendance, resolutions: [{ text: 'Award the bus contract', agendaOrder: 2, votesFor: 3, votesAgainst: 0 }] }))).rejects.toMatchObject({ code: 'CONFLICTED_MEMBER_VOTED' });
    const ok = await inOak(() => governance.record(s.people.PRINCIPAL.actor, 'ALL', m.id, { attendance, resolutions: [{ text: 'Award the bus contract', agendaOrder: 2, votesFor: 2, votesAgainst: 0, abstentions: 1 }] }));
    expect(ok.resolutions[0].outcome).toBe('PASSED');
    // A declaration must name an item on the agenda.
    await expect(inOak(() => governance.rsvp(trustee.actor, 'OWN', m.id, { conflicts: [{ agendaOrder: 9, declaration: 'x' }] }))).rejects.toMatchObject({ code: 'BAD_AGENDA_ITEM' });
    // A meeting that was held cannot be cancelled afterwards.
    await expect(inOak(() => governance.cancel(s.people.PRINCIPAL.actor, 'ALL', m.id, { reason: 'oops' }))).rejects.toMatchObject({ code: 'MEETING_HELD' });
  });

  it('names action owners and says who may tick an action done', async () => {
    const m = await heldMeeting();
    await inOak(() => BoardMeeting.updateOne({ _id: m.id }, { $set: { scheduledAt: new Date(Date.now() - DAY) } }));
    const rec = await inOak(() => governance.record(s.people.PRINCIPAL.actor, 'ALL', m.id, { actions: [{ title: 'Get three quotes', ownerProfileId: s.people.FINANCE.actor.profileId, dueOn: new Date(Date.now() - 2 * DAY).toISOString() }] }));
    expect(rec.actions[0].ownerName).toBe('FINANCE user');
    const asTrustee = await inOak(() => governance.get(trustee.actor, 'OWN', m.id));
    expect(asTrustee.actions[0].canUpdate).toBe(false);
    const asOwner = await inOak(() => governance.get(s.people.FINANCE.actor, 'ALL', m.id));
    expect(asOwner.actions[0].canUpdate).toBe(true);
  });
});

describe('board pack', () => {
  it('builds a live pack for a member, refuses a non-member, freezes versions and records reads', async () => {
    const m = await heldMeeting();
    await inOak(() => Budget.create({ fiscalYear: (() => { const n = new Date(); const y = n.getUTCMonth() >= 3 ? n.getUTCFullYear() : n.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; })(), name: 'Annual budget', status: 'APPROVED', lines: [{ code: 'MNT', head: 'Repairs', kind: 'OPEX', plannedPaise: 100_000_00, actualPaise: 150_000_00 }] }));
    const live = await inOak(() => boardPack.getPack(trustee.actor, 'OWN', m.id));
    expect(live.mode).toBe('LIVE');
    expect(live.pack.meeting.agenda).toHaveLength(2);
    expect(live.pack.budget.available).toBe(true);
    expect(live.pack.budget.lines[0].utilisationPct).toBe(150);
    expect(live.pack.compliance.available).toBe(true);
    expect(live.pack.enrolment.studentsOnRoll).toBe(4);
    expect(live.pack.questions.some((q) => q.section === 'budget' && /Repairs/.test(q.question))).toBe(true);
    for (const q of live.pack.questions) expect(q.basis).toBeTruthy();
    // Not a member: the meeting does not exist for them.
    await expect(inOak(() => boardPack.getPack(outsider.actor, 'OWN', m.id))).rejects.toMatchObject({ statusCode: 404 });
    // Only the secretariat freezes.
    await expect(inOak(() => boardPack.freezePack(trustee.actor, m.id, {}))).rejects.toMatchObject({ statusCode: 403 });
    const v1 = await inOak(() => boardPack.freezePack(s.people.PRINCIPAL.actor, m.id, { note: 'For the October meeting' }));
    expect(v1.version).toBe(1);
    const v2 = await inOak(() => boardPack.freezePack(s.people.PRINCIPAL.actor, m.id, {}));
    expect(v2.version).toBe(2);
    const read = await inOak(() => boardPack.getPack(trustee.actor, 'OWN', m.id));
    expect(read.mode).toBe('FROZEN');
    expect(read.version).toBe(2);
    expect(read.reads.map((r) => r.name)).toEqual(['Mrs Trustee']);
    await inOak(() => boardPack.getPack(trustee.actor, 'OWN', m.id)); // a second open is not a second receipt
    expect((await inOak(() => BoardPack.findOne({ meetingId: m.id, version: 2 }).lean())).reads).toHaveLength(1);
    expect(read.versions.map((v) => v.version)).toEqual([2, 1]);
    // The secretariat can still look at the live figures.
    expect((await inOak(() => boardPack.getPack(s.people.PRINCIPAL.actor, 'ALL', m.id, { live: true }))).mode).toBe('LIVE');
    const pdf = await pdfBytes(renderBoardPackPdf, read);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it('leaves out sections the reader may not see', async () => {
    const m = await heldMeeting();
    const finance = s.people.FINANCE.actor; // a member without compliance or governance management
    const p = await inOak(() => boardPack.buildPack({ ...finance, permissions: { 'governance.read': 'OWN' } }, 'OWN', m.id));
    expect(p.compliance.available).toBe(false);
    expect(p.budget.available).toBe(false);
    expect(p.finance.available).toBe(false);
  });
});

async function request(student, typeName, status = 'APPROVED') {
  return inOak(async () => {
    const type = await DocumentType.create({ name: typeName, nameKey: typeName.toLowerCase().replace(/\s+/g, '-'), allowedFileTypes: ['pdf'] });
    return DocumentRequest.create({ studentId: student.student._id, enrollmentId: student.enrollment._id, sectionId: student.enrollment.sectionId, documentTypeId: type._id, documentTypeName: typeName, purpose: 'Moving to another city', status, studentName: `${student.student.firstName} ${student.student.lastName}`, admissionNo: student.student.admissionNo });
  });
}

describe('certificates from the record', () => {
  it('checks dues, refuses a TC while fees are open, and issues with a recorded reason', async () => {
    const r = await request(s.rahul, 'Transfer Certificate');
    const cl = await inOak(() => certificates.clearance(s.people.ADMIN.actor, String(r._id)));
    expect(cl.kind).toBe('TC');
    expect(cl.required).toBe(true);
    expect(cl.clear).toBe(false);
    expect(cl.checks.find((c) => c.key === 'fees')).toMatchObject({ status: 'DUE' });
    expect(cl.checks.find((c) => c.key === 'fees').detail).toMatch(/INV-1001/);
    await expect(inOak(() => certificates.generate(s.people.ADMIN.actor, String(r._id), {}))).rejects.toMatchObject({ code: 'DUES_OPEN' });
    await expect(inOak(() => certificates.generate(s.people.ADMIN.actor, String(r._id), { overrideReason: 'short' }))).rejects.toMatchObject({ code: 'DUES_OPEN' });
    const out = await inOak(() => certificates.generate(s.people.ADMIN.actor, String(r._id), { overrideReason: 'Family relocating on transfer orders; dues waived by the trust.', reasonForLeaving: "Parent's transfer", conduct: 'Very good' }));
    expect(out.serialNo).toMatch(/^TC\/\d{4}\/0001$/);
    expect(out.verificationCode).toMatch(/^[0-9A-F]{10}$/);
    expect(out.request.status).toBe('READY');
    const saved = await inOak(() => DocumentRequest.findById(r._id).lean());
    expect(saved.files).toHaveLength(1);
    expect(saved.files[0].mimeType).toBe('application/pdf');
    expect(existsSync(join(UPLOAD_DIR, saved.files[0].storedName))).toBe(true);
    const reg = await inOak(() => certificates.register({}));
    expect(reg[0]).toMatchObject({ serialNo: out.serialNo, duesOpen: true, studentName: 'Rahul Sharma' });
    expect(reg[0].overrideReason).toMatch(/transfer orders/);
    expect(await inOak(() => certificates.verify(out.verificationCode))).toMatchObject({ valid: true, serialNo: out.serialNo });
    expect(await inOak(() => certificates.verify('0000000000'))).toMatchObject({ valid: false });
    // Another school cannot verify it.
    expect(await inSchool(RIVER, () => certificates.verify(out.verificationCode))).toMatchObject({ valid: false });
  });

  it('issues a bonafide certificate without a dues check, numbering each kind separately', async () => {
    const r = await request(s.priya, 'Bonafide Certificate');
    const pv = await inOak(() => certificates.preview(s.people.ADMIN.actor, String(r._id), { purpose: 'a passport application' }));
    expect(pv.needsClearance).toBe(false);
    expect(pv.body).toMatch(/Priya Verma/);
    expect(pv.body).toMatch(/passport application/);
    const out = await inOak(() => certificates.generate(s.people.ADMIN.actor, String(r._id), { purpose: 'a passport application' }));
    expect(out.serialNo).toMatch(/^BC\//);
    expect(await inOak(() => IssuedCertificate.countDocuments({}))).toBe(1);
  });

  it('only generates for an approved request', async () => {
    const r = await request(s.priya, 'Character Certificate', 'PENDING');
    await expect(inOak(() => certificates.generate(s.people.ADMIN.actor, String(r._id), {}))).rejects.toMatchObject({ code: 'DOCUMENT_REQUEST_INVALID_TRANSITION' });
  });

  it('writes dates of birth in words the way a TC does', () => {
    expect(certificates.dateInWords(new Date(Date.UTC(2014, 2, 7)))).toBe('Seventh March two thousand fourteen');
    expect(certificates.dateInWords(new Date(Date.UTC(2012, 10, 21)))).toBe('Twenty-first November two thousand twelve');
    expect(certificates.dateInWords(new Date(Date.UTC(1999, 0, 30)))).toBe('Thirtieth January nineteen hundred ninety-nine');
    expect(certificates.kindOf('School Leaving Certificate')).toBe('LEAVING');
    expect(certificates.kindOf('Migration certificate')).toBe('TC');
  });
});
