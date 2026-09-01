'use client';
import { PortalShell } from '@/components/shell';
import { RegistrationReview } from '@/components/registrations/registration-review';

export default function TeacherRegistrations() {
  return (
    <PortalShell
      expectedSlug="teacher"
      topbar={{ title: 'Subject Registrations', desc: 'Elective requests from students in your classes.' }}
    >
      <RegistrationReview />
    </PortalShell>
  );
}
