import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { SignIn } from '@/components/sign-in';
import type { PublicSchoolDto } from '@/lib/types';

/**
 * Signing out after "Continue with Google".
 *
 * Google sign-in comes back through NextAuth, whose session cookie carried the
 * EduOS tokens for the round trip — and then kept them, for as long as that
 * cookie lives. The sign-in screen signs in with whatever tokens it finds
 * there, and signing out of EduOS never touched that cookie. So opening the
 * school's sign-in page after signing out handed the same tokens straight back:
 * the access token is good for fifteen minutes whatever happens to the session
 * (the backend does not look it up), which is long enough for the next person
 * to pick up a shared phone.
 *
 * These drive the real AuthProvider, API client and sign-in screen. Only the
 * network and NextAuth's own client are stood in for, and the NextAuth stand-in
 * behaves as the library does: its session is there until it is signed out.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn(), back: vi.fn() }),
}));

type GoogleSession = Record<string, unknown> | null;
const nextAuth = vi.hoisted(() => ({
  session: null as GoogleSession,
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: nextAuth.session, status: nextAuth.session ? 'authenticated' : 'unauthenticated' }),
  signIn: nextAuth.signIn,
  signOut: nextAuth.signOut,
}));

const SCHOOL: PublicSchoolDto = { slug: 'oakridge', name: 'Oakridge Academy' };
const ACCESS = 'access-token-from-google-sign-in';
const REFRESH = 'refresh-token-from-google-sign-in';
const ME = { profile: { id: 'p1', role: 'STUDENT', tenantId: 'oakridge', tenantName: 'Oakridge Academy', displayName: 'Asha' } };

/** What the backend would do: the access token works until it expires, signed out or not. */
let accessTokenStillValid = true;
/** Every refresh token handed to the cookie route, in order. */
let cookieWrites: string[] = [];

function installFetch() {
  cookieWrites = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const json = (status: number, body: unknown) =>
      new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url === '/api/session' && method === 'POST') {
      cookieWrites.push(JSON.parse(String(init.body)).refreshToken);
      return json(204, null);
    }
    if (url === '/api/session' && method === 'DELETE') return json(204, null);
    // The refresh token was revoked by signing out.
    if (url === '/api/session/refresh') return json(401, { error: 'REFRESH_REJECTED' });

    const auth = new Headers(init.headers).get('Authorization');
    if (url.endsWith('/api/v1/auth/me')) {
      return auth === `Bearer ${ACCESS}` && accessTokenStillValid
        ? json(200, { success: true, data: ME })
        : json(401, { success: false, message: 'Invalid or expired token' });
    }
    if (url.endsWith('/api/v1/auth/logout')) return json(200, { success: true, data: null });
    return json(404, { success: false, message: `unexpected ${method} ${url}` });
  }));
}

function SignOutButton() {
  const { signOut } = useAuth();
  return <button type="button" onClick={() => void signOut()}>test sign out</button>;
}

const renderDoor = () =>
  render(
    <AuthProvider>
      <SignIn school={SCHOOL} />
      <SignOutButton />
    </AuthProvider>,
  );

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  nextAuth.signIn.mockReset();
  // As NextAuth's own signOut does: the session is gone once it resolves.
  nextAuth.signOut.mockReset().mockImplementation(async () => {
    nextAuth.session = null;
  });
  nextAuth.session = null;
  accessTokenStillValid = true;
  localStorage.clear();
  sessionStorage.clear();
  installFetch();
});

afterEach(() => vi.unstubAllGlobals());

/** Arrive back from Google and land in the portal. */
async function signInWithGoogle() {
  nextAuth.session = { eduosAccessToken: ACCESS, eduosRefreshToken: REFRESH };
  const view = renderDoor();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/oakridge/student'));
  return view;
}

describe('after Continue with Google', () => {
  it('still signs the user in', async () => {
    await signInWithGoogle();
    expect(cookieWrites).toEqual([REFRESH]);
  });

  it('does not leave the EduOS tokens in the NextAuth session once they are handed over', async () => {
    await signInWithGoogle();
    await waitFor(() => expect(nextAuth.signOut).toHaveBeenCalledWith({ redirect: false }));
    expect(nextAuth.session).toBeNull();
  });

  it('hands the tokens over once, however often the sign-in screen is shown', async () => {
    const view = await signInWithGoogle();
    // Returning to the school's address while signed in mounts the screen again.
    view.unmount();
    renderDoor();
    await waitFor(() => expect(replace.mock.calls.length).toBeGreaterThanOrEqual(2));
    // Writing the first refresh token back over a rotated one would be read by
    // the backend as a replay, and end every session on the account.
    expect(cookieWrites).toEqual([REFRESH]);
  });
});

describe('signing out', () => {
  it('ends the NextAuth session as well as the EduOS one', async () => {
    await signInWithGoogle();
    nextAuth.signOut.mockClear();
    // Even if the hand-over clean-up had not happened, signing out must do it.
    nextAuth.session = { eduosAccessToken: ACCESS, eduosRefreshToken: REFRESH };

    fireEvent.click(screen.getByRole('button', { name: 'test sign out' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));

    expect(nextAuth.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(nextAuth.session).toBeNull();
  });

  it('does not sign the user back in when the school’s sign-in page is opened again', async () => {
    const view = await signInWithGoogle();
    fireEvent.click(screen.getByRole('button', { name: 'test sign out' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    view.unmount();
    cleanup();
    replace.mockClear();
    cookieWrites = [];

    // The next person opens the school's address on the same device, inside
    // the fifteen minutes the access token is still good for.
    renderDoor();
    expect(await screen.findByLabelText('Email or Phone Number')).toBeInTheDocument();
    // Give any stray sign-in every chance to finish before concluding it did not.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(replace).not.toHaveBeenCalled();
    expect(cookieWrites).toEqual([]);
  });

  it('still completes when NextAuth cannot be reached', async () => {
    await signInWithGoogle();
    nextAuth.signOut.mockRejectedValue(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'test sign out' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem('eduos.session')).toBeNull();
  });
});

describe('a Google sign-in the backend refused', () => {
  it('shows the reason once, then forgets it', async () => {
    nextAuth.session = { eduosError: 'USER_NOT_FOUND' };
    const view = renderDoor();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no eduos account is linked/i);
    await waitFor(() => expect(nextAuth.signOut).toHaveBeenCalledWith({ redirect: false }));
    // It used to stay in the cookie and greet every later visit with the error.
    view.unmount();
    renderDoor();
    await screen.findByLabelText('Email or Phone Number');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat a wrong-door refusal as a sign-in', async () => {
    nextAuth.session = { eduosError: 'WRONG_DOOR', eduosErrorMessage: 'This account is not part of Oakridge Academy.' };
    renderDoor();
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not part of Oakridge Academy.');
    expect(replace).not.toHaveBeenCalled();
    expect(cookieWrites).toEqual([]);
  });
});
