import { describe, it, expect } from 'vitest';
import { el, toLang, parseProgram, validateProgram, safeHref, COMPONENTS, COMPONENT_NAMES } from '../src/modules/genui/lang.js';
import { programForAnswer, blocksFor, labelOf, unitOf } from '../src/modules/genui/fromResults.js';
import { planQuery, scoreText } from '../src/modules/genui/ask.service.js';
import { grounded, numbersIn } from '../src/modules/genui/compose.js';

/**
 * Generated UI (OpenUI Lang subset): the format, the deterministic generator
 * that writes it from tool results, and the sentence planner of "Ask your
 * dashboard". No database: these are pure functions.
 */

describe('OpenUI Lang subset: writing and reading', () => {
  it('round-trips a panel, hoisting each child to its own statement', () => {
    const tree = el('Panel', 'Fees', [el('Kpi', 'Collected', 1560000000, 'paise'), el('Evidence', [el('Source', 'Fee statistics', '/fees')])], 'This month');
    const src = toLang(tree);
    expect(src.split('\n')[0]).toBe('root = Panel("Fees", [c1, c2], "This month")');
    expect(src).toContain('c1 = Kpi("Collected", 1560000000, "paise")');
    const { root, errors } = parseProgram(src);
    expect(errors).toEqual([]);
    expect(root).toEqual({ $el: 'Panel', args: ['Fees', [{ $el: 'Kpi', args: ['Collected', 1560000000, 'paise'] }, { $el: 'Evidence', args: [[{ $el: 'Source', args: ['Fee statistics', '/fees'] }]] }], 'This month'] });
  });

  it('escapes record text so it can never close a string or start a statement', () => {
    const evil = 'x"), root = Danger("<script>alert(1)</script>';
    const src = toLang(el('Panel', evil, [el('Callout', 'info', `line1\nroot = Evil()`)]));
    const { root, errors } = parseProgram(src);
    expect(errors).toEqual([]);
    expect(root.args[0]).toBe(evil);
    expect(root.args[1][0].args[1]).toBe('line1\nroot = Evil()');
    expect(validateProgram(src).names).not.toContain('Danger');
  });

  it('refuses everything outside the read-only subset: $state, @actions, Query/Mutation as calls are unregistered', () => {
    expect(parseProgram('root = Panel("a", [x])\nx = Input("n", $name)').errors.join()).toMatch(/Unsupported character "\$"/);
    expect(parseProgram('root = Button("Go", @OpenUrl("https://evil.example"))').root).toBeNull();
    const q = validateProgram('root = Panel("a", [d])\nd = Query("delete_student", {id: "1"}, {})');
    expect(q.ok).toBe(false);
    expect(q.errors.join()).toMatch(/unknown component Query/);
    const m = validateProgram('root = Panel("a", [Mutation("pay_invoice", {})])');
    expect(m.errors.join()).toMatch(/unknown component Mutation/);
  });

  it('reports unknown components, too many arguments, unsafe links and a root that is not a Panel', () => {
    const v = validateProgram('root = Panel("t", [Kpi("a", 1, "count", "d", "good", "javascript:alert(1)", "extra"), Html("<b>x</b>"), Source("s", "//evil.example/x")])');
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual(expect.arrayContaining(['Kpi takes 6 arguments', 'unknown component Html', 'unsafe link //evil.example/x']));
    expect(validateProgram('root = Kpi("a", 1)').errors).toContain('root must be a Panel');
  });

  it('survives cycles, missing references and oversize programs without throwing', () => {
    const cyc = parseProgram('root = Panel("t", [a])\na = Panel("u", [root])');
    expect(cyc.errors.join()).toMatch(/cycle/);
    expect(parseProgram('root = Panel("t", [nope])').errors).toContain('unresolved nope');
    expect(parseProgram(`root = Panel("${'x'.repeat(50_000)}", [])`).root).toBeNull();
    expect(parseProgram('').root).toBeNull();
  });

  it('allows links to our own routes and allowlisted https hosts only', () => {
    expect(safeHref('/fees?tab=overdue')).toBe('/fees?tab=overdue');
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>')).toBeNull();
    expect(safeHref('/a\\b')).toBeNull();
    expect(safeHref('https://docs.example.org/x')).toBeNull();
    expect(safeHref('https://docs.example.org/x', { allowHosts: ['docs.example.org'] })).toBe('https://docs.example.org/x');
    expect(safeHref('http://docs.example.org/x', { allowHosts: ['docs.example.org'] })).toBeNull();
  });

  it('pins the component contract the frontend library implements', () => {
    expect(COMPONENT_NAMES).toEqual(['Panel', 'Kpi', 'MetricCompare', 'LineChart', 'BarChart', 'DonutChart', 'Series', 'Slice', 'Table', 'RecordList', 'Record', 'Timeline', 'Event', 'ActionCard', 'Callout', 'Evidence', 'Source']);
    expect(COMPONENTS.ActionCard.args.map(([a]) => a)).toEqual(['title', 'detail', 'ask', 'href']);
  });
});

