import { it, expect } from 'vitest';
import { compareInbox, PRIORITY_RANK } from '../src/modules/approvals/approval.service.js';

/**
 * Audit P-APR-1: the inbox sorted the priority *string* in Mongo (U > N > L > H,
 * so HIGH ranked lowest) and then re-sorted by overdue and due date alone,
 * discarding priority entirely. An URGENT request due next week sat below a
 * LOW one due tomorrow.
 */

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

it('ranks priority numerically', () => {
  expect(PRIORITY_RANK.URGENT).toBeGreaterThan(PRIORITY_RANK.HIGH);
  expect(PRIORITY_RANK.HIGH).toBeGreaterThan(PRIORITY_RANK.NORMAL);
  expect(PRIORITY_RANK.NORMAL).toBeGreaterThan(PRIORITY_RANK.LOW);
});

it('URGENT and HIGH first, then overdue, then due date', () => {
  const rows = [
    { id: 'low-tomorrow', priority: 'LOW', dueAt: day(1), isOverdue: false },
    { id: 'normal-overdue', priority: 'NORMAL', dueAt: day(-2), isOverdue: true },
    { id: 'high-next-week', priority: 'HIGH', dueAt: day(7), isOverdue: false },
    { id: 'urgent-next-week', priority: 'URGENT', dueAt: day(7), isOverdue: false },
    { id: 'normal-undated', priority: 'NORMAL', dueAt: null, isOverdue: false },
    { id: 'normal-soon', priority: 'NORMAL', dueAt: day(2), isOverdue: false },
    { id: 'high-overdue', priority: 'HIGH', dueAt: day(-1), isOverdue: true },
  ];
  expect([...rows].sort(compareInbox).map((r) => r.id)).toEqual([
    'urgent-next-week',
    'high-overdue',
    'high-next-week',
    'normal-overdue',
    'normal-soon',
    'normal-undated',
    'low-tomorrow',
  ]);
});
