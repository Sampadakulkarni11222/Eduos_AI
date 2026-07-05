'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, setSession } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_TO_SLUG } from '@/lib/portals';
import { signIn, useSession } from 'next-auth/react';

/* ── types ────────────────────────────────────────────────────── */
type LoginView = 'menu' | 'phone' | 'email' | 'google';

/* ── helpers ──────────────────────────────────────────────────── */
function useAfterLogin() {
  const router = useRouter();
  const { reload, me } = useAuth();
  return async () => {
    await reload();
    if (me?.profile?.role) {
      router.replace(`/${ROLE_TO_SLUG[me.profile.role]}`);
    } else {
      router.replace('/');
    }
  };
}

function errMsg(x: unknown): string {
  if (x instanceof ApiError) {
    const map: Record<string, string> = {
      OTP_WRONG: 'That code is incorrect. Please check and try again.',
      OTP_EXPIRED: 'This code has expired. Request a new one.',
      OTP_LOCKED: 'Too many wrong attempts. Please request a new code.',
      OTP_RATE_LIMITED: 'A code was just sent. Please wait a moment.',
      BAD_CREDENTIALS: 'Email or password is incorrect.',
    };
    return map[x.code] ?? 'Sign-in failed. Please try again.';
  }
  return 'Cannot reach the server. Check your connection.';
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

/* ── Phone OTP form ───────────────────────────────────────────── */
function PhoneForm({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const after = useAfterLogin();

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // Use Next.js proxy so the OTP appears in the backend terminal
      const res = await fetch('/api/otp/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error ?? 'Failed to send OTP');
      }
      setStep('code');
    }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not send OTP. Try again.'); }
    finally { setBusy(false); }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      setSession(await api.verifyOtp(phone.trim(), code.trim()));
      await after();
    }
    catch (x) { setErr(errMsg(x)); }
    finally { setBusy(false); }
  };

  if (step === 'enter') return (
    <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#591620', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }} htmlFor="login-phone">
          Phone Number
        </label>
        <input
          id="login-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          required
          style={inputStyle}
        />
        <p style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 5 }}>
          We'll send a 6-digit OTP to this number.
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
      <button type="button" onClick={onBack} style={backBtnStyle}>
        ← Back to sign-in options
      </button>
    </form>
  );

  return (
    <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#6b5a50', marginBottom: 14, lineHeight: 1.6 }}>
          Enter the 6-digit code sent to{' '}
          <strong style={{ color: '#591620' }}>{phone}</strong>
          <div style={{ fontSize: 11.5, color: '#b0a090', marginTop: 4 }}>
            Check the <strong style={{ color: '#6b1a28' }}>backend terminal</strong> for your OTP code.
          </div>
        </div>
        <input
          id="login-otp"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="— — — — — —"
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
      </div>
      {err && <ErrBanner msg={err} />}
      <PrimaryBtn disabled={busy}>
        {busy ? <><Spinner /> Verifying…</> : <>Sign In &nbsp;→</>}
      </PrimaryBtn>
      <button
        type="button"
        onClick={() => { setStep('enter'); setCode(''); setErr(null); }}
        style={backBtnStyle}
      >
        ← Use a different number
      </button>
    </form>
  );
}

