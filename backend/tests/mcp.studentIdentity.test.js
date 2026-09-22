import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, mcp, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Whose record is this?
 *
 * Manual testing found the worst kind of answer an assistant can give. Asked
 * to "show the details of Arnav Patel", it returned Aarav Bhatt's admission
 * number, class and roll number: a different, real child, confidently and
 * without a word of doubt. Two names that look alike, one record disclosed to
 * somebody who asked about the other.
 *
 * So this file is about one question only -- WHICH student a request resolves
 * to -- and it holds the resolution to different standards depending on what
 * the answer will be used for:
 *
 *   SEARCH   may return several candidates. Finding is not choosing.
 *   DETAIL   must be sure. One record, disclosed, is a decision.
 *   WRITE    must be sure, and is confirmed and audited on top.
 *
 * Normalization is allowed to bridge the gap between how a name is stored and
 * how a person types it: case, stray spaces, a missing space. Similarity is
 * NOT: a name that merely resembles another is a near miss to be offered, not
 * a record to be opened. Every test below is one or the other of those two
 * statements.
 */

let school;
let extra;

beforeAll(async () => {
  // Nothing here: each test wants the fixtures fresh (see beforeEach).
});
afterAll(async () => {
  await resetMcpClient();
});

beforeEach(async () => {
  school = await seedSchool();
  extra = await inSchool(OAK, async () => {
    const year = school.year;
    const enrol = async (admissionNo, firstName, lastName, section, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo,
      });
      return student;
    };
    return {
      // The reported pair: two real children whose names look alike.
      arnavPatel: await enrol('OAK-20', 'Arnav', 'Patel', school.sectionA, 20),
      aaravBhatt: await enrol('OAK-21', 'Aarav', 'Bhatt', school.sectionB, 21),
      // A second Arnav, so "Arnav" alone is genuinely ambiguous.
      arnavPatil: await enrol('OAK-22', 'Arnav', 'Patil', school.sectionB, 22),
      // An account name of the shape schools really keep.
      testStud: await enrol('OAK-23', 'test_Stud', 'Demo', school.sectionA, 23),
    };
  });
});

const admin = () => school.people.ADMIN;

/** get_student — the DETAIL capability, which discloses one child's record. */
const detail = (args, person = admin()) => mcp(OAK, person.actor, 'get_student', args);

/** search_students — the SEARCH capability, which may answer with several. */
const search = (query, person = admin()) => mcp(OAK, person.actor, 'search_students', query === undefined ? {} : { query });

const namesIn = (res) => (res.data?.students ?? []).map((s) => s.name);

/* ── 1. Detail: sure, or not at all ───────────────────────── */

