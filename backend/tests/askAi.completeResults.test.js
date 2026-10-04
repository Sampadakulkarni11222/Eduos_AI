import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';

/**
 * Large answers are complete, for every role.
 *
 * The assistant used to cut lists at the data layer: summarise() kept five
 * names, tools defaulted to 10/20/25/50 rows, and the Meta WhatsApp sender
 * sent `text.slice(0, 4096)`. Every one of those decided what a person could
 * ever see, before any screen had a say. Now:
 *
 *   tools return every row the caller is authorized to see (paging through
 *     services that paginate), cut only when the person asked for a number;
 *   the website collapses a long list behind "Read more" (frontend tests);
 *   WhatsApp sends a long reply as numbered parts, losing no line.
 *
 * The shared pieces are tested directly; a few end-to-end questions per role
 * prove the common path, with more rows than any old default and more than
 * one 200-row service page.
 */

// The registry first: the MCP tool modules have an import cycle (see the note
// on wrapAgentTool in _shared.js) that resolves only when entered from here.
const { parseIntent } = await import('../src/modules/ai/agent/intent.js');
await import('../src/modules/ai/mcp/registry.js');
const {
  summarise, collectPages, collectCursor, askedLimit, resultWindow, windowSlice, rangeOf, RESULT_WINDOW,
} = await import('../src/modules/ai/mcp/tools/_shared.js');
const { chunkForWhatsApp, WHATSAPP_PART_CHARS, rangeNote, presentOf } = await import('../src/modules/ai/agent/present.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { Student, Enrollment } = await import('../src/models/student.model.js');
const { Subject, SubjectOffering, Term } = await import('../src/models/academics.model.js');
const { Assignment } = await import('../src/models/assignment.model.js');
const { Announcement } = await import('../src/models/announcement.model.js');
const { HostelRoom, HostelAllocation } = await import('../src/models/hostel.model.js');
const { Book, BookIssue } = await import('../src/models/library.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, inSchool, OAK, RIVER } = await import('./support/mcpSchool.js');

const pad = (n) => String(n).padStart(3, '0');

/* ── 1. The shared pieces ───────────────────────────────────── */

describe('data: complete, a window at a time, limited only on request', () => {
  const items = Array.from({ length: 40 }, (_, i) => `Item ${i + 1}`);

  it('summarise lists every item unless a number was asked for', () => {
    const all = summarise(items, (x) => x);
    expect(all.shown).toBe(40);
    expect(all.more).toBe(false);
    expect(all.list.split('; ')).toEqual(items);
    const ten = summarise(items, (x) => x, { limit: 10 });
    expect(ten.shown).toBe(10);
    expect(ten.more).toBe(true);
  });

  it('a number asked for is exactly that many, with nothing offered after it', () => {
    expect(askedLimit({ limit: 10 })).toBe(10);
    expect(askedLimit({})).toBeNull();
    const win = resultWindow({ window: { offset: 2000 } }, { limit: 20 });
    expect(win).toMatchObject({ offset: 0, size: 20, asked: true });
    expect(rangeOf(win, 20, 4500).next).toBeNull();
  });

  it('no number asked: windows of RESULT_WINDOW rows, resuming where the last ended', () => {
    expect(resultWindow({}, {})).toMatchObject({ offset: 0, size: RESULT_WINDOW, asked: false });
    expect(resultWindow({ window: { offset: 1000 } }, {})).toMatchObject({ offset: 1000 });
    // Nonsense from outside is ignored rather than trusted.
    expect(resultWindow({ window: { offset: -5 } }, {}).offset).toBe(0);
    expect(resultWindow({ window: { offset: 'x' } }, {}).offset).toBe(0);
  });

  /** Walks every window of `n` rows exactly as the agent does, via rangeOf().next. */
  const walk = (n) => {
    const rows = Array.from({ length: n }, (_, i) => i + 1);
    const seen = [];
    const ranges = [];
    let ctx = {};
    for (let guard = 0; guard < 100; guard++) {
      const win = resultWindow(ctx, {});
      const { items, total } = windowSlice(rows, win);
      const range = rangeOf(win, items.length, total);
      seen.push(...items);
      ranges.push(range);
      if (!range.next) break;
      ctx = { window: range.next };
    }
    return { seen, ranges };
  };

  for (const n of [10, 100, 999, 1000, 1001, 2500, 4500]) {
    it(`${n} records: every one reachable, none duplicated or skipped`, () => {
      const { seen, ranges } = walk(n);
      expect(seen).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(ranges).toHaveLength(Math.max(1, Math.ceil(n / RESULT_WINDOW)));
      // Windows are contiguous: each starts right after the previous one.
      ranges.forEach((r, i) => {
        expect(r.from).toBe(i * RESULT_WINDOW + 1);
        expect(r.total).toBe(n);
      });
      expect(ranges.at(-1).to).toBe(n);
      expect(ranges.at(-1).next).toBeNull();
    });
  }

  it('the window note says which rows an answer holds, and only when it is partial', () => {
    expect(rangeNote({ from: 1, to: 40, total: 40, next: null })).toBeNull();
    expect(rangeNote({ from: 1, to: 1000, total: 4500, next: { offset: 1000 } })).toBe('_Showing 1–1000 of 4500._');
    expect(rangeNote({ from: 4001, to: 4500, total: 4500, next: null })).toBe('_Showing 4001–4500 of 4500._');
  });

  it('a later window is numbered on from where it starts', () => {
    const text = presentOf({
      speak: '4500 student(s): Ana; Ben; Cy.',
      range: { from: 1001, to: 1003, total: 4500, next: { offset: 1003 } },
    });
    expect(text).toMatch(/^\*\*4500 students\*\*\n\n1001\. Ana\n1002\. Ben\n1003\. Cy\n\n_Showing 1001–1003 of 4500\._$/);
  });

  // Behaves like utils/paginate.js: an out-of-range page is clamped to the last one.
  const pagedService = (rows, sizes = []) => async (page, pageSize) => {
    sizes.push(pageSize);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const p = Math.min(page, totalPages);
    return { items: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, totalPages };
  };

  it('collectPages reads one window with one page size, from any offset, and never loops at the end', async () => {
    const rows = Array.from({ length: 2450 }, (_, i) => i);
    const sizes = [];
    const fetchPage = pagedService(rows, sizes);
    expect((await collectPages(fetchPage, { offset: 0, size: 1000 })).items).toEqual(rows.slice(0, 1000));
    expect((await collectPages(fetchPage, { offset: 1000, size: 1000 })).items).toEqual(rows.slice(1000, 2000));
    expect((await collectPages(fetchPage, { offset: 2000, size: 1000 })).items).toEqual(rows.slice(2000));
    // An offset that is not a whole number of pages.
    expect((await collectPages(fetchPage, { offset: 450, size: 30 })).items).toEqual(rows.slice(450, 480));
    // Past the end: nothing, rather than the clamped last page again.
    expect((await collectPages(fetchPage, { offset: 2450, size: 1000 })).items).toEqual([]);
    expect(new Set(sizes).size).toBe(1);
  });

  it('collectCursor resumes at the cursor and reports what follows', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const fetchPage = async (cursor, limit) => {
      const start = cursor ?? 0;
      return { items: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? start + limit : null };
    };
    const first = await collectCursor(fetchPage, { size: 1000, cursor: null });
    expect(first.items).toEqual(rows.slice(0, 1000));
    expect(first.more).toBe(true);
    const second = await collectCursor(fetchPage, { size: 1000, cursor: first.cursor });
    expect(second.items).toEqual(rows.slice(1000, 2000));
    const third = await collectCursor(fetchPage, { size: 1000, cursor: second.cursor });
    expect(third.items).toEqual(rows.slice(2000));
    expect(third.more).toBe(false);
  });
});

describe('WhatsApp: a long reply becomes numbered parts, losing nothing', () => {
  const reply = ['*Students*', '', ...Array.from({ length: 300 }, (_, i) => `${i + 1}. *Student ${pad(i + 1)}* — Class 6 A`)].join('\n');

  it('a short reply is one message, unchanged', () => {
    expect(chunkForWhatsApp('You have 3 subjects:\n\n1. *Maths*')).toEqual(['You have 3 subjects:\n\n1. *Maths*']);
    expect(chunkForWhatsApp('')).toEqual([]);
  });

  it('a long one is split between lines into titled parts within the limit', () => {
    const parts = chunkForWhatsApp(reply);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, i) => {
      expect(part.length).toBeLessThanOrEqual(4096);
      expect(part.length).toBeLessThanOrEqual(WHATSAPP_PART_CHARS);
      expect(part.startsWith(`*Students — Part ${i + 1}/${parts.length}*\n\n`)).toBe(true);
    });
    // Every line, exactly once, in order -- numbering carries across parts.
    const lines = parts.flatMap((p) => p.split('\n').filter((l) => /^\d+\. /.test(l)));
    expect(lines).toHaveLength(300);
    expect(lines.map((l) => Number(l.split('.')[0]))).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
  });

  it('even one very long line is split at words, not dropped', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    const parts = chunkForWhatsApp(long);
    expect(parts.length).toBeGreaterThan(1);
    const words = parts.flatMap((p) => p.split('\n\n').slice(1).join(' ').split(/\s+/)).filter(Boolean);
    expect(words).toEqual(long.split(' '));
  });
});