/* ── Email OTP form ───────────────────────────────────────────── */
function EmailOtpForm({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const after = useAfterLogin();

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // Call Next.js proxy — real OTP is printed to the terminal
      const res = await fetch('/api/otp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), action: 'send' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error ?? 'Failed to send OTP');
      }
      setStep('code');
    }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not send OTP. Try again.'); }
    finally { setBusy(false); }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // Verify via Next.js proxy — it checks the stored OTP and authenticates
      const res = await fetch('/api/otp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: code.trim(), action: 'verify' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data?.code ?? 'ERROR';
        const msg = data?.error ?? 'Verification failed. Please try again.';
        const mapped: Record<string, string> = {
          OTP_WRONG: 'That code is incorrect. Please try again.',
          OTP_EXPIRED: 'This code has expired. Request a new one.',
          OTP_NOT_FOUND: 'No OTP found. Please request a new code.',
          BAD_CREDENTIALS: 'Account not found. Check your email address.',
        };
        setErr(mapped[code] ?? msg);
        return;
      }
      // data is the backend auth response wrapped as { data: { accessToken, refreshToken } } or directly
      const tokens = data?.data ?? data;
      setSession(tokens);
      await after();
    }
    catch (x) { setErr('Could not verify OTP. Please try again.'); }
    finally { setBusy(false); }
  };

  if (step === 'enter') return (
    <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#591620', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }} htmlFor="login-email">
          Email Address
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@school.com"
          required
          style={inputStyle}
        />
        <p style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 5 }}>
          We'll send a 6-digit OTP verification code to your inbox.
        </p>
      </div>
      {err && <ErrBanner msg={err} />}
      <PrimaryBtn disabled={busy}>
        {busy ? <><Spinner /> Sending…</> : <>Send OTP &nbsp;→</>}
      </PrimaryBtn>
      <button type="button" onClick={onBack} style={backBtnStyle}>
        ← Back to sign-in options
      </button>
    </form>
  );

  return (
    <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#6b5a50', marginBottom: 14, lineHeight: 1.6 }}>
          Enter the 6-digit verification code sent to{' '}
          <strong style={{ color: '#591620' }}>{email}</strong>
          <div style={{ fontSize: 11.5, color: '#b0a090', marginTop: 4 }}>
            Check the <strong style={{ color: '#6b1a28' }}>backend terminal</strong> for your OTP code.
          </div>
        </div>
        <input
          id="login-email-otp"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="— — — — — —"
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
      </div>
      {err && <ErrBanner msg={err} />}
      <PrimaryBtn disabled={busy}>
        {busy ? <><Spinner /> Verifying…</> : <>Sign In &nbsp;→</>}
      </PrimaryBtn>
      <button
        type="button"
        onClick={() => { setStep('enter'); setCode(''); setErr(null); }}
        style={backBtnStyle}
      >
        ← Use a different email
      </button>
    </form>
  );
}

/* ── Mock Google login accounts selector ──────────────────────── */
interface MockAccount {
  email: string;
  name: string;
  role: string;
  avatar: string;
}