/** Shaped like the live get_class_attendance_summary and get_fee_statistics results. */
const CLASS_ATTENDANCE = {
  tool: 'get_class_attendance_summary',
  tools: ['get_class_attendance_summary'],
  data: {
    period: { from: '2026-10-01', to: '2026-10-15', label: '2026-10-01 to 2026-10-15' },
    scope: 'SCHOOL',
    classes: [
      { sectionId: '6ad10d43654a6d0bed791cac', class: 'Class 5 A', students: 60, marked: 540, pctPresent: 90, ABSENT: 55 },
      { sectionId: '6ad10d43654a6d0bed791cae', class: 'Class 5 B', students: 60, marked: 540, pctPresent: 88, ABSENT: 64 },
      { sectionId: '6ad10d43654a6d0bed791cb0', class: 'Class 6 A', students: 60, marked: 540, pctPresent: 85, ABSENT: 81 },
    ],
  },
  evidence: [{ tool: 'get_class_attendance_summary', text: 'Class attendance summary: 3 classes', link: '/attendance' }],
};

describe('deterministic generator: tool results to a panel', () => {
  it('lays out a class list as a bar chart and a table, with the evidence footer', () => {
    const src = programForAnswer(CLASS_ATTENDANCE);
    expect(src).toMatchInlineSnapshot(`
      "root = Panel("Class attendance summary", [c1, c2, c3], "2026-10-01 to 2026-10-15")
      c1 = BarChart("Classes: Present %", ["Class 5 A", "Class 5 B", "Class 6 A"], [Series("Present %", [90, 88, 85])], "percent")
      c2 = Table("Classes", ["Class", "Present %", "Students", "Marked", "Absent"], [["Class 5 A", 90, 60, 540, 55], ["Class 5 B", 88, 60, 540, 64], ["Class 6 A", 85, 60, 540, 81]], [null, "percent", "count", "count", "count"])
      c3 = Evidence([Source("Class attendance summary: 3 classes", "/attendance")])"
    `);
    expect(validateProgram(src).ok).toBe(true);
    // Identifiers are never laid out.
    expect(src).not.toContain('6ad10d43654a6d0bed791cac');
  });

  it('turns top-level figures into KPI tiles with units from the field names', () => {
    const src = programForAnswer({ tool: 'get_fee_statistics', data: { totalBilledPaise: 3240000000, totalCollectedPaise: 1560000000, collectionPct: 48, overdueCount: 480, onlinePaymentEnabled: true } });
    expect(src).toContain('Kpi("Total billed", 3240000000, "paise")');
    expect(src).toContain('Kpi("Collection %", 48, "percent")');
    expect(src).toContain('Kpi("Overdue count", 480, "count")');
    expect(src).not.toMatch(/onlinePayment/i);
  });

  it('never lays out personal or restricted fields, even when a tool returned them', () => {
    const rows = [
      { name: 'Asha', phone: '+910000000001', email: 'a@x.in', medicalNotes: 'asthma', guardianName: 'R', marks: 81 },
      { name: 'Ravi', phone: '+910000000002', email: 'r@x.in', medicalNotes: 'none', guardianName: 'S', marks: 74 },
    ];
    const src = toLang(el('Panel', 't', blocksFor('Students', rows)));
    for (const leak of ['+9100', '@x.in', 'asthma', 'Medical', 'Guardian', 'Phone', 'Email']) expect(src).not.toContain(leak);
    expect(src).toContain('"Asha"');
  });

  it('dated rows become a timeline; rows with links become a record list with our links only', () => {
    const tl = blocksFor('Events', [{ date: '2026-10-20', title: 'PTM' }, { date: '2026-10-02', title: 'Gandhi Jayanti' }]);
    expect(tl[0].$el).toBe('Timeline');
    expect(tl[0].args[1].map((e) => e.args[1])).toEqual(['Gandhi Jayanti', 'PTM']);
    const rl = blocksFor('Tickets', [{ title: 'Fan broken', status: 'OPEN', link: '/tickets/1' }, { title: 'Leak', status: 'OPEN', link: 'javascript:alert(1)' }]);
    expect(rl[0].$el).toBe('RecordList');
    expect(rl[0].args[1][0].args[2]).toBe('/tickets/1');
    expect(rl[0].args[1][1].args[2]).toBeUndefined();
  });

  it('adds no panel to a sentence, a refusal or a write', () => {
    expect(programForAnswer({ reply: 'Hello', data: undefined })).toBeNull();
    expect(programForAnswer({ refused: 'NOT_PERMITTED', data: { a: 1 } })).toBeNull();
    expect(programForAnswer({ action: { confirmToken: 'x' }, data: { a: 1 } })).toBeNull();
    expect(programForAnswer({ tool: 'x', data: { text: 'just words' } })).toBeNull();
  });

  it('labels and units are read from field names', () => {
    expect(labelOf('totalCollectedPaise')).toBe('Total collected');
    expect(labelOf('pctPresent')).toBe('Present %');
    expect(unitOf('pendingPaise')).toBe('paise');
    expect(unitOf('attendanceRate')).toBe('percent');
    expect(unitOf('approvalDays')).toBe('days');
  });
});

