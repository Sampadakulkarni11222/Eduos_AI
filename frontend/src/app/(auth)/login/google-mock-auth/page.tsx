import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

/**
 * The development-only stand-in for Google's account chooser.
 *
 * It was already inert in production — the sign-in screen never opens it there
 * and /api/auth/google-exchange answers 501 — but the page itself was still
 * built and served: a screen drawn to look like Google's, listing the demo
 * accounts, at a public URL. A production build now has no such page.
 *
 * The chooser is imported inside the condition, not at the top of the file.
 * NODE_ENV is a constant at build time, so in a production build the bundler
 * drops the branch and the import with it: the component and its list of demo
 * accounts are not emitted as a chunk at all, rather than emitted and unused.
 */
const MockGoogleChooser =
  process.env.NODE_ENV === 'production'
    ? null
    : dynamic(() => import('./mock-chooser').then((m) => m.MockGoogleChooser));

export default function GoogleMockAuthPage() {
  if (!MockGoogleChooser) notFound();
  return <MockGoogleChooser />;
}