/* ── 2. Every role, through the common path ─────────────────── */

describe('every role gets its complete, authorized list', () => {
  let api;
  let school;
  const PUPILS = 230; // more than one 200-row service page, and every old default

  beforeAll(async () => { api = await startApi(); });
  afterAll(async () => { await api.close(); await resetMcpClient(); });

  beforeEach(async () => {
    resetAgentThrottle();
    school = await seedSchool();
    await inSchool(OAK, async () => {
      // Class 6 A gets PUPILS more students.
      for (let start = 0; start < PUPILS; start += 50) {
        await Promise.all(Array.from({ length: Math.min(50, PUPILS - start) }, async (_, k) => {
          const i = start + k + 1;
          const student = await Student.create({ admissionNo: `OAK-P${pad(i)}`, firstName: 'Pupil', lastName: pad(i) });
          await Enrollment.create({
            studentId: student._id, sectionId: school.sectionA._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo: 100 + i,
          });
        }));
      }

      // 15 pieces of homework for Class 6 A.
      const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
      const maths = await Subject.create({ name: 'Mathematics', code: 'MATH' });
      const offering = await SubjectOffering.create({
        sectionId: school.sectionA._id, subjectId: maths._id, termId: term._id, teacherId: school.people.TEACHER.profile._id,
      });
      for (let i = 1; i <= 15; i++) {
        await Assignment.create({
          subjectOfferingId: offering._id, title: `Worksheet ${pad(i)}`, type: 'HOMEWORK', dueAt: new Date(Date.now() + i * 864e5),
        });
      }

      // 15 notices to everyone (the fixture adds two more).
      for (let i = 1; i <= 15; i++) {
        await Announcement.create({
          title: `Notice ${pad(i)}`, content: 'x', audience: { all: true },
          createdByProfileId: school.people.ADMIN.profile._id, publishedAt: new Date(Date.now() - i * 60_000),
        });
      }

      // 15 hostel residents.
      const room = await HostelRoom.create({ roomNo: 'H-1', block: 'H', capacity: 20, type: 'BOYS' });
      const residents = await Student.find({ admissionNo: /^OAK-P0(0\d|1[0-5])$/ }).limit(15);
      for (const r of residents) {
        await HostelAllocation.create({ roomId: room._id, studentId: r._id, status: 'ACTIVE', allottedAt: new Date() });
      }

      // 15 overdue loans.
      for (let i = 1; i <= 15; i++) {
        const book = await Book.create({ title: `Volume ${pad(i)}`, author: 'A', totalCopies: 1, availableCopies: 0 });
        await BookIssue.create({
          bookId: book._id, borrowerProfileId: new mongoose.Types.ObjectId(), borrowerName: `Reader ${pad(i)}`,
          issuedAt: new Date(Date.now() - 30 * 864e5), dueDate: new Date(Date.now() - 7 * 864e5), status: 'ACTIVE',
        });
      }
    });
  }, 240_000);

  const ask = async (person, message) => {
    const res = await api.ask(person, message);
    expect(res.status, `${message}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    return res;
  };
  const pupilsIn = (text) => new Set(String(text).match(/Pupil \d{3}/g) ?? []);

  it('ADMIN — "Show all students": every one of them, across service pages', async () => {
    for (const message of ['Show all students', 'List all students', 'Show me every student']) {
      const res = await ask(school.people.ADMIN, message);
      expect(res.tool, message).toBe('search_students');
      expect(pupilsIn(res.reply).size, message).toBe(PUPILS);
      // And nothing was replaced by "…" or "and N more".
      expect(res.reply, message).not.toMatch(/…|and \d+ more|First \d+:/);
    }
  }, 120_000);

  it('ADMIN — "Show me the top 10 students": exactly 10', async () => {
    const res = await ask(school.people.ADMIN, 'Show me the top 10 students');
    expect(res.tool).toBe('search_students');
    const listed = String(res.reply).split('\n').filter((l) => /^\d+\. /.test(l));
    expect(listed).toHaveLength(10);
  }, 60_000);

  it('PRINCIPAL — the whole school\'s students', async () => {
    const res = await ask(school.people.PRINCIPAL, 'Show all students');
    expect(pupilsIn(res.reply).size).toBe(PUPILS);
  }, 60_000);

  it('TEACHER — every pupil in their own class, and nobody from another', async () => {
    const res = await ask(school.people.TEACHER, 'Show students in my Class 6-A');
    expect(pupilsIn(res.reply).size).toBe(PUPILS);
    expect(res.reply).not.toMatch(/Riya Kapoor/); // Class 6 B
  }, 60_000);

  it('STUDENT — every piece of homework still due', async () => {
    const res = await ask(school.people.STUDENT, 'Do I have any assignments due?');
    const titles = new Set(String(res.reply).match(/Worksheet \d{3}/g));
    expect(titles.size).toBe(15);
  }, 60_000);

  it('PARENT — every notice addressed to them', async () => {
    const res = await ask(school.people.PARENT, 'Show announcements');
    expect(res.tool).toBe('get_announcements');
    expect(new Set(String(res.reply).match(/Notice \d{3}/g)).size).toBe(15);
  }, 60_000);

  it('WARDEN — every hostel resident', async () => {
    const res = await ask(school.people.WARDEN, 'show all hostel residents');
    expect(pupilsIn(res.reply).size).toBe(15);
  }, 60_000);

  it('LIBRARIAN — every overdue book', async () => {
    const res = await ask(school.people.LIBRARIAN, 'Which books are overdue?');
    expect(new Set(String(res.reply).match(/Volume \d{3}/g)).size).toBe(15);
  }, 60_000);

  it('school isolation: another school\'s administrator sees none of these pupils', async () => {
    const res = await ask(school.people.RIVER_ADMIN, 'Show all students');
    expect(pupilsIn(res.reply).size).toBe(0);
    expect(res.reply).toMatch(/Rahul Riverside/);
  }, 60_000);

  it('authorization: a student asking for every student is still refused', async () => {
    const res = await api.ask(school.people.STUDENT, 'Show all students');
    expect(pupilsIn(res.reply ?? res.body?.message).size).toBe(0);
  }, 60_000);

  it('routing is unchanged: the same tools answer as before', () => {
    expect(parseIntent('Show all students', school.people.ADMIN.actor)?.tool).toBe('search_students');
    expect(parseIntent('Show me the top 10 students', school.people.ADMIN.actor)?.args).toEqual({ limit: 10 });
    expect(parseIntent('show all hostel residents', school.people.WARDEN.actor)?.tool).toBe('get_hostel_residents');
  });

  it('WhatsApp — the full list arrives as numbered parts', async () => {
    const res = await api.whatsapp(school.people.ADMIN, 'Show all students');
    expect(res.status).toBe(200);
    const parts = res.body.data.replies[0].parts;
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, i) => {
      expect(part.length).toBeLessThanOrEqual(4096);
      expect(part).toMatch(new RegExp(`Part ${i + 1}/${parts.length}\\*`));
    });
    // Every pupil, each exactly once, across the parts.
    const all = parts.join('\n').match(/Pupil \d{3}/g);
    expect(all).toHaveLength(PUPILS);
    expect(new Set(all).size).toBe(PUPILS);
  }, 120_000);
});

it('isolation fixture sanity: Riverside has its own school', () => {
  expect(RIVER).not.toBe(OAK);
});
