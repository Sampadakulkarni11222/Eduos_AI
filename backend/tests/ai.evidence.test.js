import { describe, it, expect } from 'vitest';
import { evidenceFor, evidenceLine, toolLabel } from '../src/modules/ai/agent/evidence.js';
import { basedOn } from '../src/modules/ai/drafts.service.js';

/**
 * Evidence-based AI: an assistant answer carries the records it used (which
 * lookup, how many, for whom, which dates, a link), built only from the calls
 * that succeeded; writes and refusals are never cited; and an AI draft says
 * it is based only on what the person entered.
 */
describe('assistant answer evidence', () => {
  it('cites each successful read with count, subject, dates and a link', () => {
    const calls = [
      { tool: 'get_attendance_roster', args: { className: '7 B', from: '2026-10-01', to: '2026-10-14' }, result: { success: true, data: { records: new Array(23).fill({ status: 'PRESENT' }) } } },
      { tool: 'get_pending_fees', args: {}, result: { success: true, data: [{ invoiceNo: 'A' }, { invoiceNo: 'B' }] } },
      { tool: 'mark_attendance', args: {}, result: { success: true, action: { status: 'completed' } } },
      { tool: 'get_student_profile', args: {}, result: { success: false, error: { message: 'No' } } },
    ];
    const ev = evidenceFor(calls);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ label: 'Attendance roster', count: 23, subject: '7 B' });
    expect(ev[0].range).toMatch(/1 Oct 2026 to 14 Oct 2026/);
    expect(ev[0].text).toBe(`Attendance roster: 23 records, for 7 B, ${ev[0].range}`);
    expect(ev[1]).toMatchObject({ count: 2 });
    expect(evidenceLine(ev)).toMatch(/^Based on: Attendance roster: 23 records/);
    expect(evidenceLine([])).toBe('');
    expect(toolLabel('get_absent_students')).toBe('Absent students');
  });
});

describe('AI draft evidence', () => {
  it('says a draft is based only on what was entered', () => {
    const b = basedOn('REPORT_REMARK', { bands: ['A1', 'B2'], attendancePct: 92 }, 1);
    expect(b.source).toMatch(/no school records were read/);
    expect(b.items).toEqual([{ label: 'Marks bands you entered', value: 'A1, B2' }, { label: 'Attendance you entered', value: '92%' }]);
    expect(b.redactedCount).toBe(1);
  });
});
