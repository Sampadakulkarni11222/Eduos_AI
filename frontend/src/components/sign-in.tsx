'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, setSession } from '@/lib/api';
import { useAuth, stashLoginProfiles } from '@/lib/auth';
import { clearActiveSchool } from '@/lib/school';
import { checkDoor } from '@/lib/login-door';
import { portalHome } from '@/lib/school-path';
import { signIn, useSession } from 'next-auth/react';
import type { ProfileSummary, PublicSchoolDto } from '@/lib/types';

/* ── types ────────────────────────────────────────────────────── */
type LoginView = 'enter' | 'code';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  profile?: ProfileSummary;
  profiles?: ProfileSummary[];
  requiresProfileSelection?: boolean;
}

/* ── helpers ──────────────────────────────────────────────────── */
/**
 * Every sign-in screen belongs to exactly one door.
 *
 *   /            the platform. Super Admins only.
 *   /oakridge    that school. Its own people only.
 *
 * The backend enforces the separation that matters — it serves a profile its
 * own school's data whatever address was used — so this is about telling
 * someone plainly that they are at the wrong door, and which one is theirs,
 * rather than dropping them into a portal that looks broken.
 */
/** Where handleGoogleSignIn parks the door for the OAuth round trip. */
const DOOR_COOKIE = 'eduos.door';

class WrongDoorError extends Error {
  constructor(message: string, public goTo?: { href: string; label: string }) {
    super(message);
  }
}

function useCompleteLogin(school: PublicSchoolDto | null) {
  const router = useRouter();
  const { reload, signOut } = useAuth();
  /** Store the session, then route to profile selection or the role portal. */
  return async (result: LoginResult) => {
    await setSession(result);
    if (result.requiresProfileSelection && result.profiles?.length) {
      stashLoginProfiles(result.profiles);
      router.replace('/select-profile');
      return;
    }
    const me = await reload();
    const role = me?.profile?.role ?? result.profile?.role;
    const ownSchool = me?.profile?.tenantId ?? null;

    const verdict = checkDoor({
      doorSchoolSlug: school?.slug ?? null,
      doorSchoolName: school?.name,
      role,
      ownSchoolSlug: ownSchool,
    });
    if (!verdict.ok) {
      await signOut();
      throw new WrongDoorError(verdict.message ?? 'You cannot sign in here.', verdict.goTo);
    }

    if (verdict.destination === 'platform') {
      router.replace('/super-admin');
      return;
    }
    router.replace(role ? portalHome(ownSchool ?? school?.slug, role) : '/');
  };
}

function errMsg(x: unknown): string {
  if (x instanceof WrongDoorError) return x.message;
  if (x instanceof ApiError) {
    const map: Record<string, string> = {
      OTP_WRONG: 'That code is incorrect. Please check and try again.',
      OTP_EXPIRED: 'This code has expired. Request a new one.',
      OTP_LOCKED: 'Too many wrong attempts. Please request a new code.',
      OTP_NOT_FOUND: 'No code was requested, or it was already used. Request a new one.',
      EMAIL_NOT_REGISTERED: 'This email is not registered. Please check the address or contact your school admin.',
      PHONE_NOT_REGISTERED: 'This phone number is not registered. Please check the number or contact your school admin.',
      INVALID_EMAIL: 'Enter a valid email address.',
      INVALID_PHONE: 'Enter a valid 10-digit phone number.',
      OTP_DELIVERY_UNAVAILABLE: 'Message delivery is not configured yet. Contact your administrator.',
      RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
      BAD_CREDENTIALS: 'Email or password is incorrect.',
      GOOGLE_NOT_CONFIGURED: 'Google sign-in is not configured on this server.',
      GOOGLE_TOKEN_INVALID: 'Google sign-in could not be verified. Please try again.',
      USER_NOT_FOUND: 'No EduOS account is linked to this Google account.',
    };
    return map[x.code] ?? x.message ?? 'Sign-in failed. Please try again.';
  }
  return 'Cannot reach the server. Check your connection.';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mirrors the backend's isValidPhone (auth/validators.js): "+91" + exactly 10
 * digits, any other "+<country code>" + 8-15 digits, or a bare 10-digit local
 * number. Catches things like the 9-digit "+91000000004" before it ever hits
 * the network.
 */
function isValidPhone(phone: string): boolean {
  if (phone.startsWith('+91')) return /^\+91\d{10}$/.test(phone);
  if (phone.startsWith('+')) return /^\+\d{8,15}$/.test(phone);
  return /^\d{10}$/.test(phone);
}

function formatIdentifier(input: string): { value: string; isEmail: boolean; valid: boolean } {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    const value = trimmed.toLowerCase();
    return { value, isEmail: true, valid: EMAIL_RE.test(value) };
  }

  let phone = trimmed.replace(/[\s\-\(\)]/g, ''); // strip spaces, dashes, parentheses
  if (!phone.startsWith('+')) {
    if (phone.length === 10) {
      phone = `+91${phone}`;
    } else {
      phone = `+${phone}`;
    }
  }
  return { value: phone, isEmail: false, valid: isValidPhone(phone) };
}

