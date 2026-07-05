'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, hasSession, setSession } from './api';
import { ROLE_TO_SLUG } from './portals';
import type { Me, ProfileSummary } from './types';

interface AuthState {
  loading: boolean;
  me: Me | null;
  /** Profiles returned by login/OTP for the profile-selection screen. */
  loginProfiles: ProfileSummary[];
  reload: () => Promise<void>;
  switchProfile: (p: ProfileSummary) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [loginProfiles, setLoginProfiles] = useState<ProfileSummary[]>([]);
  const router = useRouter();

  const reload = useCallback(async () => {
    if (!hasSession()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const switchProfile = useCallback(
    async (p: ProfileSummary) => {
      setSession(await api.selectProfile(p.id));
      await reload();
      router.push(`/${ROLE_TO_SLUG[p.role] ?? 'admin'}`);
    },
    [reload, router],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // session may already be dead; clear regardless
    }
    clearSession();
    setMe(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ loading, me, loginProfiles, reload, switchProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
