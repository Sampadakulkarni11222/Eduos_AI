import { PublicAdmissionForm } from '@/components/public-admission-form';

/**
 * The public online admission form for one school: /public/admission/<school>.
 * Outside every portal and needs no sign-in (like /public/announcements).
 */
export const metadata = { title: 'Online admission application' };

export default async function PublicAdmissionPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return <PublicAdmissionForm school={String(school).toLowerCase()} />;
}
