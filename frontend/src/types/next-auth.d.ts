import type { ProfileSummary } from '@/lib/types';
import 'next-auth';
import 'next-auth/jwt';

/**
 * NextAuth's own `Session` and `JWT` types only describe what the library
 * itself sets. Everything this app stores on them — the EduOS tokens returned
 * from the backend exchange, and the Google claims read off the OAuth profile —
 * was previously reached via `as any`, which meant a typo in any of these field
 * names failed silently at runtime instead of at compile time.
 *
 * Declaring them here makes the route handler and every `useSession()` consumer
 * type-safe against the same field list.
 */
declare module 'next-auth' {
  interface Session {
    eduosAccessToken?: string;
    eduosRefreshToken?: string;
    eduosProfile?: ProfileSummary;
    eduosProfiles?: ProfileSummary[];
    eduosRequiresProfileSelection?: boolean;
    eduosError?: 'USER_NOT_FOUND' | 'BACKEND_ERROR' | 'WRONG_DOOR';
    /** The backend's own wording for a WRONG_DOOR refusal — it names the right door. */
    eduosErrorMessage?: string | null;
  }

  /** The subset of the Google OAuth profile this app reads. */
  interface Profile {
    email?: string;
    name?: string;
    picture?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    googleIdToken?: string;
    googleEmail?: string;
    googleName?: string;
    googlePicture?: string;
    eduosAccessToken?: string;
    eduosRefreshToken?: string;
    eduosProfile?: ProfileSummary;
    eduosProfiles?: ProfileSummary[];
    eduosRequiresProfileSelection?: boolean;
    eduosError?: 'USER_NOT_FOUND' | 'BACKEND_ERROR' | 'WRONG_DOOR';
    /** The backend's own wording for a WRONG_DOOR refusal — it names the right door. */
    eduosErrorMessage?: string | null;
  }
}
