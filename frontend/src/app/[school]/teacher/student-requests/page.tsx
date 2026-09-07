'use client';
import { useState } from 'react';
import { PortalShell } from '@/components/shell';
import { CoCurricularReview, ProfileEditReview } from '@/components/student-requests/request-review';

type Tab = 'cocurricular' | 'profile';

/**
 * The class teacher's side of the two student-raised workflows.
 *
 * Added for the student flows and nothing else: a student cannot put a
 * co-curricular achievement on their own profile, nor change their own
 * details, so somebody has to decide — and the only person the school model
 * says that is, is their class teacher. The queues are scoped server-side to
 * the sections this teacher is class teacher of.
 */
export default function TeacherStudentRequests() {
  const [tab, setTab] = useState<Tab>('cocurricular');

  return (
    <PortalShell
      expectedSlug="teacher"
      topbar={{
        title: 'Student Requests',
        desc: 'Co-curricular achievements and profile corrections from students in your class.',
      }}
    >
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'cocurricular' ? 'active' : ''}`} onClick={() => setTab('cocurricular')}>
          Co-curricular
        </button>
        <button className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
          Profile corrections
        </button>
      </div>

      {tab === 'cocurricular' ? <CoCurricularReview /> : <ProfileEditReview />}
    </PortalShell>
  );
}
