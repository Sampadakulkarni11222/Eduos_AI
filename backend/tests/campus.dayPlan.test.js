import { describe, it, expect } from 'vitest';
import {
  dayKindFor, phaseOf, bannerFor, nextOpening, bellsFromSlots, normaliseBells, localParts, instantOf, isOutdoorSubject,
} from '../src/modules/campus/day-plan.js';

/**
 * The school day as a plan, for any date and time: holidays, weekly offs,
 * vacations, closures and exam-only days from the calendar; each shift's
 * place in its bell schedule; and the banner over the map.
 */

const BELLS = [
  { kind: 'ARRIVAL', start: '07:45', end: '08:10' },
  { kind: 'ASSEMBLY', label: 'Assembly', start: '08:10', end: '08:30' },
  { kind: 'PERIOD', periodNo: 1, start: '08:30', end: '09:15' },
  { kind: 'PERIOD', periodNo: 2, start: '09:15', end: '10:00' },
  { kind: 'BREAK', label: 'Short break', start: '10:00', end: '10:15' },
  { kind: 'PERIOD', periodNo: 3, start: '10:15', end: '11:00' },
  { kind: 'PERIOD', periodNo: 4, start: '11:00', end: '11:45' },
  { kind: 'LUNCH', label: 'Lunch', start: '11:45', end: '12:30' },
  { kind: 'PERIOD', periodNo: 5, start: '12:30', end: '13:15' },
  { kind: 'PERIOD', periodNo: 6, start: '13:15', end: '14:00' },
  { kind: 'PERIOD', periodNo: 7, start: '14:15', end: '15:00' },
  { kind: 'PERIOD', periodNo: 8, start: '15:00', end: '15:45' },
  { kind: 'DISPERSAL', start: '15:45', end: '16:05' },
  { kind: 'CLUBS', label: 'Clubs', start: '16:15', end: '17:15' },
];
const SECONDARY = { code: 'SEC', name: 'Secondary shift', daysOfWeek: [1, 2, 3, 4, 5, 6], bells: BELLS };
const PRIMARY = {
  code: 'PRI', name: 'Primary shift', daysOfWeek: [1, 2, 3, 4, 5],
  bells: [
    { kind: 'ARRIVAL', start: '07:15', end: '07:40' },
    { kind: 'PERIOD', periodNo: 1, start: '07:40', end: '08:20' },
    { kind: 'PERIOD', periodNo: 2, start: '08:20', end: '09:00' },
    { kind: 'BREAK', start: '09:00', end: '09:20' },
    { kind: 'PERIOD', periodNo: 3, start: '09:20', end: '10:00' },
    { kind: 'DISPERSAL', start: '10:00', end: '10:20' },
  ],
};
const m = (hm) => { const [h, mm] = hm.split(':').map(Number); return h * 60 + mm; };
const EVENTS = [
  { title: 'Diwali Break', type: 'HOLIDAY', startsAt: new Date('2026-11-08'), endsAt: new Date('2026-11-12') },
  { title: 'Winter vacation', type: 'VACATION', startsAt: new Date('2026-12-24'), endsAt: new Date('2027-01-01') },
  { title: 'Polling day closure', type: 'CLOSURE', startsAt: new Date('2026-10-28'), endsAt: new Date('2026-10-28') },
  { title: 'Unit Test 3', type: 'EXAM_ONLY', startsAt: new Date('2026-10-30'), endsAt: new Date('2026-10-30') },
  // Saved by the calendar screen at local midnight (18:30 UTC the day before): still 20 October.
  { title: 'Dussehra', type: 'HOLIDAY', startsAt: new Date('2026-10-19T18:30:00Z'), endsAt: new Date('2026-10-20T18:29:00Z') },
  { title: 'Science Exhibition', type: 'EVENT', startsAt: new Date('2026-10-22'), endsAt: new Date('2026-10-22') },
];