describe('model output is checked against our data', () => {
  it('accepts only numbers that are in the data (small structural integers aside)', () => {
    const allowed = numbersIn({ a: 1560000000, b: [48, { c: 90.5 }] });
    expect(grounded(validateProgram('root = Panel("t", [Kpi("x", 1560000000, "paise"), Kpi("y", 90.5)])'), allowed)).toBe(true);
    expect(grounded(validateProgram('root = Panel("t", [Kpi("x", 1600000000, "paise")])'), allowed)).toBe(false);
  });
});

describe('Ask your dashboard: reading the sentence', () => {
  it('compare fee collection this year with last year by month', () => {
    const p = planQuery('compare fee collection this year with last year by month');
    expect(p).toMatchObject({ preset: 'academicYear', compare: 'lastYear', bucket: 'month', classText: null });
    expect(p.words).toEqual(expect.arrayContaining(['fee', 'collection', 'collections']));
    expect(scoreText(p.groups, 'Net fee collections')).toBeGreaterThan(scoreText(p.groups, 'Fees received (gross)', 'finance collections gross'));
  });

  it('show attendance for 7B this term', () => {
    const p = planQuery('show attendance for 7B this term');
    expect(p).toMatchObject({ term: true, compare: 'previous', classText: '7B' });
    expect(p.words).toContain('attendance');
    expect(p.words).not.toContain('7b');
  });

  it('reads class 6-A, this week and financial year', () => {
    expect(planQuery('homework in Class 6-A this week')).toMatchObject({ preset: 'week', classText: 'Class 6-A' });
    expect(planQuery('budget spent this financial year').preset).toBe('financialYear');
  });
});

describe('deterministic generator: repeated lists', () => {
  it('shows the same rows in another order only once', () => {
    const rows = [{ class: 'Class 5 A', pctPresent: 90 }, { class: 'Class 5 B', pctPresent: 80 }];
    const blocks = blocksFor('Attendance', { classes: rows, ranked: [...rows].reverse() });
    expect(blocks.filter((b) => b.$el === 'Table')).toHaveLength(1);
  });
});