/* ── Shared premium input style ───────────────────────────────── */
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  border: '1.5px solid rgba(89,22,32,0.12)',
  borderRadius: 12,
  fontSize: 14,
  fontFamily: 'inherit',
  color: '#1a0a0d',
  background: 'rgba(255,255,255,0.7)',
  backdropFilter: 'blur(8px)',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  boxSizing: 'border-box',
};

/* ── Premium gradient CTA button ─────────────────────────────── */
function PrimaryBtn({ children, disabled, type = 'submit', onClick }: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        padding: '13px 24px',
        border: 'none',
        borderRadius: 12,
        fontSize: 14.5,
        fontWeight: 700,
        fontFamily: 'inherit',
        letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        background: hover && !disabled
          ? 'linear-gradient(135deg, #7a1e2e 0%, #591620 60%, #3d0f15 100%)'
          : 'linear-gradient(135deg, #6b1a28 0%, #591620 60%, #3d0f15 100%)',
        color: '#fff',
        boxShadow: hover && !disabled
          ? '0 6px 24px rgba(89,22,32,.40), 0 2px 8px rgba(89,22,32,.2)'
          : '0 4px 16px rgba(89,22,32,.28), 0 1px 4px rgba(89,22,32,.15)',
        transform: hover && !disabled ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
      }}
    >
      {children}
    </button>
  );
}

/* ── Navigation back link button style ──────────────────────── */
const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 12.5,
  color: '#9a8a7a',
  cursor: 'pointer',
  textAlign: 'center',
  fontFamily: 'inherit',
  marginTop: 10,
  textDecoration: 'underline',
  textDecorationColor: 'rgba(154,138,122,0.4)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  justifyContent: 'center',
  alignSelf: 'center',
};

/* ── Dev OTP hint (shown only when the server echoes a dev code) ── */
function DevOtpHint({ code }: { code: string }) {
  return (
    <div style={{
      background: 'rgba(240,253,244,0.9)',
      border: '1px solid #86efac',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12.5,
      color: '#166534',
      textAlign: 'center',
      lineHeight: 1.5,
    }}>
      Development mode — your one-time code is <strong style={{ fontSize: 15, letterSpacing: '0.15em' }}>{code}</strong>
    </div>
  );
}

/* ── OTP code input ───────────────────────────────────────────── */
function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="6-digit verification code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder="— — — — — —"
      // The code field only renders once the OTP step appears, so moving focus
      // to it is the intended behaviour rather than a focus steal.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      required
      style={{
        ...inputStyle,
        letterSpacing: '0.5em',
        fontSize: 26,
        textAlign: 'center',
        fontWeight: 700,
        padding: '14px 16px',
        border: '2px solid rgba(89,22,32,0.2)',
      }}
    />
  );
}

/* ── Tiny inline spinner ──────────────────────────────────────── */
function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 14, height: 14,
      border: '2px solid rgba(255,255,255,0.4)',
      borderTopColor: '#591620',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}

