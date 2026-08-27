'use client';
import { PortalShell } from '@/components/shell';
import { RegistrationReview } from '@/components/registrations/registration-review';

export default function AdminRegistrations() {
  return (
    <PortalShell
      expectedSlug="admin"
      topbar={{ title: 'Subject Registrations', desc: 'Approve or reject student elective requests.' }}
    >
      <RegistrationReview />
    </PortalShell>
  );
}