const MOCK_GOOGLE_USERS: MockAccount[] = [
  // ── System roles ──────────────────────────────────────────────────
  { email: 'owner@schoolerp.com',     name: 'Default Owner',    role: 'Superadmin', avatar: '👑' },
  { email: 'admin@schoolerp.com',     name: 'Demo Admin',       role: 'Admin',      avatar: '🏛️' },
  { email: 'principal@schoolerp.com', name: 'Demo Principal',   role: 'Principal',  avatar: '🎓' },
  // ── Teachers ──────────────────────────────────────────────────────
  { email: 'teacher@schoolerp.com',   name: 'Demo Teacher',     role: 'Teacher',    avatar: '👩‍🏫' },
  { email: 'arjun.sharma@eduos.com',  name: 'Arjun Sharma',     role: 'Teacher',    avatar: '👨‍🏫' },
  { email: 'priya.patel@eduos.com',   name: 'Priya Patel',      role: 'Teacher',    avatar: '👩‍🏫' },
  { email: 'ravi.kumar@eduos.com',    name: 'Ravi Kumar',       role: 'Teacher',    avatar: '👨‍🏫' },
  { email: 'sunita.singh@eduos.com',  name: 'Sunita Singh',     role: 'Teacher',    avatar: '👩‍🏫' },
  { email: 'mohan.verma@eduos.com',   name: 'Mohan Verma',      role: 'Teacher',    avatar: '👨‍🏫' },
  { email: 'kavita.nair@eduos.com',   name: 'Kavita Nair',      role: 'Teacher',    avatar: '👩‍🏫' },
  { email: 'deepak.joshi@eduos.com',  name: 'Deepak Joshi',     role: 'Teacher',    avatar: '👨‍🏫' },
  { email: 'anita.gupta@eduos.com',   name: 'Anita Gupta',      role: 'Teacher',    avatar: '👩‍🏫' },
  // ── Sample students ───────────────────────────────────────────────
  { email: 'student1@eduos.com',      name: 'Student One',      role: 'Student',    avatar: '🎒' },
  { email: 'student2@eduos.com',      name: 'Student Two',      role: 'Student',    avatar: '🎒' },
];



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
    <div style={{
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

/* ── Main login page ──────────────────────────────────────────── */
export default function LoginPage() {
  const [view, setView] = useState<LoginView>('menu');
  const { loading, me } = useAuth();
  const router = useRouter();
  const after = useAfterLogin();
  const { data: session } = useSession();

  useEffect(() => {
    if (!loading && me?.profile?.role) {
      router.replace(`/${ROLE_TO_SLUG[me.profile.role]}`);
    }
  }, [loading, me, router]);

  // Handle NextAuth real Google Sign-In redirect callback
  useEffect(() => {
    if (session) {
      const sess = session as any;
      if (sess.eduosAccessToken) {
        setSession({
          accessToken: sess.eduosAccessToken,
          refreshToken: sess.eduosRefreshToken,
        });
        after();
      } else if (sess.eduosError === 'USER_NOT_FOUND') {
        alert('No EduOS account linked to this Google account.');
      }
    }
  }, [session]);

  // Handle simulated/mock Google OAuth popup callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'GOOGLE_MOCK_LOGIN_SUCCESS') {
        const { email } = event.data;
        try {
          const res = await fetch('/api/auth/google-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await res.json();
          if (res.ok) {
            const tokens = data?.data ?? data;
            setSession(tokens);
            await after();
          } else {
            alert(data?.error ?? 'No EduOS account linked to this Google account.');
          }
        } catch {
          alert('Could not authenticate. Please try again.');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGoogleSignIn = () => {
    if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
      signIn('google');
    } else {
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(
        '/login/google-mock-auth',
        'GoogleMockSignIn',
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no,status=no`
      );
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
        #login-phone:focus, #login-email:focus, #login-password:focus, #login-otp:focus, #login-email-otp:focus {
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
              E
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 28, fontWeight: 700, color: '#2a0a0f', letterSpacing: '-0.5px', lineHeight: 1 }}>
                EduOS AI
              </div>
              <div style={{ fontSize: 12, color: '#9a8a7a', marginTop: 4, letterSpacing: '0.02em' }}>
                The AI-native School OS
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
                Welcome back
              </h1>
              <p style={{ fontSize: 13, color: '#7a6a60', lineHeight: 1.5 }}>
                Sign in to your EduOS account
              </p>
            </div>

            {/* Form area */}
            {view === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 1. Continue with Google */}
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
                  <span>Continue with Google</span>
                </button>

                {/* 2. Continue with Phone */}
                <button
                  type="button"
                  onClick={() => setView('phone')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    width: '100%', padding: '13px 20px', border: 'none',
                    borderRadius: 12, fontSize: 14.5, fontWeight: 700, color: '#fff',
                    background: 'linear-gradient(135deg, #6b1a28 0%, #591620 100%)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 4px 14px rgba(89,22,32,.25)', transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #7a1e2e 0%, #591620 100%)';
                    e.currentTarget.style.boxShadow = '0 6px 18px rgba(89,22,32,.35)';
                    e.currentTarget.style.transform = 'translateY(-0.5px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #6b1a28 0%, #591620 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(89,22,32,.25)';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  <span style={{ fontSize: 16 }}>📱</span>
                  <span>Continue with Phone Number</span>
                </button>

                {/* 3. Continue via Email */}
                <button
                  type="button"
                  onClick={() => setView('email')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    width: '100%', padding: '13px 20px', border: 'none',
                    borderRadius: 12, fontSize: 14.5, fontWeight: 700, color: '#fff',
                    background: 'linear-gradient(135deg, #2c3e50 0%, #1a252f 100%)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 4px 14px rgba(44,62,80,.25)', transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #34495e 0%, #1a252f 100%)';
                    e.currentTarget.style.boxShadow = '0 6px 18px rgba(44,62,80,.35)';
                    e.currentTarget.style.transform = 'translateY(-0.5px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #2c3e50 0%, #1a252f 100%)';
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(44,62,80,.25)';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  <span style={{ fontSize: 16 }}>✉️</span>
                  <span>Continue via Email OTP</span>
                </button>
              </div>
            )}

            {view === 'phone' && (
              <PhoneForm onBack={() => setView('menu')} />
            )}

            {view === 'email' && (
              <EmailOtpForm onBack={() => setView('menu')} />
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
            © {new Date().getFullYear()} EduOS AI · All rights reserved
          </p>
        </div>
      </div>
    </>
  );
}
