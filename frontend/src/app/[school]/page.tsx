'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SignIn } from '@/components/sign-in';
import { Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { rememberLastSchool, setActiveSchool } from '@/lib/school';
import { themeStyle, useFavicon } from '@/lib/school-theme';
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
  // Any failure that is not a real 404 -- a 429 from the rate limiter, a 5xx,
  // the network -- says nothing about whether the school exists. It used to be
  // shown as "404 · No school at this address".
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A school is recognised at its door before it is recognised anywhere else.
  useFavicon(school?.faviconUrl ?? null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setMissing(false);
    setUnreachable(null);

    api.publicSchool(slug)
      .then((found) => {
        if (cancelled) return;
        setActiveSchool(found);
        rememberLastSchool(found);
        setSchool(found);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setUnreachable(lookupFailureMessage(err));
      });

    return () => { cancelled = true; };
  }, [slug, attempt]);

  if (unreachable) {
    return (
      <div role="alert" style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 20, color: '#1a0a0d' }}>Can&apos;t reach the school right now</div>
        <p style={{ fontSize: 13.5, color: '#7a6a60', maxWidth: 380, lineHeight: 1.6 }}>{unreachable}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          style={{
            marginTop: 8, border: '1px solid #591620', borderRadius: 8, background: 'none', cursor: 'pointer',
            padding: '6px 16px', fontFamily: 'Newsreader, serif', fontSize: 15, color: '#591620',
          }}
        >
          Try again
        </button>
      </div>
    );
  }

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
  //
  // Its colours are scoped to this wrapper, exactly as a portal scopes them, so
  // one school's door cannot tint the platform sign-in at `/`.
  return (
    <div style={themeStyle(school.cssVariables ?? {})}>
      <SignIn school={school} />
    </div>
  );
}

/** What to tell someone whose school lookup failed for a reason other than "no such school". */
function lookupFailureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many requests from this network just now. Wait a moment and try again.';
    if (err.status >= 500) return 'The server had a problem loading this school. Try again in a moment.';
    return 'Something went wrong loading this school. Try again.';
  }
  return 'Check your internet connection, then try again.';
}
