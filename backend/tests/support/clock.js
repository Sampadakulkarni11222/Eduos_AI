import { vi, beforeAll, afterAll } from 'vitest';

/**
 * Pins the clock for a test file to a school day.
 *
 * Several suites build "today's" timetable, attendance and leave from the real
 * date, and the services refuse a Sunday (no lessons, attendance closed) and
 * read the school's day in IST. Run on a Sunday, or after 18:30 UTC when the
 * UTC and IST dates differ, those suites failed though nothing was wrong.
 *
 * Only Date is faked: timers stay real, so MongoDB, HTTP and timeouts work as
 * usual, and the clock keeps moving from the pinned moment (records created a
 * moment apart still get later timestamps).
 *
 * The pinned moment must be in the FUTURE. Mongoose stamps each heartbeat with
 * the (faked) Date.now() but compares it with a real Date it captured at load;
 * a pinned moment in the past makes every heartbeat look days old, the
 * connection reads as disconnected and queries time out while "buffering".
 */

/** The next Wednesday 10:30 IST (05:00 UTC) strictly after `from`. */
export function nextSchoolMorning(from = Date.now()) {
  const d = new Date(from);
  d.setUTCHours(5, 0, 0, 0);
  while (d.getTime() <= from || d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * TEST_CLOCK=<ISO time, in the future> pins another moment (for example a
 * Sunday evening, to reproduce a report); TEST_CLOCK=real leaves the clock alone.
 */
export function pinClock(iso = process.env.TEST_CLOCK) {
  if (iso === 'real') return;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso ?? nextSchoolMorning()), shouldAdvanceTime: true });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}
