import { describe, it, expect } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { unmetNarrowing } from '../src/modules/ai/agent/capabilityResolver.js';
import { getMcpTool } from '../src/modules/ai/mcp/registry.js';
import { actorForRole } from './support/mcpSchool.js';

/**
 * The second manual report, replayed: the ADMIN assistant.
 *
 * Every sentence here was typed into the Web assistant by a person testing it,
 * and every one of them failed. Three kinds of failure, and the kinds matter
 * more than the sentences:
 *
 *   FELL THROUGH   "Show details of Diya Patel", "Mark test_Stud present in
 *                  class today", "What is scheduled for day after tomorrow?"
 *                  -- answered with the list of topics the assistant can help
 *                  with, which is what it says when it understood nothing.
 *   LOST THE POINT "Mark Diya Patel present in Class 5-A" reached the register
 *                  without the class; the reply asked again for what had just
 *                  been said.
 *   ASKED VAGUELY  "Create Mathematics homework for Class 5-A" was answered
 *                  with "I need a bit more to do that" and no clue what.
 *
 * As in mcp.manualScenarios.test.js, this file asserts what a sentence must
 * REACH and what it must CARRY. It does not implement the reaching: nothing in
 * src/ holds this list, and if resolution ever becomes a table of phrases the
 * architecture tests beside this one fail while these still pass.
 *
 * Names here are ordinary fixtures -- any student's name behaves the same way,
 * which is what mcp.studentIdentity.test.js checks against a real register.
 */

const route = (roleKey, message) => parseIntent(message, actorForRole(roleKey));

const reaches = (roleKey, message, tool, args = {}) => {
  const step = route(roleKey, message);
  expect(step, `${roleKey}: "${message}" reached no capability`).toBeTruthy();
  expect(step.tool, `${roleKey}: "${message}"`).toBe(tool);
  for (const [key, value] of Object.entries(args)) {
    expect(step.args?.[key], `${roleKey}: "${message}" lost ${key}`).toEqual(value);
  }
  return step;
};

/* ── Issue 3: one student's record, asked for in words ────── */

describe('a request for one student\'s details reaches the student\'s record', () => {
  it('reaches it however the request is phrased', () => {
    for (const message of [
      'Show the details of Arnav Patel',
      'Show details of Diya Patel',
      'Show information about Rahul Sharma',
      'Tell me about Diya Patel',
      'Get details for Diya Patel',
    ]) {
      const step = reaches('ADMIN', message, 'get_student');
      // And it carries WHO was asked about -- the point of the request.
      expect(step.args.studentName, message).toBeTruthy();
    }
  });

  it('carries the name exactly as it was written', () => {
    expect(reaches('ADMIN', 'Show details of Diya Patel', 'get_student').args.studentName).toBe('Diya Patel');
    expect(reaches('ADMIN', 'Show the details of Arnav Patel', 'get_student').args.studentName).toBe('Arnav Patel');
  });

  it('reaches it by admission number, with or without the word "student"', () => {
    expect(reaches('ADMIN', 'Show details of ADM-2026-0720', 'get_student').args.admissionNo).toBe('ADM-2026-0720');
    expect(reaches('ADMIN', 'Show details of student ADM-2026-0720.', 'get_student').args.admissionNo)
      .toBe('ADM-2026-0720');
  });

  it('still sends a SEARCH to the directory rather than to one record', () => {
    // The distinction the whole of mcp.studentIdentity.test.js rests on:
    // finding is not choosing.
    for (const message of ['Find student Diya Patel', 'find student Diya sharma', 'Find student DiyaPatel']) {
      const step = reaches('ADMIN', message, 'search_students');
      expect(step.args.query, message).toBeTruthy();
    }
  });

  it('does not answer a question about a facet of a student with the record itself', () => {
    // The counter-test for the rule that makes the above work: naming a person
    // says what the question is ABOUT only while it names nothing else.
    expect(route('ADMIN', "show Rahul's performance")?.tool).toBe('get_performance');
    expect(route('ADMIN', "Show Rahul's attendance")?.tool).toBe('get_student_attendance');
  });
});

/* ── Issue 4: marking a register from a sentence ──────────── */

describe('marking attendance reaches the register, with everything the sentence said', () => {
  it('carries the student and the status', () => {
    const step = reaches('ADMIN', 'Mark Rahul Sharma absent today', 'mark_attendance');
    expect(step.args.students).toEqual([{ studentName: 'Rahul Sharma', status: 'ABSENT' }]);
  });

  it('carries a name that is an account name rather than a person\'s', () => {
    // "test_Stud" is the shape of name a school's own test account has. A
    // register that holds one has to be markable for it.
    const step = reaches('ADMIN', 'Mark test_Stud present in class today', 'mark_attendance');
    expect(step.args.students).toEqual([{ studentName: 'test_Stud', status: 'PRESENT' }]);
  });

  it('keeps the class when one is named as well', () => {
    // The reported loss: the register was reached without the class, so the
    // reply asked for what the sentence had just given.
    const step = reaches('ADMIN', 'Mark Diya Patel present in Class 5-A', 'mark_attendance');
    expect(step.args.students).toEqual([{ studentName: 'Diya Patel', status: 'PRESENT' }]);
    expect(step.args.className).toMatch(/5-?A/i);
  });

  it('reaches the register for a class alone, and leaves it to ask who and as what', () => {
    // Correct behaviour, not a defect: the sentence names neither the students
    // nor the status, and the tool asks for exactly those.
    const step = reaches('ADMIN', 'Mark attendance for Class 5-A', 'mark_attendance');
    expect(step.args.className).toMatch(/5-?A/i);
    expect(step.args.students).toBeUndefined();
  });

  it('reads a surname as part of the name and never as a school subject', () => {
    // The defect underneath three of the failures above: the word before
    // "absent" was read as a subject, and every attendance capability was then
    // penalised for not being able to express one.
    for (const message of ['Mark Rahul Sharma absent today', 'Mark Diya Patel present in Class 5-A']) {
      expect(route('ADMIN', message)?.args?.subject, message).toBeUndefined();
    }
  });
});

