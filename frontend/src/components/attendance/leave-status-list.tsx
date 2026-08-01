'use client';
import { Pill } from '../ui';
import { formatCalendarDate } from '@/lib/timetable-dates';
import type { LeaveApplicationDto, LeaveStatus } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

// Leave dates are calendar days, so they render in UTC — see formatCalendarDate.
const fmt = (d: string) => formatCalendarDate(d);

export function LeaveStatusList({ applications }: { applications: LeaveApplicationDto[] }) {
  if (applications.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>You haven't applied for any leave yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {applications.map((a) => (
        <div key={a._id} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,.015)', border: '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
                {fmt(a.fromDate)}{a.fromDate !== a.toDate ? ` – ${fmt(a.toDate)}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2 }}>{a.reason}</div>
              {a.remarks && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>Remarks: {a.remarks}</div>
              )}
            </div>
            <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
          </div>
        </div>
      ))}
    </div>
  );
}
