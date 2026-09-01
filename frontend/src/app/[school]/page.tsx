'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SignIn } from '@/components/sign-in';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { setActiveSchool } from '@/lib/school';
import type { PublicSchoolDto } from '@/lib/types';

/**
 * A school's own front door: `/oakridge`, `/nvmp`.
 *
 * The slug is resolved against the schools API before anything renders, so a
 * URL that names no school gets "not found" rather than a login form that
 * could never work. A resolved school is remembered for the tab, which is what
 * brands the form and what sign-in checks the account against.
 *
 * This is a dynamic segment, so it only ever runs for a path that matches no
 * real route — `/admin` and the other portals still win on their own names.
 */
export default function SchoolEntryPage() {
  const params = useParams<{ school: string }>();
  const router = useRouter();
  const slug = String(params?.school ?? '').toLowerCase();

  const [school, setSchool] = useState<PublicSchoolDto | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;

    api.publicSchool(slug)
      .then((found) => {
        if (cancelled) return;
        setActiveSchool(found);
        setSchool(found);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    return () => { cancelled = true; };
  }, [slug]);

  if (missing) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 44, color: '#591620' }}>404</div>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 20, color: '#1a0a0d' }}>No school at this address</div>
        <p style={{ fontSize: 13.5, color: '#7a6a60', maxWidth: 380, lineHeight: 1.6 }}>
          <strong>{slug}</strong> does not match any school on this platform. Check the link, or ask your
          school administrator for the right address.
        </p>
        <button
          type="button"
          onClick={() => router.replace('/login')}
          style={{
            marginTop: 8, border: 'none', background: 'none', cursor: 'pointer',
            fontFamily: 'Newsreader, serif', fontSize: 15, color: '#591620', textDecoration: 'underline',
          }}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (!school) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  // The same sign-in screen every school uses. The school is passed down rather
  // than read from storage, so this door can never be confused with the
  // platform one at `/`.
  return <SignIn school={school} />;
}
