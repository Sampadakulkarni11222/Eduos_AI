import { NewsletterUnsubscribe } from '@/components/ops/newsletter-unsubscribe';

/**
 * One-click unsubscribe from the newsletter email: /public/newsletter/<school>/unsubscribe?t=<token>.
 * No sign-in; it can only turn the email copy off (the newsletter stays readable in EduOS).
 */
export const metadata = { title: 'Unsubscribe from the newsletter email' };

export default async function Page({ params, searchParams }: { params: Promise<{ school: string }>; searchParams: Promise<{ t?: string }> }) {
  const { school } = await params;
  const { t } = await searchParams;
  return <NewsletterUnsubscribe school={String(school).toLowerCase()} token={typeof t === 'string' ? t : ''} />;
}
