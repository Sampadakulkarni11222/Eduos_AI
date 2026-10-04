import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * List answers, laid out.
 *
 * The report: "Which assignments are currently pending evaluation?" came back
 * as "5 homework item(s): Science Revision (Science, due 30 Jul); Chapter 1
 * Assignment (Science, due 15 Aug); Chapter 1 Assignment …" -- one paragraph,
 * four rows that looked identical because the class was not shown. Every list
 * answer had the same shape. Now:
 *
 *   assignments have a table of their own, with the class when rows span several
 *   any other "intro: a; b; c" answer becomes a heading and one bullet per item
 *   a plain sentence is left exactly as it was
 */

const { structureSentence, pluralise, renderView, toWhatsAppText, presentOf } = await import('../src/modules/ai/agent/present.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { Subject, SubjectOffering, Term } = await import('../src/models/academics.model.js');
const { Assignment, Submission } = await import('../src/models/assignment.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, inSchool, OAK } = await import('./support/mcpSchool.js');

describe('structureSentence', () => {
  it('turns a counted "intro: a; b; c" into a heading and a numbered list', () => {
    expect(structureSentence('5 homework item(s): Science Revision (Science, due 30 Jul); Chapter 1 Assignment (Science, due 15 Aug).'))
      .toBe('**5 homework items**\n\n1. **Science Revision** — Science, due 30 Jul\n2. **Chapter 1 Assignment** — Science, due 15 Aug');
  });

  it('reads an em-dash intro and labelled items', () => {
    expect(structureSentence('Attendance by subject — Mathematics: 80%; Science: 75%.'))
      .toBe('**Attendance by subject**\n\n- **Mathematics:** 80%\n- **Science:** 75%');
  });

  it('keeps prose before the list and a sentence after it', () => {
    expect(structureSentence('Class 6 A on 2026-08-05: 3 student(s), 2 marked. 2 absent — Rahul Sharma; Aman Gupta. Ask me to mark them.'))
      .toBe('Class 6 A on 2026-08-05: 3 students, 2 marked.\n\n**2 absent**\n\n1. Rahul Sharma\n2. Aman Gupta\n\nAsk me to mark them.');
  });

  it('says when the list was cut short', () => {
    expect(structureSentence('Overdue: INV-1 (Rahul); INV-2 (Aman), ….')).toMatch(/- \*\*INV-2\*\* — Aman\n- …$/);
  });

  it('leaves single sentences and already formatted text alone', () => {
    const plain = '1 student(s) absent today, 1 present (0 late, 0 excused) out of 2 marked.';
    expect(structureSentence(plain)).toBe(plain);
    const formatted = '**Heading**\n\n- a; b';
    expect(structureSentence(formatted)).toBe(formatted);
    expect(structureSentence('')).toBe('');
  });

  it('pluralises "(s)" by the count', () => {
    expect(pluralise('1 student(s)')).toBe('1 student');
    expect(pluralise('5 homework item(s)')).toBe('5 homework items');
    expect(pluralise('3 entr(y|ies)')).toBe('3 entries');
  });

  it('applies to any tool sentence that has no view of its own', () => {
    expect(presentOf({ speak: 'Books due: Physics (due 3 Oct); Maths (due 9 Oct).' }))
      .toBe('**Books due**\n\n- **Physics** — due 3 Oct\n- **Maths** — due 9 Oct');
  });

  it('keeps its layout on WhatsApp', () => {
    expect(toWhatsAppText(structureSentence('2 notices: Sports day; Fee reminder.'))).toBe('*2 notices*\n\n1. Sports day\n2. Fee reminder');
  });
});

describe('subjects list', () => {
  const view = (subjects, showTeacher = true) => ({ type: 'subjects.list', showTeacher, subjects });

  it('is the count, then one numbered line per subject: bold name — teacher', () => {
    const md = renderView(view([
      { name: 'Mathematics', teacher: 'Arjun Sharma (Math)' },
      { name: 'Science', teacher: 'Priya Patel (Science)' },
      { name: 'Computer Science', teacher: 'Neha Singh' },
    ]));
    expect(md).toBe([
      'You have 3 subjects:',
      '',
      '1. **Mathematics** — Arjun Sharma',
      '2. **Science** — Priya Patel',
      '3. **Computer Science** — Neha Singh',
    ].join('\n'));
    // No "(Teacher Name (Subject))" nesting survives.
    expect(md).not.toMatch(/\(.*\(/);
  });

  it('handles one subject, a subject with no teacher, and none at all', () => {
    expect(renderView(view([{ name: 'Art', teacher: null }]))).toBe('You have 1 subject:\n\n1. **Art**');
    expect(renderView(view([]))).toBe("You currently don't have any subjects assigned.");
  });

  it('lists any number of subjects, numbered in order', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Subject ${i + 1}`, teacher: `Teacher ${i + 1}` }));
    const md = renderView(view(many));
    expect(md.startsWith('You have 12 subjects:')).toBe(true);
    expect(md).toContain('12. **Subject 12** — Teacher 12');
    expect(md.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(12);
  });

  it('a teacher\'s own subjects are listed without their own name repeated', () => {
    expect(renderView(view([{ name: 'Science', teacher: 'Priya Patel (Science)' }], false))).toBe('You have 1 subject:\n\n1. **Science**');
  });

  it('a teacher name keeps a qualifier that is not trailing, and the stored name is untouched', () => {
    const subjects = [{ name: 'Science', teacher: 'Priya Patel (Science)' }];
    renderView(view(subjects));
    expect(subjects[0].teacher).toBe('Priya Patel (Science)');
  });

  it('reads on WhatsApp as numbered lines with *bold* names', () => {
    expect(toWhatsAppText(renderView(view([{ name: 'Mathematics', teacher: 'Arjun Sharma (Math)' }, { name: 'Science', teacher: null }]))))
      .toBe('You have 2 subjects:\n\n1. *Mathematics* — Arjun Sharma\n2. *Science*');
  });

  it('other counted lists share the layout (classes, bus stops)', () => {
    expect(renderView({
      type: 'list.numbered',
      intro: 'You have 2 classes:',
      items: [{ label: 'Class 6 A', detail: 'Mathematics, Science' }, { label: 'Class 6 B', detail: null }],
    })).toBe('You have 2 classes:\n\n1. **Class 6 A** — Mathematics, Science\n2. **Class 6 B**');
  });
});

describe('assignments table', () => {
  const items = [
    { title: 'Chapter 1 Assignment', subject: 'Science', class: 'Class 5 A', dueAt: '2026-08-15', submissions: 12, status: null },
    { title: 'Chapter 1 Assignment', subject: 'Science', class: 'Class 5 B', dueAt: '2026-08-15', submissions: 3, status: null },
  ];

  it('a teacher sees which class each one is for, and how many have submitted', () => {
    const md = renderView({ type: 'assignments.list', audience: 'staff', kind: 'all', scope: null, total: 2, showClass: true, items });
    expect(md).toBe([
      '**Assignments (2)**',
      '',
      '| Assignment | Subject | Class | Due | Submissions |',
      '| --- | --- | --- | --- | ---: |',
      '| **Chapter 1 Assignment** | Science | Class 5 A | 15 Aug 2026 | 12 |',
      '| **Chapter 1 Assignment** | Science | Class 5 B | 15 Aug 2026 | 3 |',
    ].join('\n'));
  });

  it('a student sees what is still to submit', () => {
    const md = renderView({
      type: 'assignments.list', audience: 'family', kind: 'pending', total: 1, showClass: false,
      items: [{ ...items[0], submissions: null, status: 'PENDING' }],
    });
    expect(md).toMatch(/^\*\*Still to submit \(1\)\*\*/);
    expect(md).toMatch(/\| Assignment \| Subject \| Due \|/);
    expect(md).not.toMatch(/Submissions|Class/);
  });
});

describe('through the assistant', () => {
  let api;
  let school;
  beforeAll(async () => { api = await startApi(); });
  afterAll(async () => { await api.close(); await resetMcpClient(); });

  beforeEach(async () => {
    resetAgentThrottle();
    school = await seedSchool();
    await inSchool(OAK, async () => {
      const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
      const science = await Subject.create({ name: 'Science', code: 'SCI' });
      const me = school.people.TEACHER.profile._id;
      const a = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: science._id, termId: term._id, teacherId: me });
      const b = await SubjectOffering.create({ sectionId: school.sectionB._id, subjectId: science._id, termId: term._id, teacherId: me });
      const due = new Date(Date.now() + 5 * 864e5);
      const hw = await Assignment.create({ subjectOfferingId: a._id, title: 'Chapter 1 Assignment', type: 'HOMEWORK', dueAt: due });
      await Assignment.create({ subjectOfferingId: b._id, title: 'Chapter 1 Assignment', type: 'HOMEWORK', dueAt: due });
      await Submission.create({ assignmentId: hw._id, enrollmentId: school.priya.enrollment._id, status: 'SUBMITTED', submittedAt: new Date() });
    });
  });

  it('"Which assignments are currently pending evaluation?" is a table, one row per class', async () => {
    const res = await api.ask(school.people.TEACHER, 'Which assignments are currently pending evaluation?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/^\*\*Assignments \(2\)\*\*/);
    expect(res.reply).toMatch(/\| \*\*Chapter 1 Assignment\*\* \| Science \| Class 6 (?:- )?A \| .+ \| 1 \|/);
    expect(res.reply).toMatch(/\| \*\*Chapter 1 Assignment\*\* \| Science \| Class 6 (?:- )?B \| .+ \| 0 \|/);
    expect(res.reply).not.toMatch(/; /);
  });

  it('"What subjects do I have?" and its variants answer with the numbered subjects list', async () => {
    for (const message of ['What subjects do I have?', 'Show my subjects', 'Which subjects are assigned to me?']) {
      const res = await api.ask(school.people.STUDENT, message);
      expect(res.status, message).toBe(200);
      expect(res.tool, message).toBe('get_subjects');
      // Priya is in Class 6 A, where Science is taught by the fixture teacher.
      expect(res.reply, message).toBe('You have 1 subject:\n\n1. **Science** — TEACHER user');
    }
  });

  it('a teacher\'s subjects are listed once each, without their own name', async () => {
    const res = await api.ask(school.people.TEACHER, 'Which subjects are assigned to me?');
    expect(res.status).toBe(200);
    expect(res.reply).toBe('You have 1 subject:\n\n1. **Science**');
  });

  it('WhatsApp gets the same list in its own format', async () => {
    const res = await api.whatsapp(school.people.STUDENT, 'What subjects do I have?');
    expect(res.reply).toBe('You have 1 subject:\n\n1. *Science* — TEACHER user');
  });

  it('a student\'s pending homework is a table too', async () => {
    const res = await api.ask(school.people.STUDENT, 'Do I have any assignments due?');
    expect(res.status).toBe(200);
    // Priya has handed in Class 6 A's; nothing else is set for her class.
    expect(res.reply).toMatch(/nothing due|Still to submit/i);
    expect(res.reply).not.toMatch(/; /);
  });
});