describe('1. a student detail is returned only for a student who was actually named', () => {
  it('returns the student whose exact full name was given', async () => {
    const res = await detail({ studentName: 'Arnav Patel' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.name).toBe('Arnav Patel');
    expect(res.data.admissionNo).toBe('OAK-20');
  });

  it('NEVER substitutes a similar name for the one asked about', async () => {
    // The reported defect, asserted directly. "Arnav Patel" must never come
    // back as "Aarav Bhatt" -- not as the answer, and not as a silently
    // corrected one either.
    const res = await detail({ studentName: 'Arnav Bhatt' });
    if (res.success) {
      expect(res.data.name, 'a different student was returned').not.toBe('Aarav Bhatt');
    } else {
      expect(res.error.message).not.toMatch(/^Aarav Bhatt/);
      expect(String(res.error.code)).toMatch(/NOT_FOUND|INVALID_INPUT/);
    }
  });

  it('refuses an ambiguous first name instead of choosing one of them', async () => {
    // Two children are called Arnav. Picking either would be a guess about
    // whose record to open.
    const res = await detail({ studentName: 'Arnav' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/more than one/i);
    expect(res.error.message).toMatch(/Arnav Patel/);
    expect(res.error.message).toMatch(/Arnav Patil/);
  });

  it('says plainly that a name matches nobody, and offers rather than takes a near miss', async () => {
    const res = await detail({ studentName: 'Zubin Mehtaa' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/no student named/i);
    // A suggestion may be offered. What it must not be is an answer: no
    // admission number, class or roll number belonging to anybody else.
    expect(res.error.message).not.toMatch(/roll no/i);
  });

  it('resolves a surname that belongs to exactly one student', async () => {
    const res = await detail({ studentName: 'Bhatt' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.name).toBe('Aarav Bhatt');
  });

  it('resolves an admission number exactly, and refuses one that does not exist', async () => {
    const found = await detail({ admissionNo: 'OAK-20' });
    expect(found.success).toBe(true);
    expect(found.data.name).toBe('Arnav Patel');

    const missing = await detail({ admissionNo: 'OAK-999' });
    expect(missing.success).toBe(false);
    expect(missing.error.message).toMatch(/no student with admission number/i);
  });

  it('reads the same name whatever case or spacing it is typed in', async () => {
    for (const written of ['Arnav Patel', 'arnav patel', 'ARNAV PATEL', '  Arnav Patel  ', 'Arnav  Patel']) {
      const res = await detail({ studentName: written });
      expect(res.success, `${JSON.stringify(written)}: ${JSON.stringify(res.error ?? {})}`).toBe(true);
      expect(res.data.admissionNo, JSON.stringify(written)).toBe('OAK-20');
    }
  });

  it('reads a name typed without its space', async () => {
    // "ArnavPatel" is how somebody types a name they are reading off a screen.
    // Whitespace is the only thing ignored; no letter is changed or guessed.
    const res = await detail({ studentName: 'ArnavPatel' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.admissionNo).toBe('OAK-20');
  });

  it('reads a name that carries an underscore or a digit', async () => {
    const res = await detail({ studentName: 'test_Stud' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.admissionNo).toBe('OAK-23');
  });
});

/* ── 2. Search: candidates, not decisions ─────────────────── */

describe('2. a search may answer with several, and says so plainly when it has none', () => {
  it('finds a student by exact full name', async () => {
    const res = await search('Arnav Patel');
    expect(res.success).toBe(true);
    expect(namesIn(res)).toContain('Arnav Patel');
  });

  it('finds the same student written in any case or spacing, including with no space', async () => {
    for (const written of ['arnav patel', 'ARNAV PATEL', ' Arnav  Patel ', 'ArnavPatel']) {
      const res = await search(written);
      expect(res.success, JSON.stringify(written)).toBe(true);
      expect(namesIn(res), JSON.stringify(written)).toContain('Arnav Patel');
    }
  });

  it('returns BOTH students when the name fits both', async () => {
    const res = await search('Arnav');
    expect(res.success).toBe(true);
    expect(namesIn(res)).toEqual(expect.arrayContaining(['Arnav Patel', 'Arnav Patil']));
  });

  it('says nobody matches a name the school does not hold, and names nobody else', async () => {
    // This is the honest answer, and it is what "find student Diya Sharma"
    // deserves when there is a Diya Patel but no Diya Sharma. A search that
    // quietly widened to the nearest surname would be the Issue 1 defect in a
    // friendlier place.
    const res = await search('Arnav Bhattacharya');
    expect(res.success).toBe(true);
    expect(res.data.students ?? []).toHaveLength(0);
    expect(res.speak ?? res.data.speak ?? '').not.toMatch(/Aarav|Patel|Patil/);
  });

  it('lists the directory when no search term is given', async () => {
    const res = await search(undefined);
    expect(res.success).toBe(true);
    expect((res.data.students ?? []).length).toBeGreaterThan(1);
  });

  it('finds by admission number', async () => {
    const res = await search('OAK-21');
    expect(res.success).toBe(true);
    expect(namesIn(res)).toEqual(['Aarav Bhatt']);
  });
});

/* ── 3. The same rules bind a write ───────────────────────── */

describe('3. a write is held to the detail standard, before any confirmation is offered', () => {
  it('refuses to mark an ambiguous name present', async () => {
    const res = await mcp(OAK, admin().actor, 'mark_attendance', {
      students: [{ studentName: 'Arnav', status: 'PRESENT' }],
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error)).toMatch(/more than one/i);
  });

  it('refuses to mark a name that matches nobody, and names nobody in its place', async () => {
    const res = await mcp(OAK, admin().actor, 'mark_attendance', {
      students: [{ studentName: 'Arnav Bhatt', status: 'PRESENT' }],
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error)).toMatch(/no student named/i);
  });

  it('proposes -- and does not perform -- a mark for a student who was named unambiguously', async () => {
    const res = await mcp(OAK, admin().actor, 'mark_attendance', {
      students: [{ studentName: 'Arnav Patel', status: 'PRESENT' }],
    });
    // A proposal, because marking a register always needs confirmation.
    expect(res.action ?? res.success).toBeTruthy();
    expect(res.success === true && res.action === undefined).toBe(false);
  });
});

/* ── 4. Tenancy is not a name question ────────────────────── */

describe('4. a name is resolved inside the caller\'s own school', () => {
  it('does not reach a student of the same name in another school', async () => {
    // Riverside has its own Rahul. An Oakridge admin naming Rahul gets
    // Oakridge's, and nothing tells them the other exists.
    const res = await detail({ studentName: 'Rahul Sharma' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.admissionNo).toBe('OAK-1');

    const foreign = await detail({ studentName: 'Rahul Riverside' });
    expect(foreign.success).toBe(false);
    expect(JSON.stringify(foreign.error)).not.toMatch(/RIV-1/);
  });

  it('refuses an id belonging to another school outright', async () => {
    const res = await detail({ studentId: String(school.river.student._id) });
    expect(res.success).toBe(false);
  });

  it('answers the other school\'s admin about their own student only', async () => {
    const res = await mcp(RIVER, school.people.RIVER_ADMIN.actor, 'get_student', { studentName: 'Rahul Riverside' });
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.admissionNo).toBe('RIV-1');
  });
});
