'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, readLoginProfiles } from '@/lib/auth';
import { hasSession } from '@/lib/api';
import { portalHome } from '@/lib/school-path';
import { Spinner } from '@/components/ui';
import type { ProfileSummary } from '@/lib/types';

const ROLE_GLYPH: Record<string, string> = {
  SUPER_ADMIN: '🛡️', ADMIN: '🏛️', PRINCIPAL: '🎓', TEACHER: '👩‍🏫', PARENT: '👨‍👩‍👧',
  STUDENT: '🎒', FINANCE: '💰', LIBRARIAN: '📚', WARDEN: '🔑',
};

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export default function SelectProfilePage() {
  const { loading, me, switchProfile } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Already acting as a profile → straight to its portal.
    if (!loading && me?.profile?.role) {
      router.replace(portalHome(me.profile.tenantId, me.profile.role));
      return;
    }
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    const stashed = readLoginProfiles();
    if (stashed.length === 0 && !loading && !me) {
      // Pre-session but nothing to pick from (e.g. hard reload after storage
      // was cleared) — restart the sign-in flow.
      router.replace('/login');
      return;
    }
    setProfiles(stashed);
  }, [loading, me, router]);

  const pick = async (p: ProfileSummary) => {
    setBusyId(p.id);
    setErr(null);
    try {
      await switchProfile(p);
    } catch {
      setErr('Could not select this profile. Please try again.');
      setBusyId(null);
    }
  };

  if (!profiles || profiles.length === 0) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
        background: 'radial-gradient(160% 120% at 80% -10%, #f5ece0 0%, #ede3d2 35%, #e0d4be 70%, #d5c8ae 100%)',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'Newsreader, serif', fontSize: 26, fontWeight: 700, color: '#2a0a0f' }}>
            Choose a profile
          </div>
          <p style={{ fontSize: 13, color: '#7a6a60', marginTop: 6 }}>
            Your account holds more than one role. Pick which one to continue as.
          </p>
        </div>

        {err && (
          <div style={{
            background: 'rgba(254,242,242,0.9)', border: '1px solid #fca5a5', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, color: '#991b1b', marginBottom: 14,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => void pick(p)}
              disabled={busyId !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(89,22,32,0.1)',
                borderRadius: 16, padding: '14px 18px', cursor: busyId ? 'wait' : 'pointer',
                boxShadow: '0 4px 18px rgba(89,22,32,.08)', fontFamily: 'inherit',
                opacity: busyId && busyId !== p.id ? 0.55 : 1, transition: 'all 0.18s',
              }}
            >
              <span style={{ fontSize: 26 }}>{ROLE_GLYPH[p.role] ?? '👤'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#1a0a0d' }}>{p.displayName}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#9a8a7a', marginTop: 2 }}>{roleLabel(p.role)}</span>
              </span>
              {busyId === p.id
                ? <span className="spinner" style={{ width: 18, height: 18 }} />
                : <span style={{ color: '#9a8a7a' }}>→</span>}
            </button>
          ))}
        </div>

        <button
          onClick={() => router.replace('/login')}
          style={{
            display: 'block', margin: '18px auto 0', background: 'none', border: 'none',
            fontSize: 12.5, color: '#9a8a7a', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
          }}
        >
          ← Sign in with a different account
        </button>
      </div>
    </div>
  );
}
