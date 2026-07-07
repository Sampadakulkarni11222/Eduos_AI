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
        token.googleEmail = (profile as any)?.email;
        token.googleName = (profile as any)?.name;
        token.googlePicture = (profile as any)?.picture;

        // Exchange with backend to get EduOS JWT tokens
        try {
          const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';
          const res = await fetch(`${BACKEND_URL}/api/v1/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken: account.id_token,
              email: (profile as any)?.email,
              name: (profile as any)?.name,
              picture: (profile as any)?.picture,
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
            // Backend doesn't have this user — mark as needing registration
            token.eduosError = 'USER_NOT_FOUND';
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
      (session as any).eduosAccessToken = token.eduosAccessToken;
      (session as any).eduosRefreshToken = token.eduosRefreshToken;
      (session as any).eduosProfile = token.eduosProfile;
      (session as any).eduosProfiles = token.eduosProfiles;
      (session as any).eduosRequiresProfileSelection = token.eduosRequiresProfileSelection;
      (session as any).eduosError = token.eduosError;
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
