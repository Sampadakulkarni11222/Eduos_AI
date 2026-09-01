import { cookies } from 'next/headers';
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';

const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile }) {
      // On initial Google sign-in, exchange the Google ID token with our backend
      if (account?.provider === 'google' && account.id_token) {
        token.googleIdToken = account.id_token;
        token.googleEmail = profile?.email;
        token.googleName = profile?.name;
        token.googlePicture = profile?.picture;

        // Exchange with backend to get EduOS JWT tokens
        try {
          const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';
          // Which sign-in address the Google button was pressed at. The OAuth
          // round trip leaves the page, so the door travels in a short-lived
          // cookie written just before the redirect (see DOOR_COOKIE in
          // components/sign-in.tsx). Absent means the platform sign-in, which
          // the backend admits only for platform administrators.
          const door = (await cookies()).get('eduos.door')?.value ?? null;
          const res = await fetch(`${BACKEND_URL}/api/v1/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken: account.id_token,
              schoolId: door,
              email: profile?.email,
              name: profile?.name,
              picture: profile?.picture,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const tokens = data?.data ?? data;
            token.eduosAccessToken = tokens.accessToken;
            token.eduosRefreshToken = tokens.refreshToken;
            token.eduosProfile = tokens.profile ?? tokens.profiles?.[0];
            token.eduosProfiles = tokens.profiles;
            token.eduosRequiresProfileSelection = tokens.requiresProfileSelection;
          } else {
            const body = await res.json().catch(() => ({}));
            // A wrong-door refusal is a real account signing in at the wrong
            // address — distinct from an account the backend has never seen.
            token.eduosError = body?.error?.code === 'WRONG_DOOR' ? 'WRONG_DOOR' : 'USER_NOT_FOUND';
            token.eduosErrorMessage = body?.message ?? null;
          }
        } catch (err) {
          console.error('[NextAuth] Backend exchange failed:', err);
          token.eduosError = 'BACKEND_ERROR';
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Forward EduOS tokens to client via session
      session.eduosAccessToken = token.eduosAccessToken;
      session.eduosRefreshToken = token.eduosRefreshToken;
      session.eduosProfile = token.eduosProfile;
      session.eduosProfiles = token.eduosProfiles;
      session.eduosRequiresProfileSelection = token.eduosRequiresProfileSelection;
      session.eduosError = token.eduosError;
      session.eduosErrorMessage = token.eduosErrorMessage;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
