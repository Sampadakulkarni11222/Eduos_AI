'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, hasSession, setSession } from './api';
import { portalHome } from './school-path';
import { invalidateCache } from './cache';
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
      // A different profile means a different permission scope, so nothing
      // cached under the previous one may be reused.
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
    // The read cache is per-tab and in-memory; drop it so the next account
    // signing in on this tab can never be served the previous one's data.
    invalidateCache();
    setMe(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ loading, me, reload, switchProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
