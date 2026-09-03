'use client';
import { PortalShell } from '@/components/shell';
import { LeaveReview } from '@/components/leave/leave-review';

export default function TeacherLeave() {
  return (
    <PortalShell
      expectedSlug="teacher"
      topbar={{ title: 'Leave Requests', desc: 'Leave applications from students in your classes.' }}
    >
      <LeaveReview />
    </PortalShell>
  );
}
