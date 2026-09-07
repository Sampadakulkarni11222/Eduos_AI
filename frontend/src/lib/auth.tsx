'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, hasSession, setSession } from './api';
import { useSessionActivity } from './session-activity';
import { portalHome } from './school-path';
import { invalidateCache } from './cache';
import { clearActingSchool } from './acting-school';
import type { Me, ProfileSummary } from './types';

const LOGIN_PROFILES_KEY = 'eduos.login.profiles';

/** Persist the profile list between /login and /select-profile (survives reloads). */
export function stashLoginProfiles(profiles: ProfileSummary[]) {
  sessionStorage.setItem(LOGIN_PROFILES_KEY, JSON.stringify(profiles));
}
export function readLoginProfiles(): ProfileSummary[] {
  try {
    return JSON.parse(sessionStorage.getItem(LOGIN_PROFILES_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function clearLoginProfiles() {
  sessionStorage.removeItem(LOGIN_PROFILES_KEY);
}

interface AuthState {
  loading: boolean;
  me: Me | null;
  /** Reload /auth/me; resolves with the fresh value (or null). */
  reload: () => Promise<Me | null>;
  switchProfile: (p: ProfileSummary) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();

  const reload = useCallback(async (): Promise<Me | null> => {
    if (!hasSession()) {
      setMe(null);
      setLoading(false);
      return null;
    }
    try {
      const fresh = await api.me();
      setMe(fresh);
      return fresh;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const switchProfile = useCallback(
    async (p: ProfileSummary) => {
      await setSession(await api.selectProfile(p.id));
      clearLoginProfiles();
      // A different profile means a different school and permission scope, so
      // nothing cached under the previous one may be reused.
      clearActingSchool();
      invalidateCache();
      const fresh = await reload();
      const role = fresh?.profile?.role ?? p.role;
      // A profile switch can also be a school switch, so the school comes from
      // the profile just selected, not from the URL we are leaving.
      router.push(portalHome(fresh?.profile?.tenantId ?? p.tenantId, role));
    },
    [reload, router],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // session may already be dead; clear regardless
    }
    await clearSession();
    clearLoginProfiles();
    // Whichever school a platform admin was looking at does not carry into the
    // next session on this tab.
    clearActingSchool();
    // The read cache is per-tab and in-memory; drop it so the next account
    // signing in on this tab can never be served the previous one's data.
    invalidateCache();
    setMe(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ loading, me, reload, switchProfile, signOut }}>
      <SessionKeeper active={Boolean(me)} signOut={signOut} />
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Renews a session that is in use and ends one that is not.
 *
 * Rendered inside the provider rather than being a bare hook call so the
 * warning has somewhere to live. It draws nothing at all until the last minute
 * of the inactivity window, at which point the person gets the chance to say
 * they are still there — being dropped mid-sentence with no warning is the
 * part of an inactivity policy people actually resent.
 */
function SessionKeeper({ active, signOut }: { active: boolean; signOut: () => Promise<void> }) {
  const { secondsUntilSignOut, keepAlive } = useSessionActivity(active, () => { void signOut(); });

  if (!active || secondsUntilSignOut == null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Session about to expire"
      style={{
        position: 'fixed', left: 20, bottom: 20, zIndex: 9998, maxWidth: 340,
        background: 'var(--panel-bg, #FBF6EC)', border: '1px solid var(--input-border, #E2D7BF)',
        borderRadius: 12, padding: '14px 16px', boxShadow: '0 10px 34px rgba(40,20,15,.18)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-1, #332b25)' }}>
        Still there?
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2, #716757)', marginTop: 4, lineHeight: 1.5 }}>
        You will be signed out in {secondsUntilSignOut} second{secondsUntilSignOut === 1 ? '' : 's'} because of inactivity.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-accent btn-sm" onClick={keepAlive}>Stay signed in</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out now</button>
      </div>
    </div>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
