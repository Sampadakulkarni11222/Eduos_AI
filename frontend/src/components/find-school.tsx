'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { portalHome } from '@/lib/school-path';
import { forgetSchool, lookupSchool, parseSchoolCode, recallSchool, rememberSchool } from '@/lib/school-lookup';
import { Spinner } from './ui';

/**
 * "Which school are you with?" — the installed app's first screen.
 *
 * Three kinds of visitor arrive here and only one needs the form:
 *
 *   signed in                → their own portal, as `/` would send them
 *   been here before         → their school's sign-in door
 *   new, or changing school  → the form
 *
 * `?change=1` skips the second case, so "choose a different school" on a
 * school's door does not bounce straight back to it.
 *
 * Finding a school grants nothing. The form ends at that school's ordinary
 * sign-in screen, and every check there and behind it is unchanged.
 */
export function FindSchool() {
  const { loading, me } = useAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (me?.profile?.id && me.profile.role) {
      router.replace(portalHome(me.profile.tenantId, me.profile.role));
      return;
    }
    // Read from the address bar rather than useSearchParams, which would force
    // this otherwise static page to opt out of prerendering.
    const changing = new URLSearchParams(window.location.search).has('change');
    if (changing) {
      forgetSchool();
    } else {
      const remembered = recallSchool();
      if (remembered) {
        router.replace(`/${remembered}`);
        return;
      }
    }
    setReady(true);
  }, [loading, me, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);

    const parsed = parseSchoolCode(code);
    if (!parsed.ok) {
      setErr(parsed.message);
      return;
    }

    setBusy(true);
    const result = await lookupSchool(parsed.slug);
    if (result.status === 'found') {
      // The slug the server answered with, not the one typed.
      rememberSchool(result.school.slug);
      router.push(`/${result.school.slug}`);
      return; // stay busy while the door loads
    }
    setErr(result.message);
    setBusy(false);
  };

  if (!ready) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        background: 'radial-gradient(160% 120% at 80% -10%, #f5ece0 0%, #ede3d2 35%, #e0d4be 70%, #d5c8ae 100%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 26 }}>
          <div
            aria-hidden
            style={{
              width: 58, height: 58, borderRadius: 16,
              background: 'linear-gradient(150deg,#F2E4CC,#D8B98A)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Newsreader, serif', fontWeight: 700, fontSize: 30, color: '#591620',
              boxShadow: '0 6px 24px rgba(89,22,32,.2)',
            }}
          >
            E
          </div>
          <div style={{ fontFamily: 'Newsreader, serif', fontSize: 28, fontWeight: 700, color: '#2a0a0f', lineHeight: 1 }}>
            EduOS AI
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.82)',
            borderRadius: 22,
            border: '1px solid rgba(255,255,255,0.85)',
            boxShadow: '0 16px 56px rgba(89,22,32,.13), 0 4px 16px rgba(0,0,0,.07)',
            padding: '30px 24px 24px',
          }}
        >
          <h1 style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 700, color: '#1a0a0d', textAlign: 'center', margin: '0 0 6px' }}>
            Find your school
          </h1>
          <p style={{ fontSize: 13.5, color: '#6b5a50', lineHeight: 1.55, textAlign: 'center', margin: '0 0 22px' }}>
            Enter the school code your school gave you. You can also paste your school&apos;s EduOS link.
          </p>

          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                htmlFor="school-code"
                style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#591620', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                School code
              </label>
              <input
                id="school-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. oakridge"
                // A code is not a word: keep the phone's keyboard from
                // capitalising or "correcting" it.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="organization"
                inputMode="url"
                enterKeyHint="go"
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? 'school-code-error' : undefined}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '13px 16px',
                  border: '1.5px solid rgba(89,22,32,0.18)', borderRadius: 12,
                  // 16px: anything smaller makes mobile browsers zoom the page on focus.
                  fontSize: 16, fontFamily: 'inherit', color: '#1a0a0d', background: '#fff',
                }}
              />
            </div>

            {err && (
              <div
                id="school-code-error"
                role="alert"
                style={{
                  background: 'rgba(254,242,242,0.9)', border: '1px solid #fca5a5', borderRadius: 10,
                  padding: '10px 14px', fontSize: 13, color: '#991b1b', lineHeight: 1.5,
                }}
              >
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%', minHeight: 48, padding: '13px 24px', border: 'none', borderRadius: 12,
                fontSize: 15, fontWeight: 700, fontFamily: 'inherit', color: '#fff',
                background: 'linear-gradient(135deg, #6b1a28 0%, #591620 60%, #3d0f15 100%)',
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Looking up…' : 'Continue'}
            </button>
          </form>

          <p style={{ fontSize: 12.5, color: '#9a8a7a', lineHeight: 1.6, textAlign: 'center', margin: '20px 0 0' }}>
            Don&apos;t know your code? Ask your school office or administrator.
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12.5, marginTop: 20 }}>
          <Link href="/login" style={{ color: '#7a6a60', textDecoration: 'underline' }}>
            Platform administrator sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
