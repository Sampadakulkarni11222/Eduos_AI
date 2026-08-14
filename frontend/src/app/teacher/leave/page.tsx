'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, SkeletonRows, useToast } from '@/components/ui';
import { ApplyLeaveModal } from '@/components/attendance/apply-leave-modal';
import { LeaveStatusList } from '@/components/attendance/leave-status-list';
import { api } from '@/lib/api';
import type { LeaveApplicationDto } from '@/lib/types';

export default function TeacherLeavePage() {
  const [applications, setApplications] = useState<LeaveApplicationDto[] | null>(null);
  const [showApply, setShowApply] = useState(false);
  const toast = useToast();

  const loadLeave = () => {
    api.myLeaveApplications()
      .then(setApplications)
      .catch(() => {
        setApplications([]);
        toast('Failed to load leave applications.', 'error');
      });
  };

  useEffect(loadLeave, []);

  return (
    <PortalShell
      expectedSlug="teacher"
      topbar={{
        title: 'Leave Applications',
        desc: 'Apply for staff leave and view status of past requests.',
        actions: (
          <Button onClick={() => setShowApply(true)}>+ Apply for Leave</Button>
        ),
      }}
    >
      <Card pad>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 14 }}>My Leave History</div>
        {applications === null ? (
          <SkeletonRows rows={4} />
        ) : (
          <LeaveStatusList applications={applications} />
        )}
      </Card>

      {showApply && (
        <ApplyLeaveModal
          onClose={() => setShowApply(false)}
          onApplied={() => {
            setShowApply(false);
            loadLeave();
          }}
        />
      )}
    </PortalShell>
  );
}
