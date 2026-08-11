'use client';
import { Pill } from '../ui';
import { formatCalendarDate } from '@/lib/timetable-dates';
import type { LeaveApplicationDto, LeaveStatus } from '@/lib/types';

const STATUS_TONE: Record<LeaveStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

const fmt = (d: string) => formatCalendarDate(d);

export function LeaveStatusList({ applications }: { applications: LeaveApplicationDto[] }) {
  if (applications.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>You haven't applied for any leave yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {applications.map((a) => {
        const key = a.id || a._id || String(Math.random());
        return (
          <div key={key} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--panel-bg, rgba(0,0,0,.015))', border: '1px solid var(--hairline)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
                    {fmt(a.fromDate)}{a.fromDate !== a.toDate ? ` – ${fmt(a.toDate)}` : ''}
                  </span>
                  {a.leaveType && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-2)', background: 'var(--hairline)', padding: '2px 6px', borderRadius: 4 }}>
                      {a.leaveType}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{a.reason}</div>
                {a.remarks && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
                    <strong>Remarks ({a.reviewedByName ?? 'Reviewer'}):</strong> {a.remarks}
                  </div>
                )}
              </div>
              <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
            </div>
          </div>
        );
      })}
    </div>
  );
}