/* ── Issue 5: setting homework ────────────────────────────── */

describe('setting homework reaches an assignment, keeping the class, subject and task', () => {
  it('keeps the section, not just the grade', () => {
    // The regression this must never repeat: "Class 5-A" read as "Class 5",
    // which sets homework for the wrong children.
    const step = reaches('ADMIN', 'Create Mathematics homework for Class 5-A.', 'create_assignment');
    expect(step.args.className).toBe('Class 5-A');
    expect(step.args.subject).toBe('Mathematics');
  });

  it('keeps the task itself when the sentence gives it', () => {
    const step = reaches(
      'ADMIN',
      'Create Mathematics homework for Class 5-A: Solve the linear equations examples.',
      'create_assignment',
    );
    expect(step.args.className).toBe('Class 5-A');
    expect(step.args.subject).toBe('Mathematics');
    expect(step.args.title).toBe('Solve the linear equations examples');
  });

  it('needs no identifier nobody could type', () => {
    // Why it was unreachable: it required a subjectOfferingId. What is still
    // required must be sayable, so the tool can ask for it.
    const tool = getMcpTool('create_assignment');
    expect(tool.inputSchema.required).not.toContain('subjectOfferingId');
    for (const name of tool.inputSchema.required) {
      expect(tool.inputSchema.properties[name].pattern ?? '', name).not.toContain('a-f0-9');
    }
  });
});

/* ── Issue 6: a day named in words ────────────────────────── */

describe('a day named in words reaches what is on that day', () => {
  it('resolves "day after tomorrow" to a date and asks the calendar', () => {
    const step = reaches('ADMIN', 'What is scheduled for day after tomorrow?', 'get_calendar_events');
    const now = new Date();
    const expected = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 2))
      .toISOString()
      .slice(0, 10);
    expect(step.args.from).toBe(expected);
    expect(step.args.to).toBe(expected);
  });

  it('reads the other spoken days the same way', () => {
    for (const [said, offset] of [['today', 0], ['tomorrow', 1], ['yesterday', -1]]) {
      const step = route('ADMIN', `What is scheduled for ${said}?`);
      expect(step?.tool, said).toBe('get_calendar_events');
      const now = new Date();
      const expected = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset))
        .toISOString()
        .slice(0, 10);
      expect(step.args.from, said).toBe(expected);
    }
  });

  it('keeps a timetable question on the timetable', () => {
    const step = reaches('ADMIN', "Show today's timetable for Class 5-A", 'get_timetable');
    expect(step.args.className).toMatch(/5-?A/i);
  });
});

/* ── Issue 7: what the Web cannot do either ───────────────── */

describe('an aggregate no EduOS service can produce is declined, not approximated', () => {
  const ASKED = 'Show attendance statistics for Class 5-A for the last 1 year';

  it('reaches nothing, rather than a figure about a different period or a different class', () => {
    // There is no class-level attendance aggregate over a range anywhere in
    // EduOS: /attendance/summary takes one enrolment, /attendance/roster takes
    // one date. The Web cannot answer this, so neither may this -- and the one
    // thing that must never happen is today's figure, or the school's, offered
    // as though it were the answer.
    expect(route('ADMIN', ASKED)).toBeNull();
  });

  it('can say WHICH part of the request it could not honour', () => {
    const unmet = unmetNarrowing(ASKED, actorForRole('ADMIN'));
    expect(unmet, 'the turn could not explain itself').toBeTruthy();
    expect(unmet.missing).toContain('range');
    expect(unmet.words.join(' ')).toMatch(/date range/);
  });

  it('answers the supported form of the same question', () => {
    // The alternative is real, which is what makes declining the wider one
    // honest rather than a shrug.
    expect(route('ADMIN', 'Show the attendance of Class 5-A today')?.tool).toBe('get_attendance_roster');
  });
});

/* ── Issue 12: what already worked, still working ─────────── */

describe('the requests that already worked are unchanged', () => {
  it('shows a class timetable, with teacher names', () => {
    const step = reaches('ADMIN', 'Show Class 5-A timetable with teacher names', 'get_timetable');
    expect(step.args.className).toMatch(/5-?A/i);
  });

  it('updates the latest announcement for a class, changing only its message', () => {
    const step = reaches(
      'ADMIN',
      "Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.",
      'update_announcement',
    );
    expect(step.args.className).toMatch(/5-?A/i);
    expect(step.args.latest).toBe(true);
    expect(step.args.content).toBe('Submit the books');
    // No stray rename: the quoted words are the message, not a new title.
    expect(step.args.title).toBeUndefined();
  });

  it('lists the students of the school', () => {
    reaches('ADMIN', 'Show me the list of students in my school.', 'search_students');
  });
});