describe('what kind of day a date is', () => {
  const kind = (ymd, shifts = [SECONDARY]) => dayKindFor({ ymd, events: EVENTS, shifts });
  it('names holidays, vacations and closures from the calendar', () => {
    expect(kind('2026-11-10')).toEqual({ kind: 'HOLIDAY', title: 'Diwali Break', open: false });
    expect(kind('2026-12-30')).toMatchObject({ kind: 'VACATION', title: 'Winter vacation', open: false });
    expect(kind('2026-10-28')).toMatchObject({ kind: 'CLOSURE', open: false });
    expect(kind('2026-10-20')).toMatchObject({ kind: 'HOLIDAY', title: 'Dussehra' });
    expect(kind('2026-10-21')).toMatchObject({ kind: 'SCHOOL_DAY', open: true });
  });
  it('a weekday no shift runs on is a weekly off; a plain event does not close the school', () => {
    expect(kind('2026-10-18')).toMatchObject({ kind: 'WEEKLY_OFF', title: 'Sunday', open: false });
    // Saturday: the secondary shift runs, the primary does not.
    expect(kind('2026-10-17', [PRIMARY])).toMatchObject({ kind: 'WEEKLY_OFF', title: 'Saturday' });
    expect(kind('2026-10-17', [PRIMARY, SECONDARY])).toMatchObject({ kind: 'SCHOOL_DAY' });
    expect(kind('2026-10-22')).toMatchObject({ kind: 'SCHOOL_DAY' });
  });
  it('an exam-only day is open, and says so', () => {
    expect(kind('2026-10-30')).toEqual({ kind: 'EXAM_ONLY', title: 'Unit Test 3', open: true });
  });
});

describe("where a shift is in its bell schedule", () => {
  it('walks the day from arrival to clubs', () => {
    expect(phaseOf(SECONDARY, m('07:00'))).toMatchObject({ phase: 'BEFORE', label: 'Opens 7:45 am' });
    expect(phaseOf(SECONDARY, m('07:50'))).toMatchObject({ phase: 'ARRIVAL', label: 'Arrival: first bell at 8:10 am' });
    expect(phaseOf(SECONDARY, m('08:20'))).toMatchObject({ phase: 'ASSEMBLY', label: 'Assembly' });
    expect(phaseOf(SECONDARY, m('10:48'))).toMatchObject({ phase: 'PERIOD', periodNo: 3, periodsTotal: 8, minutesLeft: 12, label: 'Period 3 of 8, 12 min left' });
    expect(phaseOf(SECONDARY, m('10:05'))).toMatchObject({ phase: 'BREAK', label: 'Short break, 10 min left' });
    expect(phaseOf(SECONDARY, m('12:00'))).toMatchObject({ phase: 'LUNCH' });
    expect(phaseOf(SECONDARY, m('14:05'))).toMatchObject({ phase: 'PASSING', nextPeriodNo: 7 });
    expect(phaseOf(SECONDARY, m('15:50'))).toMatchObject({ phase: 'DISPERSAL' });
    expect(phaseOf(SECONDARY, m('16:10'))).toMatchObject({ phase: 'AFTER', label: 'Clubs from 4:15 pm' });
    expect(phaseOf(SECONDARY, m('16:30'))).toMatchObject({ phase: 'CLUBS', label: 'Clubs' });
    expect(phaseOf(SECONDARY, m('18:00'))).toMatchObject({ phase: 'AFTER', label: 'Day over' });
  });
  it('adds an arrival window and a dispersal a school did not set', () => {
    const bells = normaliseBells([{ kind: 'PERIOD', periodNo: 1, start: '09:00', end: '10:00' }]);
    expect(bells.map((b) => [b.kind, b.start, b.end])).toEqual([['ARRIVAL', '08:35', '09:00'], ['PERIOD', '09:00', '10:00'], ['DISPERSAL', '10:00', '10:20']]);
  });
  it('reads bells off a timetable when no shift is set up (gaps become breaks and lunch)', () => {
    const bells = bellsFromSlots([
      { periodNo: 1, startTime: '08:30', endTime: '09:15' }, { periodNo: 2, startTime: '09:15', endTime: '10:00' },
      { periodNo: 3, startTime: '10:15', endTime: '11:00' }, { periodNo: 4, startTime: '11:45', endTime: '12:30' },
      { periodNo: 1, startTime: '08:30', endTime: '09:15' },
    ]);
    expect(bells.map((b) => b.kind)).toEqual(['PERIOD', 'PERIOD', 'BREAK', 'PERIOD', 'LUNCH', 'PERIOD']);
  });
});