/* ── Small error banner ───────────────────────────────────────── */
function ErrBanner({ msg }: { msg: string }) {
  return (
    <div role="alert" style={{
      background: 'rgba(254,242,242,0.9)',
      border: '1px solid #fca5a5',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 13,
      color: '#991b1b',
      lineHeight: 1.5,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
      <span>{msg}</span>
    </div>
  );
}

/* ── The sign-in screen ───────────────────────────────────────── */
/**
 * Rendered at two addresses:
 *   /            with no school   → the platform sign-in (Super Admins)
 *   /[school]    with a school    → that school's sign-in
 *
 * `school` comes from the route, not from storage, so the two can never be
 * confused by a stale value left over from an earlier visit in this tab.
 */
export function SignIn({ school: schoolProp }: { school?: PublicSchoolDto | null } = {}) {
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isEmailType, setIsEmailType] = useState(true);
  const [normalizedVal, setNormalizedVal] = useState('');
  
  const [pageErr, setPageErr] = useState<string | null>(null);
  /** Set when someone signed in at the wrong door: where they should go. */
  const [wrongDoor, setWrongDoor] = useState<{ href: string; label: string } | null>(null);
  // A school is passed in by /[school]; its absence means this is the platform
  // door. Landing here also clears any school remembered from an earlier visit
  // in this tab, so the platform sign-in cannot inherit one.
  const school = schoolProp ?? null;
  useEffect(() => {
    if (!school) clearActiveSchool();
  }, [school]);

  useEffect(() => {
    document.title = school ? `${school.name} · EduOS AI` : 'EduOS AI';
  }, [school]);

  const { loading, me } = useAuth();
  const router = useRouter();
  const complete = useCompleteLogin(school);
  const { data: session } = useSession();

  const isPlatform = !school;
  // The door this screen is: a school's slug, or null for the platform. It
  // travels with every credential so the server refuses an account that
  // belongs elsewhere before it ever issues a code or a session.
  const door = school?.slug ?? null;
  const brandName = school?.name ?? 'EduOS AI';
  const brandSub = school ? 'The AI-native School OS' : 'Platform Administration';
  const brandInitial = (school?.name ?? 'EduOS AI').trim().charAt(0).toUpperCase() || 'E';

  // A demo-only Google popup is available in development builds when no real
  // Google client id has been configured.
  const googleConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  const mockGoogleAvailable = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    if (!loading && me?.profile?.role) {
      router.replace(portalHome(me.profile.tenantId, me.profile.role));
    }
  }, [loading, me, router]);

  // Handle NextAuth real Google Sign-In redirect callback
  useEffect(() => {
    if (session) {
      const sess = session as any;
      if (sess.eduosAccessToken) {
        void complete({
          accessToken: sess.eduosAccessToken,
          refreshToken: sess.eduosRefreshToken,
          profiles: sess.eduosProfiles,
          requiresProfileSelection: sess.eduosRequiresProfileSelection,
        });
      } else if (sess.eduosError === 'WRONG_DOOR') {
        setPageErr(sess.eduosErrorMessage ?? 'This account is not part of this school.');
      } else if (sess.eduosError === 'USER_NOT_FOUND') {
        setPageErr('No EduOS account is linked to this Google account. Ask your school admin to add your email.');
      } else if (sess.eduosError) {
        setPageErr('Google sign-in could not be completed. Please try again.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Handle the development-only mock Google popup callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'GOOGLE_MOCK_LOGIN_SUCCESS') {
        const { email } = event.data;
        try {
          const res = await fetch('/api/auth/google-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, schoolId: door }),
          });
          const data = await res.json();
          if (res.ok) {
            await complete((data?.data ?? data) as LoginResult);
          } else {
            setPageErr(data?.error ?? 'No EduOS account is linked to this Google account.');
          }
        } catch (x) {
          setWrongDoor(x instanceof WrongDoorError ? x.goTo ?? null : null);
          setPageErr(x instanceof WrongDoorError ? x.message : 'Could not authenticate. Please try again.');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleSignIn = () => {
    setPageErr(null);
    if (googleConfigured) {
      // Google takes the browser away from this page and brings it back to a
      // route handler that no longer knows which door was used, so the slug is
      // parked in a short-lived cookie the handler reads. Lax keeps it on the
      // return trip; ten minutes is well past any real sign-in.
      document.cookie = `${DOOR_COOKIE}=${encodeURIComponent(door ?? '')}; path=/; max-age=600; samesite=lax`;
      void signIn('google');
    } else if (mockGoogleAvailable) {
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(
        '/login/google-mock-auth',
        'GoogleMockSignIn',
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no,status=no`
      );
    } else {
      setPageErr('Google sign-in is not configured. Use phone or email OTP instead.');
    }
  };

  const handleSendOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setErr(null);
    setPageErr(null);
    setWrongDoor(null);

    const { value, isEmail, valid } = formatIdentifier(identifier);
    if (!valid) {
      setErr(isEmail ? 'Enter a valid email address.' : 'Enter a valid 10-digit phone number.');
      return;
    }

    setBusy(true);
    try {
      setIsEmailType(isEmail);
      setNormalizedVal(value);

      let res;
      if (isEmail) {
        res = await api.requestEmailOtp(value, door);
      } else {
        res = await api.requestOtp(value, door);
      }
      setDevOtp(res.devOtp ?? null);
      setStep('code');
    } catch (x) {
      setWrongDoor(x instanceof WrongDoorError ? x.goTo ?? null : null);
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setPageErr(null);
    setWrongDoor(null);
    try {
      let loginRes;
      if (isEmailType) {
        loginRes = await api.verifyEmailOtp(normalizedVal, code.trim(), door);
      } else {
        loginRes = await api.verifyOtp(normalizedVal, code.trim(), door);
      }
      await complete(loginRes);
    } catch (x) {
      setWrongDoor(x instanceof WrongDoorError ? x.goTo ?? null : null);
      setErr(errMsg(x));
      setBusy(false);
    }
  };

  return (
    <>
      {/* Global keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blobFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.05); }
          66% { transform: translate(-15px, 15px) scale(0.97); }
        }
        @keyframes blobFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(-25px, 20px) scale(1.04); }
          70% { transform: translate(20px, -10px) scale(0.96); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        #login-identifier:focus, #login-password:focus, #login-otp:focus, #login-email-otp:focus {
          border-color: rgba(89,22,32,0.45) !important;
          box-shadow: 0 0 0 4px rgba(89,22,32,0.08) !important;
          background: rgba(255,255,255,0.9) !important;
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'radial-gradient(160% 120% at 80% -10%, #f5ece0 0%, #ede3d2 35%, #e0d4be 70%, #d5c8ae 100%)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Animated background blobs */}
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <div style={{
            position: 'absolute', width: 560, height: 560, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(89,22,32,.14) 0%, transparent 65%)',
            top: -160, right: -100, filter: 'blur(50px)',
            animation: 'blobFloat1 12s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', width: 440, height: 440, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201,162,63,.11) 0%, transparent 65%)',
            bottom: -80, left: -60, filter: 'blur(45px)',
            animation: 'blobFloat2 15s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(89,22,32,.07) 0%, transparent 65%)',
            top: '40%', left: '10%', filter: 'blur(40px)',
            animation: 'blobFloat1 18s ease-in-out infinite reverse',
          }} />
        </div>

        {/* Wrapper */}
        <div style={{ width: '100%', maxWidth: 420, padding: '0 20px', position: 'relative', zIndex: 1 }}>

          {/* Logo — centered & stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 30, animation: 'cardIn 0.5s ease both' }}>
            <div style={{
              width: 58, height: 58, borderRadius: 16, flexShrink: 0,
              background: 'linear-gradient(135deg, #7a1e2e 0%, #591620 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: 'Newsreader, serif',
              boxShadow: '0 6px 24px rgba(89,22,32,.32), 0 2px 6px rgba(89,22,32,.2)',
              letterSpacing: '-1px',
            }}>
              {brandInitial}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 28, fontWeight: 700, color: '#2a0a0f', letterSpacing: '-0.5px', lineHeight: 1 }}>
                {brandName}
              </div>
              <div style={{ fontSize: 12, color: '#9a8a7a', marginTop: 4, letterSpacing: '0.02em' }}>
                {brandSub}
              </div>
            </div>
          </div>

          {/* Glass login card */}
          <div style={{
            background: 'rgba(255,255,255,0.78)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            borderRadius: 22,
            border: '1px solid rgba(255,255,255,0.85)',
            boxShadow: '0 16px 56px rgba(89,22,32,.13), 0 4px 16px rgba(0,0,0,.07), inset 0 1px 0 rgba(255,255,255,0.9)',
            padding: '32px 28px 28px',
            animation: 'cardIn 0.55s ease 0.05s both',
          }}>
            {/* Heading */}
            <div style={{ textAlign: 'center', marginBottom: 26 }}>
              <h1 style={{
                fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 700,
                color: '#1a0a0d', marginBottom: 6, letterSpacing: '-0.2px',
              }}>
                {isPlatform ? 'Platform sign-in' : 'Welcome back'}
              </h1>
              <p style={{ fontSize: 13, color: '#7a6a60', lineHeight: 1.5 }}>
                {isPlatform
                  ? 'For platform administrators. School staff, students and families sign in at their own school’s address.'
                  : `Sign in to your ${brandName} account`}
              </p>
            </div>

            {pageErr && <div style={{ marginBottom: 14 }}><ErrBanner msg={pageErr} /></div>}
            {wrongDoor && (
              <div style={{ marginBottom: 14, textAlign: 'center' }}>
                <a
                  href={wrongDoor.href}
                  style={{ fontSize: 13, fontWeight: 600, color: '#591620', textDecoration: 'underline' }}
                >
                  {wrongDoor.label} →
                </a>
              </div>
            )}

            {/* Form area */}
            {step === 'enter' ? (
              <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#591620', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }} htmlFor="login-identifier">
                    Email or Phone Number
                  </label>
                  <input
                    id="login-identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="name@school.com or +91 98765 43210"
                    required
                    style={inputStyle}
                  />
                  <p style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 5 }}>
                    We&apos;ll send a 6-digit OTP verification code.
                  </p>
                </div>
                {err && <ErrBanner msg={err} />}
                <PrimaryBtn disabled={busy}>
                  {busy ? (
                    <><Spinner /> Sending…</>
                  ) : (
                    <>Send OTP &nbsp;→</>
                  )}
                </PrimaryBtn>

                {/* Google Sign-in */}
                {(googleConfigured || mockGoogleAvailable) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(89,22,32,0.08)' }} />
                      <span style={{ fontSize: 11, color: '#b0a090', fontWeight: 600 }}>OR</span>
                      <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(89,22,32,0.08)' }} />
                    </div>
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        width: '100%', padding: '13px 20px', border: '1px solid rgba(0,0,0,0.12)',
                        borderRadius: 12, fontSize: 14.5, fontWeight: 600, color: '#3c4043',
                        background: '#ffffff', cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)', transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f8f9fa';
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#ffffff';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.22-.67-.35-1.37-.35-2.1z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Continue with Google{!googleConfigured ? ' (demo)' : ''}</span>
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: '#6b5a50', marginBottom: 14, lineHeight: 1.6 }}>
                    Enter the 6-digit verification code sent to{' '}
                    <strong style={{ color: '#591620' }}>{normalizedVal}</strong>
                  </div>
                  <CodeInput id="login-otp" value={code} onChange={setCode} />
                </div>
                {devOtp && <DevOtpHint code={devOtp} />}
                {err && <ErrBanner msg={err} />}
                <PrimaryBtn disabled={busy}>
                  {busy ? <><Spinner /> Verifying…</> : <>Sign In &nbsp;→</>}
                </PrimaryBtn>
                <button
                  type="button"
                  onClick={() => { setStep('enter'); setCode(''); setErr(null); setDevOtp(null); }}
                  style={backBtnStyle}
                >
                  ← Use a different email or phone number
                </button>
              </form>
            )}

            {/* Footer note */}
            <div style={{
              marginTop: 24,
              paddingTop: 18,
              borderTop: '1px solid rgba(89,22,32,0.07)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: 11.5, color: '#b0a090', lineHeight: 1.6 }}>
                Use your school-issued credentials to sign in.
              </p>
            </div>
          </div>

          {/* Page footer */}
          <p style={{ textAlign: 'center', fontSize: 11, color: '#b0a090', marginTop: 22 }}>
            © {new Date().getFullYear()} {brandName} · All rights reserved
          </p>
        </div>
      </div>
    </>
  );
}