describe('the banner over the map', () => {
  const day = { kind: 'SCHOOL_DAY', title: null, open: true };
  it('a holiday names itself and when the school opens; nobody moves', () => {
    const next = nextOpening({ ymd: '2026-11-10', minutes: m('10:00'), events: EVENTS, shifts: [SECONDARY] });
    expect(next).toMatchObject({ date: '2026-11-13', time: '07:45', label: 'Fri 13 Nov, 7:45 am' });
    expect(bannerFor({ day: dayKindFor({ ymd: '2026-11-10', events: EVENTS, shifts: [SECONDARY] }), next })).toEqual({ text: 'Holiday: Diwali Break', sub: 'Opens Fri 13 Nov, 7:45 am', tone: 'holiday', motion: false });
  });
  it('after hours says closed and when it opens (skipping Sunday)', () => {
    const next = nextOpening({ ymd: '2026-10-17', minutes: m('20:00'), events: EVENTS, shifts: [SECONDARY] });
    expect(next.label).toBe('Mon 19 Oct, 7:45 am');
    const before = nextOpening({ ymd: '2026-10-16', minutes: m('06:30'), events: EVENTS, shifts: [SECONDARY] });
    expect(bannerFor({ day, phases: [phaseOf(SECONDARY, m('06:30'))], next: before })).toMatchObject({ text: 'School closed: opens 7:45 am', motion: false });
    expect(nextOpening({ ymd: '2026-10-15', minutes: m('20:00'), events: EVENTS, shifts: [SECONDARY] }).label).toBe('tomorrow, 7:45 am');
  });
  it('a period, a break, and two shifts at different points of their day', () => {
    expect(bannerFor({ day, phases: [phaseOf(SECONDARY, m('10:48'))] })).toMatchObject({ text: 'Period 3 of 8, 12 min left', tone: 'class', motion: true });
    expect(bannerFor({ day, phases: [phaseOf(SECONDARY, m('10:05'))] })).toMatchObject({ text: 'Short break, 10 min left', tone: 'break' });
    const both = bannerFor({ day, phases: [phaseOf(PRIMARY, m('09:30')), phaseOf(SECONDARY, m('09:30'))] });
    expect(both.text).toBe('Primary shift: Period 3 of 3, 30 min left · Secondary shift: Period 2 of 8, 30 min left');
    // The primary shift has gone home; the secondary is in lessons.
    const later = bannerFor({ day, phases: [phaseOf(PRIMARY, m('13:00')), phaseOf(SECONDARY, m('13:00'))] });
    expect(later.text).toBe('Secondary shift: Period 5 of 8, 15 min left');
    expect(later.sub).toBe('Primary shift: day over');
  });
  it('an exam-only day says only classes sitting a paper are in', () => {
    const b = bannerFor({ day: { kind: 'EXAM_ONLY', title: 'Unit Test 3', open: true }, phases: [phaseOf(SECONDARY, m('09:00'))] });
    expect(b).toMatchObject({ tone: 'exam', motion: true });
    expect(b.sub).toContain('Exam day: Unit Test 3');
  });
});

describe('time helpers', () => {
  it('converts between instants and the school\'s local date and minute', () => {
    const at = instantOf('2026-10-16', m('13:30'));
    expect(at.toISOString()).toBe('2026-10-16T08:00:00.000Z');
    expect(localParts(at)).toEqual({ ymd: '2026-10-16', dow: 5, minutes: m('13:30') });
  });
  it('knows which subjects are taught outdoors', () => {
    expect(isOutdoorSubject('Physical Education')).toBe(true);
    expect(isOutdoorSubject('Games')).toBe(true);
    expect(isOutdoorSubject('Physics')).toBe(false);
    expect(isOutdoorSubject('Mathematics')).toBe(false);
  });
});
